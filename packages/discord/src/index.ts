/**
 * @herdctl/discord
 *
 * Discord connector for herdctl - Autonomous Agent Fleet Management for Claude Code
 *
 * This package provides:
 * - DiscordConnector class for connecting agents to Discord
 * - Per-agent Discord bot support
 * - Connection lifecycle management
 * - Event-driven architecture for monitoring
 * - SessionManager for per-channel conversation context
 */

export const VERSION = "0.0.1";

// Main connector class
export { DiscordConnector } from "./discord-connector.js";

// Logger
export {
  DiscordLogger,
  createLoggerFromConfig,
  createDefaultDiscordLogger,
} from "./logger.js";

export type {
  DiscordLogLevel,
  DiscordLoggerOptions,
} from "./logger.js";

// Session manager
export { SessionManager } from "./session-manager/index.js";

// Types
export type {
  DiscordConnectorOptions,
  DiscordConnectorState,
  DiscordConnectionStatus,
  DiscordConnectorLogger,
  IDiscordConnector,
  DiscordConnectorEventMap,
  DiscordConnectorEventName,
  DiscordConnectorEventPayload,
} from "./types.js";

// Session manager types
export type {
  SessionManagerOptions,
  SessionManagerLogger,
  ISessionManager,
  SessionResult,
  ChannelSession,
  DiscordSessionState,
} from "./session-manager/index.js";

export {
  DiscordSessionStateSchema,
  ChannelSessionSchema,
  createInitialSessionState,
  createChannelSession,
} from "./session-manager/index.js";

// Mention handling
export {
  isBotMentioned,
  shouldProcessMessage,
  stripBotMention,
  stripMentions,
  processMessage,
  fetchMessageHistory,
  buildConversationContext,
  formatContextForPrompt,
} from "./mention-handler.js";

export type {
  TextBasedChannel,
  ContextMessage,
  ContextBuildOptions,
  ConversationContext,
} from "./mention-handler.js";

// Auto mode handling (DMs and dedicated channels)
export {
  isDMEnabled,
  getDMMode,
  checkDMUserFilter,
  findChannelConfig,
  resolveChannelConfig,
  shouldProcessInMode,
  DEFAULT_DM_CONTEXT_MESSAGES,
  DEFAULT_CHANNEL_CONTEXT_MESSAGES,
} from "./auto-mode-handler.js";

export type {
  DMFilterResult,
  DMConfig,
  ResolvedChannelConfig,
} from "./auto-mode-handler.js";

// Errors
export {
  DiscordErrorCode,
  DiscordConnectorError,
  DiscordConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
  MissingTokenError,
  isDiscordConnectorError,
} from "./errors.js";

// Error handling utilities
export {
  USER_ERROR_MESSAGES,
  ErrorCategory,
  classifyError,
  withRetry,
  ErrorHandler,
  safeExecute,
  safeExecuteWithReply,
} from "./error-handler.js";

export type {
  UserErrorMessageKey,
  ClassifiedError,
  RetryOptions,
  RetryResult,
  ErrorHandlerOptions,
} from "./error-handler.js";

// Session manager errors
export {
  SessionErrorCode,
  SessionManagerError,
  SessionStateReadError,
  SessionStateWriteError,
  SessionDirectoryCreateError,
  isSessionManagerError,
} from "./session-manager/index.js";

// Commands
export { CommandManager } from "./commands/index.js";
export { helpCommand, resetCommand, statusCommand } from "./commands/index.js";

export type {
  CommandContext,
  SlashCommand,
  CommandManagerLogger,
  CommandManagerOptions,
  ICommandManager,
} from "./commands/index.js";

// Formatting utilities
export {
  DISCORD_MAX_MESSAGE_LENGTH,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  findSplitPoint,
  splitMessage,
  needsSplit,
  startTypingIndicator,
  sendSplitMessage,
  sendWithTyping,
  truncateMessage,
  formatCodeBlock,
  escapeMarkdown,
} from "./utils/index.js";

export type {
  SendableChannel,
  MessageSplitOptions,
  SendSplitOptions,
  SplitResult,
  TypingController,
} from "./utils/index.js";
