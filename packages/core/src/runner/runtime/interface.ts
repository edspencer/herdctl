/**
 * Runtime interface for executing Claude agents
 *
 * This interface defines the contract for runtime implementations (SDK, CLI, etc.)
 * that can execute Claude agents. All runtimes must provide an execute() method
 * that returns an AsyncIterable of SDK messages.
 *
 * The interface enables runtime abstraction, allowing the JobExecutor to work with
 * any backend (Claude Agent SDK, Claude CLI, etc.) through a unified interface.
 */

import type { SlashCommand } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedAgent } from "../../config/index.js";
import type { SDKMessage } from "../types.js";

/**
 * A slash command available to an agent's session: its name (no leading slash),
 * a human-readable description, and an argument hint for autocomplete.
 *
 * Re-exported from the Claude Agent SDK so consumers of `@herdctl/core` can type
 * command listings (e.g. {@link RuntimeSession.listCommands} or
 * `FleetManager.listAgentCommands`) without importing the SDK directly.
 */
export type { SlashCommand };

/**
 * Options for executing a runtime
 */
export interface RuntimeExecuteOptions {
  /** The prompt to execute */
  prompt: string;

  /** Resolved agent configuration */
  agent: ResolvedAgent;

  /** Optional session ID to resume */
  resume?: string;

  /** Whether to fork the session */
  fork?: boolean;

  /** AbortController for cancellation support */
  abortController?: AbortController;

  /** MCP servers to inject at runtime (all runtimes: SDK, CLI, Docker) */
  injectedMcpServers?: Record<string, import("../types.js").InjectedMcpServerDef>;

  /** Text to append to the agent's system prompt for this run */
  systemPromptAppend?: string;

  /**
   * Request partial (streaming) assistant messages from the SDK.
   *
   * When `true`, `includePartialMessages` is set on the SDK `query()` options so
   * the stream carries incremental `stream_event` / `text_delta` chunks in
   * addition to the terminal whole `assistant` message. Consumers that translate
   * the stream (e.g. `@herdctl/chat`'s `SDKMessageTranslator`) can then surface
   * assistant text token-by-token. Default off, so batch/one-shot callers and
   * existing session callers are unchanged; streaming-session callers opt in.
   */
  includePartialMessages?: boolean;

  /**
   * Observe the run's session-lifecycle signals: turn boundaries (the SDK
   * main-agent `Stop` hook), live background-task changes
   * (`background_tasks_changed`), mid-turn activity, and explicit `CronDelete`
   * retirements — with a snapshot of the session's pending timer-class wakeups
   * (`sessionCrons`) and continuous-class background work (`backgroundTasks`).
   *
   * Originally streaming-session-only (the session-reaper's own consumer, via
   * `SessionLifecycleManager.manage`). {@link SDKRuntime.execute} also
   * supports it now for its one-shot job path: it composes the caller's sink
   * AFTER its own internal background-task tracking (the #458/#459 bg-wait),
   * fire-and-forget and swallowing any throw/rejection, so a consumer must not
   * rely on ordering against the raw message stream or assume its errors
   * surface anywhere. See `SessionLifecycleManager.trackJob` (vulpes-pack#148)
   * for the job-path consumer. The CLI and Docker runtimes still ignore this —
   * neither wires the Stop-hook signals `execute()` needs to populate it.
   */
  onLifecycleSignal?: (
    signal: import("../../session/types.js").SessionLifecycleSignal,
  ) => void | Promise<void>;
}

/**
 * Runtime interface for executing Claude agents
 *
 * Implementations of this interface wrap different execution backends
 * (SDK, CLI, etc.) and provide a unified streaming message interface.
 *
 * The execute() method returns an AsyncIterable<SDKMessage> to support
 * streaming execution with real-time message processing.
 *
 * @example
 * ```typescript
 * const runtime = new SDKRuntime();
 * const messages = runtime.execute({
 *   prompt: "Fix the bug in auth.ts",
 *   agent: resolvedAgent,
 * });
 *
 * for await (const message of messages) {
 *   console.log(message.type, message.content);
 * }
 * ```
 */
export interface RuntimeInterface {
  /**
   * Execute an agent with the given prompt and options
   *
   * @param options - Execution options including prompt, agent config, and session info
   * @returns AsyncIterable of SDK messages for real-time streaming
   */
  execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage>;

