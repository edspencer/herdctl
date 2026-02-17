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
 *
 * Session management, message splitting, and other shared utilities
 * are provided by @herdctl/chat - import them from there directly.
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
  DiscordReplyEmbedField,
  DiscordReplyEmbed,
  DiscordReplyPayload,
} from "./types.js";

// Mention handling (Discord-specific)
export {
  isBotMentioned,
  shouldProcessMessage,
  stripBotMention,
  stripBotRoleMentions,
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

// Auto mode handling (Discord-specific: guild hierarchy, channel resolution)
export {
  findChannelConfig,
  resolveChannelConfig,
  DEFAULT_DM_CONTEXT_MESSAGES,
  DEFAULT_CHANNEL_CONTEXT_MESSAGES,
} from "./auto-mode-handler.js";

export type { ResolvedChannelConfig } from "./auto-mode-handler.js";

// Discord-specific errors
export {
  DiscordErrorCode,
  DiscordConnectorError,
  DiscordConnectionError,
  AlreadyConnectedError,
  InvalidTokenError,
  MissingTokenError,
  isDiscordConnectorError,
} from "./errors.js";

// Discord-specific error handling (classification uses Discord error codes)
export {
  classifyError,
  ErrorHandler,
} from "./error-handler.js";

export type { ErrorHandlerOptions } from "./error-handler.js";

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

// Discord-specific formatting utilities (typing indicator, escapeMarkdown)
export {
  DISCORD_MAX_MESSAGE_LENGTH,
  startTypingIndicator,
  sendSplitMessage,
  sendWithTyping,
  escapeMarkdown,
} from "./utils/index.js";

export type {
  SendableChannel,
  SendSplitOptions,
  TypingController,
} from "./utils/index.js";
