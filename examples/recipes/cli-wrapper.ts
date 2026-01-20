/**
 * Simple CLI Wrapper Example
 *
 * Demonstrates building a custom CLI tool that wraps herdctl functionality.
 * Uses Commander.js for argument parsing.
 *
 * Usage:
 *   npx tsx examples/recipes/cli-wrapper.ts status
 *   npx tsx examples/recipes/cli-wrapper.ts agents
 *   npx tsx examples/recipes/cli-wrapper.ts trigger my-agent
 *   npx tsx examples/recipes/cli-wrapper.ts trigger my-agent -p "Custom prompt"
 *   npx tsx examples/recipes/cli-wrapper.ts trigger my-agent -s hourly
 *   npx tsx examples/recipes/cli-wrapper.ts trigger my-agent --force
 */

import { Command } from "commander";
import {
  FleetManager,
  isAgentNotFoundError,
  isScheduleNotFoundError,
  isConcurrencyLimitError,
} from "@herdctl/core";

const program = new Command();

program
  .name("my-fleet")
  .description("Custom fleet management CLI")
  .version("1.0.0");

// Shared manager factory
async function createManager(): Promise<FleetManager> {
  const manager = new FleetManager({
    configPath: process.env.HERDCTL_CONFIG || "./herdctl.yaml",
    stateDir: process.env.HERDCTL_STATE || "./.herdctl",
  });
  await manager.initialize();
  return manager;
}

// Format duration
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

// Status command
program
  .command("status")
  .description("Show fleet status")
  .action(async () => {
    try {
      const manager = await createManager();
      const status = await manager.getFleetStatus();

      console.log("\n=== Fleet Status ===\n");
      console.log(`State:         ${status.state}`);
      console.log(`Agents:        ${status.counts.totalAgents}`);
      console.log(`  Idle:        ${status.counts.idleAgents}`);
      console.log(`  Running:     ${status.counts.runningAgents}`);
      console.log(`  Error:       ${status.counts.errorAgents}`);
      console.log(`Schedules:     ${status.counts.totalSchedules}`);
      console.log(`Running Jobs:  ${status.counts.runningJobs}`);

      if (status.uptimeSeconds !== null) {
        console.log(`Uptime:        ${formatUptime(status.uptimeSeconds)}`);
      }

      console.log("\n--- Scheduler ---");
      console.log(`Status:        ${status.scheduler.status}`);
      console.log(`Checks:        ${status.scheduler.checkCount}`);
      console.log(`Triggers:      ${status.scheduler.triggerCount}`);
      console.log(`Interval:      ${status.scheduler.checkIntervalMs}ms`);

      if (status.lastError) {
        console.log(`\nLast Error:    ${status.lastError}`);
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

// List agents command
program
  .command("agents")
  .description("List all agents")
  .option("-v, --verbose", "Show detailed information")
  .action(async (options: { verbose?: boolean }) => {
    try {
      const manager = await createManager();
      const agents = await manager.getAgentInfo();

      console.log("\n=== Agents ===\n");

      if (agents.length === 0) {
        console.log("No agents configured.");
        return;
      }

      for (const agent of agents) {
        const statusIcon =
          agent.status === "running" ? "\u001b[32m\u25CF\u001b[0m" : // Green dot
          agent.status === "error" ? "\u001b[31m\u25CF\u001b[0m" :   // Red dot
          "\u001b[90m\u25CB\u001b[0m";                               // Gray circle

        console.log(`${statusIcon} ${agent.name}`);
        console.log(`  Status:     ${agent.status}`);
        console.log(`  Concurrent: ${agent.runningCount}/${agent.maxConcurrent}`);

        if (options.verbose) {
          if (agent.description) {
            console.log(`  Description: ${agent.description}`);
          }
          if (agent.model) {
            console.log(`  Model:      ${agent.model}`);
          }
          if (agent.currentJobId) {
            console.log(`  Current Job: ${agent.currentJobId}`);
          }
        }

        console.log(`  Schedules:  ${agent.scheduleCount}`);
        for (const schedule of agent.schedules) {
          const scheduleIcon =
            schedule.status === "running" ? "\u001b[33m\u25B6\u001b[0m" : // Yellow play
            schedule.status === "disabled" ? "\u001b[90m\u25A0\u001b[0m" : // Gray stop
            "\u001b[90m\u25CB\u001b[0m";                                   // Gray circle

          console.log(`    ${scheduleIcon} ${schedule.name} (${schedule.type})`);

          if (options.verbose && schedule.nextRunAt) {
            const nextRun = new Date(schedule.nextRunAt);
            console.log(`      Next: ${nextRun.toLocaleString()}`);
          }
        }

        console.log("");
      }
    } catch (error) {
      console.error("Error:", error);
      process.exit(1);
    }
  });

// Trigger command
program
  .command("trigger <agent>")
  .description("Trigger an agent")
  .option("-s, --schedule <name>", "Use specific schedule")
  .option("-p, --prompt <text>", "Custom prompt")
  .option("-f, --force", "Bypass concurrency limit")
  .option("-w, --wait", "Wait for job to complete")
  .action(async (agent: string, options: { schedule?: string; prompt?: string; force?: boolean; wait?: boolean }) => {
    let manager: FleetManager | undefined;

    try {
      manager = await createManager();
      await manager.start();

      console.log(`\nTriggering agent: ${agent}`);
      if (options.schedule) console.log(`Schedule: ${options.schedule}`);
      if (options.prompt) console.log(`Prompt: ${options.prompt}`);
      if (options.force) console.log("Bypassing concurrency limit");

      const result = await manager.trigger(agent, options.schedule, {
        prompt: options.prompt,
        bypassConcurrencyLimit: options.force,
      });

      console.log(`\nJob started: ${result.jobId}`);

      if (options.wait) {
        console.log("\nWaiting for completion...\n");

        // Stream output
        manager.on("job:output", (payload) => {
          if (payload.job.id === result.jobId) {
            process.stdout.write(payload.output);
          }
        });

        // Wait for completion
        const success = await new Promise<boolean>((resolve) => {
          manager!.on("job:completed", (payload) => {
            if (payload.job.id === result.jobId) {
              console.log(`\nCompleted in ${payload.durationSeconds}s`);
              resolve(true);
            }
          });
          manager!.on("job:failed", (payload) => {
            if (payload.job.id === result.jobId) {
              console.error(`\nFailed: ${payload.error.message}`);
              resolve(false);
            }
          });
        });

        process.exit(success ? 0 : 1);
      }
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        console.error(`\nAgent not found: ${error.agentName}`);
        console.error(`Available agents: ${error.availableAgents?.join(", ") || "none"}`);
        process.exit(1);
      }
      if (isScheduleNotFoundError(error)) {
        console.error(`\nSchedule not found: ${error.scheduleName}`);
        console.error(`Available schedules: ${error.availableSchedules?.join(", ") || "none"}`);
        process.exit(1);
      }
      if (isConcurrencyLimitError(error)) {
        console.error(`\nAgent at capacity: ${error.currentJobs}/${error.limit}`);
        console.error("Use --force to bypass the limit");
        process.exit(1);
      }
      console.error("Error:", error);
      process.exit(1);
    } finally {
      if (manager) {
        await manager.stop();
      }
    }
  });

// Parse and execute
program.parse();