  /**
   * Open a long-lived streaming session for an agent (optional capability).
   *
   * Unlike {@link execute}, which drives a single one-shot turn, a session keeps
   * the underlying query open across many turns. This unlocks the SDK's control
   * requests — which are "only supported when streaming input/output is used" —
   * so callers can send follow-up messages, run slash commands (e.g. `/compact`)
   * by sending them as user messages, interrupt the current turn, and enumerate
   * the available commands.
   *
   * Only the SDK runtime implements this. Runtimes that cannot support streaming
   * sessions (CLI, Docker) leave it undefined; callers should feature-detect.
   *
   * @param options - Execution options (an initial `prompt` is optional; send
   *   further turns via {@link RuntimeSession.send})
   * @returns A live session handle
   */
  openSession?(options: RuntimeExecuteOptions): RuntimeSession;

  /**
   * The Claude home this runtime reads and writes transcripts in (optional).
   *
   * Both first-party runtimes resolve a home — one explicitly passed, or
   * `~/.claude` by default — and expose it here so callers can do transcript
   * path arithmetic against the SAME home the runtime will actually use, instead
   * of re-deriving `~/.claude` and silently disagreeing with it (herdctl#423).
   *
   * Left undefined by runtimes that own no host-side Claude home (e.g.
   * `ContainerRunner`, whose home lives inside the container); callers should
   * feature-detect and fall back to the default.
   */
  getClaudeHomePath?(): string;
}

/**
 * A live, multi-turn streaming session over a single agent query.
 *
 * The session owns one open SDK query. Consume {@link messages} to receive the
 * SDK message stream (as with {@link RuntimeInterface.execute}), and use the
 * control methods to drive the conversation. All control methods map onto the
 * SDK's `Query` control interface and are only meaningful while the session is
 * open (before {@link close}).
 */
export interface RuntimeSession {
  /** The live SDK message stream for the session. Iterate to receive output. */
  readonly messages: AsyncIterable<SDKMessage>;

  /**
   * Send a user turn into the session.
   *
   * A leading-slash string (e.g. `"/compact"`, `"/clear"`) is dispatched by the
   * CLI as a slash command — there is no separate "run command" call; commands
   * are just user messages whose text is the command.
   */
  send(text: string): Promise<void>;

  /**
   * Interrupt the current turn. Returns control to the caller without closing
   * the session (further {@link send} calls remain valid). Takes no arguments —
   * this is "stop the current turn", not "run a command".
   */
  interrupt(): Promise<void>;

  /**
   * List the slash commands available in this session (name, description,
   * argument hint). For populating a command palette; does not run anything.
   */
  listCommands(): Promise<SlashCommand[]>;

  /** Change the model used for subsequent turns in this session. */
  setModel(model?: string): Promise<void>;

  /**
   * Stop ONE background task in this session by id — a background shell, a
   * sub-agent, a monitor — without touching the rest of the session.
   *
   * Distinct from {@link interrupt} (which stops the in-flight model turn, and
   * during the background phase there is none) and from closing the session
   * (which stops everything). The SDK emits the terminal
   * `task_notification{status:"stopped"}` on {@link messages} itself, so callers
   * need no separate confirmation and no bookkeeping.
   *
   * Idempotent by construction: the CLI converts `not_found` / `not_running`
   * into a success, so stopping a task that just finished on its own resolves
   * normally. Do NOT wrap this in a liveness pre-check — that only reintroduces
   * the race it is designed to absorb.
   *
   * Not ownership-gated: this control request carries no caller id, so it can
   * stop any task in the session. That is the point — an out-of-band actor (a
   * UI's stop button) is exactly who needs it.
   *
   * Rejects when the task cannot be stopped for a reason that is not a race —
   * notably `monitor_mcp` tasks, for which the CLI has no kill strategy and
   * answers `unsupported_type`. That rejection is surfaced rather than
   * swallowed: a caller needs to know the button did nothing.
   *
   * @param taskId - The background task's id, as carried on the session's
   *   `task_notification` messages and on
   *   {@link import("../../session/types.js").BackgroundTaskSummary}.
   */
  stopTask(taskId: string): Promise<void>;

  /** Close the session, ending the input stream and shutting down the query. */
  close(): Promise<void>;
}
