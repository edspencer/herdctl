/**
 * Message formatting utilities for Slack
 *
 * Provides utilities for:
 * - Converting standard markdown to Slack's mrkdwn format
 * - Splitting long messages to fit Slack's practical limit
 * - Creating context attachments with color coding
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Slack's practical maximum message length
 *
 * Hard limit is ~40K, but messages above ~4K become unwieldy in threads.
 */
export const SLACK_MAX_MESSAGE_LENGTH = 4000;

/**
 * Minimum chunk size when splitting messages
 */
export const MIN_CHUNK_SIZE = 100;

/**
 * Default delay between sending split messages (in milliseconds)
 */
export const DEFAULT_MESSAGE_DELAY_MS = 500;

// =============================================================================
// Types
// =============================================================================

/**
 * Options for splitting messages
 */
export interface MessageSplitOptions {
  maxLength?: number;
  preserveBoundaries?: boolean;
  splitPoints?: string[];
}

/**
 * Result from splitting a message
 */
export interface SplitResult {
  chunks: string[];
  wasSplit: boolean;
  originalLength: number;
}

/**
 * Context attachment for Slack messages
 */
export interface ContextAttachment {
  footer: string;
  color: string;
}

// =============================================================================
// Markdown to mrkdwn Conversion
// =============================================================================

import { slackifyMarkdown } from "slackify-markdown";

/**
 * Convert standard markdown to Slack's mrkdwn format
 *
 * Uses slackify-markdown (Unified/Remark-based AST parser) for robust
 * conversion that handles edge cases regex approaches miss.
 */
export function markdownToMrkdwn(text: string): string {
  if (!text) return text;
  return (
    slackifyMarkdown(text)
      // Strip zero-width spaces — Slack's mrkdwn parser doesn't handle them
      .replace(/\u200B/g, "")
      // Replace *** horizontal rules (Slack shows them as literal asterisks)
      .replace(/^\*\*\*$/gm, "⸻")
      .trimEnd()
  );
}

// =============================================================================
// Message Splitting
// =============================================================================

const DEFAULT_SPLIT_POINTS = ["\n\n", "\n", ". ", "! ", "? ", ", ", " "];

/**
 * Find the best split point within a text chunk
 */
export function findSplitPoint(
  text: string,
  maxLength: number,
  splitPoints: string[] = DEFAULT_SPLIT_POINTS
): number {
  if (text.length <= maxLength) {
    return text.length;
  }

  for (const splitPoint of splitPoints) {
    const searchText = text.slice(0, maxLength);
    const lastIndex = searchText.lastIndexOf(splitPoint);

    if (lastIndex > MIN_CHUNK_SIZE) {
      return lastIndex + splitPoint.length;
    }
  }

  const hardSplitIndex = text.lastIndexOf(" ", maxLength);
  if (hardSplitIndex > MIN_CHUNK_SIZE) {
    return hardSplitIndex + 1;
  }

  return maxLength;
}

/**
 * Split a message into chunks that fit Slack's message length limit
 */
export function splitMessage(
  content: string,
  options: MessageSplitOptions = {}
): SplitResult {
  const {
    maxLength = SLACK_MAX_MESSAGE_LENGTH,
    preserveBoundaries = true,
    splitPoints = DEFAULT_SPLIT_POINTS,
  } = options;

  const originalLength = content.length;

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
      chunks.push(remaining.trim());
      break;
    }

    let splitIndex: number;
    if (preserveBoundaries) {
      splitIndex = findSplitPoint(remaining, maxLength, splitPoints);
    } else {
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

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
 */
export function needsSplit(
  content: string,
  maxLength: number = SLACK_MAX_MESSAGE_LENGTH
): boolean {
  return content.length > maxLength;
}

// =============================================================================
// Context Attachments
// =============================================================================

/**
 * Create a context attachment for Slack messages
 *
 * Used to display context usage information in a color-coded footer.
 */
export function createContextAttachment(
  contextPercent: number
): ContextAttachment {
  return {
    footer: `Context: ${Math.round(contextPercent)}% remaining`,
    color: contextPercent < 20 ? "#ff0000" : "#36a64f",
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Truncate a message to fit within the max length, adding an ellipsis
 */
export function truncateMessage(
  content: string,
  maxLength: number = SLACK_MAX_MESSAGE_LENGTH,
  ellipsis: string = "..."
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const truncatedLength = maxLength - ellipsis.length;
  return content.slice(0, truncatedLength) + ellipsis;
}

/**
 * Format code as a Slack code block
 */
export function formatCodeBlock(code: string, language?: string): string {
  const langTag = language ?? "";
  return `\`\`\`${langTag}\n${code}\n\`\`\``;
}

/**
 * Escape Slack mrkdwn characters in text
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/([*_~`|\\<>])/g, "\\$1");
}
