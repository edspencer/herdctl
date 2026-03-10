import type { CommandContext, SlashCommand } from "./types.js";

export const pingCommand: SlashCommand = {
  name: "ping",
  description: "Quick health check",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, connectorState, agentName } = context;
    await interaction.reply({
      embeds: [
        {
          description: [
            "**Status:** online",
            `**Connector:** ${connectorState.status}`,
            `**Agent:** ${agentName}`,
          ].join("\n"),
          color: 0x22c55e,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
