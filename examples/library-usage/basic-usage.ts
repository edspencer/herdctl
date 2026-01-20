/**
 * Basic FleetManager Usage Example
 *
 * This example demonstrates:
 * - Creating a FleetManager instance
 * - Lifecycle methods (initialize, start, stop)
 * - Event subscription
 * - Querying fleet status
 * - Manual agent triggering
 *
 * Run with: npx tsx examples/library-usage/basic-usage.ts
 */

import { FleetManager, isAgentNotFoundError, isConcurrencyLimitError } from "@herdctl/core";

async function main() {
  // Create FleetManager with configuration
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
    checkInterval: 5000, // Check schedules every 5 seconds
    logger: {
      debug: (msg) => console.debug(`[DEBUG] ${msg}`),
      info: (msg) => console.info(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  });

  // Set up event handlers for lifecycle events
  manager.on("initialized", () => {
    console.log("Fleet initialized successfully");
  });

  manager.on("started", () => {
    console.log("Fleet scheduler started");
  });

  manager.on("stopped", () => {
    console.log("Fleet stopped");
  });

  manager.on("error", (error) => {
    console.error("Fleet error:", error.message);
  });

  // Job lifecycle events
  manager.on("job:created", (payload) => {
    console.log(`Job created: ${payload.job.id}`);
    console.log(`  Agent: ${payload.agentName}`);
    console.log(`  Schedule: ${payload.scheduleName ?? "manual"}`);
  });

  manager.on("job:output", (payload) => {
    // Stream job output to stdout
    process.stdout.write(payload.output);
  });

  manager.on("job:completed", (payload) => {
    console.log(`Job ${payload.job.id} completed`);
    console.log(`  Duration: ${payload.durationSeconds}s`);
    console.log(`  Exit reason: ${payload.exitReason}`);
  });

  manager.on("job:failed", (payload) => {
    console.error(`Job ${payload.job.id} failed`);
    console.error(`  Error: ${payload.error.message}`);
  });

  // Schedule events
  manager.on("schedule:triggered", (payload) => {
    console.log(`Schedule triggered: ${payload.agentName}/${payload.scheduleName}`);
  });

  manager.on("schedule:skipped", (payload) => {
    console.log(`Schedule skipped: ${payload.agentName}/${payload.scheduleName}`);
    console.log(`  Reason: ${payload.reason}`);
  });

  // Config reload events
  manager.on("config:reloaded", (payload) => {
    console.log(`Config reloaded: ${payload.agentCount} agents`);
    for (const change of payload.changes) {
      console.log(`  ${change.type} ${change.category}: ${change.name}`);
    }
  });

  try {
    // Initialize the fleet
    await manager.initialize();
    console.log(`Loaded ${manager.state.agentCount} agents`);

    // Start the fleet
    await manager.start();
    console.log(`Fleet status: ${manager.state.status}`);

    // Query fleet status
    const status = await manager.getFleetStatus();
    console.log("\n--- Fleet Status ---");
    console.log(`State: ${status.state}`);
    console.log(`Uptime: ${status.uptimeSeconds}s`);
    console.log(`Agents: ${status.counts.totalAgents} total, ${status.counts.runningAgents} running`);
    console.log(`Schedules: ${status.counts.totalSchedules}`);
    console.log(`Running jobs: ${status.counts.runningJobs}`);

    // List all agents
    const agents = await manager.getAgentInfo();
    console.log("\n--- Agents ---");
    for (const agent of agents) {
      console.log(`${agent.name}:`);
      console.log(`  Status: ${agent.status}`);
      console.log(`  Running: ${agent.runningCount}/${agent.maxConcurrent}`);
      console.log(`  Schedules: ${agent.scheduleCount}`);
      for (const schedule of agent.schedules) {
        console.log(`    - ${schedule.name}: ${schedule.status}`);
        if (schedule.nextRunAt) {
          console.log(`      Next run: ${schedule.nextRunAt}`);
        }
      }
    }

    // Manual trigger example (uncomment to use)
    /*
    try {
      const result = await manager.trigger('my-agent', 'hourly', {
        prompt: 'Check for urgent issues only',
      });
      console.log(`Triggered job: ${result.jobId}`);
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        console.error(`Agent not found: ${error.agentName}`);
        console.error(`Available agents: ${error.availableAgents?.join(', ')}`);
      } else if (isConcurrencyLimitError(error)) {
        console.error(`Agent at capacity: ${error.currentJobs}/${error.limit}`);
      } else {
        throw error;
      }
    }
    */

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nReceived SIGINT, shutting down...");
      await manager.stop({
        timeout: 30000,
        cancelOnTimeout: true,
      });
      process.exit(0);
    });

    // Keep the process running
    console.log("\nFleet is running. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Failed to start fleet:", error);
    process.exit(1);
  }
}

main();
