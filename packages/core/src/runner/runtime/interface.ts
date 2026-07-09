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
   * Streaming sessions only: observe the session's background-work lifecycle.
   *
   * Called at each turn boundary (the SDK `Stop`/`SubagentStop` hook) and when
   * the live background-task set changes (`background_tasks_changed`), with a
   * snapshot of the session's pending timer-class wakeups (`sessionCrons`) and
   * continuous-class background work (`backgroundTasks`). The session-reaper
   * uses this to decide when to close an idle session and to capture wakeups for
   * re-triggering. Ignored by {@link RuntimeInterface.execute}.
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

  /** Close the session, ending the input stream and shutting down the query. */
  close(): Promise<void>;
}
