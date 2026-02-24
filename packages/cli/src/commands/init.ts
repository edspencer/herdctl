/**
 * herdctl init - Router for init subcommands
 *
 * When invoked without a subcommand, asks whether to initialize a fleet or agent.
 */

import { select } from "@inquirer/prompts";
import { initAgentCommand } from "./init-agent.js";
import { initFleetCommand } from "./init-fleet.js";

// Re-export for backwards compatibility
export { updateGitignore } from "./init-utils.js";

export interface InitRouterOptions {
  yes?: boolean;
  force?: boolean;
}

/**
 * Router action for bare `herdctl init` (no subcommand).
 * Prompts the user to choose between fleet and agent initialization.
 */
export async function initRouterAction(options: InitRouterOptions): Promise<void> {
  if (options.yes) {
    console.error(
      "Error: With --yes flag, specify a subcommand: herdctl init fleet or herdctl init agent <name>",
    );
    process.exit(1);
  }

  const choice = await select({
    message: "What would you like to initialize?",
    choices: [
      {
        name: "Fleet - Create a new herdctl.yaml fleet configuration",
        value: "fleet",
      },
      {
        name: "Agent - Add a new agent to your fleet",
        value: "agent",
      },
    ],
  });

  if (choice === "fleet") {
    await initFleetCommand({ force: options.force });
  } else {
    await initAgentCommand(undefined, { force: options.force });
  }
}
