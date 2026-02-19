/**
 * herdctl init - Initialize a new herdctl project
 *
 * Scaffolds a new project with:
 * - herdctl.yaml configuration file
 * - agents/ directory with example agent
 * - .herdctl/ state directory
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { confirm, input, select } from "@inquirer/prompts";

export interface InitOptions {
  name?: string;
  example?: string;
  yes?: boolean;
  force?: boolean;
}

interface Template {
  name: string;
  description: string;
  fleetConfig: string;
  agentConfig: string;
  agentFilename: string;
}

const TEMPLATES: Record<string, Template> = {
  simple: {
    name: "simple",
    description: "A basic fleet with one agent that runs on a schedule",
    fleetConfig: `# herdctl fleet configuration
#
# This file defines your agent fleet.
# Run \`herdctl start\` to start all agents.

version: 1

fleet:
  name: {{FLEET_NAME}}
  description: {{FLEET_DESCRIPTION}}

defaults:
  max_turns: 50
  permission_mode: default

agents:
  - path: ./agents/example-agent.yaml
`,
    agentConfig: `# Example agent configuration
#
# This agent runs on a schedule and can be customized
# to perform various tasks.

name: example-agent
description: An example agent

# System prompt defines the agent's behavior
system_prompt: |
  You are a helpful assistant. When triggered,
  analyze the task and provide a useful response.

# Workspace - where the agent operates
workspace: ./workspace

# Schedules - when the agent runs
schedules:
  heartbeat:
    type: interval
    interval: 5m
    prompt: |
      Report the current status and any pending tasks.
      Keep your response brief.

# Permissions - what the agent can do
allowed_tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
`,
    agentFilename: "example-agent.yaml",
  },
  quickstart: {
    name: "quickstart",
    description: "Minimal setup - a single agent that says hello",
    fleetConfig: `# herdctl fleet configuration
#
# Minimal configuration to get started quickly.

version: 1

fleet:
  name: {{FLEET_NAME}}

agents:
  - path: ./agents/hello-agent.yaml
`,
    agentConfig: `# Hello Agent
#
# A simple agent that demonstrates basic scheduling.

name: hello-agent
description: A simple agent that says hello

schedules:
  greet:
    type: interval
    interval: 30s
    prompt: |
      Say hello and report the current date and time.
      Keep your response brief (1-2 sentences).
`,
    agentFilename: "hello-agent.yaml",
  },
  github: {
    name: "github",
    description: "Agent that processes GitHub issues with 'ready' label",
    fleetConfig: `# herdctl fleet configuration
#
# Fleet configured to process GitHub issues.

version: 1

fleet:
  name: {{FLEET_NAME}}
  description: {{FLEET_DESCRIPTION}}

defaults:
  max_turns: 100
  permission_mode: acceptEdits

agents:
  - path: ./agents/github-agent.yaml
`,
    agentConfig: `# GitHub Issue Agent
#
# Processes issues labeled 'ready' from a GitHub repository.
# Set GITHUB_TOKEN environment variable for authentication.

name: github-agent
description: Processes GitHub issues

system_prompt: |
  You are a developer assistant. When given an issue to work on,
  analyze the requirements and implement the requested changes.
  Follow best practices and write clean, tested code.

workspace: ./workspace

schedules:
  process-issues:
    type: interval
    interval: 5m
    work_source:
      type: github_issues
      repo: your-org/your-repo  # TODO: Update this
      labels:
        include: ["ready"]
        exclude: ["blocked", "wip"]
      claim_label: in-progress
      complete_action: close

allowed_tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - "Bash(git *)"
  - "Bash(npm *)"
  - "Bash(pnpm *)"
`,
    agentFilename: "github-agent.yaml",
  },
};

const DEFAULT_TEMPLATE = "simple";

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const agentsDir = path.join(cwd, "agents");
  const stateDir = path.join(cwd, ".herdctl");
  const gitignorePath = path.join(cwd, ".gitignore");

  // Check if config already exists
  if (fs.existsSync(configPath) && !options.force) {
    console.error("Error: herdctl.yaml already exists. Use --force to overwrite.");
    process.exit(1);
  }

  // Determine the template to use
  let templateName = options.example || DEFAULT_TEMPLATE;
  if (options.example && !TEMPLATES[options.example]) {
    console.error(`Error: Unknown example template '${options.example}'.`);
    console.error(`Available templates: ${Object.keys(TEMPLATES).join(", ")}`);
    process.exit(1);
  }

  // Interactive mode if not --yes and missing required info
  let fleetName = options.name;
  let fleetDescription = "";

  if (!options.yes) {
    // Ask for fleet name if not provided
    if (!fleetName) {
      fleetName = await input({
        message: "Fleet name:",
        default: path.basename(cwd),
        validate: (value) => {
          if (!value.trim()) return "Fleet name is required";
          if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
            return "Fleet name must start with a letter and contain only letters, numbers, hyphens, and underscores";
          }
          return true;
        },
      });
    }

    // Ask for description
    fleetDescription = await input({
      message: "Fleet description (optional):",
      default: "",
    });

    // Ask for template if not specified
    if (!options.example) {
      templateName = await select({
        message: "Choose a template:",
        choices: Object.entries(TEMPLATES).map(([key, template]) => ({
          name: `${template.name} - ${template.description}`,
          value: key,
        })),
        default: DEFAULT_TEMPLATE,
      });
    }

    // Confirm before proceeding
    console.log("");
    console.log("Will create:");
    console.log(`  - herdctl.yaml (${templateName} template)`);
    console.log(`  - agents/ directory with example agent`);
    console.log(`  - .herdctl/ state directory`);
    console.log("");

    const proceed = await confirm({
      message: "Proceed?",
      default: true,
    });

    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  } else {
    // In --yes mode, use defaults
    fleetName = fleetName || path.basename(cwd);
  }

  const template = TEMPLATES[templateName];

  // Create agents directory
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  // Create .herdctl directory
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Generate fleet config from template
  const fleetConfig = template.fleetConfig
    .replace(/\{\{FLEET_NAME\}\}/g, fleetName)
    .replace(/\{\{FLEET_DESCRIPTION\}\}/g, fleetDescription || `A herdctl fleet`);

  // Write fleet config
  fs.writeFileSync(configPath, fleetConfig, "utf-8");

  // Write agent config
  const agentPath = path.join(agentsDir, template.agentFilename);
  if (!fs.existsSync(agentPath) || options.force) {
    fs.writeFileSync(agentPath, template.agentConfig, "utf-8");
  }

  // Update .gitignore if it exists
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
    const linesToAdd: string[] = [];

    if (!gitignoreContent.includes(".herdctl/")) {
      linesToAdd.push(".herdctl/");
    }

    if (linesToAdd.length > 0) {
      const newContent =
        gitignoreContent.trimEnd() +
        "\n\n# herdctl state directory\n" +
        linesToAdd.join("\n") +
        "\n";
      fs.writeFileSync(gitignorePath, newContent, "utf-8");
    }
  }

  // Print success message and next steps
  console.log("");
  console.log("✓ Initialized herdctl project");
  console.log("");
  console.log("Created:");
  console.log(`  herdctl.yaml`);
  console.log(`  agents/${template.agentFilename}`);
  console.log(`  .herdctl/`);
  console.log("");
  console.log("Next steps:");
  console.log("");
  console.log("  1. Review and customize your configuration:");
  console.log("     - herdctl.yaml (fleet settings)");
  console.log(`     - agents/${template.agentFilename} (agent definition)`);
  console.log("");
  console.log("  2. Start your fleet:");
  console.log("     $ herdctl start");
  console.log("");
  console.log("  3. Check status:");
  console.log("     $ herdctl status");
  console.log("");

  if (templateName === "github") {
    console.log("  Note: Update the 'repo' field in your agent config");
    console.log("  and set the GITHUB_TOKEN environment variable.");
    console.log("");
  }

  console.log("Documentation: https://herdctl.dev");
}
