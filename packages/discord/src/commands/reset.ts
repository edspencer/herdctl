/**
 * /reset command - Clear conversation context
 *
 * Clears the session for the current channel, starting a fresh conversation.
 * Responds ephemerally with a color-coded embed confirmation.
 */

import type { CommandContext, SlashCommand } from "./types.js";

export const resetCommand: SlashCommand = {
  name: "reset",
  description: "Clear conversation context (start fresh session)",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, sessionManager, agentName } = context;
    const channelId = interaction.channelId;

    const wasCleared = await sessionManager.clearSession(channelId);

    await interaction.reply({
      embeds: [
        {
          description: wasCleared
            ? "Session cleared. Starting fresh."
            : "No active session in this channel.",
          color: wasCleared ? 0x22c55e : 0x6b7280,
          footer: { text: `herdctl \u00b7 ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
