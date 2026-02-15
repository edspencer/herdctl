/**
 * Type definitions for Slack session management
 *
 * Provides interfaces for per-thread session state tracking,
 * enabling conversation context preservation across Slack threads.
 */

import { z } from "zod";

// =============================================================================
// Session Schema
// =============================================================================

/**
 * Schema for individual thread session mapping
 */
export const ThreadSessionSchema = z.object({
  /** Claude session ID for resuming conversations */
  sessionId: z.string().min(1, "Session ID cannot be empty"),

  /** ISO timestamp when last message was sent/received */
  lastMessageAt: z.string().datetime({
    message: "lastMessageAt must be a valid ISO datetime string",
  }),

  /** Channel ID where the thread exists */
  channelId: z.string().min(1, "Channel ID cannot be empty"),
});

/**
 * Schema for the entire agent's Slack session state file
 *
 * Stored at .herdctl/slack-sessions/<agent-name>.yaml
 */
export const SlackSessionStateSchema = z.object({
  /** Version for future schema migrations */
  version: z.literal(1),

  /** Agent name this session state belongs to */
  agentName: z.string().min(1, "Agent name cannot be empty"),

  /** Map of thread timestamp to session info */
  threads: z.record(z.string(), ThreadSessionSchema),
});

// =============================================================================
// Type Exports
// =============================================================================

export type ThreadSession = z.infer<typeof ThreadSessionSchema>;
export type SlackSessionState = z.infer<typeof SlackSessionStateSchema>;

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
  /** Name of the agent this session manager is for */
  agentName: string;

  /** Root path for state storage (e.g., .herdctl) */
  stateDir: string;

  /** Session expiry timeout in hours (default: 24) */
  sessionExpiryHours?: number;

  /** Logger for session manager operations */
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
 * Interface that all Slack session managers must implement
 *
 * Keyed by threadTs (unlike Discord which keys by channelId)
 */
export interface ISessionManager {
  /**
   * Get or create a session for a thread
   *
   * @param threadTs - Slack thread timestamp (conversation key)
   * @param channelId - Channel where the thread exists
   */
  getOrCreateSession(
    threadTs: string,
    channelId: string
  ): Promise<SessionResult>;

  /**
   * Update the last message timestamp for a session
   *
   * @param threadTs - Slack thread timestamp
   */
  touchSession(threadTs: string): Promise<void>;

  /**
   * Get an existing session without creating one
   *
   * @param threadTs - Slack thread timestamp
   * @returns Session if it exists and is not expired, null otherwise
   */
  getSession(threadTs: string): Promise<ThreadSession | null>;

  /**
   * Store or update the session ID for a thread
   *
   * @param threadTs - Slack thread timestamp
   * @param sessionId - The Claude Agent SDK session ID
   * @param channelId - Channel where the thread exists
   */
  setSession(
    threadTs: string,
    sessionId: string,
    channelId: string
  ): Promise<void>;

  /**
   * Clear a specific session
   *
   * @param threadTs - Slack thread timestamp
   * @returns true if cleared, false if it didn't exist
   */
  clearSession(threadTs: string): Promise<boolean>;

  /**
   * Clean up all expired sessions
   *
   * @returns Number of sessions cleaned up
   */
  cleanupExpiredSessions(): Promise<number>;

  /**
   * Get the count of active (non-expired) sessions
   */
  getActiveSessionCount(): Promise<number>;

  /** Name of the agent this session manager is for */
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
): SlackSessionState {
  return {
    version: 1,
    agentName,
    threads: {},
  };
}

/**
 * Create a new thread session
 */
export function createThreadSession(
  sessionId: string,
  channelId: string
): ThreadSession {
  return {
    sessionId,
    lastMessageAt: new Date().toISOString(),
    channelId,
  };
}
