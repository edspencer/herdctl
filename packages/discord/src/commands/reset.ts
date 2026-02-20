/**
 * /reset command - Clear conversation context
 *
 * Clears the session for the current channel, starting a fresh conversation.
 * Responds ephemerally with confirmation.
 */

import type { CommandContext, SlashCommand } from "./types.js";

export const resetCommand: SlashCommand = {
  name: "reset",
  description: "Clear conversation context (start fresh session)",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, sessionManager, agentName } = context;
    const channelId = interaction.channelId;

    const wasCleared = await sessionManager.clearSession(channelId);

    if (wasCleared) {
      await interaction.reply({
        content: `Conversation context cleared for **${agentName}**. Starting fresh!`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `No active session found for **${agentName}** in this channel. You're already starting fresh!`,
        ephemeral: true,
      });
    }
  },
};
