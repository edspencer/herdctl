/**
 * Slash commands module for Discord bot
 *
 * Provides command registration, handling, and built-in commands
 * for controlling the bot via Discord slash commands.
 */

// Command Manager
export { CommandManager } from "./command-manager.js";
// Built-in Commands
export { helpCommand } from "./help.js";
export { resetCommand } from "./reset.js";
export { statusCommand } from "./status.js";
// Types
export type {
  CommandContext,
  CommandManagerLogger,
  CommandManagerOptions,
  ICommandManager,
  SlashCommand,
} from "./types.js";
