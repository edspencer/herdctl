/**
 * Message processor for transforming SDK messages to job output format
 *
 * Handles all Claude SDK message types and converts them to the format
 * expected by the job output logging system. Includes robust handling
 * of malformed or unexpected SDK responses.
 */

import type { JobOutputInput } from "../state/index.js";
import type { ProcessedMessage, SDKMessage } from "./types.js";

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Safely extract a string value from an unknown field
 */
function safeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  // Convert other types to string for safety
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

/**
 * Safely extract a boolean value from an unknown field
 */
function _safeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Check if a value is a valid SDK message type
 *
 * The Claude Agent SDK sends these message types:
 * - assistant: Complete assistant message with nested APIAssistantMessage
 * - stream_event: Partial streaming content (contains RawMessageStreamEvent)
 * - result: Final result message with summary
 * - system: System messages (init, status, compact_boundary, etc.)
 * - user: User messages with nested APIUserMessage
 * - tool_progress: Progress updates for long-running tools
 * - auth_status: Authentication status updates
 *
 * Legacy types (for backwards compatibility):
 * - tool_use: Tool invocation (now part of assistant content blocks)
 * - tool_result: Tool result (now part of user messages)
 */
function isValidMessageType(
  type: unknown,
): type is
  | "system"
  | "assistant"
  | "stream_event"
  | "result"
  | "user"
  | "tool_progress"
  | "auth_status"
  | "error"
  | "tool_use"
  | "tool_result" {
  return (
    type === "system" ||
    type === "assistant" ||
    type === "stream_event" ||
    type === "result" ||
    type === "user" ||
    type === "tool_progress" ||
    type === "auth_status" ||
    type === "error" ||
    // Legacy types for backwards compatibility
    type === "tool_use" ||
    type === "tool_result"
  );
}

// =============================================================================
// Message Type Handlers
// =============================================================================

/**
 * Process a system message from the SDK
 *
 * Session ID is specifically extracted from messages with subtype "init",
 * as this is when the Claude SDK provides the session identifier.
 */
function processSystemMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "system",
  };

  if (message.content) {
    output.content = message.content;
  }

  if (message.subtype) {
    output.subtype = message.subtype;
  }

  // Extract session ID specifically from init messages
  // The Claude SDK provides session_id in the system message with subtype "init"
  const sessionId = message.subtype === "init" ? message.session_id : undefined;

  return {
    output,
    sessionId,
  };
}

/**
 * Extract text content from Anthropic API content blocks
 *
 * The API returns content as an array of content blocks, where text content
 * has type: 'text' with a text field.
 */
function extractTextFromContentBlocks(content: unknown): string | undefined {
  // Handle null/undefined
  if (content === null || content === undefined) return undefined;

  // If it's a string (including empty string), return directly
  if (typeof content === "string") {
    return content;
  }

  // If it's an array of content blocks, extract text blocks
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block) {
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
    }
    return textParts.length > 0 ? textParts.join("\n") : undefined;
  }

  return undefined;
}

/**
 * Process an assistant message from the SDK
 *
 * SDK assistant messages have the content nested inside a `message` field
 * which is an Anthropic APIAssistantMessage with content blocks.
 */
function processAssistantMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "assistant",
  };

  // SDK wraps the API message in a `message` field
  // Structure: { type: 'assistant', message: { content: [...], ... }, ... }
  const apiMessage = message.message as { content?: unknown; usage?: unknown } | undefined;

  if (apiMessage?.content !== undefined) {
    const textContent = extractTextFromContentBlocks(apiMessage.content);
    if (textContent) {
      output.content = textContent;
    }
  }

  // Also check top-level content for backwards compatibility
  if (output.content === undefined && message.content !== undefined) {
    const textContent = extractTextFromContentBlocks(message.content);
    if (textContent !== undefined) {
      output.content = textContent;
    }
  }

  if (message.partial !== undefined) {
    output.partial = message.partial as boolean;
  }

  // Handle usage statistics (can be at top level or in nested message)
  const usage = (apiMessage?.usage ?? message.usage) as
    | {
        input_tokens?: number;
        output_tokens?: number;
      }
    | undefined;

  if (usage) {
    output.usage = {};
    if (usage.input_tokens !== undefined) {
      output.usage.input_tokens = usage.input_tokens;
    }
    if (usage.output_tokens !== undefined) {
      output.usage.output_tokens = usage.output_tokens;
    }
  }

  return { output };
}

/**
 * Process a tool use message (legacy type for backwards compatibility)
 */
function processToolUseMessage(message: SDKMessage): ProcessedMessage {
  const toolName = message.tool_name ?? message.name ?? "unknown";

  const output: JobOutputInput = {
    type: "tool_use",
    tool_name: toolName as string,
  };

  if (message.tool_use_id) {
    output.tool_use_id = message.tool_use_id;
  }

  if (message.input !== undefined) {
    output.input = message.input;
  }

  return { output };
}

