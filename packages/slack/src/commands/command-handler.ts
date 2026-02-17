/**
 * Command handler for Slack message prefix commands
 *
 * Handles !command style messages for MVP simplicity
 * (vs Slack slash commands which require URL verification).
 */

import type { IChatSessionManager } from "@herdctl/chat";
import type { SlackConnectorLogger, SlackConnectorState } from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  /** Name of the agent handling this command */
  agentName: string;

  /** Channel ID */
  channelId: string;

  /** User who sent the command */
  userId: string;

  /** Function to reply in the channel */
  reply: (content: string) => Promise<void>;

  /** Session manager for the agent */
  sessionManager: IChatSessionManager;

  /** Current connector state */
  connectorState: SlackConnectorState;
}

/**
 * A prefix command definition
 */
export interface PrefixCommand {
  /** Command name (without ! prefix) */
  name: string;

  /** Description of the command */
  description: string;

  /** Execute the command */
  execute(context: CommandContext): Promise<void>;
}

/**
 * Options for CommandHandler
 */
export interface CommandHandlerOptions {
  /** Logger instance */
  logger?: SlackConnectorLogger;
}

// =============================================================================
// Command Handler
// =============================================================================

/**
 * CommandHandler manages message prefix commands for Slack
 *
 * Commands are triggered by messages starting with `!` (e.g., `!reset`, `!status`)
 */
export class CommandHandler {
  private commands: Map<string, PrefixCommand> = new Map();
  private readonly logger: SlackConnectorLogger;

  constructor(options: CommandHandlerOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }

  /**
   * Register a command
   */
  registerCommand(command: PrefixCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
  }

  /**
   * Check if a message is a command
   */
  isCommand(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith("!")) {
      return false;
    }

    const commandName = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    return this.commands.has(commandName);
  }

  /**
   * Execute a command from message text
   *
   * @returns true if a command was executed, false otherwise
   */
  async executeCommand(
    text: string,
    context: CommandContext
  ): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("!")) {
      return false;
    }

    const commandName = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
    const command = this.commands.get(commandName);

    if (!command) {
      return false;
    }

    this.logger.info(`Executing command: !${commandName}`, {
      agentName: context.agentName,
      channelId: context.channelId,
    });

    try {
      await command.execute(context);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Command !${commandName} failed: ${errorMessage}`);

      try {
        await context.reply(
          `An error occurred while executing \`!${commandName}\`. Please try again.`
        );
      } catch {
        // Ignore reply error
      }

      return true; // Command was attempted, even if it failed
    }
  }

  /**
   * Get all registered commands
   */
  getCommands(): PrefixCommand[] {
    return Array.from(this.commands.values());
  }
}
