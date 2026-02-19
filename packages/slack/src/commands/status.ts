/**
 * !status command — Show agent status and connection info
 */

import { formatDuration, formatTimestamp, getStatusEmoji } from "@herdctl/chat";
import type { CommandContext, PrefixCommand } from "./command-handler.js";

export const statusCommand: PrefixCommand = {
  name: "status",
  description: "Show agent status and connection info",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, channelId, connectorState, sessionManager, reply } = context;

    // Get session info for this channel
    const session = await sessionManager.getSession(channelId);

    // Build status message using Slack mrkdwn
    const statusEmoji = getStatusEmoji(connectorState.status);
    const botUsername = connectorState.botUser?.username ?? "Unknown";

    let statusMessage = `*${agentName} Status*\n\n`;
    statusMessage += `${statusEmoji} *Connection:* ${connectorState.status}\n`;
    statusMessage += `*Bot:* ${botUsername}`;

    if (connectorState.connectedAt) {
      statusMessage += `\n*Connected:* ${formatTimestamp(connectorState.connectedAt)}`;
      statusMessage += `\n*Uptime:* ${formatDuration(connectorState.connectedAt)}`;
    }

    if (connectorState.reconnectAttempts > 0) {
      statusMessage += `\n*Reconnect Attempts:* ${connectorState.reconnectAttempts}`;
    }

    if (connectorState.lastError) {
      statusMessage += `\n*Last Error:* ${connectorState.lastError}`;
    }

    // Session info
    statusMessage += `\n\n*Session Info*`;
    if (session) {
      statusMessage += `\n*Session ID:* \`${session.sessionId.substring(0, 20)}...\``;
      statusMessage += `\n*Last Activity:* ${formatTimestamp(session.lastMessageAt)}`;
      statusMessage += `\n*Session Age:* ${formatDuration(session.lastMessageAt)}`;
    } else {
      statusMessage += `\nNo active session in this channel.`;
    }

    await reply(statusMessage);
  },
};
