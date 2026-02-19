/**
 * Message splitting utilities for chat platforms
 *
 * Provides utilities for:
 * - Splitting long messages to fit platform character limits
 * - Maintaining message coherence when splitting (avoiding mid-sentence breaks)
 * - Preserving code blocks when splitting
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Default delay between sending split messages (in milliseconds)
 */
export const DEFAULT_MESSAGE_DELAY_MS = 500;

/**
 * Minimum chunk size when splitting messages
 * Prevents creating very small message fragments
 */
export const MIN_CHUNK_SIZE = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Options for splitting messages
 */
export interface MessageSplitOptions {
  /**
   * Maximum length for each message chunk
   * Required - no default since it varies by platform
   */
  maxLength: number;

  /**
   * Whether to try to split at natural boundaries like sentences (default: true)
   */
  preserveBoundaries?: boolean;

  /**
   * Characters to use as split points, in order of preference
   * Default: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' ']
   */
  splitPoints?: string[];
}

/**
 * Result from splitting a message
 */
export interface SplitResult {
  /** Array of message chunks */
  chunks: string[];

  /** Whether the message was split */
  wasSplit: boolean;

  /** Original message length */
  originalLength: number;
}

// =============================================================================
// Default Split Points
// =============================================================================

/**
 * Default split points in order of preference
 *
 * We prefer to split at paragraph breaks, then sentences, then clauses, then words
 */
export const DEFAULT_SPLIT_POINTS = ["\n\n", "\n", ". ", "! ", "? ", ", ", " "];

// =============================================================================
// Message Splitting Functions
// =============================================================================

/**
 * Find the best split point within a text chunk
 *
 * @param text - Text to find split point in
 * @param maxLength - Maximum length for the chunk
 * @param splitPoints - Split points to search for, in order of preference
 * @returns Index to split at, or maxLength if no good split point found
 *
 * @example
 * ```typescript
 * const splitIndex = findSplitPoint(longText, 2000);
 * const firstPart = longText.slice(0, splitIndex);
 * const secondPart = longText.slice(splitIndex);
 * ```
 */
export function findSplitPoint(
  text: string,
  maxLength: number,
  splitPoints: string[] = DEFAULT_SPLIT_POINTS,
): number {
  // If text fits, no split needed
  if (text.length <= maxLength) {
    return text.length;
  }

  // Try each split point in order of preference
  for (const splitPoint of splitPoints) {
    // Search backwards from maxLength to find the last occurrence of this split point
    const searchText = text.slice(0, maxLength);
    const lastIndex = searchText.lastIndexOf(splitPoint);

    // If found and results in a reasonable chunk size
    if (lastIndex > MIN_CHUNK_SIZE) {
      // Include the split point in the first chunk (e.g., keep the period with the sentence)
      return lastIndex + splitPoint.length;
    }
  }

  // No good split point found - fall back to hard split at maxLength
  // But try to avoid splitting in the middle of a word
  const hardSplitIndex = text.lastIndexOf(" ", maxLength);
  if (hardSplitIndex > MIN_CHUNK_SIZE) {
    return hardSplitIndex + 1; // Include the space in the first chunk
  }

  // Last resort: hard split at maxLength
  return maxLength;
}

/**
 * Split a message into chunks that fit within the specified max length
 *
 * @param content - Message content to split
 * @param options - Split options including maxLength
 * @returns Split result with chunks array
 *
 * @example
 * ```typescript
 * const result = splitMessage(longText, { maxLength: 2000 });
 * for (const chunk of result.chunks) {
 *   await channel.send(chunk);
 * }
 * ```
 */
export function splitMessage(content: string, options: MessageSplitOptions): SplitResult {
  const { maxLength, preserveBoundaries = true, splitPoints = DEFAULT_SPLIT_POINTS } = options;

  const originalLength = content.length;

  // If content fits in one message, return as-is
  if (content.length <= maxLength) {
    return {
      chunks: [content],
      wasSplit: false,
      originalLength,
    };
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      // Remaining text fits in one message
      chunks.push(remaining.trim());
      break;
    }

    // Find the best split point
    let splitIndex: number;
    if (preserveBoundaries) {
      splitIndex = findSplitPoint(remaining, maxLength, splitPoints);
    } else {
      // Simple split at maxLength
      splitIndex = maxLength;
    }

    // Extract the chunk and trim
    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Update remaining text
    remaining = remaining.slice(splitIndex).trim();
  }

  return {
    chunks,
    wasSplit: chunks.length > 1,
    originalLength,
  };
}

/**
 * Check if a message needs to be split
 *
 * @param content - Message content to check
 * @param maxLength - Maximum message length
 * @returns true if the message exceeds the max length
 *
 * @example
 * ```typescript
 * if (needsSplit(message, 2000)) {
 *   const { chunks } = splitMessage(message, { maxLength: 2000 });
 *   // Send each chunk
 * } else {
 *   // Send as-is
 * }
 * ```
 */
export function needsSplit(content: string, maxLength: number): boolean {
  return content.length > maxLength;
}

/**
 * Truncate a message to fit within the max length, adding an ellipsis
 *
 * @param content - Message content to truncate
 * @param maxLength - Maximum length
 * @param ellipsis - Ellipsis to append (default: '...')
 * @returns Truncated message
 *
 * @example
 * ```typescript
 * const short = truncateMessage(longText, 100);
 * // Returns: "This is a very long text that has been trun..."
 * ```
 */
export function truncateMessage(
  content: string,
  maxLength: number,
  ellipsis: string = "...",
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const truncatedLength = maxLength - ellipsis.length;
  return content.slice(0, truncatedLength) + ellipsis;
}

/**
 * Format code as a code block with optional language
 *
 * @param code - Code to format
 * @param language - Optional language for syntax highlighting
 * @returns Formatted code block
 *
 * @example
 * ```typescript
 * const formatted = formatCodeBlock('const x = 1;', 'typescript');
 * // Returns: "```typescript\nconst x = 1;\n```"
 * ```
 */
export function formatCodeBlock(code: string, language?: string): string {
  const langTag = language ?? "";
  return `\`\`\`${langTag}\n${code}\n\`\`\``;
}
