/**
 * @herdctl/slack
 *
 * Slack connector for herdctl — Autonomous Agent Fleet Management for Claude Code
 *
 * This package provides:
 * - SlackConnector class for connecting agents to Slack via Socket Mode
 * - Single Bolt App shared across all agents (one bot token per workspace)
 * - Channel→agent routing for multi-agent support
 * - Thread-based conversation management
 * - SessionManager for per-thread conversation context
 */

export const VERSION = "0.1.0";

// Main connector class
export { SlackConnector } from "./slack-connector.js";

// Logger
export {
  createSlackLogger,
  createDefaultSlackLogger,
} from "./logger.js";

export type {
  SlackLogLevel,
  SlackLoggerOptions,
} from "./logger.js";

// Session manager
export { SessionManager } from "./session-manager/index.js";

// Types
export type {
  SlackConnectorOptions,
  SlackConnectorState,
  SlackConnectionStatus,
  SlackConnectorLogger,
  SlackMessageEvent,
  SlackErrorEvent,
  ISlackConnector,
  ISlackSessionManager,
  SlackConnectorEventMap,
  SlackConnectorEventName,
  SlackConnectorEventPayload,
} from "./types.js";

// Session manager types
export type {
  SessionManagerOptions,
  SessionManagerLogger,
  ISessionManager,
  SessionResult,
  ThreadSession,
  SlackSessionState,
} from "./session-manager/index.js";

export {
  SlackSessionStateSchema,
  ThreadSessionSchema,
  createInitialSessionState,
  createThreadSession,
} from "./session-manager/index.js";

// Errors
export {
  SlackErrorCode,
  SlackConnectorError,
  SlackConnectionError,
  AlreadyConnectedError,
  MissingTokenError,
  InvalidTokenError,
  isSlackConnectorError,
} from "./errors.js";

// Error handling utilities
export {
  USER_ERROR_MESSAGES,
  ErrorCategory,
  classifyError,
  safeExecute,
  safeExecuteWithReply,
} from "./error-handler.js";

export type { ClassifiedError } from "./error-handler.js";

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
export { CommandHandler } from "./commands/index.js";
export { helpCommand, resetCommand, statusCommand } from "./commands/index.js";

export type {
  CommandContext,
  PrefixCommand,
  CommandHandlerOptions,
} from "./commands/index.js";

// Message handling
export {
  isBotMentioned,
  stripBotMention,
  stripMentions,
  shouldProcessMessage,
  processMessage,
} from "./message-handler.js";

// Formatting utilities
export {
  SLACK_MAX_MESSAGE_LENGTH,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  findSplitPoint,
  splitMessage,
  needsSplit,
  truncateMessage,
  formatCodeBlock,
  escapeMrkdwn,
  markdownToMrkdwn,
  createContextAttachment,
} from "./formatting.js";

export type {
  MessageSplitOptions,
  SplitResult,
  ContextAttachment,
} from "./formatting.js";
