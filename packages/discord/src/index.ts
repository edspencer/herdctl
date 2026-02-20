/**
 * @herdctl/discord
 *
 * Discord connector for herdctl - Autonomous Agent Fleet Management for Claude Code
 *
 * This package provides:
 * - DiscordConnector class for connecting agents to Discord
 * - DiscordManager class for managing multiple Discord connectors
 * - Per-agent Discord bot support
 * - Connection lifecycle management
 * - Event-driven architecture for monitoring
 *
 * Session management, message splitting, and other shared utilities
 * are provided by @herdctl/chat - import them from there directly.
 */

export const VERSION = "0.0.1";

export type { ResolvedChannelConfig } from "./auto-mode-handler.js";
// Auto mode handling (Discord-specific: guild hierarchy, channel resolution)
export {
  DEFAULT_CHANNEL_CONTEXT_MESSAGES,
  DEFAULT_DM_CONTEXT_MESSAGES,
  findChannelConfig,
  resolveChannelConfig,
} from "./auto-mode-handler.js";
export type {
  CommandContext,
  CommandManagerLogger,
  CommandManagerOptions,
  ICommandManager,
  SlashCommand,
} from "./commands/index.js";
// Commands
export { CommandManager, helpCommand, resetCommand, statusCommand } from "./commands/index.js";
// Main connector class
export { DiscordConnector } from "./discord-connector.js";
export type { ErrorHandlerOptions } from "./error-handler.js";
// Discord-specific error handling (classification uses Discord error codes)
export {
  classifyError,
  ErrorHandler,
} from "./error-handler.js";
// Discord-specific errors
export {
  AlreadyConnectedError,
  DiscordConnectionError,
  DiscordConnectorError,
  DiscordErrorCode,
  InvalidTokenError,
  isDiscordConnectorError,
  MissingTokenError,
} from "./errors.js";
export type {
  DiscordLoggerOptions,
  DiscordLogLevel,
} from "./logger.js";
// Logger
export {
  createDefaultDiscordLogger,
  createLoggerFromConfig,
  DiscordLogger,
} from "./logger.js";
// Manager class (used by FleetManager)
export { DiscordManager } from "./manager.js";
export type {
  ContextBuildOptions,
  ContextMessage,
  ConversationContext,
  TextBasedChannel,
} from "./mention-handler.js";
// Mention handling (Discord-specific)
export {
  buildConversationContext,
  fetchMessageHistory,
  formatContextForPrompt,
  isBotMentioned,
  processMessage,
  shouldProcessMessage,
  stripBotMention,
  stripBotRoleMentions,
  stripMentions,
} from "./mention-handler.js";
// Types
export type {
  DiscordConnectionStatus,
  DiscordConnectorEventMap,
  DiscordConnectorEventName,
  DiscordConnectorEventPayload,
  DiscordConnectorLogger,
  DiscordConnectorOptions,
  DiscordConnectorState,
  DiscordReplyEmbed,
  DiscordReplyEmbedField,
  DiscordReplyPayload,
  IDiscordConnector,
} from "./types.js";
export type {
  SendableChannel,
  SendSplitOptions,
  TypingController,
} from "./utils/index.js";
// Discord-specific formatting utilities (typing indicator, escapeMarkdown)
export {
  DISCORD_MAX_MESSAGE_LENGTH,
  escapeMarkdown,
  sendSplitMessage,
  sendWithTyping,
  startTypingIndicator,
} from "./utils/index.js";
