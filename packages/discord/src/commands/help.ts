/**
 * /help command - Show available commands
 *
 * Responds ephemerally with a styled embed listing available commands.
 */

import type { CommandContext, SlashCommand } from "./types.js";

export const helpCommand: SlashCommand = {
  name: "help",
  description: "Show available commands",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, agentName } = context;

    await interaction.reply({
      embeds: [
        {
          description: [
            "**/help** \u2014 Show this help message",
            "**/status** \u2014 Show agent status and session info",
            "**/reset** \u2014 Clear conversation context",
            "**/new** \u2014 Start a fresh conversation",
            "**/session** \u2014 Show current session and run state",
            "**/stop** \u2014 Stop the active run in this channel",
            "**/retry** \u2014 Retry the last prompt in this channel",
            "",
            "**Usage**",
            "Mention the bot or message in a configured channel. DMs are supported based on configuration.",
          ].join("\n"),
          color: 0x3b82f6,
          footer: { text: `herdctl \u00b7 ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
