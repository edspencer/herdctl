/**
 * Slash commands module for Discord bot
 *
 * Provides command registration, handling, and built-in commands
 * for controlling the bot via Discord slash commands.
 */

// Command Manager
export { CommandManager } from "./command-manager.js";

// Types
export type {
  CommandContext,
  SlashCommand,
  CommandManagerLogger,
  CommandManagerOptions,
  ICommandManager,
} from "./types.js";

// Built-in Commands
export { helpCommand } from "./help.js";
export { resetCommand } from "./reset.js";
export { statusCommand } from "./status.js";
