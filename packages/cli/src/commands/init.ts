/**
 * herdctl init - Router and shared utilities
 *
 * When invoked without a subcommand, asks whether to initialize a fleet or agent.
 * Shared helpers (e.g. gitignore updates) are exported for use by init-fleet and init-agent.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { select } from "@inquirer/prompts";
import { initAgentCommand } from "./init-agent.js";
import { initFleetCommand } from "./init-fleet.js";

export interface InitRouterOptions {
  yes?: boolean;
  force?: boolean;
}

/**
 * Update .gitignore to include .herdctl/ if it exists and doesn't already have it.
 */
export function updateGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, ".gitignore");

  if (!fs.existsSync(gitignorePath)) {
    return;
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
  const linesToAdd: string[] = [];

  if (!gitignoreContent.includes(".herdctl/")) {
    linesToAdd.push(".herdctl/");
  }

  if (linesToAdd.length > 0) {
    const newContent = `${gitignoreContent.trimEnd()}\n\n# herdctl state directory\n${linesToAdd.join("\n")}\n`;
    fs.writeFileSync(gitignorePath, newContent, "utf-8");
  }
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
