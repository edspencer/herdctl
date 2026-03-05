import { formatCompactNumber } from "@herdctl/chat";
import type { CommandContext, SlashCommand } from "./types.js";

export const usageCommand: SlashCommand = {
  name: "usage",
  description: "Show usage summary for the most recent run in this channel",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;
    const usage = commandActions?.getUsage
      ? await commandActions.getUsage(interaction.channelId)
      : null;
    if (!usage) {
      await interaction.reply({
        content: "No usage data is available yet for this channel.",
        ephemeral: true,
      });
      return;
    }

    const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const lines = [
      `**Status:** ${usage.isError ? "failed" : "success"}`,
      `**Turns:** ${usage.numTurns ?? "n/a"}`,
      `**Duration:** ${usage.durationMs !== undefined ? `${usage.durationMs}ms` : "n/a"}`,
      `**Cost:** ${usage.totalCostUsd !== undefined ? `$${usage.totalCostUsd.toFixed(4)}` : "n/a"}`,
      `**Tokens:** ${totalTokens > 0 ? formatCompactNumber(totalTokens) : "n/a"} (in ${usage.inputTokens ?? 0}, out ${usage.outputTokens ?? 0})`,
    ];

    await interaction.reply({
      embeds: [
        {
          description: lines.join("\n"),
          color: usage.isError ? 0xef4444 : 0x22c55e,
          footer: { text: `herdctl · ${agentName}` },
          timestamp: usage.timestamp,
        },
      ],
      ephemeral: true,
    });
  },
};
