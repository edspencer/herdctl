/**
 * /status command - Show agent status and session info
 *
 * Responds ephemerally with the current agent status, connection info,
 * and session information for the current channel.
 */

import type { SlashCommand, CommandContext } from "./types.js";
import { formatTimestamp, formatDuration, getStatusEmoji } from "@herdctl/chat";

export const statusCommand: SlashCommand = {
  name: "status",
  description: "Show agent status and session info",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, agentName, connectorState, sessionManager } = context;
    const channelId = interaction.channelId;

    // Get session info for this channel
    const session = await sessionManager.getSession(channelId);

    // Build status message
    const statusEmoji = getStatusEmoji(connectorState.status);
    const botUsername = connectorState.botUser?.username ?? "Unknown";

    let statusMessage = `**${agentName} Status**

${statusEmoji} **Connection:** ${connectorState.status}
**Bot:** ${botUsername}`;

    if (connectorState.connectedAt) {
      statusMessage += `\n**Connected:** ${formatTimestamp(connectorState.connectedAt)}`;
      statusMessage += `\n**Uptime:** ${formatDuration(connectorState.connectedAt)}`;
    }

    if (connectorState.reconnectAttempts > 0) {
      statusMessage += `\n**Reconnect Attempts:** ${connectorState.reconnectAttempts}`;
    }

    if (connectorState.lastError) {
      statusMessage += `\n**Last Error:** ${connectorState.lastError}`;
    }

    // Session info
    statusMessage += `\n\n**Session Info**`;
    if (session) {
      statusMessage += `\n**Session ID:** \`${session.sessionId.substring(0, 20)}...\``;
      statusMessage += `\n**Last Activity:** ${formatTimestamp(session.lastMessageAt)}`;
      statusMessage += `\n**Session Age:** ${formatDuration(session.lastMessageAt)}`;
    } else {
      statusMessage += `\nNo active session in this channel.`;
    }

    await interaction.reply({
      content: statusMessage,
      ephemeral: true,
    });
  },
};
