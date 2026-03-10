/**
 * Type definitions for Discord slash commands
 *
 * Provides interfaces for command registration, execution context,
 * and command handler definitions.
 */

import type { IChatSessionManager } from "@herdctl/chat";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
} from "discord.js";
import type { DiscordConnectorState } from "../types.js";

export interface CommandActionResult {
  success: boolean;
  message: string;
  jobId?: string;
}

export interface ChannelRunUsage {
  timestamp: string;
  numTurns?: number;
  durationMs?: number;
  totalCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  isError?: boolean;
}

export interface CumulativeUsage {
  totalRuns: number;
  totalSuccesses: number;
  totalFailures: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  firstRunAt: string;
  lastRunAt: string;
}

export interface CommandActions {
  stopRun?: (channelId: string) => Promise<CommandActionResult>;
  retryRun?: (channelId: string) => Promise<CommandActionResult>;
  runSkill?: (channelId: string, skillName: string, input?: string) => Promise<CommandActionResult>;
  listSkills?: () => Promise<Array<{ name: string; description?: string }>>;
  getUsage?: (channelId: string) => Promise<ChannelRunUsage | null>;
  getCumulativeUsage?: () => Promise<CumulativeUsage>;
  getAgentConfig?: () => Promise<{
    runtime?: string;
    model?: string;
    permissionMode?: string;
    workingDirectory?: string;
    allowedTools?: string[];
    deniedTools?: string[];
    mcpServers?: string[];
  }>;
  getSessionInfo?: (channelId: string) => Promise<{
    activeJobId?: string;
    lastPrompt?: string;
  }>;
}

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

  /** Optional manager-backed command actions */
  commandActions?: CommandActions;
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
   * Optional slash-command builder customizations (options, autocomplete flags, etc.)
   */
  build?: (builder: SlashCommandBuilder) => SlashCommandBuilder;

  /**
   * Execute the command
   *
   * @param context - Command execution context
   */
  execute(context: CommandContext): Promise<void>;

  /**
   * Optional autocomplete handler for command options
   */
  autocomplete?: (
    interaction: AutocompleteInteraction,
    context: Omit<CommandContext, "interaction">,
  ) => Promise<void>;
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

  /** Optional manager-backed command actions */
  commandActions?: CommandActions;

  /** Registration mode for slash commands */
  commandRegistration?: {
    scope: "global" | "guild";
    guildId?: string;
  };
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
   * Handle an autocomplete interaction for slash command option suggestions.
   */
  handleAutocomplete(interaction: AutocompleteInteraction): Promise<void>;

  /**
   * Get all registered commands
   */
  getCommands(): ReadonlyMap<string, SlashCommand>;
}
