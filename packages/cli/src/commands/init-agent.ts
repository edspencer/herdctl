/**
 * herdctl init agent - Add a new agent to the fleet
 *
 * Interactive command that walks through agent configuration:
 * - Name, description, permission mode
 * - Docker, runtime
 * - Discord/Slack chat integration
 *
 * Generates agents/<name>/agent.yaml and appends a reference to herdctl.yaml.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { addAgentToFleetConfig, createLogger, PermissionModeSchema } from "@herdctl/core";
import { confirm, input, select } from "@inquirer/prompts";
import { stringify as stringifyYaml } from "yaml";

const logger = createLogger("cli:init-agent");

export interface InitAgentOptions {
  description?: string;
  permissionMode?: string;
  docker?: boolean;
  runtime?: string;
  discord?: boolean;
  slack?: boolean;
  yes?: boolean;
  force?: boolean;
}

/** Must match AGENT_NAME_PATTERN from @herdctl/core schema */
const AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

const PERMISSION_MODES = PermissionModeSchema.options;

function isDockerAvailable(): boolean {
  try {
    execSync("docker --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

interface AgentConfig {
  name: string;
  description: string;
  permissionMode: string;
  docker: boolean;
  runtime: string;
  discord: boolean;
  slack: boolean;
}

/**
 * Safely format a YAML scalar value using the yaml library.
 * This handles all special characters including colons, newlines, quotes, etc.
 */
function yamlScalar(value: string): string {
  // Use stringify to get properly quoted/escaped YAML, then trim the trailing newline
  return stringifyYaml(value).trimEnd();
}

function generateAgentYaml(config: AgentConfig): string {
  const lines: string[] = [];

  lines.push(`name: ${yamlScalar(config.name)}`);
  if (config.description) {
    lines.push(`description: ${yamlScalar(config.description)}`);
  }
  lines.push("");
  lines.push(`permission_mode: ${config.permissionMode}`);
  lines.push(`runtime: ${config.runtime}`);

  if (config.docker) {
    lines.push("");
    lines.push("docker:");
    lines.push("  enabled: true");
  }

  // Commented-out system prompt
  lines.push("");
  lines.push("# System prompt defines the agent's behavior");
  lines.push("# system_prompt: |");
  lines.push("#   You are a helpful assistant.");

  // Commented-out schedule boilerplate
  lines.push("");
  lines.push("# Schedules define when the agent runs automatically.");
  lines.push("# See https://herdctl.dev for schedule configuration docs.");
  lines.push("#");
  lines.push("# schedules:");
  lines.push("#   heartbeat:");
  lines.push("#     type: interval");
  lines.push("#     interval: 5m");
  lines.push("#     prompt: |");
  lines.push("#       Report current status.");
  lines.push("#");
  lines.push("#   daily-check:");
  lines.push("#     type: cron");
  lines.push('#     expression: "0 9 * * *"');
  lines.push("#     prompt: |");
  lines.push("#       Run the daily check.");

  // Chat integrations
  if (config.discord || config.slack) {
    lines.push("");
    lines.push("chat:");

    if (config.discord) {
      lines.push("  discord:");
      lines.push("    bot_token_env: DISCORD_BOT_TOKEN");
      lines.push("    session_expiry_hours: 24");
      lines.push("    log_level: standard");
      lines.push("    guilds:");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: YAML placeholder, not JS template
      lines.push('      - id: "${DISCORD_GUILD_ID}"');
      lines.push("        channels:");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: YAML placeholder, not JS template
      lines.push('          - id: "${DISCORD_CHANNEL_ID}"');
      lines.push('            name: "#general"');
      lines.push("            mode: mention");
      lines.push("            context_messages: 10");
      lines.push("    dm:");
      lines.push("      enabled: true");
      lines.push("      mode: auto");
    }

    if (config.slack) {
      lines.push("  slack:");
      lines.push("    bot_token_env: SLACK_BOT_TOKEN");
      lines.push("    app_token_env: SLACK_APP_TOKEN");
      lines.push("    session_expiry_hours: 24");
      lines.push("    log_level: standard");
      lines.push("    channels:");
      // biome-ignore lint/suspicious/noTemplateCurlyInString: YAML placeholder, not JS template
      lines.push('      - id: "${SLACK_CHANNEL_ID}"');
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function initAgentCommand(
  nameArg: string | undefined,
  options: InitAgentOptions,
): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "herdctl.yaml");
  const agentsDir = path.join(cwd, "agents");

  // Check fleet config exists
  if (!fs.existsSync(configPath)) {
    logger.error("No herdctl.yaml found. Run 'herdctl init fleet' first.");
    process.exitCode = 1;
    return;
  }

  const dockerAvailable = isDockerAvailable();

  let agentName: string;
  let description: string;
  let permissionMode: string;
  let docker: boolean;
  let runtime: string;
  let discord: boolean;
  let slack: boolean;

  if (options.yes) {
    // Non-interactive mode
    if (!nameArg) {
      logger.error("Agent name is required with --yes flag.");
      logger.error("Usage: herdctl init agent <name> --yes");
      process.exitCode = 1;
      return;
    }

    if (!AGENT_NAME_PATTERN.test(nameArg)) {
      logger.error(
        "Agent name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.",
      );
      process.exitCode = 1;
      return;
    }

    agentName = nameArg;
    description = options.description || "";
    permissionMode = options.permissionMode || "default";
    docker = options.docker ?? dockerAvailable;
    runtime = options.runtime || "sdk";
    discord = options.discord || false;
    slack = options.slack || false;

    // Validate permission mode
    if (!PERMISSION_MODES.includes(permissionMode as (typeof PERMISSION_MODES)[number])) {
      logger.error(`Invalid permission mode '${permissionMode}'.`);
      logger.error(`Valid modes: ${PERMISSION_MODES.join(", ")}`);
      process.exitCode = 1;
      return;
    }

    // Validate runtime
    if (runtime !== "sdk" && runtime !== "cli") {
      logger.error(`Invalid runtime '${runtime}'. Must be 'sdk' or 'cli'.`);
      process.exitCode = 1;
      return;
    }
  } else {
    // Interactive mode
    if (nameArg) {
      if (!AGENT_NAME_PATTERN.test(nameArg)) {
        logger.error(
          "Agent name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.",
        );
        process.exitCode = 1;
        return;
      }
      agentName = nameArg;
    } else {
      agentName = await input({
        message: "Agent name:",
        validate: (value) => {
          if (!value.trim()) return "Agent name is required";
          if (!AGENT_NAME_PATTERN.test(value)) {
            return "Agent name must start with a letter or number and contain only letters, numbers, hyphens, and underscores";
          }
          return true;
        },
      });
    }

    description = await input({
      message: "Description (optional):",
      default: "",
    });

    permissionMode = await select({
      message: "Permission mode:",
      choices: PERMISSION_MODES.map((mode) => ({
        name: mode,
        value: mode,
      })),
      default: "default",
    });

    docker = await confirm({
      message: "Enable Docker isolation?",
      default: dockerAvailable,
    });

    runtime = await select({
      message: "Runtime:",
      choices: [
        { name: "sdk - Claude Agent SDK (standard pricing)", value: "sdk" },
        { name: "cli - Claude CLI (Max plan pricing)", value: "cli" },
      ],
      default: "sdk",
    });

    discord = await confirm({
      message: "Connect to Discord?",
      default: false,
    });

    slack = await confirm({
      message: "Connect to Slack?",
      default: false,
    });
  }

  // Check if agent directory already exists
  const agentDir = path.join(agentsDir, agentName);
  const agentPath = path.join(agentDir, "agent.yaml");
  if (fs.existsSync(agentDir) && !options.force) {
    logger.error(`agents/${agentName}/ already exists. Use --force to overwrite.`);
    process.exitCode = 1;
    return;
  }

  // Create agent directory (agents/<name>/)
  fs.mkdirSync(agentDir, { recursive: true });

  // Generate and write agent config
  const agentYaml = generateAgentYaml({
    name: agentName,
    description,
    permissionMode,
    docker,
    runtime,
    discord,
    slack,
  });
  fs.writeFileSync(agentPath, agentYaml, "utf-8");

  // Append agent reference to herdctl.yaml
  await addAgentToFleetConfig({
    configPath,
    agentPath: `./agents/${agentName}/agent.yaml`,
  });

  // Print success
  console.log("");
  console.log(`Added agent '${agentName}'`);
  console.log("");
  console.log("Created:");
  console.log(`  agents/${agentName}/agent.yaml`);
  console.log("");
  console.log("Updated:");
  console.log("  herdctl.yaml (added agent reference)");
  console.log("");
  console.log("Next steps:");
  console.log("");
  console.log("  1. Customize your agent:");
  console.log(`     - agents/${agentName}/agent.yaml`);
  console.log("");
  console.log("  2. Start your fleet:");
  console.log("     $ herdctl start");
  console.log("");

  if (discord) {
    console.log("  Set Discord environment variables:");
    console.log("    DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CHANNEL_ID");
    console.log("");
  }

  if (slack) {
    console.log("  Set Slack environment variables:");
    console.log("    SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_CHANNEL_ID");
    console.log("");
  }
}
