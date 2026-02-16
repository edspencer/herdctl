/**
 * !reset command — Clear session for current channel
 */

import type { PrefixCommand, CommandContext } from "./command-handler.js";

export const resetCommand: PrefixCommand = {
  name: "reset",
  description: "Clear conversation context (start fresh session)",

  async execute(context: CommandContext): Promise<void> {
    const { channelId, sessionManager, reply } = context;

    const cleared = await sessionManager.clearSession(channelId);

    if (cleared) {
      await reply(
        "Session cleared. The next message will start a fresh conversation."
      );
    } else {
      await reply("No active session in this channel.");
    }
  },
};
