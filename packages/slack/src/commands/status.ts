/**
 * !status command — Show agent status and connection info
 */

import type { PrefixCommand, CommandContext } from "./command-handler.js";

/**
 * Format a timestamp for display
 */
function formatTimestamp(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format duration since a timestamp
 */
function formatDuration(isoString: string | null): string {
  if (!isoString) {
    return "N/A";
  }
  const startTime = new Date(isoString).getTime();
  const now = Date.now();
  const durationMs = now - startTime;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get status emoji based on connection status
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case "connected":
      return "\u{1F7E2}"; // Green circle
    case "connecting":
    case "reconnecting":
      return "\u{1F7E1}"; // Yellow circle
    case "disconnected":
    case "disconnecting":
      return "\u26AA"; // White circle
    case "error":
      return "\u{1F534}"; // Red circle
    default:
      return "\u2753"; // Question mark
  }
}

export const statusCommand: PrefixCommand = {
  name: "status",
  description: "Show agent status and connection info",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, threadTs, connectorState, sessionManager, reply } =
      context;

    // Get session info for this thread
    const session = await sessionManager.getSession(threadTs);

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
      statusMessage += `\nNo active session in this thread.`;
    }

    await reply(statusMessage);
  },
};
