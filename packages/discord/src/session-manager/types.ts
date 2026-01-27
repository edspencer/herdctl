/**
 * Type definitions for Discord session management
 *
 * Provides interfaces for per-channel session state tracking,
 * enabling conversation context preservation across Discord channels.
 */

import { z } from "zod";

// =============================================================================
// Session Schema
// =============================================================================

/**
 * Schema for individual channel/DM session mapping
 */
export const ChannelSessionSchema = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when last message was sent/received */
  lastMessageAt: z.string().datetime({
    message: "lastMessageAt must be a valid ISO datetime string",
  }),
});

/**
 * Schema for the entire agent's Discord session state file
 *
 * Stored at .herdctl/discord-sessions/<agent-name>.yaml
 */
export const DiscordSessionStateSchema = z.object({
  /** Version for future schema migrations */
  version: z.literal(1),

  /** Agent name this session state belongs to */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of channel/DM ID to session info */
  channels: z.record(z.string(), ChannelSessionSchema),
});

// =============================================================================
// Type Exports
// =============================================================================

export type ChannelSession = z.infer<typeof ChannelSessionSchema>;
export type DiscordSessionState = z.infer<typeof DiscordSessionStateSchema>;

// =============================================================================
// Session Manager Options
// =============================================================================

/**
 * Logger interface for session manager operations
 */
export interface SessionManagerLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for configuring the SessionManager
 */
export interface SessionManagerOptions {
  /**
   * Name of the agent this session manager is for
   */
  agentName: string;

  /**
   * Root path for state storage (e.g., .herdctl)
   * Sessions will be stored at <stateDir>/discord-sessions/<agent-name>.yaml
   */
  stateDir: string;

  /**
   * Session expiry timeout in hours
   * Sessions inactive for longer than this will be considered expired
   *
   * @default 24
   */
  sessionExpiryHours?: number;

  /**
   * Logger for session manager operations
   *
   * @default console-based logger
   */
  logger?: SessionManagerLogger;
}

// =============================================================================
// Session Manager Interface
// =============================================================================

/**
 * Result of getting or creating a session
 */
export interface SessionResult {
  /** Claude session ID */
  sessionId: string;

  /** Whether this is a newly created session */
  isNew: boolean;
}

/**
 * Interface that all session managers must implement
 */
export interface ISessionManager {
  /**
   * Get or create a session for a channel/DM
   *
   * If an active (non-expired) session exists, returns it.
   * Otherwise, creates a new session.
   *
   * @param channelId - Discord channel or DM ID
   * @returns Session info with sessionId and isNew flag
   */
  getOrCreateSession(channelId: string): Promise<SessionResult>;

  /**
   * Update the last message timestamp for a session
   *
   * Called after each message to keep the session active.
   *
   * @param channelId - Discord channel or DM ID
   */
  touchSession(channelId: string): Promise<void>;

  /**
   * Get an existing session without creating one
   *
   * Returns null if no session exists or if the session is expired.
   *
   * @param channelId - Discord channel or DM ID
   * @returns The session if it exists and is not expired, null otherwise
   */
  getSession(channelId: string): Promise<ChannelSession | null>;

  /**
   * Clear a specific session
   *
   * @param channelId - Discord channel or DM ID
   * @returns true if the session was cleared, false if it didn't exist
   */
  clearSession(channelId: string): Promise<boolean>;

  /**
   * Clean up all expired sessions
   *
   * Should be called on connector startup and periodically.
   *
   * @returns Number of sessions that were cleaned up
   */
  cleanupExpiredSessions(): Promise<number>;

  /**
   * Get the count of active (non-expired) sessions
   *
   * Useful for logging during shutdown to confirm sessions are preserved.
   *
   * @returns Number of active sessions
   */
  getActiveSessionCount(): Promise<number>;

  /**
   * Name of the agent this session manager is for
   */
  readonly agentName: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create initial session state for a new agent
 */
export function createInitialSessionState(
  agentName: string
): DiscordSessionState {
  return {
    version: 1,
    agentName,
    channels: {},
  };
}

/**
 * Create a new channel session
 */
export function createChannelSession(sessionId: string): ChannelSession {
  return {
    sessionId,
    lastMessageAt: new Date().toISOString(),
  };
}
