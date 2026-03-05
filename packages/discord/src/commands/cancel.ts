import type { CommandContext, SlashCommand } from "./types.js";

export const cancelCommand: SlashCommand = {
  name: "cancel",
  description: "Alias for /stop",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const channelId = interaction.channelId;
    const result = commandActions?.stopRun
      ? await commandActions.stopRun(channelId)
      : { success: false, message: "Stop is not available in this deployment." };

    await interaction.reply({
      embeds: [
        {
          description: result.message,
          color: result.success ? 0x22c55e : 0xef4444,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
