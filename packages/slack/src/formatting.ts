/**
 * Message formatting utilities for Slack
 *
 * Provides utilities for:
 * - Converting standard markdown to Slack's mrkdwn format
 * - Creating context attachments with color coding
 *
 * Note: Message splitting utilities (findSplitPoint, splitMessage, needsSplit,
 * truncateMessage, formatCodeBlock) are provided by @herdctl/chat.
 */

import { slackifyMarkdown } from "slackify-markdown";

// =============================================================================
// Re-exports from @herdctl/chat
// =============================================================================

// Re-export message splitting utilities from @herdctl/chat
// These are identical between Discord and Slack, just with different max lengths
export {
  findSplitPoint,
  splitMessage,
  needsSplit,
  truncateMessage,
  formatCodeBlock,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  type MessageSplitOptions,
  type SplitResult,
} from "@herdctl/chat";

// =============================================================================
// Constants
// =============================================================================

/**
 * Slack's practical maximum message length
 *
 * Hard limit is ~40K, but messages above ~4K become unwieldy in threads.
 */
export const SLACK_MAX_MESSAGE_LENGTH = 4000;

// =============================================================================
// Types
// =============================================================================

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
 * Escape Slack mrkdwn characters in text
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/([*_~`|\\<>])/g, "\\$1");
}
