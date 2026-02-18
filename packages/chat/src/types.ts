/**
 * Shared type definitions for chat connectors
 *
 * These types define the common interfaces used across all chat platform
 * integrations (Discord, Slack, etc.).
 */

// =============================================================================
// Connection Status
// =============================================================================

/**
 * Chat connector connection status
 *
 * This is identical across all platforms.
 */
export type ChatConnectionStatus =
  | "disconnected" // Initial state, not connected
  | "connecting" // Connection in progress
  | "connected" // Connected and ready
  | "reconnecting" // Attempting to reconnect after disconnect
  | "disconnecting" // Graceful shutdown in progress
  | "error"; // Connection error occurred

// =============================================================================
// Connector State
// =============================================================================

/**
 * Base connector state that all platforms share
 *
 * Platform-specific implementations may extend this with additional fields.
 */
export interface ChatConnectorState {
  /** Current connection status */
  status: ChatConnectionStatus;

  /** ISO timestamp when the connector connected */
  connectedAt: string | null;

  /** ISO timestamp when the connector disconnected */
  disconnectedAt: string | null;

  /** Number of reconnect attempts since last successful connection */
  reconnectAttempts: number;

  /** Last error message if status is 'error' */
  lastError: string | null;

  /** Bot user info (only present when connected) */
  botUser: {
    id: string;
    username: string;
  } | null;

  /** Message statistics since connection */
  messageStats: {
    /** Total messages received and processed */
    received: number;
    /** Total messages sent (replies) */
    sent: number;
    /** Total messages ignored (not mentioned, bot messages, etc.) */
    ignored: number;
  };
}

// =============================================================================
// Connector Interface
// =============================================================================

/**
 * Session manager interface for chat connectors
 *
 * Minimal interface for session management in connectors.
 * Keyed by channelId for both Discord and Slack.
 */
export interface IChatSessionManager {
  readonly agentName: string;

  getOrCreateSession(channelId: string): Promise<{ sessionId: string; isNew: boolean }>;

  getSession(channelId: string): Promise<{ sessionId: string; lastMessageAt: string } | null>;

  setSession(channelId: string, sessionId: string): Promise<void>;

  touchSession(channelId: string): Promise<void>;

  clearSession(channelId: string): Promise<boolean>;

  cleanupExpiredSessions(): Promise<number>;

  getActiveSessionCount(): Promise<number>;
}

/**
 * Base interface for chat connectors
 *
 * All chat platform connectors (Discord, Slack, etc.) implement this interface.
 */
export interface IChatConnector {
  /** Name of the agent this connector is bound to */
  readonly agentName: string;

  /** Session manager for this agent */
  readonly sessionManager: IChatSessionManager;

  /** Connect to the chat platform */
  connect(): Promise<void>;

  /** Disconnect from the chat platform */
  disconnect(): Promise<void>;

  /** Check if currently connected */
  isConnected(): boolean;

  /** Get current connector state */
  getState(): ChatConnectorState;
}

// =============================================================================
// Logger Interface
// =============================================================================

/**
 * Logger interface for chat connector operations
 *
 * All connectors accept a logger with this interface.
 */
export interface ChatConnectorLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// =============================================================================
// Message Event Types
// =============================================================================

/**
 * Base metadata for chat messages
 */
export interface ChatMessageMetadata {
  /** Channel ID where the message was sent */
  channelId: string;
  /** User ID who sent the message */
  userId: string;
  /** Whether this was triggered by a mention */
  wasMentioned: boolean;
  /** Allow additional platform-specific fields */
  [key: string]: unknown;
}

/**
 * Base message event from chat connectors
 *
 * This is emitted when a processable message is received.
 * Platform-specific connectors may extend this with additional fields.
 */
export interface ChatMessageEvent {
  /** Name of the agent handling this message */
  agentName: string;

  /** The processed prompt text (with mention stripped) */
  prompt: string;

  /** Platform-specific metadata */
  metadata: ChatMessageMetadata;

  /** Function to send a reply in the same channel/thread */
  reply: (content: string) => Promise<void>;

  /**
   * Start showing processing indicator.
   * Returns a stop function that should be called when done.
   */
  startProcessingIndicator: () => () => void;
}

// =============================================================================
// Event Map Types
// =============================================================================

/**
 * Session lifecycle event types
 */
export type SessionLifecycleEvent = "created" | "resumed" | "expired" | "cleared";

/**
 * Base event map for chat connectors
 *
 * All connectors emit these events. Platform-specific connectors may
 * add additional events.
 */
export interface ChatConnectorEventMap {
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
  message: ChatMessageEvent;

  /** Emitted when a message is ignored */
  messageIgnored: {
    agentName: string;
    reason: string;
    channelId: string;
  };

  /** Emitted when a command is executed */
  commandExecuted: {
    agentName: string;
    commandName: string;
    userId: string;
    channelId: string;
  };

  /** Emitted when a session is created, resumed, expired, or cleared */
  sessionLifecycle: {
    agentName: string;
    event: SessionLifecycleEvent;
    channelId: string;
    sessionId: string;
  };
}

export type ChatConnectorEventName = keyof ChatConnectorEventMap;
export type ChatConnectorEventPayload<E extends ChatConnectorEventName> =
  ChatConnectorEventMap[E];
