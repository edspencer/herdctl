import { formatDuration } from "@herdctl/chat";
import type { CommandContext, SlashCommand } from "./types.js";

export const sessionCommand: SlashCommand = {
  name: "session",
  description: "Show current session and run state for this channel",

  async execute(context: CommandContext): Promise<void> {
    const { interaction, sessionManager, commandActions, agentName } = context;
    const channelId = interaction.channelId;

    const session = await sessionManager.getSession(channelId);
    const managedInfo = commandActions?.getSessionInfo
      ? await commandActions.getSessionInfo(channelId)
      : undefined;

    const lines: string[] = [];

    if (session) {
      lines.push("**Session**");
      lines.push(
        `\`${session.sessionId.substring(0, 20)}…\` · Active ${formatDuration(session.lastMessageAt)} ago`,
      );
    } else {
      lines.push("**Session**");
      lines.push("No active session.");
    }

    lines.push("");
    lines.push("**Run State**");
    if (managedInfo?.activeJobId) {
      lines.push(`Running job: \`${managedInfo.activeJobId}\``);
    } else {
      lines.push("No active run in this channel.");
    }
    if (managedInfo?.lastPrompt) {
      const preview =
        managedInfo.lastPrompt.length > 100
          ? `${managedInfo.lastPrompt.substring(0, 100)}…`
          : managedInfo.lastPrompt;
      lines.push(`Last prompt: \`${preview}\``);
    }

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
