#!/usr/bin/env node

/**
 * herdctl - Autonomous Agent Fleet Management for Claude Code
 *
 * Commands (PRD 6):
 * - herdctl init              Initialize fleet or agent (interactive selector)
 * - herdctl init fleet        Create a new herdctl.yaml fleet configuration
 * - herdctl init agent [name] Add a new agent to the fleet
 * - herdctl start [agent]     Start all agents or a specific agent
 * - herdctl stop [agent]      Stop all agents or a specific agent
 * - herdctl status [agent]    Show fleet or agent status
 * - herdctl logs [agent]      Tail agent logs
 * - herdctl trigger <agent>   Manually trigger an agent
 *
 * Commands (PRD 7):
 * - herdctl config validate   Validate configuration
 * - herdctl config show       Show resolved configuration
 *
 * Commands (PRD 8 - Job Management):
 * - herdctl jobs              List recent jobs
 * - herdctl job <id>          Show job details
 * - herdctl cancel <id>       Cancel running job
 *
 * Commands (Session Management):
 * - herdctl sessions              List Claude Code sessions
 * - herdctl sessions resume [id]  Resume a session in Claude Code
 */

import { createRequire } from "node:module";
import { createLogger } from "@herdctl/core";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

const logger = createLogger("cli");

import {
  agentAddCommand,
  agentInfoCommand,
  agentListCommand,
  agentRemoveCommand,
} from "./commands/agent.js";
import { cancelCommand } from "./commands/cancel.js";
import { configShowCommand, configValidateCommand } from "./commands/config.js";
import { initRouterAction } from "./commands/init.js";
import { initAgentCommand } from "./commands/init-agent.js";
import { initFleetCommand } from "./commands/init-fleet.js";
import { jobCommand } from "./commands/job.js";
import { jobsCommand } from "./commands/jobs.js";
import { logsCommand } from "./commands/logs.js";
import { sessionsCommand, sessionsResumeCommand } from "./commands/sessions.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand } from "./commands/stop.js";
import { triggerCommand } from "./commands/trigger.js";

const program = new Command();

program
  .name("herdctl")
  .description("Autonomous Agent Fleet Management for Claude Code")
  .version(VERSION);

