#!/usr/bin/env node

/**
 * herdctl - Autonomous Agent Fleet Management for Claude Code
 *
 * Commands (PRD 6):
 * - herdctl init              Initialize a new herdctl project
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

import { Command } from "commander";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");
import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { configValidateCommand, configShowCommand } from "./commands/config.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { triggerCommand } from "./commands/trigger.js";
import { jobsCommand } from "./commands/jobs.js";
import { jobCommand } from "./commands/job.js";
import { cancelCommand } from "./commands/cancel.js";
import { sessionsCommand, sessionsResumeCommand } from "./commands/sessions.js";

const program = new Command();

program
  .name("herdctl")
  .description("Autonomous Agent Fleet Management for Claude Code")
  .version(VERSION);

program
  .command("init")
  .description("Initialize a new herdctl project")
  .option("-n, --name <name>", "Fleet name")
  .option("-e, --example <template>", "Use example template (simple, quickstart, github)")
  .option("-y, --yes", "Accept all defaults without prompting")
  .option("-f, --force", "Overwrite existing configuration")
  .action(async (options) => {
    try {
      await initCommand(options);
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
      console.error("Error:", error instanceof Error ? error.message : String(error));
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
  .option("-S, --status <status>", "Filter by status (pending, running, completed, failed, cancelled)")
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
const configCmd = program
  .command("config")
  .description("Configuration management commands");

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
