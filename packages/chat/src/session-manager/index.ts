/**
 * Session manager module for chat platforms
 *
 * Provides per-channel session management for Claude conversations.
 * This module is shared between Discord, Slack, and other chat platforms.
 */

export {
  isSessionManagerError,
  SessionDirectoryCreateError,
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
} from "./errors.js";
export { ChatSessionManager } from "./session-manager.js";
export {
  // Types
  type ChannelSession,
  // Schemas
  ChannelSessionSchema,
  type ChatSessionManagerOptions,
  type ChatSessionState,
  ChatSessionStateSchema,
  createChannelSession,
  // Factory functions
  createInitialSessionState,
  type IChatSessionManager,
  type SessionManagerLogger,
  type SessionResult,
} from "./types.js";
