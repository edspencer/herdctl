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

import type { SDKMessage } from "../types.js";
import type { ResolvedAgent } from "../../config/index.js";

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
}
