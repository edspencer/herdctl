/**
 * Quickstart Example - Using herdctl as a Library
 *
 * This minimal example demonstrates:
 * - Creating a FleetManager
 * - Initializing and starting the fleet
 * - Listening for job and schedule events
 * - Graceful shutdown
 *
 * Run: npx tsx quickstart.ts
 * Requires: herdctl.yaml and agents/hello-agent.yaml in the same directory
 */

import {
  FleetManager,
  type JobCreatedPayload,
  type JobCompletedPayload,
  type ScheduleTriggeredPayload,
} from "@herdctl/core";

const manager = new FleetManager({
  configPath: "./herdctl.yaml",
  stateDir: "./.herdctl",
});

await manager.initialize();
console.log("Fleet initialized");

await manager.start();
console.log("Fleet started - watching for scheduled triggers...");

manager.on("job:created", (payload: JobCreatedPayload) => {
  console.log(`Job created: ${payload.job.id} for ${payload.agentName}`);
});

manager.on("schedule:triggered", (payload: ScheduleTriggeredPayload) => {
  console.log(`Schedule triggered: ${payload.agentName}/${payload.scheduleName}`);
});

manager.on("job:completed", (payload: JobCompletedPayload) => {
  console.log(`Job completed: ${payload.job.id}`);
});

// Keep running until interrupted
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await manager.stop();
  console.log("Fleet stopped");
  process.exit(0);
});

// Prevent Node from exiting immediately
setInterval(() => {}, 1000);
