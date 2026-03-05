import type { CommandContext, SlashCommand } from "./types.js";

export const toolsCommand: SlashCommand = {
  name: "tools",
  description: "Show allowed/denied tools and MCP integration status",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const config = commandActions?.getAgentConfig ? await commandActions.getAgentConfig() : null;
    if (!config) {
      await interaction.reply({
        content: "Tool details are not available in this deployment.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      embeds: [
        {
          description: [
            `**Allowed:** ${config.allowedTools?.length ? config.allowedTools.join(", ") : "all defaults"}`,
            `**Denied:** ${config.deniedTools?.length ? config.deniedTools.join(", ") : "none"}`,
            `**MCP Servers:** ${config.mcpServers?.length ? config.mcpServers.join(", ") : "none"}`,
          ].join("\n"),
          color: 0x3b82f6,
          footer: { text: `herdctl · ${agentName}` },
        },
      ],
      ephemeral: true,
    });
  },
};