/**
 * Process a tool result message (legacy type for backwards compatibility)
 */
function processToolResultMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "tool_result",
  };

  if (message.tool_use_id) {
    output.tool_use_id = message.tool_use_id;
  }

  if (message.result !== undefined) {
    output.result = message.result;
  }

  if (message.success !== undefined) {
    output.success = message.success as boolean;
  }

  if (message.error !== undefined) {
    output.error = message.error as string;
  }

  return { output };
}

/**
 * Process an error message from the SDK
 */
function processErrorMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "error",
    message: (message.message as string) ?? "Unknown error",
  };

  if (message.code) {
    output.code = message.code;
  }

  if (message.stack) {
    output.stack = message.stack as string;
  }

  return {
    output,
    isFinal: true,
  };
}

/**
 * Process a user message from the SDK
 *
 * SDK user messages have the content nested inside a `message` field
 * which is an Anthropic APIUserMessage. User messages often contain
 * tool results (responses to assistant tool use).
 *
 * We log them as system messages with subtype "user_input" for traceability,
 * but also extract tool_use_result if present.
 */
function processUserMessage(message: SDKMessage): ProcessedMessage {
  // Check if this is a tool result response
  const toolUseResult = message.tool_use_result;
  if (toolUseResult !== undefined) {
    const output: JobOutputInput = {
      type: "tool_result",
      success: true,
    };

    // Extract the result content
    if (typeof toolUseResult === "string") {
      output.result = toolUseResult;
    } else if (toolUseResult && typeof toolUseResult === "object") {
      // Try to extract meaningful content from the result object
      const resultObj = toolUseResult as Record<string, unknown>;
      if ("content" in resultObj) {
        output.result =
          extractTextFromContentBlocks(resultObj.content) ?? JSON.stringify(toolUseResult, null, 2);
      } else {
        output.result = JSON.stringify(toolUseResult, null, 2);
      }
    }

    return { output };
  }

  // Regular user input message
  const output: JobOutputInput = {
    type: "system",
    subtype: "user_input",
  };

  // SDK wraps the API message in a `message` field
  const apiMessage = message.message as { content?: unknown } | undefined;
  const content = apiMessage?.content ?? message.content;

  if (content !== undefined) {
    const textContent = extractTextFromContentBlocks(content);
    output.content =
      textContent ?? (typeof content === "string" ? content : JSON.stringify(content));
  }

  return { output };
}

/**
 * Process a stream_event message from the SDK
 *
 * Stream events contain partial content as messages are being generated.
 * The event field contains a RawMessageStreamEvent from the Anthropic API.
 */
function processStreamEventMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "assistant",
    partial: true,
  };

  // Extract the streaming event
  const event = message.event as
    | {
        type?: string;
        delta?: { type?: string; text?: string };
        content_block?: { type?: string; text?: string };
      }
    | undefined;

  if (event) {
    // Handle content_block_delta events (streaming text)
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      output.content = event.delta.text;
    }
    // Handle content_block_start events
    else if (event.type === "content_block_start" && event.content_block?.type === "text") {
      output.content = event.content_block.text;
    }
  }

  return { output };
}

/**
 * Process a tool_progress message from the SDK
 *
 * Tool progress messages indicate that a long-running tool is still executing.
 */
function processToolProgressMessage(message: SDKMessage): ProcessedMessage {
  const output: JobOutputInput = {
    type: "system",
    subtype: "tool_progress",
  };

  if (message.tool_name) {
    output.content = `Tool ${message.tool_name} in progress`;
  }

  return { output };
}

/**
 * Process an auth_status message from the SDK
 *
 * Auth status messages indicate authentication state changes.
 */
function processAuthStatusMessage(message: SDKMessage): ProcessedMessage {
  const authMessage = message as {
    isAuthenticating?: boolean;
    output?: string[];
    error?: string;
  };

  const output: JobOutputInput = {
    type: "system",
    subtype: "auth_status",
  };

  if (authMessage.error) {
    output.content = `Authentication error: ${authMessage.error}`;
  } else if (authMessage.output && authMessage.output.length > 0) {
    output.content = authMessage.output.join("\n");
  }

  return { output };
}

/**
 * Process a result message from the SDK
 *
 * SDK result messages indicate the completion of a query and contain
 * summary information, usage statistics, and the final result.
 */
