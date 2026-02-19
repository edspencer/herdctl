/**
 * Chat Manager Interface
 *
 * Defines the contract that platform-specific chat managers (Discord, Slack)
 * must implement. FleetManager uses this interface to interact with chat
 * managers without importing their concrete implementations.
 *
 * @module chat-manager-interface
 */

/**
 * State of a chat connector for an agent
 *
 * This is a normalized view of connector state that works across
 * all chat platforms (Discord, Slack, etc.).
 */
export interface ChatManagerConnectorState {
  /**
   * Connection status
   */
  status: "disconnected" | "connecting" | "connected" | "reconnecting" | "disconnecting" | "error";

  /**
   * ISO timestamp when the connector was connected (null if never connected)
   */
  connectedAt: string | null;

  /**
   * ISO timestamp when the connector was disconnected (null if never disconnected)
   */
  disconnectedAt: string | null;

  /**
   * Number of reconnection attempts since last successful connection
   */
  reconnectAttempts: number;

  /**
   * Last error message (null if no error)
   */
  lastError: string | null;

  /**
   * Bot user information (null if not connected)
   */
  botUser: {
    id: string;
    username: string;
  } | null;

  /**
   * Message statistics
   */
  messageStats: {
    received: number;
    sent: number;
    ignored: number;
  };
}

/**
 * Interface for chat managers
 *
 * Chat managers (DiscordManager, SlackManager) implement this interface
 * so FleetManager can interact with them generically without importing
 * platform-specific code.
 *
 * FleetManager stores managers in a Map<string, IChatManager> where the
 * key is the platform name (e.g., "discord", "slack").
 */
export interface IChatManager {
  /**
   * Initialize the chat manager
   *
   * Creates connectors for agents that have this chat platform configured.
   * Should be called during FleetManager initialization.
   */
  initialize(): Promise<void>;

  /**
   * Start all connectors
   *
   * Connects to the chat platform and begins handling messages.
   * Should be called during FleetManager start.
   */
  start(): Promise<void>;

  /**
   * Stop all connectors
   *
   * Gracefully disconnects from the chat platform.
   * Should be called during FleetManager stop.
   */
  stop(): Promise<void>;

  /**
   * Check if the manager has been initialized
   */
  isInitialized(): boolean;

  /**
   * Get qualified names of all agents with connectors
   *
   * @returns Array of agent qualified names that have connectors for this platform
   */
  getConnectorNames(): string[];

  /**
   * Get the number of currently connected connectors
   *
   * @returns Number of connectors that are currently connected
   */
  getConnectedCount(): number;

  /**
   * Check if an agent has a connector for this platform
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns true if the agent has a connector
   */
  hasAgent(qualifiedName: string): boolean;

  /**
   * Get the state of a connector for a specific agent
   *
   * @param qualifiedName - Qualified name of the agent (e.g., "herdctl.security-auditor")
   * @returns The connector state, or undefined if the agent has no connector
   */
  getState(qualifiedName: string): ChatManagerConnectorState | undefined;
}
