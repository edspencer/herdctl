/**
 * Translate SDK lifecycle events into herdctl {@link SessionLifecycleSignal}s.
 *
 * Two surfaces feed the session-reaper:
 * - {@link buildLifecycleHooks} — `Stop`/`SubagentStop` hooks that carry the
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
  SessionCronSummary,
  StopHookInput,
  SubagentStopHookInput,
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

function isStopLike(input: HookInput): input is StopHookInput | SubagentStopHookInput {
  return input.hook_event_name === "Stop" || input.hook_event_name === "SubagentStop";
}

/**
 * Build the `Stop`/`SubagentStop` hooks that forward each turn-boundary snapshot
 * to `sink`. The hook awaits the sink so cron capture completes before the turn
 * unwinds, then returns `{ continue: true }` to leave turn flow untouched.
 */
export function buildLifecycleHooks(sink: LifecycleSignalSink): Options["hooks"] {
  const callback = async (input: HookInput) => {
    if (isStopLike(input)) {
      const sessionCrons: SessionCronSummary[] = input.session_crons ?? [];
      const backgroundTasks: BackgroundTaskSummary[] = input.background_tasks ?? [];
      // Never let a sink failure reject the hook (which would disrupt turn flow);
      // log and continue. `emit` observes the async rejection off the hot path.
      emit(sink, { kind: "turn_end", sessionId: input.session_id, sessionCrons, backgroundTasks });
    }
    return { continue: true };
  };

  return {
    Stop: [{ hooks: [callback] }],
    SubagentStop: [{ hooks: [callback] }],
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
