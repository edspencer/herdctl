/**
 * Long-Running Daemon with Graceful Shutdown
 *
 * Run herdctl as a background service with proper signal handling
 * for SIGINT (Ctrl+C) and SIGTERM (container shutdown).
 *
 * Usage:
 *   npx tsx examples/recipes/daemon.ts
 *
 * Then press Ctrl+C to test graceful shutdown.
 */

import { FleetManager } from "@herdctl/core";

async function startDaemon() {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
    checkInterval: 5000,
    logger: {
      debug: (msg) => console.debug(`[DEBUG] ${msg}`),
      info: (msg) => console.info(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  });

  // Track shutdown state to prevent multiple shutdown attempts
  let isShuttingDown = false;

  // Graceful shutdown handler
  async function shutdown(signal: string) {
    if (isShuttingDown) {
      console.log("Shutdown already in progress...");
      return;
    }
    isShuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    const startTime = Date.now();

    try {
      await manager.stop({
        timeout: 30000, // Wait 30s for jobs to complete
        cancelOnTimeout: true, // Cancel remaining jobs after timeout
        cancelTimeout: 10000, // Give jobs 10s to respond to SIGTERM
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`Shutdown complete in ${elapsed}s`);
      process.exit(0);
    } catch (error) {
      console.error("Shutdown failed:", error);
      process.exit(1);
    }
  }

  // Register signal handlers
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown("unhandledRejection");
  });

  // Set up comprehensive event logging
  manager.on("initialized", () => {
    console.log(`Fleet initialized with ${manager.state.agentCount} agents`);
  });

  manager.on("started", () => {
    console.log("Fleet scheduler started");
  });

  manager.on("stopped", () => {
    console.log("Fleet stopped");
  });

  manager.on("error", (error) => {
    console.error(`Fleet error: ${error.message}`);
  });

  manager.on("config:reloaded", (payload) => {
    console.log(`Config reloaded: ${payload.agentCount} agents`);
    for (const change of payload.changes) {
      console.log(`  ${change.type} ${change.category}: ${change.name}`);
    }
  });

  manager.on("schedule:triggered", (payload) => {
    console.log(`Schedule triggered: ${payload.agentName}/${payload.scheduleName}`);
  });

  manager.on("schedule:skipped", (payload) => {
    console.log(`Schedule skipped: ${payload.agentName}/${payload.scheduleName} - ${payload.reason}`);
  });

  manager.on("job:created", (payload) => {
    console.log(`Job started: ${payload.job.id} (${payload.agentName})`);
  });

  manager.on("job:completed", (payload) => {
    console.log(`Job completed: ${payload.job.id} in ${payload.durationSeconds}s`);
  });

  manager.on("job:failed", (payload) => {
    console.error(`Job failed: ${payload.job.id} - ${payload.error.message}`);
  });

  manager.on("job:cancelled", (payload) => {
    console.log(`Job cancelled: ${payload.job.id} (${payload.terminationType})`);
  });

  // Start the fleet
  console.log("=== Starting Fleet Daemon ===\n");

  await manager.initialize();
  await manager.start();

  // Log status summary
  const status = await manager.getFleetStatus();
  console.log("\n--- Fleet Status ---");
  console.log(`State: ${status.state}`);
  console.log(`Agents: ${status.counts.totalAgents}`);
  console.log(`Schedules: ${status.counts.totalSchedules}`);
  console.log(`Check interval: ${status.scheduler.checkIntervalMs}ms`);

  // List agents and their schedules
  const agents = await manager.getAgentInfo();
  console.log("\n--- Agents ---");
  for (const agent of agents) {
    console.log(`${agent.name}: ${agent.schedules.length} schedules`);
    for (const schedule of agent.schedules) {
      const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleTimeString() : "N/A";
      console.log(`  - ${schedule.name} (${schedule.type}): next run at ${next}`);
    }
  }

  console.log("\n========================================");
  console.log("Fleet daemon is running.");
  console.log("Press Ctrl+C to stop gracefully.");
  console.log("========================================\n");
}

startDaemon().catch((error) => {
  console.error("Failed to start daemon:", error);
  process.exit(1);
});
