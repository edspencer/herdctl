/**
 * Type definitions for the Discord connector
 *
 * Provides interfaces for Discord connector configuration,
 * connection state, and event definitions.
 */

import type { AgentConfig, AgentChatDiscord } from "@herdctl/core";
import type { FleetManager } from "@herdctl/core";
import type { ContextMessage, ConversationContext } from "./mention-handler.js";
import type { ISessionManager } from "./session-manager/index.js";

// =============================================================================
// Connector Options
// =============================================================================

/**
 * Logger interface for Discord connector operations
 */
export interface DiscordConnectorLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for configuring the DiscordConnector
 *
 * @example
 * ```typescript
 * const options: DiscordConnectorOptions = {
 *   agentConfig: loadedAgentConfig,
 *   discordConfig: loadedAgentConfig.chat.discord,
 *   botToken: process.env.MY_BOT_TOKEN,
 *   fleetManager: manager,
 * };
 * ```
 */
export interface DiscordConnectorOptions {
  /**
   * The agent configuration this connector is associated with
   */
  agentConfig: AgentConfig;

  /**
   * Discord-specific configuration from agent's chat.discord section
   */
  discordConfig: AgentChatDiscord;

  /**
   * Discord bot token for authentication
   *
   * This should be retrieved from the environment variable specified
   * in discordConfig.bot_token_env. Never store tokens in config files.
   */
  botToken: string;

  /**
   * Reference to the FleetManager for job triggering
   */
  fleetManager: FleetManager;

  /**
   * Logger for connector operations
   *
   * Default: console-based logger with [discord:agentName] prefix
   */
  logger?: DiscordConnectorLogger;

  /**
   * Session manager for conversation context management
   *
   * Required for slash command support (/reset, /status)
   */
  sessionManager: ISessionManager;

  /**
   * Root path for state storage (e.g., .herdctl)
   *
   * Used for session persistence
   */
  stateDir?: string;
}

// =============================================================================
// Connector State
// =============================================================================

/**
 * Current connection status of the Discord connector
 */
export type DiscordConnectionStatus =
  | "disconnected" // Initial state, not connected
  | "connecting" // Connection in progress
  | "connected" // Connected and ready
  | "reconnecting" // Attempting to reconnect after disconnect
  | "disconnecting" // Graceful shutdown in progress
  | "error"; // Connection error occurred

/**
 * Detailed connector state for monitoring
 */
export interface DiscordConnectorState {
  /**
   * Current connection status
   */
  status: DiscordConnectionStatus;

  /**
   * ISO timestamp of when the connector was connected
   */
  connectedAt: string | null;

  /**
   * ISO timestamp of when the connector was disconnected
   */
  disconnectedAt: string | null;

  /**
   * Number of reconnection attempts since last successful connection
   */
  reconnectAttempts: number;

  /**
   * Last error message if status is 'error'
   */
  lastError: string | null;

  /**
   * Discord user info when connected
   */
  botUser: {
    id: string;
    username: string;
    discriminator: string;
  } | null;

  /**
   * Rate limit tracking information
   */
  rateLimits: {
    /**
     * Total count of rate limits encountered since connection
     */
    totalCount: number;
    /**
     * ISO timestamp of the last rate limit encountered
     */
    lastRateLimitAt: string | null;
    /**
     * Whether currently rate limited (based on most recent rate limit)
     */
    isRateLimited: boolean;
    /**
     * Time in ms until current rate limit resets (0 if not rate limited)
     */
    currentResetTime: number;
  };

  /**
   * Message statistics since connection
   */
  messageStats: {
    /**
     * Total messages received and processed
     */
    received: number;
    /**
     * Total messages sent (replies)
     */
    sent: number;
    /**
     * Total messages ignored (not mentioned, bot messages, etc.)
     */
    ignored: number;
  };
}

// =============================================================================
// Connector Interface
// =============================================================================

/**
 * Interface that all Discord connectors must implement
 *
 * This interface defines the contract for connecting agents to Discord.
 * Each agent has its own DiscordConnector instance with its own bot identity.
 */
