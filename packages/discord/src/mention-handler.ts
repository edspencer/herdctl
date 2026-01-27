/**
 * Mention handler for Discord bot interactions
 *
 * Provides utilities for:
 * - Detecting bot mentions in messages
 * - Stripping mentions from prompt text
 * - Building conversation context from message history
 */

import type { Message, Collection, Snowflake, TextChannel, DMChannel, NewsChannel, ThreadChannel } from "discord.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Supported text-based channel types for message fetching
 */
export type TextBasedChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

/**
 * A processed message for context building
 */
export interface ContextMessage {
  /** Discord user ID of the message author */
  authorId: string;
  /** Display name or username of the message author */
  authorName: string;
  /** Whether the author is a bot */
  isBot: boolean;
  /** Whether this is the bot's own message */
  isSelf: boolean;
  /** Message content with any bot mentions stripped */
  content: string;
  /** ISO timestamp of when the message was created */
  timestamp: string;
  /** The original message ID */
  messageId: string;
}

/**
 * Options for building conversation context
 */
export interface ContextBuildOptions {
  /** Maximum number of messages to include (default: 10) */
  maxMessages?: number;
  /** Whether to include bot messages in context (default: true) */
  includeBotMessages?: boolean;
  /** Whether to prioritize user messages over bot messages (default: true) */
  prioritizeUserMessages?: boolean;
}

/**
 * Result of context building
 */
export interface ConversationContext {
  /** Processed messages in chronological order (oldest first) */
  messages: ContextMessage[];
  /** The triggering message with mention stripped */
  prompt: string;
  /** Whether the bot was mentioned in the triggering message */
  wasMentioned: boolean;
}

// =============================================================================
// Mention Detection
// =============================================================================

/**
 * Check if a message mentions a specific bot user
 *
 * Checks both direct user mentions (@BotName) and role mentions where
 * the bot is a member of the mentioned role. This handles the common case
 * where Discord auto-creates a managed role for bots and users accidentally
 * mention the role instead of the user.
 *
 * @param message - Discord message to check
 * @param botUserId - The bot's user ID
 * @returns true if the bot is mentioned (directly or via role), false otherwise
 *
 * @example
 * ```typescript
 * if (isBotMentioned(message, client.user.id)) {
 *   // Handle the mention
 * }
 * ```
 */