function processResultMessage(message: SDKMessage): ProcessedMessage {
  const resultMsg = message as {
    subtype?: string;
    result?: string;
    is_error?: boolean;
    errors?: string[];
    total_cost_usd?: number;
    num_turns?: number;
    duration_ms?: number;
  };

  // Determine if this is an error result
  const isError = resultMsg.is_error || (resultMsg.subtype && resultMsg.subtype !== "success");

  const output: JobOutputInput = {
    type: "tool_result",
    success: !isError,
  };

  // Extract the result content
  if (resultMsg.result !== undefined) {
    output.result = resultMsg.result;
  } else if (resultMsg.errors && resultMsg.errors.length > 0) {
    output.error = resultMsg.errors.join("; ");
  }

  return { output };
}

// =============================================================================
// Main Processing Function
// =============================================================================

/**
 * Process an SDK message into job output format
 *
 * Takes a message from the Claude Agent SDK and transforms it into
 * the format expected by the job output logging system. This function
 * handles malformed responses gracefully without crashing.
 *
 * @param message - The SDK message to process
 * @returns Processed message with output and optional metadata
 *
 * @example
 * ```typescript
 * const sdkMessage = { type: "assistant", content: "Hello!" };
 * const { output, sessionId } = processSDKMessage(sdkMessage);
 * await appendJobOutput(jobsDir, jobId, output);
 * ```
 */
export function processSDKMessage(message: SDKMessage): ProcessedMessage {
  // Handle null/undefined messages - log as system warning, not error
  // to avoid terminating execution due to malformed SDK responses
  if (message === null || message === undefined) {
    return {
      output: {
        type: "system",
        content: "Received null or undefined SDK message",
        subtype: "malformed_message",
      },
    };
  }

  // Handle non-object messages - log as system warning
  if (typeof message !== "object") {
    return {
      output: {
        type: "system",
        content: `Expected object message, received ${typeof message}`,
        subtype: "malformed_message",
      },
    };
  }

  // Validate message type
  const messageType = message.type;

  if (!isValidMessageType(messageType)) {
    // Handle unknown or missing message types gracefully
    const unknownType = safeString(messageType) ?? "undefined";
    return {
      output: {
        type: "system",
        content: `Unknown message type: ${unknownType}`,
        subtype: "unknown_type",
      },
    };
  }

  // Process known message types
  switch (messageType) {
    case "system":
      return processSystemMessage(message);

    case "assistant":
      return processAssistantMessage(message);

    case "stream_event":
      return processStreamEventMessage(message);

    case "result":
      return processResultMessage(message);

    case "user":
      return processUserMessage(message);

    case "tool_progress":
      return processToolProgressMessage(message);

    case "auth_status":
      return processAuthStatusMessage(message);

    case "error":
      return processErrorMessage(message);

    // Legacy types for backwards compatibility with tests
    case "tool_use":
      return processToolUseMessage(message);

    case "tool_result":
      return processToolResultMessage(message);
  }
}

/**
 * Check if a message indicates the end of execution
 *
 * The SDK signals completion via a 'result' message type, which contains
 * the final summary and usage statistics.
 *
 * @param message - The SDK message to check
 * @returns true if this is a terminal message
 */
export function isTerminalMessage(message: SDKMessage): boolean {
  // Handle null/undefined/non-object messages - these are not terminal
  if (message === null || message === undefined || typeof message !== "object") {
    return false;
  }

  // Error messages are terminal
  if (message.type === "error") {
    return true;
  }

  // Result messages indicate query completion
  if (message.type === "result") {
    return true;
  }

  // System messages with certain subtypes indicate completion
  if (message.type === "system") {
    const subtype = message.subtype as string | undefined;
    if (subtype === "end" || subtype === "complete" || subtype === "session_end") {
      return true;
    }
  }

  return false;
}

/**
 * Extract the final summary from a message if present
 *
 * Looks for summaries in the following order:
 * 1. Explicit `summary` field on the message
 * 2. Result message with `result` field (SDK final result)
 * 3. Non-partial assistant message content
 *
 * Note: No truncation is applied here. Downstream consumers (e.g., Discord hook)
 * are responsible for truncating to their specific limits (e.g., 4096 for Discord).
 *
 * @param message - The SDK message to extract summary from
 * @returns Summary string if present, undefined otherwise
 */
export function extractSummary(message: SDKMessage): string | undefined {
  // Handle null/undefined/non-object messages
  if (message === null || message === undefined || typeof message !== "object") {
    return undefined;
  }

  // Check for explicit summary field
  if (message.summary) {
    return String(message.summary);
  }

  // For result messages, use the result field as summary
  if (message.type === "result") {
    const resultMsg = message as { result?: string };
    if (resultMsg.result) {
      return resultMsg.result;
    }
  }

  // For assistant messages, try to extract content from nested message
  if (message.type === "assistant" && !message.partial) {
    const apiMessage = message.message as { content?: unknown } | undefined;
    const content = apiMessage?.content ?? message.content;
    const textContent = extractTextFromContentBlocks(content);

    if (textContent) {
      return textContent;
    }
  }

  return undefined;
}
