import type { CommandContext, SlashCommand } from "./types.js";

export const configCommand: SlashCommand = {
  name: "config",
  description: "Show runtime-relevant agent configuration",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const config = commandActions?.getAgentConfig ? await commandActions.getAgentConfig() : null;
    if (!config) {
      await interaction.reply({
        content: "Config details are not available in this deployment.",
        ephemeral: true,
      });
      return;
    }

    const lines = [
      `**Runtime:** ${config.runtime ?? "default"}`,
      `**Model:** ${config.model ?? "default"}`,
      `**Permission Mode:** ${config.permissionMode ?? "default"}`,
      `**Working Dir:** ${config.workingDirectory ?? "not set"}`,
      `**MCP Servers:** ${config.mcpServers?.length ? config.mcpServers.join(", ") : "none"}`,
    ];
    await interaction.reply({
      embeds: [
        {
          description: lines.join("\n"),
          color: 0x3b82f6,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
