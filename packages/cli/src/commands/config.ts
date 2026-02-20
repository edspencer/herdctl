/**
 * herdctl config - Configuration validation and inspection commands
 *
 * Commands:
 * - herdctl config validate         Validate current config
 * - herdctl config validate --fix   Show suggestions for fixes
 * - herdctl config show             Show merged/resolved config
 * - herdctl config show --json      JSON output
 */

import * as path from "node:path";
import {
  AgentLoadError,
  AgentValidationError,
  AgentYamlSyntaxError,
  ConfigNotFoundError,
  FileReadError,
  type ResolvedConfig,
  type SchemaIssue,
  SchemaValidationError,
  safeLoadConfig,
  UndefinedVariableError,
  YamlSyntaxError,
} from "@herdctl/core";

export interface ConfigValidateOptions {
  fix?: boolean;
  config?: string;
}

export interface ConfigShowOptions {
  json?: boolean;
  config?: string;
}

/**
 * Suggests fixes for common validation errors
 */
function suggestFix(issue: SchemaIssue): string | null {
  const { path: issuePath, message, code } = issue;

  // Missing required field
  if (code === "invalid_type" && message.includes("Required")) {
    return `Add the required field '${issuePath}' to your configuration`;
  }

  // Invalid type
  if (code === "invalid_type") {
    const match = message.match(/Expected (\w+), received (\w+)/);
    if (match) {
      return `Change '${issuePath}' from ${match[2]} to ${match[1]}`;
    }
  }

  // Invalid enum value
  if (code === "invalid_enum_value") {
    const match = message.match(/Invalid enum value.*Expected (.*)/);
    if (match) {
      return `Change '${issuePath}' to one of: ${match[1]}`;
    }
  }

  // Unrecognized keys
  if (code === "unrecognized_keys") {
    const match = message.match(/Unrecognized key\(s\) in object: (.+)/);
    if (match) {
      return `Remove unrecognized key(s): ${match[1]}`;
    }
  }

  // Invalid string pattern (e.g., repo format)
  if (code === "invalid_string" && issuePath.includes("repo")) {
    return `Use the format 'owner/repo' for the repository field`;
  }

  return null;
}

/**
 * Format validation errors for display
 */