// Init command group
const initCmd = program
  .command("init")
  .description("Initialize a new fleet or add an agent")
  .option("-y, --yes", "Accept all defaults without prompting")
  .option("-f, --force", "Overwrite existing files")
  .action(async (options) => {
    try {
      await initRouterAction(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

initCmd
  .command("fleet")
  .description("Create a new herdctl.yaml fleet configuration")
  .option("-n, --name <name>", "Fleet name")
  .option("-f, --force", "Overwrite existing configuration")
  .action(async (options) => {
    try {
      await initFleetCommand(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

initCmd
  .command("agent [name]")
  .description("Add a new agent to the fleet")
  .option("-d, --description <desc>", "Agent description")
  .option(
    "--permission-mode <mode>",
    "Permission mode (default, acceptEdits, bypassPermissions, plan, delegate, dontAsk)",
  )
  .option("--docker", "Enable Docker isolation")
  .option("--no-docker", "Disable Docker isolation")
  .option("--runtime <runtime>", "Runtime backend (sdk or cli)")
  .option("--discord", "Add Discord chat integration")
  .option("--slack", "Add Slack chat integration")
  .option("-y, --yes", "Skip all prompts, use defaults")
  .option("-f, --force", "Overwrite existing agent file")
  .action(async (name, options) => {
    try {
      await initAgentCommand(name, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

// Agent management command group
const agentCmd = program.command("agent").description("Manage installed agents");

agentCmd
  .command("add <source>")
  .description("Install an agent from GitHub or a local path")
  .option("--path <path>", "Override installation directory")
  .option("--dry-run", "Preview changes without installing")
  .option("-f, --force", "Overwrite existing agent directory")
  .action(async (source, options) => {
    try {
      await agentAddCommand(source, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

agentCmd
  .command("list")
  .description("List all agents in the fleet")
  .option("--json", "Output as JSON for scripting")
  .action(async (options) => {
    try {
      await agentListCommand(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

agentCmd
  .command("info <name>")
  .description("Show detailed information about an agent")
  .option("--json", "Output as JSON for scripting")
  .action(async (name, options) => {
    try {
      await agentInfoCommand(name, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

agentCmd
  .command("remove <name>")
  .description("Remove an installed agent from the fleet")
  .option("-f, --force", "Skip confirmation (reserved for future use)")
  .option("--keep-workspace", "Preserve the workspace directory")
  .action(async (name, options) => {
    try {
      await agentRemoveCommand(name, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("start")
  .description("Start the fleet")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .option("-v, --verbose", "Enable verbose debug logging")
  .option("--web", "Enable the web dashboard")
  .option("--web-port <port>", "Web dashboard port (default: 3232)", parseInt)
  .action(async (options) => {
    try {
      await startCommand(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("stop")
  .description("Stop the fleet")
  .option("-f, --force", "Immediate stop (cancel jobs)")
  .option("-t, --timeout <seconds>", "Wait max seconds before force kill", "30")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (options) => {
    try {
      await stopCommand({
        force: options.force,
        timeout: parseInt(options.timeout, 10),
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("process.exit")) {
        // Let the process.exit call in stopCommand handle this
        return;
      }
      logger.error("Error:", { message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  });

program
  .command("status [agent]")
  .description("Show fleet status or agent details")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (agent, options) => {
    try {
      await statusCommand(agent, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("logs [agent]")
  .description("Show agent logs")
  .option("-f, --follow", "Follow log output continuously")
  .option("--job <id>", "Logs from specific job")
  .option("-n, --lines <count>", "Number of lines to show (default: 50)")
  .option("--json", "Output as newline-delimited JSON")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (agent, options) => {
    try {
      await logsCommand(agent, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("trigger <agent>")
  .description("Manually trigger an agent")
  .option("-S, --schedule <name>", "Trigger specific schedule")
  .option("-p, --prompt <prompt>", "Custom prompt")
  .option("-w, --wait", "Wait for job to complete and stream logs")
  .option("-q, --quiet", "Suppress output display (just show job info)")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (agent, options) => {
    try {
      await triggerCommand(agent, {
        schedule: options.schedule,
        prompt: options.prompt,
        wait: options.wait,
        quiet: options.quiet,
        json: options.json,
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

// Job management commands (PRD 8)
program
  .command("jobs")
  .description("List recent jobs")
  .option("-a, --agent <name>", "Filter by agent name")
  .option(
    "-S, --status <status>",
    "Filter by status (pending, running, completed, failed, cancelled)",
  )
  .option("-l, --limit <count>", "Number of jobs to show (default: 20)")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (options) => {
    try {
      await jobsCommand({
        agent: options.agent,
        status: options.status,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        json: options.json,
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("job <id>")
  .description("Show job details")
  .option("-L, --logs", "Show job output")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (id, options) => {
    try {
      await jobCommand(id, {
        logs: options.logs,
        json: options.json,
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program
  .command("cancel <id>")
  .description("Cancel a running job")
  .option("-f, --force", "Force cancel (SIGKILL)")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (id, options) => {
    try {
      await cancelCommand(id, {
        force: options.force,
        yes: options.yes,
        json: options.json,
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

// Session management command group
const sessionsCmd = program
  .command("sessions")
  .description("List and resume Claude Code sessions for agents")
  .option("-a, --agent <name>", "Filter by agent name")
  .option("-v, --verbose", "Show full resume commands")
  .option("--json", "Output as JSON for scripting")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (options) => {
    try {
      await sessionsCommand({
        agent: options.agent,
        verbose: options.verbose,
        json: options.json,
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

sessionsCmd
  .command("resume [session-id]")
  .description("Resume a session in Claude Code (defaults to most recent)")
  .option("-c, --config <path>", "Path to config file or directory")
  .option("-s, --state <path>", "Path to state directory (default: .herdctl)")
  .action(async (sessionId, options) => {
    try {
      await sessionsResumeCommand(sessionId, {
        config: options.config,
        state: options.state,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

// Config command group
const configCmd = program.command("config").description("Configuration management commands");

configCmd
  .command("validate")
  .description("Validate the current configuration")
  .option("--fix", "Show suggestions for fixes")
  .option("-c, --config <path>", "Path to config file or directory")
  .action(async (options) => {
    try {
      await configValidateCommand(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

configCmd
  .command("show")
  .description("Show merged/resolved configuration")
  .option("--json", "Output as JSON")
  .option("-c, --config <path>", "Path to config file or directory")
  .action(async (options) => {
    try {
      await configShowCommand(options);
    } catch (error) {
      if (error instanceof Error && error.message.includes("User force closed")) {
        console.log("\nAborted.");
        process.exit(0);
      }
      throw error;
    }
  });

program.parse();
