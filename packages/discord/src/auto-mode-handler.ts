/**
 * Auto mode handler for Discord DMs and dedicated channels
 *
 * Provides utilities for:
 * - Determining channel mode configuration (Discord guild hierarchy)
 * - Resolving channel config for a message
 *
 * DM filtering utilities (isDMEnabled, getDMMode, checkDMUserFilter, shouldProcessInMode)
 * are provided by @herdctl/chat - the Discord-specific functions here use them internally
 * while working with Discord's guild/channel hierarchy.
 */

import {
  checkDMUserFilter as chatCheckDMUserFilter,
  getDMMode as chatGetDMMode,
  isDMEnabled as chatIsDMEnabled,
  type DMFilterResult,
} from "@herdctl/chat";
import type { ChatDM, DiscordChannel, DiscordGuild } from "@herdctl/core";

// =============================================================================
// Types
// =============================================================================

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
// DM Filtering (wrappers around @herdctl/chat functions)
// =============================================================================

/**
 * Check if DMs are enabled based on configuration
 *
 * @param dmConfig - DM configuration from agent's Discord config
 * @returns true if DMs are enabled, false otherwise
 */
export function isDMEnabled(dmConfig?: ChatDM): boolean {
  return chatIsDMEnabled(dmConfig);
}

/**
 * Get the mode for DM processing
 *
 * @param dmConfig - DM configuration from agent's Discord config
 * @returns The mode for DM processing (defaults to "auto")
 */
export function getDMMode(dmConfig?: ChatDM): "mention" | "auto" {
  return chatGetDMMode(dmConfig);
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
export function checkDMUserFilter(userId: string, dmConfig?: ChatDM): DMFilterResult {
  return chatCheckDMUserFilter(userId, dmConfig);
}

// =============================================================================
// Channel Configuration (Discord-specific)
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
  guilds: DiscordGuild[],
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
  dmConfig?: ChatDM,
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
