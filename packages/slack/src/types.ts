/**
 * Type definitions for the Slack connector
 *
 * Provides interfaces for connector configuration, state tracking,
 * and event definitions.
 */

import type { EventEmitter } from "node:events";

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
export interface SlackConnectorOptions {
  /** Slack Bot Token (xoxb-...) */
  botToken: string;

  /** Slack App Token for Socket Mode (xapp-...) */
  appToken: string;

  /** Map of channel ID to agent name for routing */
  channelAgentMap: Map<string, string>;

  /** Session managers keyed by agent name */
  sessionManagers: Map<string, ISlackSessionManager>;

  /** Logger for connector operations */
  logger?: SlackConnectorLogger;

  /** State directory for persistence */
  stateDir?: string;
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

    /** Thread timestamp (conversation key) */
    threadTs: string;

    /** Message timestamp */
    messageTs: string;

    /** User ID who sent the message */
    userId: string;

    /** Whether this was triggered by a mention */
    wasMentioned: boolean;
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
export interface ISlackConnector extends EventEmitter {
  /** Connect to Slack via Socket Mode */
  connect(): Promise<void>;

  /** Disconnect from Slack */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Get current state */
  getState(): SlackConnectorState;

  /** Event subscription */
  on(event: "message", listener: (payload: SlackMessageEvent) => void): this;
  on(event: "error", listener: (payload: SlackErrorEvent) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

// =============================================================================
// Session Manager Interface (minimal for connector use)
// =============================================================================

/**
 * Session manager interface for Slack
 *
 * Keyed by threadTs instead of channelId (unlike Discord).
 */
export interface ISlackSessionManager {
  readonly agentName: string;

  getOrCreateSession(
    threadTs: string,
    channelId: string
  ): Promise<{ sessionId: string; isNew: boolean }>;

  getSession(
    threadTs: string
  ): Promise<{ sessionId: string; lastMessageAt: string; channelId: string } | null>;

  setSession(
    threadTs: string,
    sessionId: string,
    channelId: string
  ): Promise<void>;

  touchSession(threadTs: string): Promise<void>;

  clearSession(threadTs: string): Promise<boolean>;

  cleanupExpiredSessions(): Promise<number>;

  getActiveSessionCount(): Promise<number>;
}

// =============================================================================
// Connector Event Map
// =============================================================================

/**
 * Strongly-typed event map for SlackConnector
 */
export interface SlackConnectorEventMap {
  message: [payload: SlackMessageEvent];
  error: [payload: SlackErrorEvent];
  connected: [];
  disconnected: [];
}

export type SlackConnectorEventName = keyof SlackConnectorEventMap;
export type SlackConnectorEventPayload<E extends SlackConnectorEventName> =
  SlackConnectorEventMap[E] extends [infer P] ? P : void;
