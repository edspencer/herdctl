/**
 * CLI output parser - transforms Claude CLI stream-json output to SDKMessage format
 *
 * The Claude CLI outputs JSONL (newline-delimited JSON) with message types that
 * closely match the SDK message format. This module parses CLI output and maps it
 * to the SDKMessage interface for consistency across runtimes.
 */

import type { SDKMessage } from "../types.js";

/**
 * CLI message types from stream-json output
 *
 * The CLI outputs these message types:
 * - system: System messages (init, status, etc.)
 * - assistant: Assistant messages with nested API message
 * - result: Final query result with summary and usage stats
 * - user: User messages with nested API message
 */
export interface CLIMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    [key: string]: unknown;
  };
  result?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

/**
 * Transform CLI message to SDKMessage format
 *
 * Maps CLI message types to SDK message format:
 * - system: Copy type, subtype, session_id
 * - assistant: Extract content from message.content[0].text if present
 * - result: Map subtype, result, preserve session_id
 * - user: Pass through with message content
 * - Default: Spread remaining fields for unknown types
 *
 * @param cliMessage - Raw CLI message from stream-json output
 * @returns SDKMessage compatible with JobExecutor processing
 */
export function toSDKMessage(cliMessage: CLIMessage): SDKMessage {
  // Destructure to exclude 'type' when spreading
  const { type: _type, ...rest } = cliMessage;

  switch (cliMessage.type) {
    case "system":
      return {
        type: "system",
        // Preserve all other system fields (cwd, tools, model, etc.)
        ...rest,
      };

    case "assistant": {
      // Extract text content from nested message structure
      const content =
        cliMessage.message?.content?.[0]?.type === "text"
          ? cliMessage.message.content[0].text
          : undefined;

      return {
        type: "assistant",
        session_id: cliMessage.session_id,
        message: cliMessage.message,
        content,
      };
    }

    case "result":
      return {
        type: "result",
        // Preserve is_error and other result fields
        ...rest,
      };

    case "user":
      return {
        type: "user",
        session_id: cliMessage.session_id,
        message: cliMessage.message,
      };

    default:
      // Unknown message type - pass through all fields
      // Cast to SDKMessage type since we can't validate unknown types at compile time
      return {
        type: cliMessage.type as SDKMessage["type"],
        ...rest,
      } as SDKMessage;
  }
}

/**
 * Parse a single line from CLI stream-json output
 *
 * Handles:
 * - Empty lines (returns null)
 * - Invalid JSON (logs warning, returns null)
 * - Valid JSON (transforms to SDKMessage)
 *
 * @param line - Raw line from CLI stdout
 * @returns Parsed SDKMessage or null if line is empty/invalid
 */
export function parseCLILine(line: string): SDKMessage | null {
  // Skip empty lines
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as CLIMessage;
    return toSDKMessage(parsed);
  } catch (error) {
    // Log warning but don't throw - CLI may output non-JSON lines
    console.warn(
      `[CLIRuntime] Failed to parse CLI output line: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
