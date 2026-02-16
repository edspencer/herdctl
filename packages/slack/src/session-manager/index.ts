/**
 * Session manager module for Slack
 *
 * Provides per-channel session management for Claude conversations.
 */

export { SessionManager } from "./session-manager.js";

export {
  // Schemas
  ChannelSessionSchema,
  SlackSessionStateSchema,
  // Types
  type ChannelSession,
  type SlackSessionState,
  type SessionManagerLogger,
  type SessionManagerOptions,
  type SessionResult,
  type ISessionManager,
  // Factory functions
  createInitialSessionState,
  createChannelSession,
} from "./types.js";

export {
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "./errors.js";
