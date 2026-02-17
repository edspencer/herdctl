/**
 * Session manager module for chat platforms
 *
 * Provides per-channel session management for Claude conversations.
 * This module is shared between Discord, Slack, and other chat platforms.
 */

export { ChatSessionManager } from "./session-manager.js";

export {
  // Schemas
  ChannelSessionSchema,
  ChatSessionStateSchema,
  // Types
  type ChannelSession,
  type ChatSessionState,
  type SessionManagerLogger,
  type ChatSessionManagerOptions,
  type SessionResult,
  type IChatSessionManager,
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
