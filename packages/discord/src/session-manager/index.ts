/**
 * Session manager module for Discord channel conversations
 *
 * Provides per-channel session management for Claude conversations,
 * enabling conversation context preservation across Discord channels.
 */

// Main class
export { SessionManager } from "./session-manager.js";

// Types
export type {
  SessionManagerOptions,
  SessionManagerLogger,
  ISessionManager,
  SessionResult,
  ChannelSession,
  DiscordSessionState,
} from "./types.js";

export {
  DiscordSessionStateSchema,
  ChannelSessionSchema,
  createInitialSessionState,
  createChannelSession,
} from "./types.js";

// Errors
export {
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "./errors.js";
