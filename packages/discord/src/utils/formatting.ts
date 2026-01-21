/**
 * Message formatting utilities for Discord
 *
 * Provides utilities for:
 * - Splitting long messages to fit Discord's 2000 character limit
 * - Maintaining message coherence when splitting (avoiding mid-sentence breaks)
 * - Managing typing indicators during message processing
 */

import type {
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
} from "discord.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Discord's maximum message length
 */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

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
 * Supported text-based channel types that can receive messages
 */
export type SendableChannel =
  | TextChannel
  | DMChannel
  | NewsChannel
  | ThreadChannel;

/**
 * Options for splitting messages
 */
export interface MessageSplitOptions {
  /**
   * Maximum length for each message chunk (default: 2000)
   */
  maxLength?: number;

  /**
   * Whether to try to split at natural boundaries like sentences (default: true)
   */
  preserveBoundaries?: boolean;

  /**
   * Characters to use as split points, in order of preference (default: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' '])
   */
  splitPoints?: string[];
}

/**
 * Options for sending split messages
 */
export interface SendSplitOptions extends MessageSplitOptions {
  /**
   * Delay between messages in milliseconds (default: 500)
   */
  delayMs?: number;
}

/**
 * Result from splitting a message
 */
export interface SplitResult {
  /**
   * Array of message chunks
   */
  chunks: string[];

  /**
   * Whether the message was split
   */
  wasSplit: boolean;

  /**
   * Original message length
   */
  originalLength: number;
}

// =============================================================================
// Message Splitting
// =============================================================================

/**
 * Default split points in order of preference
 *
 * We prefer to split at paragraph breaks, then sentences, then clauses, then words
 */
const DEFAULT_SPLIT_POINTS = ["\n\n", "\n", ". ", "! ", "? ", ", ", " "];

/**
 * Find the best split point within a text chunk
 *
 * @param text - Text to find split point in
 * @param maxLength - Maximum length for the chunk
 * @param splitPoints - Split points to search for, in order of preference
 * @returns Index to split at, or maxLength if no good split point found
 */
export function findSplitPoint(
  text: string,
  maxLength: number,
  splitPoints: string[] = DEFAULT_SPLIT_POINTS
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
 * Split a message into chunks that fit Discord's message length limit
 *
 * @param content - Message content to split
 * @param options - Split options
 * @returns Split result with chunks array
 *
 * @example
 * ```typescript
 * const result = splitMessage(longText);
 * for (const chunk of result.chunks) {
 *   await channel.send(chunk);
 * }
 * ```
 */
export function splitMessage(
  content: string,
  options: MessageSplitOptions = {}
): SplitResult {
  const {
    maxLength = DISCORD_MAX_MESSAGE_LENGTH,
    preserveBoundaries = true,
    splitPoints = DEFAULT_SPLIT_POINTS,
  } = options;

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
 * @param maxLength - Maximum message length (default: 2000)
 * @returns true if the message exceeds the max length
 */
export function needsSplit(
  content: string,
  maxLength: number = DISCORD_MAX_MESSAGE_LENGTH
): boolean {
  return content.length > maxLength;
}

// =============================================================================
// Typing Indicator
// =============================================================================

/**
 * Controller for managing a typing indicator loop
 */
export interface TypingController {
  /**
   * Stop the typing indicator
   */
  stop(): void;

  /**
   * Whether the typing indicator is currently active
   */
  readonly isActive: boolean;
}

/**
 * Start a typing indicator that refreshes automatically
 *
 * Discord typing indicators expire after ~10 seconds, so this function
 * sets up an interval to keep refreshing the typing status until stopped.
 *
 * @param channel - Channel to show typing indicator in
 * @param refreshInterval - How often to refresh (default: 5000ms)
 * @returns Controller to stop the typing indicator
 *
 * @example
 * ```typescript
 * const typing = startTypingIndicator(channel);
 * try {
 *   const response = await processMessage(prompt);
 *   await channel.send(response);
 * } finally {
 *   typing.stop();
 * }
 * ```
 */
export function startTypingIndicator(
  channel: SendableChannel,
  refreshInterval: number = 5000
): TypingController {
  let isActive = true;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Send initial typing indicator
  channel.sendTyping().catch(() => {
    // Ignore errors - typing indicator is not critical
  });

  // Set up refresh interval
  intervalId = setInterval(() => {
    if (isActive) {
      channel.sendTyping().catch(() => {
        // Ignore errors
      });
    }
  }, refreshInterval);

  return {
    stop() {
      isActive = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    get isActive() {
      return isActive;
    },
  };
}

// =============================================================================
// Combined Send Utilities
// =============================================================================

/**
 * Send a message, automatically splitting if needed
 *
 * @param channel - Channel to send the message to
 * @param content - Message content to send
 * @param options - Send options including split and delay settings
 * @returns Array of message IDs for sent messages
 *
 * @example
 * ```typescript
 * const messageIds = await sendSplitMessage(channel, longResponse, {
 *   delayMs: 500,
 *   preserveBoundaries: true,
 * });
 * console.log(`Sent ${messageIds.length} messages`);
 * ```
 */
export async function sendSplitMessage(
  channel: SendableChannel,
  content: string,
  options: SendSplitOptions = {}
): Promise<string[]> {
  const { delayMs = DEFAULT_MESSAGE_DELAY_MS, ...splitOptions } = options;

  const { chunks } = splitMessage(content, splitOptions);
  const messageIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Send the message
    const message = await channel.send(chunk);
    messageIds.push(message.id);

    // Add delay between messages (except after the last one)
    if (i < chunks.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return messageIds;
}

/**
 * Send a message with typing indicator
 *
 * Shows a typing indicator, processes the content, then sends the response.
 * Automatically splits long messages.
 *
 * @param channel - Channel to send the message to
 * @param contentProvider - Async function that generates the message content
 * @param options - Send options
 * @returns Array of message IDs for sent messages
 *
 * @example
 * ```typescript
 * const messageIds = await sendWithTyping(channel, async () => {
 *   return await generateResponse(prompt);
 * });
 * ```
 */
export async function sendWithTyping(
  channel: SendableChannel,
  contentProvider: () => Promise<string>,
  options: SendSplitOptions = {}
): Promise<string[]> {
  const typing = startTypingIndicator(channel);

  try {
    const content = await contentProvider();
    return await sendSplitMessage(channel, content, options);
  } finally {
    typing.stop();
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a message to fit within the max length, adding an ellipsis
 *
 * @param content - Message content to truncate
 * @param maxLength - Maximum length (default: 2000)
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
  maxLength: number = DISCORD_MAX_MESSAGE_LENGTH,
  ellipsis: string = "..."
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const truncatedLength = maxLength - ellipsis.length;
  return content.slice(0, truncatedLength) + ellipsis;
}

/**
 * Format code as a Discord code block
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

/**
 * Escape Discord markdown characters in text
 *
 * @param text - Text to escape
 * @returns Text with markdown characters escaped
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_~`|\\])/g, "\\$1");
}
