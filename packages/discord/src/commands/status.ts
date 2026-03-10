/**
 * /status command - Show agent status and session info
 *
 * Responds ephemerally with a condensed embed showing connection status
 * and session information for the current channel.
 */

import { formatDuration, getStatusEmoji } from "@herdctl/chat";
import type { CommandContext, SlashCommand } from "./types.js";

export const statusCommand: SlashCommand = {
  name: "status",
  description: "Show agent status and session info",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, agentName, connectorState, sessionManager } = context;
    const channelId = interaction.channelId;

    // Get session info for this channel
    const session = await sessionManager.getSession(channelId);

    // Build condensed status
    const statusEmoji = getStatusEmoji(connectorState.status);
    const botUsername = connectorState.botUser?.username ?? "Unknown";
    const statusLabel =
      connectorState.status.charAt(0).toUpperCase() + connectorState.status.slice(1);

    const lines: string[] = [];

    // Connection line: "🟢 **Connected** as MyBot · Uptime 2h 30m"
    const connectionParts = [`${statusEmoji} **${statusLabel}**`, `as ${botUsername}`];
    if (connectorState.connectedAt) {
      connectionParts.push(`\u00b7 Uptime ${formatDuration(connectorState.connectedAt)}`);
    }
    lines.push(connectionParts.join(" "));

    if (connectorState.reconnectAttempts > 0) {
      lines.push(`Reconnect attempts: ${connectorState.reconnectAttempts}`);
    }
    if (connectorState.lastError) {
      lines.push(`Last error: ${connectorState.lastError}`);
    }

    // Session section
    lines.push("");
    if (session) {
      lines.push("**Session**");
      lines.push(
        `\`${session.sessionId.substring(0, 20)}\u2026\` \u00b7 Active ${formatDuration(session.lastMessageAt)} ago`,
      );
    } else {
      lines.push("**Session**");
      lines.push("No active session in this channel.");
    }

    await interaction.reply({
      embeds: [
        {
          description: lines.join("\n"),
          color: 0x3b82f6,
          footer: { text: `herdctl \u00b7 ${agentName}` },
          timestamp: new Date().toISOString(),
        },
      ],
      ephemeral: true,
    });
  },
};
