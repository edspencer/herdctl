/**
 * Translate SDK lifecycle events into herdctl {@link SessionLifecycleSignal}s.
 *
 * Two surfaces feed the session-reaper:
 * - {@link buildLifecycleHooks} — the main-agent `Stop` hook that carries the
 *   authoritative turn-boundary snapshot (`session_crons` + `background_tasks`).
 * - {@link tapLifecycleStream} — a pass-through over the session's message
 *   stream that surfaces mid-turn `background_tasks_changed` events and a single
 *   "a new turn started" activity marker per turn.
 *
 * Kept separate from the SDK runtime so the mapping is unit-testable without a
 * live `claude` process. See edspencer/herdctl#307.
 */

import type {
  BackgroundTaskSummary,
  HookInput,
  Options,
  PostToolUseHookInput,
  SessionCronSummary,
  StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "../runner/types.js";
import { createLogger } from "../utils/logger.js";
import type { SessionLifecycleSignal } from "./types.js";

const logger = createLogger("session-hooks");

/** Receiver for lifecycle signals (the session-reaper's `handleSignal`). */
export type LifecycleSignalSink = (signal: SessionLifecycleSignal) => void | Promise<void>;

/**
 * Deliver a signal to the sink without blocking the caller, observing (and
 * logging) any rejection so a failing sink can't surface as an unhandled promise
 * rejection (which crashes Node 15+).
 */
function emit(sink: LifecycleSignalSink, signal: SessionLifecycleSignal): void {
  void Promise.resolve()
    .then(() => sink(signal))
    .catch((error: unknown) => {
      logger.warn(`Lifecycle signal sink threw (${signal.kind}): ${(error as Error).message}`);
    });
}

/**
 * A main-agent `Stop` is the only reap-eligible turn boundary.
 *
 * `SubagentStop` is deliberately NOT treated as one. It fires when a
 * *synchronous* subagent (a `Task`/`Agent` tool call) finishes, which happens
 * *mid* the parent turn — the parent is still live and about to consume the
 * subagent's result and continue. Emitting a `turn_end` for it let the
 * session-reaper (which reaps on any `turn_end` with no live background work)
 * close the streaming session out from under the running parent turn: a keeper
 * driving a managed session (`openChatSession({ manageLifecycle: true })`) then
 * appeared to "stop" the instant a synchronous subagent returned, never
 * consuming the result. The parent emits its own `Stop` when the turn actually
 * ends, and any background tasks/crons a subagent registers still reach the
 * reaper via the `background_tasks_changed` stream and that authoritative
 * parent `Stop`.
 */
function isMainAgentStop(input: HookInput): input is StopHookInput {
  return input.hook_event_name === "Stop";
}

/** The SDK tool name that retires a session cron by id. */
const CRON_DELETE_TOOL = "CronDelete";

/**
 * Pull the retired cron id out of a `CronDelete` PostToolUse input, or `null` if
 * this isn't a well-formed `CronDelete`. `tool_input` is typed `unknown`, so we
 * narrow structurally: `{ id: string }` (see the SDK's `CronDeleteInput`).
 */
function deletedCronId(input: PostToolUseHookInput): string | null {
  if (input.tool_name !== CRON_DELETE_TOOL) return null;
  const toolInput = input.tool_input;
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const id = (toolInput as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Build the SDK hooks that feed the session-reaper:
 * - `Stop` — the main-agent turn boundary carrying the authoritative
 *   `session_crons`/`background_tasks` snapshot (a `turn_end` signal).
 * - `PostToolUse` — watches for `CronDelete` and emits a `cron_deleted` signal
 *   so a herdctl-owned recurring wake can be retired. This is the only reliable
 *   delete signal: on a herdctl-resumed turn the session-only cron is never
 *   re-armed, so `reconcile` can't tell a delete from a naturally-empty report
 *   and deliberately keeps recurring wakes — leaving them un-cancellable until
 *   the 7-day prune (#409). The delete must therefore be reported explicitly.
 *
 * Both hooks return `{ continue: true }` and forward via `emit`, so a sink
 * failure never rejects the hook (which would disrupt turn flow).
 */
export function buildLifecycleHooks(sink: LifecycleSignalSink): Options["hooks"] {
  const stopCallback = async (input: HookInput) => {
    if (isMainAgentStop(input)) {
      const sessionCrons: SessionCronSummary[] = input.session_crons ?? [];
      const backgroundTasks: BackgroundTaskSummary[] = input.background_tasks ?? [];
      // Never let a sink failure reject the hook (which would disrupt turn flow);
      // log and continue. `emit` observes the async rejection off the hot path.
      emit(sink, { kind: "turn_end", sessionId: input.session_id, sessionCrons, backgroundTasks });
    }
    return { continue: true };
  };

  const postToolUseCallback = async (input: HookInput) => {
    if (input.hook_event_name === "PostToolUse") {
      const id = deletedCronId(input as PostToolUseHookInput);
      if (id !== null) {
        emit(sink, {
          kind: "cron_deleted",
          sessionId: input.session_id,
          sessionCrons: [],
          backgroundTasks: [],
          deletedCronIds: [id],
        });
      }
    }
    return { continue: true };
  };

  // Only `Stop` is registered for the turn boundary — see {@link isMainAgentStop}
  // for why a `SubagentStop` must not reach the reaper as one.
  return {
    Stop: [{ hooks: [stopCallback] }],
    PostToolUse: [{ hooks: [postToolUseCallback] }],
  };
}

/** Shape of the `background_tasks_changed` system message's `tasks` entries. */
interface BackgroundTasksChangedEntry {
  task_id: string;
  task_type: string;
  description: string;
}

/**
 * Map the lean `background_tasks_changed` task entries onto the richer
 * {@link BackgroundTaskSummary} the reaper consumes. Only the fields the reap
 * decision needs are populated; the rest are left undefined.
 */
function toBackgroundTaskSummaries(tasks: BackgroundTasksChangedEntry[]): BackgroundTaskSummary[] {
  return tasks.map((t) => ({
    id: t.task_id,
    type: t.task_type,
    status: "running",
    description: t.description,
  }));
}

/**
 * Wrap a session's message stream, yielding every message through unchanged
 * while emitting lifecycle signals as a side effect:
 * - `background_tasks_changed` system messages → a `background_tasks_changed`
 *   signal (fresh task set; no crons).
 * - the first `assistant` message after a turn boundary → one `activity` signal
 *   (a new turn is underway), reset on each `result` message.
 *
 * Signals are fire-and-forget; the reaper serializes them internally, preserving
 * stream order, so yielding to the consumer is never blocked.
 */
export async function* tapLifecycleStream(
  source: AsyncIterable<SDKMessage>,
  sink: LifecycleSignalSink,
): AsyncGenerator<SDKMessage> {
  let activityForwarded = false;

  for await (const message of source) {
    if (message.type === "system" && message.subtype === "background_tasks_changed") {
      const rawTasks = (message.tasks as BackgroundTasksChangedEntry[] | undefined) ?? [];
      emit(sink, {
        kind: "background_tasks_changed",
        sessionId: message.session_id ?? "",
        sessionCrons: [],
        backgroundTasks: toBackgroundTaskSummaries(rawTasks),
      });
    } else if (message.type === "assistant") {
      if (!activityForwarded) {
        activityForwarded = true;
        emit(sink, {
          kind: "activity",
          sessionId: message.session_id ?? "",
          sessionCrons: [],
          backgroundTasks: [],
        });
      }
    } else if (message.type === "result") {
      activityForwarded = false;
    }

    yield message;
  }
}
