/**
 * Type definitions for chat session management
 *
 * Provides interfaces for per-channel session state tracking,
 * enabling conversation context preservation across chat channels.
 *
 * This module is shared between Discord, Slack, and other chat platforms.
 */

import { z } from "zod";

// =============================================================================
// Session Schema
// =============================================================================

/**
 * Schema for individual channel session mapping
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
 * Schema for the entire agent's chat session state file
 *
 * Stored at .herdctl/<platform>-sessions/<agent-name>.yaml
 * For example:
 *   - .herdctl/discord-sessions/my-agent.yaml
 *   - .herdctl/slack-sessions/my-agent.yaml
 */
export const ChatSessionStateSchema = z.object({
  /**
   * Schema version. Accepts 1, 2, and 3 — all have identical structure.
   * (1 was Discord's original, 2 was Slack's, 3 was a mistaken bump.)
   * Only increment this when the schema shape actually changes, and add
   * migration logic to handle older versions.
   */
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),

  /** Agent name this session state belongs to */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of channel ID to session info */
  channels: z.record(z.string(), ChannelSessionSchema),
});

// =============================================================================
// Type Exports
// =============================================================================

export type ChannelSession = z.infer<typeof ChannelSessionSchema>;
export type ChatSessionState = z.infer<typeof ChatSessionStateSchema>;

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
 * Options for configuring the ChatSessionManager
 */
export interface ChatSessionManagerOptions {
  /**
   * Platform identifier (e.g., "discord", "slack")
   * Used to compute storage path and session ID prefix
   */
  platform: string;

  /**
   * Name of the agent this session manager is for
   */
  agentName: string;

  /**
   * Root path for state storage (e.g., .herdctl)
   * Sessions will be stored at <stateDir>/<platform>-sessions/<agent-name>.yaml
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
   * @default console-based logger using createLogger from @herdctl/core
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
 * Interface that all chat session managers must implement
 */
export interface IChatSessionManager {
  /**
   * Get or create a session for a channel
   *
   * If an active (non-expired) session exists, returns it.
   * Otherwise, creates a new session.
   *
   * @param channelId - Channel or DM ID
   * @returns Session info with sessionId and isNew flag
   */
  getOrCreateSession(channelId: string): Promise<SessionResult>;

  /**
   * Update the last message timestamp for a session
   *
   * Called after each message to keep the session active.
   *
   * @param channelId - Channel or DM ID
   */
  touchSession(channelId: string): Promise<void>;

  /**
   * Get an existing session without creating one
   *
   * Returns null if no session exists or if the session is expired.
   *
   * @param channelId - Channel or DM ID
   * @returns The session if it exists and is not expired, null otherwise
   */
  getSession(channelId: string): Promise<ChannelSession | null>;

  /**
   * Store or update the session ID for a channel
   *
   * Called after a job completes to store the SDK-provided session ID.
   * This enables conversation continuity by allowing subsequent requests
   * to resume from this session.
   *
   * @param channelId - Channel or DM ID
   * @param sessionId - The Claude Agent SDK session ID
   */
  setSession(channelId: string, sessionId: string): Promise<void>;

  /**
   * Clear a specific session
   *
   * @param channelId - Channel or DM ID
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

  /**
   * Platform identifier this session manager is for
   */
  readonly platform: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create initial session state for a new agent
 */
export function createInitialSessionState(agentName: string): ChatSessionState {
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
