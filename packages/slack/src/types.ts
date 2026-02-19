/**
 * Type definitions for the Slack connector
 *
 * Provides interfaces for connector configuration, state tracking,
 * and event definitions.
 */

import type { EventEmitter } from "node:events";
import type { IChatSessionManager, DMConfig } from "@herdctl/chat";

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Slack connector connection status
 */
export type SlackConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

// =============================================================================
// Connector State
// =============================================================================

/**
 * Current state of the Slack connector
 */
export interface SlackConnectorState {
  /** Current connection status */
  status: SlackConnectionStatus;

  /** ISO timestamp when the connector connected */
  connectedAt: string | null;

  /** ISO timestamp when the connector disconnected */
  disconnectedAt: string | null;

  /** Number of reconnect attempts */
  reconnectAttempts: number;

  /** Last error message */
  lastError: string | null;

  /** Bot user info (only present when connected) */
  botUser: {
    id: string;
    username: string;
  } | null;

  /** Message statistics */
  messageStats: {
    received: number;
    sent: number;
    ignored: number;
  };
}

// =============================================================================
// Connector Options
// =============================================================================

/**
 * Options for creating a SlackConnector
 */
/**
 * Per-channel configuration
 */
export interface SlackChannelConfig {
  /** The Slack channel ID */
  id: string;
  /** Channel message mode: "mention" = only @mentions, "auto" = all messages */
  mode?: "mention" | "auto";
}

/**
 * Options for creating a SlackConnector
 */
export interface SlackConnectorOptions {
  /** Name of the agent this connector is bound to */
  agentName: string;

  /** Slack Bot Token (xoxb-...) */
  botToken: string;

  /** Slack App Token for Socket Mode (xapp-...) */
  appToken: string;

  /** Channels this agent listens to */
  channels: SlackChannelConfig[];

  /** DM (direct message) configuration */
  dm?: Partial<DMConfig>;

  /** Session manager for this agent */
  sessionManager: IChatSessionManager;

  /** Logger for connector operations */
  logger?: SlackConnectorLogger;
}

// =============================================================================
// Logger
// =============================================================================

/**
 * Logger interface for Slack connector operations
 */
export interface SlackConnectorLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// =============================================================================
// Message Event
// =============================================================================

/**
 * Message event payload from SlackConnector
 */
export interface SlackMessageEvent {
  /** Name of the agent handling this message */
  agentName: string;

  /** The processed prompt text */
  prompt: string;

  /** Slack-specific metadata */
  metadata: {
    /** Channel ID where the message was sent */
    channelId: string;

    /** Message timestamp */
    messageTs: string;

    /** User ID who sent the message */
    userId: string;

    /** Whether this was triggered by a mention */
    wasMentioned: boolean;

    /** Whether this message is from a DM */
    isDM: boolean;
  };

  /** Function to send a reply in the same thread */
  reply: (content: string) => Promise<void>;

  /** Add hourglass reaction while processing, returns remove function */
  startProcessingIndicator: () => () => void;
}

/**
 * Error event payload from SlackConnector
 */
export interface SlackErrorEvent {
  agentName: string;
  error: Error;
}

// =============================================================================
// Connector Interface
// =============================================================================

/**
 * Interface for the Slack connector
 */
/**
 * Parameters for uploading a file to Slack
 */
export interface SlackFileUploadParams {
  /** Channel ID to upload to */
  channelId: string;
  /** File contents */
  fileBuffer: Buffer;
  /** Filename for the upload */
  filename: string;
  /** Optional message to accompany the file */
  message?: string;
}

export interface ISlackConnector extends EventEmitter {
  /** Name of the agent this connector is bound to */
  readonly agentName: string;

  /** Session manager for this agent */
  readonly sessionManager: IChatSessionManager;

  /** Connect to Slack via Socket Mode */
  connect(): Promise<void>;

  /** Disconnect from Slack */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Get current state */
  getState(): SlackConnectorState;

  /** Upload a file to a Slack channel/thread */
  uploadFile(params: SlackFileUploadParams): Promise<{ fileId: string }>;

  /** Type-safe event subscription */
  on<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void,
  ): this;
  once<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void,
  ): this;
  off<K extends SlackConnectorEventName>(
    event: K,
    listener: (payload: SlackConnectorEventMap[K]) => void,
  ): this;
}

// =============================================================================
// Connector Event Map
// =============================================================================

/**
 * Strongly-typed event map for SlackConnector
 *
 * Uses object syntax matching Discord's DiscordConnectorEventMap pattern.
 */
export interface SlackConnectorEventMap {
  /** Emitted when connection is established and ready */
  ready: {
    agentName: string;
    botUser: {
      id: string;
      username: string;
    };
  };

  /** Emitted when connection is lost */
  disconnect: {
    agentName: string;
    reason: string;
  };

  /** Emitted on connection error */
  error: {
    agentName: string;
    error: Error;
  };

  /** Emitted when a processable message is received */
  message: SlackMessageEvent;

  /** Emitted when a message is ignored */
  messageIgnored: {
    agentName: string;
    reason:
      | "not_configured"
      | "bot_message"
      | "no_agent_resolved"
      | "empty_prompt"
      | "dm_disabled"
      | "dm_filtered";
    channelId: string;
    messageTs: string;
  };

  /** Emitted when a prefix command is executed */
  commandExecuted: {
    agentName: string;
    commandName: string;
    userId: string;
    channelId: string;
  };

  /** Emitted when a session is created, resumed, expired, or cleared */
  sessionLifecycle: {
    agentName: string;
    event: "created" | "resumed" | "expired" | "cleared";
    channelId: string;
    sessionId: string;
  };
}

export type SlackConnectorEventName = keyof SlackConnectorEventMap;
export type SlackConnectorEventPayload<E extends SlackConnectorEventName> =
  SlackConnectorEventMap[E];
