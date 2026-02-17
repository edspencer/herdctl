/**
 * Command Manager - Handles slash command registration and execution
 *
 * Registers commands per-bot (as application commands) and handles
 * command interactions by routing them to the appropriate handler.
 */

import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import type {
  SlashCommand,
  CommandManagerOptions,
  CommandManagerLogger,
  ICommandManager,
  CommandContext,
} from "./types.js";
import type { DiscordConnectorState } from "../types.js";
import type { ISessionManager } from "../session-manager/index.js";
import { helpCommand } from "./help.js";
import { resetCommand } from "./reset.js";
import { statusCommand } from "./status.js";
import {
  USER_ERROR_MESSAGES,
  ErrorHandler,
  withRetry,
  type ErrorHandlerOptions,
} from "../error-handler.js";

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(agentName: string): CommandManagerLogger {
  const prefix = `[commands:${agentName}]`;
  return {
    debug: (msg, data) =>
      console.debug(prefix, msg, data ? JSON.stringify(data) : ""),
    info: (msg, data) =>
      console.info(prefix, msg, data ? JSON.stringify(data) : ""),
    warn: (msg, data) =>
      console.warn(prefix, msg, data ? JSON.stringify(data) : ""),
    error: (msg, data) =>
      console.error(prefix, msg, data ? JSON.stringify(data) : ""),
  };
}

// =============================================================================
// Built-in Commands
// =============================================================================

/**
 * Get all built-in commands
 */
function getBuiltInCommands(): SlashCommand[] {
  return [helpCommand, resetCommand, statusCommand];
}

// =============================================================================
// Command Manager Implementation
// =============================================================================

/**
 * CommandManager handles slash command registration and execution.
 *
 * Commands are registered per-bot using Discord's REST API. Each agent's
 * bot has its own set of commands.
 *
 * @example
 * ```typescript
 * const commandManager = new CommandManager({
 *   agentName: 'my-agent',
 *   client: discordClient,
 *   botToken: process.env.BOT_TOKEN,
 *   sessionManager,
 *   getConnectorState: () => connector.getState(),
 * });
 *
 * // Register commands after client is ready
 * await commandManager.registerCommands();
 *
 * // Handle interactions in your interaction handler
 * client.on('interactionCreate', async (interaction) => {
 *   if (interaction.isChatInputCommand()) {
 *     await commandManager.handleInteraction(interaction);
 *   }
 * });
 * ```
 */
export class CommandManager implements ICommandManager {
  private readonly agentName: string;
  private readonly client: Client;
  private readonly botToken: string;
  private readonly sessionManager: ISessionManager;
  private readonly getConnectorState: () => DiscordConnectorState;
  private readonly logger: CommandManagerLogger;
  private readonly commands: Map<string, SlashCommand>;
  private readonly errorHandler: ErrorHandler;

  constructor(options: CommandManagerOptions) {
    this.agentName = options.agentName;
    this.client = options.client;
    this.botToken = options.botToken;
    this.sessionManager = options.sessionManager;
    this.getConnectorState = options.getConnectorState;
    this.logger = options.logger ?? createDefaultLogger(options.agentName);

    // Initialize error handler
    this.errorHandler = new ErrorHandler({
      logger: this.logger,
      agentName: this.agentName,
    });

    // Initialize commands map
    this.commands = new Map();
    for (const command of getBuiltInCommands()) {
      this.commands.set(command.name, command);
    }
  }

  /**
   * Register all commands with Discord
   *
   * Uses the Discord REST API to register application commands.
   * Commands are registered globally for the bot application.
   * Includes retry logic for transient failures.
   */
  async registerCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(this.botToken);

    // Build command data for Discord API
    const commandData = Array.from(this.commands.values()).map((cmd) =>
      new SlashCommandBuilder()
        .setName(cmd.name)
        .setDescription(cmd.description)
        .toJSON()
    );

    const clientId = this.client.user?.id;
    if (!clientId) {
      this.logger.error("Cannot register commands: client user ID not available");
      throw new Error("Client user ID not available for command registration");
    }

    this.logger.debug("Registering slash commands...", {
      commandCount: commandData.length,
      commands: Array.from(this.commands.keys()),
    });

    // Use retry logic for command registration (handles rate limits, network issues)
    const result = await withRetry(
      async () => {
        await rest.put(Routes.applicationCommands(clientId), {
          body: commandData,
        });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        operationName: "registerCommands",
        logger: this.logger,
      }
    );

    if (!result.success) {
      const errorMessage = result.error?.message ?? "Unknown error";
      this.logger.error("Failed to register slash commands after retries", {
        error: errorMessage,
        attempts: result.attempts,
      });
      throw result.error ?? new Error("Failed to register commands");
    }

    this.logger.debug("Successfully registered slash commands");
  }

  /**
   * Handle an incoming command interaction
   *
   * Routes the interaction to the appropriate command handler.
   * Provides user-friendly error messages on failure.
   */
  async handleInteraction(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const commandName = interaction.commandName;
    const command = this.commands.get(commandName);

    if (!command) {
      this.logger.warn("Unknown command received", { commandName });
      await interaction.reply({
        content: "Unknown command.",
        ephemeral: true,
      });
      return;
    }

    this.logger.debug("Executing command", {
      commandName,
      userId: interaction.user.id,
      channelId: interaction.channelId,
    });

    const context: CommandContext = {
      interaction,
      client: this.client,
      agentName: this.agentName,
      sessionManager: this.sessionManager,
      connectorState: this.getConnectorState(),
    };

    try {
      await command.execute(context);
    } catch (error) {
      // Use error handler for detailed logging
      const userMessage = this.errorHandler.handleError(
        error,
        `executing command '${commandName}'`
      );

      // Try to respond with user-friendly error if we haven't already replied
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: userMessage,
          ephemeral: true,
        });
      } else if (interaction.deferred && !interaction.replied) {
        // If deferred but not replied, use editReply
        await interaction.editReply({
          content: userMessage,
        });
      }
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): ReadonlyMap<string, SlashCommand> {
    return this.commands;
  }
}
