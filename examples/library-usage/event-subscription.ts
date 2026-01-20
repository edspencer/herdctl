/**
 * Multiple Event Subscription Example
 *
 * This example demonstrates:
 * - Subscribing to all major event types
 * - Tracking active jobs with a Map
 * - Type-safe event handlers
 * - Graceful shutdown handling
 *
 * Run with: npx tsx examples/library-usage/event-subscription.ts
 */

import { FleetManager } from "@herdctl/core";

async function main() {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  // Track active jobs
  const activeJobs = new Map<string, { startedAt: Date; agentName: string }>();

  // =========================================================================
  // Lifecycle Events
  // =========================================================================

  manager.on("initialized", () => {
    console.log("[Fleet] Initialized");
  });

  manager.on("started", () => {
    console.log("[Fleet] Started - scheduler is now processing schedules");
  });

  manager.on("stopped", () => {
    console.log("[Fleet] Stopped - all jobs complete");
  });

  manager.on("error", (error) => {
    console.error("[Fleet] Error:", error.message);
  });

  // =========================================================================
  // Configuration Events
  // =========================================================================

  manager.on("config:reloaded", (payload) => {
    console.log(`[Config] Reloaded: ${payload.agentCount} agents`);
    console.log(`[Config] Path: ${payload.configPath}`);

    for (const change of payload.changes) {
      const icon =
        change.type === "added" ? "+" : change.type === "removed" ? "-" : "~";
      console.log(`[Config]   ${icon} ${change.category}: ${change.name}`);
      if (change.details) {
        console.log(`[Config]     ${change.details}`);
      }
    }
  });

  // =========================================================================
  // Agent Events
  // =========================================================================

  manager.on("agent:started", (payload) => {
    console.log(`[Agent] Started: ${payload.agent.name}`);
    const scheduleCount = Object.keys(payload.agent.schedules || {}).length;
    console.log(`[Agent]   Schedules: ${scheduleCount}`);
  });

  manager.on("agent:stopped", (payload) => {
    console.log(`[Agent] Stopped: ${payload.agentName}`);
    if (payload.reason) {
      console.log(`[Agent]   Reason: ${payload.reason}`);
    }
  });

  // =========================================================================
  // Schedule Events
  // =========================================================================

  manager.on("schedule:triggered", (payload) => {
    console.log(
      `[Schedule] Triggered: ${payload.agentName}/${payload.scheduleName}`,
    );
    console.log(`[Schedule]   Type: ${payload.schedule.type}`);
  });

  manager.on("schedule:skipped", (payload) => {
    const reasons: Record<string, string> = {
      already_running: "Agent already running",
      disabled: "Schedule disabled",
      max_concurrent: "At concurrency limit",
      work_source_empty: "No work items available",
    };
    console.log(
      `[Schedule] Skipped: ${payload.agentName}/${payload.scheduleName}`,
    );
    console.log(`[Schedule]   Reason: ${reasons[payload.reason]}`);
  });

  // =========================================================================
  // Job Events
  // =========================================================================

  manager.on("job:created", (payload) => {
    activeJobs.set(payload.job.id, {
      startedAt: new Date(),
      agentName: payload.agentName,
    });
    console.log(`[Job] Created: ${payload.job.id}`);
    console.log(`[Job]   Agent: ${payload.agentName}`);
    console.log(`[Job]   Schedule: ${payload.scheduleName ?? "manual"}`);
    console.log(`[Job]   Active jobs: ${activeJobs.size}`);
  });

  manager.on("job:output", (payload) => {
    // Stream output without adding extra newlines
    // The output already contains newlines where appropriate
    process.stdout.write(payload.output);
  });

  manager.on("job:completed", (payload) => {
    activeJobs.delete(payload.job.id);
    console.log(`\n[Job] Completed: ${payload.job.id}`);
    console.log(`[Job]   Duration: ${payload.durationSeconds}s`);
    console.log(`[Job]   Exit reason: ${payload.exitReason}`);
    console.log(`[Job]   Active jobs: ${activeJobs.size}`);
  });

  manager.on("job:failed", (payload) => {
    activeJobs.delete(payload.job.id);
    console.error(`\n[Job] Failed: ${payload.job.id}`);
    console.error(`[Job]   Error: ${payload.error.message}`);
    console.error(`[Job]   Exit reason: ${payload.exitReason}`);
    if (payload.durationSeconds !== undefined) {
      console.error(`[Job]   Duration: ${payload.durationSeconds}s`);
    }
    console.log(`[Job]   Active jobs: ${activeJobs.size}`);
  });

  manager.on("job:cancelled", (payload) => {
    activeJobs.delete(payload.job.id);
    console.log(`\n[Job] Cancelled: ${payload.job.id}`);
    console.log(`[Job]   Termination: ${payload.terminationType}`);
    if (payload.durationSeconds !== undefined) {
      console.log(`[Job]   Duration: ${payload.durationSeconds}s`);
    }
    console.log(`[Job]   Active jobs: ${activeJobs.size}`);
  });

  manager.on("job:forked", (payload) => {
    activeJobs.set(payload.job.id, {
      startedAt: new Date(),
      agentName: payload.agentName,
    });
    console.log(`[Job] Forked: ${payload.job.id}`);
    console.log(`[Job]   From: ${payload.originalJob.id}`);
    console.log(`[Job]   Agent: ${payload.agentName}`);
    console.log(`[Job]   Active jobs: ${activeJobs.size}`);
  });

  // =========================================================================
  // Start the Fleet
  // =========================================================================

  await manager.initialize();
  console.log(`\nLoaded ${manager.state.agentCount} agents`);

  await manager.start();
  console.log("Fleet is running. Press Ctrl+C to stop.\n");

  // =========================================================================
  // Graceful Shutdown
  // =========================================================================

  process.on("SIGINT", async () => {
    console.log(`\n\nReceived SIGINT, shutting down...`);
    console.log(`Active jobs: ${activeJobs.size}`);

    if (activeJobs.size > 0) {
      console.log("Waiting for jobs to complete (30s timeout)...");
    }

    await manager.stop({
      timeout: 30000,
      cancelOnTimeout: true,
      cancelTimeout: 10000,
    });

    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
