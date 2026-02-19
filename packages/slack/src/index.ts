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

export type {
  CommandContext,
  CommandHandlerOptions,
  PrefixCommand,
} from "./commands/index.js";
// Commands
export { CommandHandler, helpCommand, resetCommand, statusCommand } from "./commands/index.js";
export type { ClassifiedError } from "./error-handler.js";
// Slack-specific error handling (re-exports shared types + Slack classifier)
export {
  classifyError,
  ErrorCategory,
  safeExecute,
  safeExecuteWithReply,
} from "./error-handler.js";

// Slack-specific errors
export {
  AlreadyConnectedError,
  InvalidTokenError,
  isSlackConnectorError,
  MissingTokenError,
  SlackConnectionError,
  SlackConnectorError,
  SlackErrorCode,
} from "./errors.js";
export type {
  ContextAttachment,
  MessageSplitOptions,
  SplitResult,
} from "./formatting.js";
// Slack-specific formatting utilities
// Note: Message splitting functions are re-exported from @herdctl/chat
export {
  createContextAttachment,
  DEFAULT_MESSAGE_DELAY_MS,
  escapeMrkdwn,
  // Re-exported from @herdctl/chat
  findSplitPoint,
  formatCodeBlock,
  MIN_CHUNK_SIZE,
  markdownToMrkdwn,
  needsSplit,
  // Slack-specific
  SLACK_MAX_MESSAGE_LENGTH,
  splitMessage,
  truncateMessage,
} from "./formatting.js";
export type {
  SlackLoggerOptions,
  SlackLogLevel,
} from "./logger.js";
// Logger
export {
  createDefaultSlackLogger,
  createSlackLogger,
} from "./logger.js";
// Manager class (used by FleetManager)
export { SlackManager } from "./manager.js";

// Message handling
export {
  isBotMentioned,
  processMessage,
  shouldProcessMessage,
  stripBotMention,
  stripMentions,
} from "./message-handler.js";
// Main connector class
export { SlackConnector } from "./slack-connector.js";
// Types (Slack-specific only - shared types are in @herdctl/chat)
export type {
  ISlackConnector,
  SlackChannelConfig,
  SlackConnectionStatus,
  SlackConnectorEventMap,
  SlackConnectorEventName,
  SlackConnectorEventPayload,
  SlackConnectorLogger,
  SlackConnectorOptions,
  SlackConnectorState,
  SlackErrorEvent,
  SlackFileUploadParams,
  SlackMessageEvent,
} from "./types.js";