function formatValidationErrors(issues: SchemaIssue[], showFixes: boolean): string {
  const lines: string[] = [];

  for (const issue of issues) {
    lines.push(`  - ${issue.path}: ${issue.message}`);

    if (showFixes) {
      const fix = suggestFix(issue);
      if (fix) {
        lines.push(`    Fix: ${fix}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Get suggestions for environment variable errors
 */
function suggestEnvVarFix(varName: string): string {
  return `Set the environment variable: export ${varName}=<value>`;
}

/**
 * Validate the herdctl configuration
 */
export async function configValidateCommand(options: ConfigValidateOptions): Promise<void> {
  const result = await safeLoadConfig(options.config);

  if (result.success) {
    const config = result.data;
    console.log("Configuration is valid.");
    console.log("");
    console.log(`Fleet: ${config.fleet.fleet?.name || "(unnamed)"}`);
    console.log(`Config: ${config.configPath}`);
    console.log(`Agents: ${config.agents.length}`);

    if (config.agents.length > 0) {
      for (const agent of config.agents) {
        console.log(`  - ${agent.qualifiedName}`);
      }
    }

    process.exit(0);
  }

  // Handle errors and show all validation issues
  const error = result.error;
  console.error("Configuration validation failed:\n");

  if (error instanceof ConfigNotFoundError) {
    console.error(`Error: No configuration file found.`);
    console.error(`Searched from: ${error.startDirectory}`);
    console.error("");
    if (options.fix) {
      console.error("Fix: Run 'herdctl init' to create a configuration file.");
    }
    process.exit(1);
  }

  if (error instanceof SchemaValidationError) {
    console.error("Schema validation errors:");
    console.error(formatValidationErrors(error.issues, options.fix ?? false));
    process.exit(1);
  }

  if (error instanceof AgentValidationError) {
    console.error(`Agent validation errors in '${error.filePath}':`);
    console.error(formatValidationErrors(error.issues, options.fix ?? false));
    process.exit(1);
  }

  if (error instanceof YamlSyntaxError || error instanceof AgentYamlSyntaxError) {
    console.error("YAML syntax error:");
    console.error(`  ${error.message}`);
    if (error.line !== undefined) {
      console.error(`  Location: line ${error.line}, column ${error.column}`);
    }
    if (options.fix) {
      console.error("");
      console.error("Fix: Check your YAML syntax. Common issues:");
      console.error("  - Incorrect indentation (use spaces, not tabs)");
      console.error("  - Missing colons after keys");
      console.error("  - Unquoted special characters");
    }
    process.exit(1);
  }

  if (error instanceof AgentLoadError) {
    console.error(`Failed to load agent: ${error.agentPath}`);
    console.error(`  ${error.message}`);

    // Check if the underlying cause has more details
    if (error.cause instanceof SchemaValidationError) {
      console.error("");
      console.error("Agent schema validation errors:");
      console.error(formatValidationErrors(error.cause.issues, options.fix ?? false));
    }

    if (options.fix) {
      console.error("");
      console.error("Fix: Check that the agent file exists and is valid YAML.");
    }
    process.exit(1);
  }

  if (error instanceof FileReadError) {
    console.error(`Failed to read file: ${error.filePath}`);
    console.error(`  ${error.message}`);
    if (options.fix) {
      console.error("");
      console.error("Fix: Check that the file exists and is readable.");
    }
    process.exit(1);
  }

  if (error instanceof UndefinedVariableError) {
    console.error(`Undefined environment variable:`);
    console.error(`  ${error.message}`);
    if (options.fix) {
      // Extract variable name from error message
      const match = error.message.match(/\${([^}:]+)/);
      if (match) {
        console.error("");
        console.error(`Fix: ${suggestEnvVarFix(match[1])}`);
      }
    }
    process.exit(1);
  }

  // Generic error
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

/**
 * Format a resolved config for human-readable output
 */
function formatConfigForDisplay(config: ResolvedConfig): string {
  const lines: string[] = [];

  // Fleet info
  lines.push("Fleet Configuration");
  lines.push("===================");
  lines.push(`Name: ${config.fleet.fleet?.name || "(unnamed)"}`);
  if (config.fleet.fleet?.description) {
    lines.push(`Description: ${config.fleet.fleet.description}`);
  }
  lines.push(`Config File: ${config.configPath}`);
  lines.push(`Version: ${config.fleet.version}`);

  // Defaults
  if (config.fleet.defaults) {
    lines.push("");
    lines.push("Defaults");
    lines.push("--------");
    const defaults = config.fleet.defaults;
    if (defaults.model) lines.push(`Model: ${defaults.model}`);
    if (defaults.max_turns) lines.push(`Max Turns: ${defaults.max_turns}`);
    if (defaults.permission_mode) lines.push(`Permission Mode: ${defaults.permission_mode}`);
    if (defaults.allowed_tools?.length) {
      lines.push(`Allowed Tools: ${defaults.allowed_tools.join(", ")}`);
    }
    if (defaults.denied_tools?.length) {
      lines.push(`Denied Tools: ${defaults.denied_tools.join(", ")}`);
    }
  }

  // Agents
  lines.push("");
  lines.push(`Agents (${config.agents.length})`);
  lines.push("------");

  for (const agent of config.agents) {
    lines.push("");
    lines.push(`[${agent.qualifiedName}]`);
    if (agent.fleetPath && agent.fleetPath.length > 0) {
      lines.push(`  Fleet: ${agent.fleetPath.join(".")}`);
    }
    if (agent.description) lines.push(`  Description: ${agent.description}`);
    lines.push(`  Config: ${path.relative(config.configDir, agent.configPath)}`);

    if (agent.model) lines.push(`  Model: ${agent.model}`);
    if (agent.max_turns) lines.push(`  Max Turns: ${agent.max_turns}`);
    if (agent.permission_mode) lines.push(`  Permission Mode: ${agent.permission_mode}`);

    // Workspace
    if (agent.working_directory) {
      const ws =
        typeof agent.working_directory === "string"
          ? agent.working_directory
          : agent.working_directory.root;
      lines.push(`  Workspace: ${ws}`);
    }

    // Schedules
    if (agent.schedules && Object.keys(agent.schedules).length > 0) {
      lines.push(`  Schedules:`);
      for (const [name, schedule] of Object.entries(agent.schedules)) {
        const scheduleInfo = [];
        scheduleInfo.push(`type=${schedule.type}`);
        if (schedule.interval) scheduleInfo.push(`interval=${schedule.interval}`);
        if (schedule.expression) scheduleInfo.push(`cron=${schedule.expression}`);
        lines.push(`    - ${name}: ${scheduleInfo.join(", ")}`);
      }
    }

    // Tool permissions
    if (agent.allowed_tools?.length) {
      lines.push(`  Allowed Tools: ${agent.allowed_tools.join(", ")}`);
    }
    if (agent.denied_tools?.length) {
      lines.push(`  Denied Tools: ${agent.denied_tools.join(", ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Show the merged/resolved configuration
 */
export async function configShowCommand(options: ConfigShowOptions): Promise<void> {
  const result = await safeLoadConfig(options.config);

  if (!result.success) {
    console.error(`Error loading configuration: ${result.error.message}`);
    console.error("");
    console.error("Run 'herdctl config validate' for detailed error information.");
    process.exit(1);
  }

  const config = result.data;

  if (options.json) {
    // JSON output - include the full resolved config
    const output = {
      fleet: config.fleet,
      agents: config.agents.map((agent) => ({
        ...agent,
        configPath: path.relative(config.configDir, agent.configPath),
      })),
      configPath: config.configPath,
      configDir: config.configDir,
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable output
    console.log(formatConfigForDisplay(config));
  }

  process.exit(0);
}
