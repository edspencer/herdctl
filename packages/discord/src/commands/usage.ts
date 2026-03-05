import { formatCompactNumber, formatCost, formatDurationMs } from "@herdctl/chat";
import type { CommandContext, SlashCommand } from "./types.js";

export const usageCommand: SlashCommand = {
  name: "usage",
  description: "Show usage stats: last run and cumulative totals",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, commandActions, agentName } = context;

    const [lastRun, cumulative] = await Promise.all([
      commandActions?.getUsage ? commandActions.getUsage(interaction.channelId) : null,
      commandActions?.getCumulativeUsage ? commandActions.getCumulativeUsage() : null,
    ]);

    if (!lastRun && (!cumulative || cumulative.totalRuns === 0)) {
      await interaction.reply({
        content: "No usage data is available yet.",
        ephemeral: true,
      });
      return;
    }

    const embeds: Array<{
      title?: string;
      description: string;
      color: number;
      footer?: { text: string };
      timestamp?: string;
    }> = [];

    // Last run embed
    if (lastRun) {
      const totalTokens = (lastRun.inputTokens ?? 0) + (lastRun.outputTokens ?? 0);
      const lines = [
        `**Status:** ${lastRun.isError ? "failed" : "success"}`,
        `**Turns:** ${lastRun.numTurns ?? "n/a"}`,
        `**Duration:** ${lastRun.durationMs !== undefined ? formatDurationMs(lastRun.durationMs) : "n/a"}`,
        `**Cost:** ${lastRun.totalCostUsd !== undefined ? formatCost(lastRun.totalCostUsd) : "n/a"}`,
        `**Tokens:** ${totalTokens > 0 ? formatCompactNumber(totalTokens) : "n/a"} (in: ${formatCompactNumber(lastRun.inputTokens ?? 0)}, out: ${formatCompactNumber(lastRun.outputTokens ?? 0)})`,
      ];
      embeds.push({
        title: "Last Run",
        description: lines.join("\n"),
        color: lastRun.isError ? 0xef4444 : 0x22c55e,
        timestamp: lastRun.timestamp,
      });
    }

    // Cumulative embed
    if (cumulative && cumulative.totalRuns > 0) {
      const totalTokens = cumulative.totalInputTokens + cumulative.totalOutputTokens;
      const lines = [
        `**Runs:** ${cumulative.totalRuns} (${cumulative.totalSuccesses} ok, ${cumulative.totalFailures} failed)`,
        `**Total Cost:** ${formatCost(cumulative.totalCostUsd)}`,
        `**Total Tokens:** ${formatCompactNumber(totalTokens)} (in: ${formatCompactNumber(cumulative.totalInputTokens)}, out: ${formatCompactNumber(cumulative.totalOutputTokens)})`,
        `**Total Duration:** ${formatDurationMs(cumulative.totalDurationMs)}`,
        `**Since:** <t:${Math.floor(new Date(cumulative.firstRunAt).getTime() / 1000)}:R>`,
      ];
      embeds.push({
        title: "Session Totals",
        description: lines.join("\n"),
        color: 0x326ce5,
      });
    }

    // Add footer to the last embed
    const lastEmbed = embeds[embeds.length - 1];
    lastEmbed.footer = { text: `herdctl · ${agentName}` };

    await interaction.reply({ embeds, ephemeral: true });
  },
};