export interface IDiscordConnector {
  /**
   * Connect to Discord gateway
   *
   * Establishes connection and registers event handlers.
   * Auto-reconnect is handled by discord.js on connection loss.
   *
   * @throws DiscordConnectorError on connection failure
   */
  connect(): Promise<void>;

  /**
   * Disconnect from Discord gateway
   *
   * Performs graceful shutdown, cleaning up resources.
   * Does not throw on failure - logs errors and completes.
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected to Discord
   *
   * @returns true if connected and ready, false otherwise
   */
  isConnected(): boolean;

  /**
   * Get current connector state
   *
   * @returns Current state including connection status and metadata
   */
  getState(): DiscordConnectorState;

  /**
   * Name of the agent this connector is for
   */
  readonly agentName: string;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted by the Discord connector
 */
export interface DiscordConnectorEventMap {
  /**
   * Emitted when connection is established and ready
   */
  ready: {
    agentName: string;
    botUser: {
      id: string;
      username: string;
      discriminator: string;
    };
  };

  /**
   * Emitted when connection is lost
   */
  disconnect: {
    agentName: string;
    code: number;
    reason: string;
  };

  /**
   * Emitted on connection error
   */
  error: {
    agentName: string;
    error: Error;
  };

  /**
   * Emitted when reconnecting after disconnect
   */
  reconnecting: {
    agentName: string;
    attempt: number;
  };

  /**
   * Emitted when successfully reconnected
   */
  reconnected: {
    agentName: string;
  };

  /**
   * Emitted when a message is received that should be processed
   *
   * This event is emitted after mention detection and filtering.
   * The prompt has already been stripped of the bot mention.
   */
  message: {
    agentName: string;
    /** The processed prompt (with mention stripped) */
    prompt: string;
    /** Conversation context including recent message history */
    context: ConversationContext;
    /** Discord-specific metadata */
    metadata: {
      /** ID of the guild (server), null for DMs */
      guildId: string | null;
      /** ID of the channel */
      channelId: string;
      /** ID of the message */
      messageId: string;
      /** ID of the user who sent the message */
      userId: string;
      /** Username of the user who sent the message */
      username: string;
      /** Whether this was triggered by a mention */
      wasMentioned: boolean;
      /** Channel mode that was applied */
      mode: "mention" | "auto";
    };
    /** Function to send a reply in the same channel */
    reply: (content: string) => Promise<void>;
  };

  /**
   * Emitted when a message is ignored (e.g., in mention mode but not mentioned)
   */
  messageIgnored: {
    agentName: string;
    reason: "not_mentioned" | "bot_message" | "not_configured" | "unknown_channel";
    /** Discord channel ID */
    channelId: string;
    /** Discord message ID */
    messageId: string;
  };

  /**
   * Emitted when a slash command is executed
   */
  commandExecuted: {
    agentName: string;
    /** Name of the command that was executed */
    commandName: string;
    /** Discord user ID who executed the command */
    userId: string;
    /** Discord channel ID where the command was executed */
    channelId: string;
  };

  /**
   * Emitted when a session is created, resumed, or expires
   *
   * This event allows FleetManager to track session lifecycle for monitoring.
   */
  sessionLifecycle: {
    agentName: string;
    /** Type of session event */
    event: "created" | "resumed" | "expired" | "cleared";
    /** Discord channel ID */
    channelId: string;
    /** Claude session ID */
    sessionId: string;
  };

  /**
   * Emitted when a rate limit is encountered
   *
   * Discord.js handles rate limits automatically by queuing and retrying requests.
   * This event is emitted for monitoring and logging purposes.
   */
  rateLimit: {
    agentName: string;
    /** The time (in milliseconds) until the rate limit resets */
    timeToReset: number;
    /** Maximum number of requests allowed in the rate limit window */
    limit: number;
    /** HTTP method of the request that hit the rate limit */
    method: string;
    /** Route hash for the rate-limited endpoint */
    hash: string;
    /** The API route that hit the rate limit */
    route: string;
    /** Whether this is a global rate limit */
    global: boolean;
  };
}

export type DiscordConnectorEventName = keyof DiscordConnectorEventMap;
export type DiscordConnectorEventPayload<T extends DiscordConnectorEventName> =
  DiscordConnectorEventMap[T];
