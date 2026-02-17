/**
 * @herdctl/slack
 *
 * Slack connector for herdctl — Autonomous Agent Fleet Management for Claude Code
 *
 * This package provides:
 * - SlackConnector class for connecting agents to Slack via Socket Mode
 * - Single Bolt App shared across all agents (one bot token per workspace)
 * - Channel->agent routing for multi-agent support
 * - Channel-based conversation management
 *
 * Session management, message splitting, and other shared utilities
 * are provided by @herdctl/chat - import them from there directly.
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

// Types (Slack-specific only - shared types are in @herdctl/chat)
export type {
  SlackConnectorOptions,
  SlackConnectorState,
  SlackConnectionStatus,
  SlackConnectorLogger,
  SlackMessageEvent,
  SlackErrorEvent,
  SlackChannelConfig,
  SlackFileUploadParams,
  ISlackConnector,
  SlackConnectorEventMap,
  SlackConnectorEventName,
  SlackConnectorEventPayload,
} from "./types.js";

// Slack-specific errors
export {
  SlackErrorCode,
  SlackConnectorError,
  SlackConnectionError,
  AlreadyConnectedError,
  MissingTokenError,
  InvalidTokenError,
  isSlackConnectorError,
} from "./errors.js";

// Slack-specific error handling (re-exports shared types + Slack classifier)
export {
  ErrorCategory,
  classifyError,
  safeExecute,
  safeExecuteWithReply,
} from "./error-handler.js";

export type { ClassifiedError } from "./error-handler.js";

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

// Slack-specific formatting utilities
// Note: Message splitting functions are re-exported from @herdctl/chat
export {
  // Slack-specific
  SLACK_MAX_MESSAGE_LENGTH,
  markdownToMrkdwn,
  escapeMrkdwn,
  createContextAttachment,
  // Re-exported from @herdctl/chat
  findSplitPoint,
  splitMessage,
  needsSplit,
  truncateMessage,
  formatCodeBlock,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
} from "./formatting.js";

export type {
  MessageSplitOptions,
  SplitResult,
  ContextAttachment,
} from "./formatting.js";
