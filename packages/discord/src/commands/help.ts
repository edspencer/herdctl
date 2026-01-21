/**
 * /help command - Show available commands
 *
 * Responds ephemerally with a list of available commands and their descriptions.
 */

import type { SlashCommand, CommandContext } from "./types.js";

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, agentName } = context;

    const helpMessage = `**${agentName} Bot Commands**

**/help** - Show this help message
**/status** - Show agent status and session info
**/reset** - Clear conversation context (start fresh session)

**Interacting with the bot:**
- Mention the bot in a channel to start a conversation
- In configured channels, the bot may respond automatically
- DMs are supported based on configuration`;

    await interaction.reply({
      content: helpMessage,
      ephemeral: true,
    });
  },
};
