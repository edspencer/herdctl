import type { CommandContext, SlashCommand } from "./types.js";

export const retryCommand: SlashCommand = {
  name: "retry",
  description: "Retry the last prompt in this channel",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const channelId = interaction.channelId;

    const result = commandActions?.retryRun
      ? await commandActions.retryRun(channelId)
      : {
          success: false,
          message: "Retry is not available in this deployment.",
        };

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
