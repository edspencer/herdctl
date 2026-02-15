/**
 * Message handling utilities for Slack
 *
 * Provides utilities for:
 * - Detecting bot mentions in messages
 * - Stripping bot mention from message text
 * - Determining if a message should be processed
 */

// =============================================================================
// Mention Detection
// =============================================================================

/**
 * Check if the bot was mentioned in a message
 *
 * Slack format for mentions: <@U1234567890>
 *
 * @param text - Message text
 * @param botUserId - Bot's user ID
 * @returns true if the bot was mentioned
 */
export function isBotMentioned(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

/**
 * Strip the bot mention from message text
 *
 * Removes <@BOTID> and trims whitespace.
 *
 * @param text - Message text
 * @param botUserId - Bot's user ID
 * @returns Cleaned message text
 */
export function stripBotMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
}

/**
 * Strip all user mentions from message text
 *
 * @param text - Message text
 * @returns Text with all mentions removed
 */
export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

// =============================================================================
// Message Processing
// =============================================================================

/**
 * Determine if a message should be processed
 *
 * Rules:
 * - Ignore messages from bots
 * - Process app_mention events (always a mention)
 * - Process thread replies in active conversation threads
 *
 * @param event - Slack event data
 * @param botUserId - Bot's user ID
 * @returns true if the message should be processed
 */
export function shouldProcessMessage(
  event: {
    bot_id?: string;
    subtype?: string;
    user?: string;
    thread_ts?: string;
  },
  botUserId: string
): boolean {
  // Ignore bot messages
  if (event.bot_id || event.subtype === "bot_message") {
    return false;
  }

  // Ignore messages from the bot itself
  if (event.user === botUserId) {
    return false;
  }

  return true;
}

/**
 * Process a message event and extract the prompt
 *
 * @param text - Raw message text
 * @param botUserId - Bot's user ID
 * @returns Processed prompt text
 */
export function processMessage(text: string, botUserId: string): string {
  // Strip the bot mention if present
  let prompt = stripBotMention(text, botUserId);

  // Trim whitespace
  prompt = prompt.trim();

  return prompt;
}
