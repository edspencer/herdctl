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
  message?: {
    content?: string | ContentBlock[];
  };
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
