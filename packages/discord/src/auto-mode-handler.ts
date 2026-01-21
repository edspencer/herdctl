/**
 * Auto mode handler for Discord DMs and dedicated channels
 *
 * Provides utilities for:
 * - Checking if DMs should be processed (auto mode by default)
 * - Filtering users via allowlist/blocklist
 * - Determining channel mode configuration
 */

import type { DiscordDM, DiscordChannel, DiscordGuild } from "@herdctl/core";

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

/**
 * Result of resolving channel configuration
 */
export interface ResolvedChannelConfig {
  /** The mode for this channel */
  mode: "mention" | "auto";
  /** Number of context messages to include */
  contextMessages: number;
  /** Whether this is a DM channel */
  isDM: boolean;
  /** The guild ID if applicable */
  guildId: string | null;
}

// =============================================================================
// DM Filtering
// =============================================================================

/**
 * Check if DMs are enabled based on configuration
 *
 * @param dmConfig - DM configuration from agent's Discord config
 * @returns true if DMs are enabled, false otherwise
 */
export function isDMEnabled(dmConfig?: DiscordDM): boolean {
  // If no DM config provided, DMs are enabled by default
  if (!dmConfig) {
    return true;
  }
  return dmConfig.enabled;
}

/**
 * Get the mode for DM processing
 *
 * @param dmConfig - DM configuration from agent's Discord config
 * @returns The mode for DM processing (defaults to "auto")
 */
export function getDMMode(dmConfig?: DiscordDM): "mention" | "auto" {
  // DMs default to auto mode (no mention required)
  if (!dmConfig) {
    return "auto";
  }
  return dmConfig.mode;
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
 * @param userId - Discord user ID to check
 * @param dmConfig - DM configuration from agent's Discord config
 * @returns Filter result with allowed status and reason
 *
 * @example
 * ```typescript
 * const result = checkDMUserFilter("123456789", dmConfig);
 * if (!result.allowed) {
 *   console.log(`User blocked: ${result.reason}`);
 * }
 * ```
 */
export function checkDMUserFilter(
  userId: string,
  dmConfig?: DiscordDM
): DMFilterResult {
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

// =============================================================================
// Channel Configuration
// =============================================================================

/**
 * Default number of context messages for DMs
 */
export const DEFAULT_DM_CONTEXT_MESSAGES = 10;

/**
 * Default number of context messages for channels
 */
export const DEFAULT_CHANNEL_CONTEXT_MESSAGES = 10;

/**
 * Find channel configuration from guild config
 *
 * @param channelId - Discord channel ID
 * @param guilds - Array of guild configurations
 * @returns Channel config and guild ID, or null if not found
 */
export function findChannelConfig(
  channelId: string,
  guilds: DiscordGuild[]
): { channel: DiscordChannel; guildId: string } | null {
  for (const guild of guilds) {
    const channel = guild.channels?.find((c) => c.id === channelId);
    if (channel) {
      return { channel, guildId: guild.id };
    }
  }
  return null;
}

/**
 * Resolve channel configuration for a message
 *
 * Determines the mode and context settings for a given channel,
 * handling both guild channels and DMs appropriately.
 *
 * @param channelId - Discord channel ID
 * @param guildId - Guild ID (null for DMs)
 * @param guilds - Array of guild configurations
 * @param dmConfig - Global DM configuration
 * @returns Resolved channel configuration or null if channel not configured
 *
 * @example
 * ```typescript
 * const config = resolveChannelConfig(
 *   message.channel.id,
 *   message.guildId,
 *   discordConfig.guilds,
 *   discordConfig.dm
 * );
 *
 * if (config) {
 *   if (config.mode === 'auto') {
 *     // Process all non-bot messages
 *   } else {
 *     // Only process mentions
 *   }
 * }
 * ```
 */
export function resolveChannelConfig(
  channelId: string,
  guildId: string | null,
  guilds: DiscordGuild[],
  dmConfig?: DiscordDM
): ResolvedChannelConfig | null {
  // Handle DMs
  if (!guildId) {
    // Check if DMs are enabled
    if (!isDMEnabled(dmConfig)) {
      return null;
    }

    return {
      mode: getDMMode(dmConfig),
      contextMessages: DEFAULT_DM_CONTEXT_MESSAGES,
      isDM: true,
      guildId: null,
    };
  }

  // Handle guild channels
  const guildConfig = guilds.find((g) => g.id === guildId);
  if (!guildConfig) {
    return null;
  }

  const channelConfig = guildConfig.channels?.find((c) => c.id === channelId);
  if (!channelConfig) {
    return null;
  }

  return {
    mode: channelConfig.mode,
    contextMessages: channelConfig.context_messages,
    isDM: false,
    guildId,
  };
}

/**
 * Check if a message should be processed in auto mode
 *
 * In auto mode:
 * - All non-bot messages are processed
 * - No mention is required
 * - Full conversation context is maintained
 *
 * @param isBot - Whether the message author is a bot
 * @param mode - The channel mode
 * @param wasMentioned - Whether the bot was mentioned
 * @returns true if the message should be processed
 */
export function shouldProcessInMode(
  isBot: boolean,
  mode: "mention" | "auto",
  wasMentioned: boolean
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
