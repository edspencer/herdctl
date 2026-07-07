/**
 * Message content extraction utilities
 *
 * Extracts text content from Claude SDK assistant messages.
 * This is 100% identical between Discord and Slack managers.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Content block with type and text
 *
 * Represents a text content block from the Claude SDK.
 * We define a minimal type here to avoid depending on the full Anthropic SDK.
 */
export interface TextContentBlock {
  type: "text";
  text: string;
}

/**
 * Any content block from the SDK
 */
export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * SDK message structure
 *
 * Represents the structure of messages from the Claude Agent SDK.
 */
export interface SDKMessage {
  type: string;
  content?: string;
  /**
   * Agent attribution for this message: `null`/absent for the main agent, or the
   * `Task` tool_use id of the subagent that produced it. The Claude Agent SDK
   * sets this on every `assistant`/`user` message so consumers can separate the
   * main agent from `Task`-spawned subagents into distinct lanes.
   */
  parent_tool_use_id?: string | null;
  message?: {
    content?: string | ContentBlock[];
    /**
     * The model that produced this message. The Claude Code CLI tags its own
     * synthetic placeholder turns (e.g. "No response requested.") with the
     * sentinel model name `"<synthetic>"`; consumers use this to filter them.
     */
    model?: string;
  };
}

/**
 * Sentinel model name the Claude Code CLI stamps on its synthetic placeholder
 * assistant turns (e.g. "No response requested." after a `/compact`
 * continuation). These are not real assistant output and should be filtered
 * out of both live streams and parsed history.
 */
export const SYNTHETIC_MODEL = "<synthetic>";

/**
 * Whether an SDK assistant message is a CLI-emitted synthetic placeholder turn.
 *
 * The Claude Code CLI writes synthetic assistant messages (tagged with the
 * `"<synthetic>"` model name) into both the live message stream and the session
 * transcript — most visibly the "No response requested." placeholder that
 * follows a `/compact` continuation. They carry no real content and must not be
 * surfaced as assistant output. Matching on the model name (rather than the
 * literal text) is forward-compatible with the CLI's other synthetic strings.
 *
 * @param message - SDK message object
 * @returns true if the message is a synthetic placeholder turn
 */
export function isSyntheticMessage(message: SDKMessage): boolean {
  return message.message?.model === SYNTHETIC_MODEL;
}

/**
 * Agent attribution for a translated event: which agent produced it.
 *
 * `parentToolUseId` is `null` for the main agent, or the `Task` tool_use id of
 * the subagent that produced the message. Consumers group events by this id to
 * reconstruct per-agent lanes (the `Task` tool_use id seen on the main stream
 * correlates to the subagent's `parent_tool_use_id`).
 */
export interface AgentAttribution {
  /** `null` for the main agent, else the spawning `Task` tool_use id. */
  parentToolUseId: string | null;
}

/**
 * Read the agent attribution off an SDK message.
 *
 * Normalizes the SDK's snake_case `parent_tool_use_id` (which may be `null` or
 * absent for the main agent) into an {@link AgentAttribution}.
 *
 * @param message - SDK message object
 * @returns The agent attribution (`parentToolUseId: null` = main agent)
 */
export function getAgentAttribution(message: SDKMessage): AgentAttribution {
  return { parentToolUseId: message.parent_tool_use_id ?? null };
}

// =============================================================================
// Extraction Functions
// =============================================================================

/**
 * Extract text content from an SDK assistant message
 *
 * Handles various message formats from the Claude Agent SDK:
 * - Direct string content in message.content
 * - Nested string content in message.message.content
 * - Array of content blocks with text type
 *
 * @param message - SDK message object
 * @returns Extracted text content, or undefined if no text found
 *
 * @example
 * ```typescript
 * // Direct content
 * extractMessageContent({ type: 'assistant', content: 'Hello!' });
 * // Returns: 'Hello!'
 *
 * // Array of content blocks
 * extractMessageContent({
 *   type: 'assistant',
 *   message: {
 *     content: [
 *       { type: 'text', text: 'Hello ' },
 *       { type: 'text', text: 'world!' }
 *     ]
 *   }
 * });
 * // Returns: 'Hello world!'
 * ```
 */
export function extractMessageContent(message: SDKMessage): string | undefined {
  // Check for direct content
  if (typeof message.content === "string" && message.content) {
    return message.content;
  }

  // Check for nested message content (SDK structure)
  const apiMessage = message.message;
  const content = apiMessage?.content;

  if (!content) {
    return undefined;
  }

  // If it's a string, return directly
  if (typeof content === "string") {
    return content;
  }

  // If it's an array of content blocks, extract text
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (isTextContentBlock(block)) {
        textParts.push(block.text);
      }
    }
    return textParts.length > 0 ? textParts.join("") : undefined;
  }

  return undefined;
}

/**
 * Type guard for text content blocks
 *
 * @param block - Content block to check
 * @returns true if the block is a text content block
 */
export function isTextContentBlock(block: unknown): block is TextContentBlock {
  return (
    block !== null &&
    typeof block === "object" &&
    "type" in block &&
    (block as ContentBlock).type === "text" &&
    "text" in block &&
    typeof (block as TextContentBlock).text === "string"
  );
}

/**
 * Check if a message has extractable text content
 *
 * @param message - SDK message object
 * @returns true if the message contains text content
 */
export function hasTextContent(message: SDKMessage): boolean {
  return extractMessageContent(message) !== undefined;
}
