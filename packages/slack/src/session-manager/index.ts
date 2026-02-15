/**
 * Session manager module for Slack
 *
 * Provides per-thread session management for Claude conversations.
 */

export { SessionManager } from "./session-manager.js";

export {
  // Schemas
  ThreadSessionSchema,
  SlackSessionStateSchema,
  // Types
  type ThreadSession,
  type SlackSessionState,
  type SessionManagerLogger,
  type SessionManagerOptions,
  type SessionResult,
  type ISessionManager,
  // Factory functions
  createInitialSessionState,
  createThreadSession,
} from "./types.js";

export {
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "./errors.js";