export function isBotMentioned(message: Message, botUserId: string): boolean {
  // Check if the bot user is directly mentioned
  if (message.mentions.users.has(botUserId)) {
    return true;
  }

  // Check if any mentioned role contains the bot as a member
  // This handles the case where the bot's managed role is mentioned
  for (const [, role] of message.mentions.roles) {
    if (role.members.has(botUserId)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a message should be processed based on channel mode
 *
 * @param message - Discord message to check
 * @param botUserId - The bot's user ID
 * @param mode - Channel mode ('mention' or 'auto')
 * @returns true if the message should be processed, false otherwise
 *
 * @example
 * ```typescript
 * if (shouldProcessMessage(message, client.user.id, 'mention')) {
 *   // Bot was mentioned, process the message
 * }
 * ```
 */
export function shouldProcessMessage(
  message: Message,
  botUserId: string,
  mode: "mention" | "auto"
): boolean {
  // Never process messages from bots (including self)
  if (message.author.bot) {
    return false;
  }

  // In 'auto' mode, process all non-bot messages
  if (mode === "auto") {
    return true;
  }

  // In 'mention' mode, only process if bot is mentioned
  return isBotMentioned(message, botUserId);
}

// =============================================================================
// Mention Stripping
// =============================================================================

/**
 * Strip bot mention from message content
 *
 * Removes the bot mention (e.g., <@123456789>) from the message content
 * and trims any excess whitespace.
 *
 * @param content - Message content to process
 * @param botUserId - The bot's user ID
 * @returns Content with the bot mention removed
 *
 * @example
 * ```typescript
 * const prompt = stripBotMention("<@123> help me with this", "123");
 * // Returns: "help me with this"
 * ```
 */
export function stripBotMention(content: string, botUserId: string): string {
  // Match both regular mentions <@id> and nickname mentions <@!id>
  const mentionRegex = new RegExp(`<@!?${botUserId}>`, "g");
  return content.replace(mentionRegex, "").trim();
}

/**
 * Strip bot role mentions from message content
 *
 * Removes role mentions (e.g., <@&123456789>) where the bot is a member
 * of that role. This handles the case where users mention the bot's
 * auto-created managed role instead of the bot user directly.
 *
 * @param content - Message content to process
 * @param message - The Discord message (to access role mentions)
 * @param botUserId - The bot's user ID
 * @returns Content with bot role mentions removed
 */
export function stripBotRoleMentions(
  content: string,
  message: Message,
  botUserId: string
): string {
  let result = content;

  // Find role mentions where the bot is a member and strip them
  for (const [roleId, role] of message.mentions.roles) {
    if (role.members.has(botUserId)) {
      // Strip this role mention
      const roleRegex = new RegExp(`<@&${roleId}>`, "g");
      result = result.replace(roleRegex, "");
    }
  }

  return result.trim();
}

/**
 * Strip all bot mentions from message content
 *
 * Removes all user mentions from the message content. Useful for
 * cleaning context messages.
 *
 * @param content - Message content to process
 * @param botUserId - The bot's user ID (optional, if provided only strips this bot)
 * @returns Content with mentions removed
 */
export function stripMentions(content: string, botUserId?: string): string {
  if (botUserId) {
    return stripBotMention(content, botUserId);
  }
  // Strip all user mentions
  return content.replace(/<@!?\d+>/g, "").trim();
}

// =============================================================================
// Context Building
// =============================================================================

/**
 * Process a Discord message into a context message
 *
 * @param message - Discord message to process
 * @param botUserId - The bot's user ID
 * @returns Processed context message
 */
export function processMessage(
  message: Message,
  botUserId: string
): ContextMessage {
  // Strip both user mentions and role mentions where bot is a member
  let content = stripBotMention(message.content, botUserId);
  content = stripBotRoleMentions(content, message, botUserId);

  return {
    authorId: message.author.id,
    authorName: message.author.displayName ?? message.author.username,
    isBot: message.author.bot,
    isSelf: message.author.id === botUserId,
    content,
    timestamp: message.createdAt.toISOString(),
    messageId: message.id,
  };
}

/**
 * Fetch recent message history from a channel
 *
 * @param channel - Text-based channel to fetch from
 * @param beforeMessageId - Fetch messages before this message ID
 * @param limit - Maximum number of messages to fetch
 * @returns Collection of messages
 */
export async function fetchMessageHistory(
  channel: TextBasedChannel,
  beforeMessageId: string,
  limit: number
): Promise<Collection<Snowflake, Message>> {
  return channel.messages.fetch({
    before: beforeMessageId,
    limit,
  });
}

/**
 * Build conversation context from message history
 *
 * Fetches recent messages from the channel and processes them into
 * a conversation context suitable for sending to Claude.
 *
 * @param triggerMessage - The message that triggered the bot
 * @param channel - The channel to fetch history from
 * @param botUserId - The bot's user ID
 * @param options - Context building options
 * @returns Conversation context with processed messages
 *
 * @example
 * ```typescript
 * const context = await buildConversationContext(
 *   message,
 *   message.channel,
 *   client.user.id,
 *   { maxMessages: 10, prioritizeUserMessages: true }
 * );
 *
 * // Use context.prompt as the main prompt
 * // Use context.messages for conversation history
 * ```
 */
export async function buildConversationContext(
  triggerMessage: Message,
  channel: TextBasedChannel,
  botUserId: string,
  options: ContextBuildOptions = {}
): Promise<ConversationContext> {
  const {
    maxMessages = 10,
    includeBotMessages = true,
    prioritizeUserMessages = true,
  } = options;

  // Process the trigger message
  const wasMentioned = isBotMentioned(triggerMessage, botUserId);
  // Strip both direct user mentions and role mentions where the bot is a member
  let prompt = stripBotMention(triggerMessage.content, botUserId);
  prompt = stripBotRoleMentions(prompt, triggerMessage, botUserId);

  // Fetch message history (messages before the trigger)
  // Fetch more than we need to allow for filtering
  const fetchLimit = prioritizeUserMessages ? maxMessages * 2 : maxMessages;
  const history = await fetchMessageHistory(
    channel,
    triggerMessage.id,
    fetchLimit
  );

  // Convert to array and process
  let processedMessages = Array.from(history.values())
    .map((msg) => processMessage(msg, botUserId))
    .filter((msg) => {
      // Filter out bot messages if not included
      if (!includeBotMessages && msg.isBot) {
        return false;
      }
      // Always filter out empty messages
      if (!msg.content.trim()) {
        return false;
      }
      return true;
    });

  // If prioritizing user messages, sort to put user messages first
  // then take the limit, then re-sort by timestamp
  if (prioritizeUserMessages && processedMessages.length > maxMessages) {
    // Separate user and bot messages
    const userMessages = processedMessages.filter((m) => !m.isBot);
    const botMessages = processedMessages.filter((m) => m.isBot);

    // Take user messages first, fill remaining with bot messages
    const selectedMessages = [
      ...userMessages.slice(0, maxMessages),
      ...botMessages.slice(0, Math.max(0, maxMessages - userMessages.length)),
    ].slice(0, maxMessages);

    // Sort by timestamp (oldest first)
    processedMessages = selectedMessages.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  } else {
    // Take messages and sort by timestamp (oldest first) for chronological order
    processedMessages = processedMessages
      .slice(0, maxMessages)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
  }

  return {
    messages: processedMessages,
    prompt,
    wasMentioned,
  };
}

/**
 * Format conversation context as a string for Claude
 *
 * Creates a formatted string representation of the conversation context
 * suitable for including in a prompt to Claude.
 *
 * @param context - The conversation context to format
 * @returns Formatted string representation
 *
 * @example
 * ```typescript
 * const formatted = formatContextForPrompt(context);
 * // Returns:
 * // [User123 at 2024-01-20T10:00:00Z]: How do I use this feature?
 * // [BotName at 2024-01-20T10:00:30Z]: Here's how you can...
 * // [User123 at 2024-01-20T10:01:00Z]: Thanks, but what about...
 * ```
 */
export function formatContextForPrompt(context: ConversationContext): string {
  if (context.messages.length === 0) {
    return "";
  }

  return context.messages
    .map((msg) => {
      const authorLabel = msg.isBot ? `${msg.authorName} (bot)` : msg.authorName;
      return `[${authorLabel} at ${msg.timestamp}]: ${msg.content}`;
    })
    .join("\n");
}
