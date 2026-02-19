/**
 * DM (Direct Message) filtering utilities
 *
 * Provides utilities for:
 * - Checking if DMs should be processed
 * - Filtering users via allowlist/blocklist
 * - Determining DM mode configuration
 *
 * These utilities are platform-agnostic and work for any chat platform
 * that supports direct messages with user filtering.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Result of checking if a user is allowed to DM the bot
 */
export interface DMFilterResult {
  /** Whether the user is allowed to send DMs */
  allowed: boolean;
  /** Reason for filtering decision */
  reason: "allowed" | "dm_disabled" | "not_in_allowlist" | "in_blocklist";
}

/**
 * Configuration for DM handling
 *
 * This is the generic DM config shape used by the filtering functions.
 * Platform-specific configs may have additional fields.
 */
export interface DMConfig {
  /** Whether DMs are enabled */
  enabled: boolean;
  /** Mode for DM processing */
  mode: "mention" | "auto";
  /** User IDs that are explicitly allowed (if set, only these users can DM) */
  allowlist?: string[];
  /** User IDs that are explicitly blocked */
  blocklist?: string[];
}

// =============================================================================
// DM Filtering Functions
// =============================================================================

/**
 * Check if DMs are enabled based on configuration
 *
 * If no DM config is provided, DMs are enabled by default.
 *
 * @param dmConfig - DM configuration from agent's chat config
 * @returns true if DMs are enabled, false otherwise
 *
 * @example
 * ```typescript
 * if (isDMEnabled(agentConfig.chat.discord?.dm)) {
 *   // Process DM
 * }
 * ```
 */
export function isDMEnabled(dmConfig?: Partial<DMConfig>): boolean {
  // If no DM config provided, DMs are enabled by default
  if (!dmConfig) {
    return true;
  }
  // If enabled is not specified, default to true
  return dmConfig.enabled !== false;
}

/**
 * Get the mode for DM processing
 *
 * DMs default to "auto" mode (no mention required).
 *
 * @param dmConfig - DM configuration from agent's chat config
 * @returns The mode for DM processing
 *
 * @example
 * ```typescript
 * const mode = getDMMode(agentConfig.chat.discord?.dm);
 * if (mode === 'auto') {
 *   // Process all DM messages
 * }
 * ```
 */
export function getDMMode(dmConfig?: Partial<DMConfig>): "mention" | "auto" {
  // DMs default to auto mode (no mention required)
  if (!dmConfig) {
    return "auto";
  }
  return dmConfig.mode ?? "auto";
}

/**
 * Check if a user is allowed to send DMs to the bot
 *
 * Filtering rules:
 * 1. If DMs are disabled, no users are allowed
 * 2. If a blocklist is defined and user is on it, they are blocked
 * 3. If an allowlist is defined, only users on it are allowed
 * 4. If neither list is defined, all users are allowed
 *
 * Note: Blocklist takes precedence over allowlist.
 *
 * @param userId - User ID to check
 * @param dmConfig - DM configuration from agent's chat config
 * @returns Filter result with allowed status and reason
 *
 * @example
 * ```typescript
 * const result = checkDMUserFilter("123456789", dmConfig);
 * if (!result.allowed) {
 *   console.log(`User blocked: ${result.reason}`);
 *   return; // Don't process message
 * }
 * ```
 */
export function checkDMUserFilter(userId: string, dmConfig?: Partial<DMConfig>): DMFilterResult {
  // If DMs are disabled, no users are allowed
  if (!isDMEnabled(dmConfig)) {
    return {
      allowed: false,
      reason: "dm_disabled",
    };
  }

  // If no config, all users are allowed
  if (!dmConfig) {
    return {
      allowed: true,
      reason: "allowed",
    };
  }

  const { allowlist, blocklist } = dmConfig;

  // Check blocklist first (takes precedence)
  if (blocklist && blocklist.length > 0) {
    if (blocklist.includes(userId)) {
      return {
        allowed: false,
        reason: "in_blocklist",
      };
    }
  }

  // Check allowlist (if defined, only users on it are allowed)
  if (allowlist && allowlist.length > 0) {
    if (!allowlist.includes(userId)) {
      return {
        allowed: false,
        reason: "not_in_allowlist",
      };
    }
  }

  // User is allowed
  return {
    allowed: true,
    reason: "allowed",
  };
}

/**
 * Check if a message should be processed in the given mode
 *
 * In auto mode:
 * - All non-bot messages are processed
 * - No mention is required
 *
 * In mention mode:
 * - Only messages that mention the bot are processed
 *
 * Bot messages are never processed in either mode.
 *
 * @param isBot - Whether the message author is a bot
 * @param mode - The channel/DM mode
 * @param wasMentioned - Whether the bot was mentioned in the message
 * @returns true if the message should be processed
 *
 * @example
 * ```typescript
 * const mode = getDMMode(dmConfig);
 * if (shouldProcessInMode(message.author.bot, mode, wasMentioned)) {
 *   // Process message
 * }
 * ```
 */
export function shouldProcessInMode(
  isBot: boolean,
  mode: "mention" | "auto",
  wasMentioned: boolean,
): boolean {
  // Never process bot messages
  if (isBot) {
    return false;
  }

  // In auto mode, process all non-bot messages
  if (mode === "auto") {
    return true;
  }

  // In mention mode, only process if mentioned
  return wasMentioned;
}
