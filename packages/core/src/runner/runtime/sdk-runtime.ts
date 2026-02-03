/**
 * SDK Runtime implementation
 *
 * Wraps the Claude Agent SDK behind the RuntimeInterface, providing
 * a unified execution interface for the SDK backend.
 *
 * This adapter delegates to the SDK's query() function and converts
 * agent configuration to SDK options using the existing toSDKOptions adapter.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { toSDKOptions } from "../sdk-adapter.js";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage } from "../types.js";

/**
 * SDK runtime implementation
 *
 * This runtime uses the Claude Agent SDK to execute agents. It wraps the SDK's
 * query() function and provides the standard RuntimeInterface.
 *
 * The SDKRuntime is the default runtime when no runtime type is specified in
 * agent configuration.
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
export class SDKRuntime implements RuntimeInterface {
  /**
   * Execute an agent using the Claude Agent SDK
   *
   * Converts agent configuration to SDK options and delegates to the SDK's
   * query() function. Yields each message from the SDK stream.
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // Convert agent configuration to SDK options
    const sdkOptions = toSDKOptions(options.agent, {
      resume: options.resume,
      fork: options.fork,
    });

    // Execute via SDK query()
    // Note: SDK does not currently support AbortController for cancellation
    // This is tracked for future enhancement when SDK adds support
    const messages = query({
      prompt: options.prompt,
      options: sdkOptions as Record<string, unknown>,
    });

    // Stream messages from SDK
    for await (const message of messages) {
      yield message as SDKMessage;
    }
  }
}
