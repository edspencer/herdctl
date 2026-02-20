/**
 * herdctl init fleet - Initialize a new herdctl fleet
 *
 * Non-interactive command that scaffolds:
 * - herdctl.yaml with a comprehensive commented template
 * - agents/ directory
 * - .herdctl/ state directory
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { updateGitignore } from "./init.js";

export interface InitFleetOptions {
  name?: string;
  yes?: boolean;
  force?: boolean;
}

function generateFleetTemplate(fleetName: string): string {
  return `# herdctl fleet configuration
#
# This file defines your agent fleet. Start agents with:
#   herdctl start
#
# Full documentation: https://herdctl.dev

version: 1

fleet:
  name: ${fleetName}
  # description: A brief description of this fleet

# Fleet-wide defaults applied to all agents (agents can override)
# defaults:
#   permission_mode: default        # default | acceptEdits | bypassPermissions | plan
#   max_turns: 50
#   model: claude-sonnet-4-20250514
#
#   # Docker isolation (applies to all agents unless overridden)
#   # docker:
#   #   enabled: true
#   #   image: anthropic/claude-code:latest
#   #   network: bridge
#   #   memory: 2g

# Web dashboard
# web:
#   enabled: true
#   port: 3232

# Compose sub-fleets from other herdctl.yaml files
# fleets:
#   - path: ./other-fleet/herdctl.yaml
#     name: other-fleet

# Add agents with: herdctl init agent <name>
agents: []
`;
}

export async function initFleetCommand(options: InitFleetOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const agentsDir = path.join(cwd, "agents");
  const stateDir = path.join(cwd, ".herdctl");

  // Check if config already exists
  if (fs.existsSync(configPath) && !options.force) {
    console.error("Error: herdctl.yaml already exists. Use --force to overwrite.");
    process.exit(1);
  }

  const fleetName = options.name || path.basename(cwd);

  // Create directories
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Write fleet config
  fs.writeFileSync(configPath, generateFleetTemplate(fleetName), "utf-8");

  // Update .gitignore
  updateGitignore(cwd);

  // Print success message
  console.log("");
  console.log("Initialized herdctl fleet");
  console.log("");
  console.log("Created:");
  console.log("  herdctl.yaml");
  console.log("  agents/");
  console.log("  .herdctl/");
  console.log("");
  console.log("Next steps:");
  console.log("");
  console.log("  1. Add an agent:");
  console.log("     $ herdctl init agent <name>");
  console.log("");
  console.log("  2. Start your fleet:");
  console.log("     $ herdctl start");
  console.log("");
  console.log("Documentation: https://herdctl.dev");
}
