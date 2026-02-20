/**
 * Type definitions for Discord slash commands
 *
 * Provides interfaces for command registration, execution context,
 * and command handler definitions.
 */

import type { IChatSessionManager } from "@herdctl/chat";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { DiscordConnectorState } from "../types.js";

// =============================================================================
// Command Context
// =============================================================================

/**
 * Context provided to command handlers when executing
 */
export interface CommandContext {
  /** The Discord interaction object */
  interaction: ChatInputCommandInteraction;

  /** The Discord client */
  client: Client;

  /** Name of the agent this command is being executed for */
  agentName: string;

  /** Session manager for conversation context management */
  sessionManager: IChatSessionManager;

  /** Current connector state */
  connectorState: DiscordConnectorState;
}

// =============================================================================
// Command Definition
// =============================================================================

/**
 * Definition of a slash command
 */
export interface SlashCommand {
  /** Command name (lowercase, no spaces) */
  name: string;

  /** Command description shown in Discord's command picker */
  description: string;

  /**
   * Execute the command
   *
   * @param context - Command execution context
   */
  execute(context: CommandContext): Promise<void>;
}

// =============================================================================
// Command Manager Options
// =============================================================================

/**
 * Logger interface for command manager operations
 */
export interface CommandManagerLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Options for the command manager
 */
export interface CommandManagerOptions {
  /** Name of the agent */
  agentName: string;

  /** Discord client for registering commands */
  client: Client;

  /** Bot token for REST API authentication */
  botToken: string;

  /** Session manager for conversation context */
  sessionManager: IChatSessionManager;

  /** Function to get current connector state */
  getConnectorState: () => DiscordConnectorState;

  /** Optional logger */
  logger?: CommandManagerLogger;
}

// =============================================================================
// Command Manager Interface
// =============================================================================

/**
 * Interface for command managers
 */
export interface ICommandManager {
  /**
   * Register all commands with Discord
   *
   * Commands are registered per-bot (application commands), not globally.
   */
  registerCommands(): Promise<void>;

  /**
   * Handle an incoming command interaction
   *
   * @param interaction - The command interaction to handle
   */
  handleInteraction(interaction: ChatInputCommandInteraction): Promise<void>;

  /**
   * Get all registered commands
   */
  getCommands(): ReadonlyMap<string, SlashCommand>;
}
