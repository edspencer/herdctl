/**
 * Message formatting utilities for Discord
 *
 * Provides utilities for:
 * - Managing typing indicators during message processing
 * - Sending messages with automatic splitting
 * - Discord-specific markdown escaping
 *
 * Message splitting utilities are provided by @herdctl/chat.
 */

import type { TextChannel, DMChannel, NewsChannel, ThreadChannel } from "discord.js";
import { splitMessage, DEFAULT_MESSAGE_DELAY_MS } from "@herdctl/chat";

// =============================================================================
// Constants
// =============================================================================

/**
 * Discord's maximum message length
 */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

// =============================================================================
// Types
// =============================================================================

/**
 * Supported text-based channel types that can receive messages
 */
export type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

/**
 * Options for sending split messages
 *
 * All MessageSplitOptions fields are optional here since we default maxLength
 * to DISCORD_MAX_MESSAGE_LENGTH when not provided.
 */
export interface SendSplitOptions {
  /**
   * Maximum length for each message chunk (defaults to DISCORD_MAX_MESSAGE_LENGTH)
   */
  maxLength?: number;

  /**
   * Whether to try to split at natural boundaries like sentences (default: true)
   */
  preserveBoundaries?: boolean;

  /**
   * Characters to use as split points, in order of preference
   */
  splitPoints?: string[];

  /**
   * Delay between messages in milliseconds (default: 500)
   */
  delayMs?: number;
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
  refreshInterval: number = 5000,
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
  options: SendSplitOptions = {},
): Promise<string[]> {
  const {
    delayMs = DEFAULT_MESSAGE_DELAY_MS,
    maxLength = DISCORD_MAX_MESSAGE_LENGTH,
    preserveBoundaries,
    splitPoints,
  } = options;

  // Use Discord's max length as default
  const splitResult = splitMessage(content, {
    maxLength,
    preserveBoundaries,
    splitPoints,
  });
  const messageIds: string[] = [];

  for (let i = 0; i < splitResult.chunks.length; i++) {
    const chunk = splitResult.chunks[i];

    // Send the message
    const message = await channel.send(chunk);
    messageIds.push(message.id);

    // Add delay between messages (except after the last one)
    if (i < splitResult.chunks.length - 1 && delayMs > 0) {
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
  options: SendSplitOptions = {},
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
 * Escape Discord markdown characters in text
 *
 * @param text - Text to escape
 * @returns Text with markdown characters escaped
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_~`|\\])/g, "\\$1");
}
