/**
 * !help command — Show available commands
 */

import type { PrefixCommand, CommandContext } from "./command-handler.js";

export const helpCommand: PrefixCommand = {
  name: "help",
  description: "Show available commands",

  async execute(context: CommandContext): Promise<void> {
    const { agentName, reply } = context;

    const helpMessage = `*${agentName} Bot Commands*

\`!help\` — Show this help message
\`!status\` — Show agent status and session info
\`!reset\` — Clear conversation context (start fresh session)

*Interacting with the bot:*
\u2022 Mention the bot in a configured channel to start a conversation
\u2022 Reply in the thread to continue the conversation
\u2022 Each thread is a separate conversation with its own context`;

    await reply(helpMessage);
  },
};
