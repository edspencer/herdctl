/**
 * Console Progress Monitor Example
 *
 * This example demonstrates:
 * - Building a real-time dashboard in the terminal
 * - Tracking multiple jobs with their progress
 * - Using console clearing for dynamic updates
 * - Displaying job statistics and timing
 *
 * Run with: npx tsx examples/library-usage/progress-monitor.ts
 */

import { FleetManager } from "@herdctl/core";

// Track job state for display
interface JobState {
  id: string;
  agentName: string;
  scheduleName: string | null;
  status: "starting" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt: Date | null;
  outputLines: number;
  lastOutput: string;
  exitReason: string | null;
  error: string | null;
}

// Global state
const jobs = new Map<string, JobState>();
const completedJobs: JobState[] = [];
let totalJobsRun = 0;
let totalJobsFailed = 0;
let lastRenderTime = 0;
let schedulerStartedAt: Date | null = null;

// Format duration in human-readable form
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}

// Truncate string with ellipsis
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// Render the dashboard
function render(): void {
  // Throttle rendering to avoid flicker (max 10 fps)
  const now = Date.now();
  if (now - lastRenderTime < 100) return;
  lastRenderTime = now;

  // Clear screen and move cursor to top
  process.stdout.write("\x1b[2J\x1b[H");

  // Header
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║                     FLEET PROGRESS MONITOR                    ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  // Fleet status
  const uptime = schedulerStartedAt
    ? formatDuration((Date.now() - schedulerStartedAt.getTime()) / 1000)
    : "not started";

  console.log(`Uptime: ${uptime}`);
  console.log(`Total Jobs: ${totalJobsRun}  |  Failed: ${totalJobsFailed}  |  Active: ${jobs.size}\n`);

  // Active jobs section
  console.log("─────────────────────────── Active Jobs ───────────────────────────\n");

  if (jobs.size === 0) {
    console.log("  No jobs currently running. Waiting for triggers...\n");
  } else {
    for (const [id, job] of jobs) {
      const elapsed = (Date.now() - job.startedAt.getTime()) / 1000;
      const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][
        Math.floor(Date.now() / 80) % 10
      ];

      // Status indicator
      let statusIcon: string;
      let statusColor: string;
      switch (job.status) {
        case "starting":
          statusIcon = "○";
          statusColor = "\x1b[33m"; // yellow
          break;
        case "running":
          statusIcon = spinner;
          statusColor = "\x1b[32m"; // green
          break;
        case "completed":
          statusIcon = "✓";
          statusColor = "\x1b[32m"; // green
          break;
        case "failed":
          statusIcon = "✗";
          statusColor = "\x1b[31m"; // red
          break;
        case "cancelled":
          statusIcon = "⊘";
          statusColor = "\x1b[33m"; // yellow
          break;
      }

      const reset = "\x1b[0m";
      const dim = "\x1b[2m";

      console.log(
        `  ${statusColor}${statusIcon}${reset} ${job.agentName}${dim}/${job.scheduleName ?? "manual"}${reset}`,
      );
      console.log(`    ${dim}ID:${reset} ${truncate(id, 30)}`);
      console.log(`    ${dim}Elapsed:${reset} ${formatDuration(elapsed)}`);
      console.log(`    ${dim}Output lines:${reset} ${job.outputLines}`);

      if (job.lastOutput) {
        const lastLine = truncate(
          job.lastOutput.trim().split("\n").pop() || "",
          50,
        );
        console.log(`    ${dim}Last output:${reset} ${lastLine}`);
      }

      console.log("");
    }
  }

  // Recent completions
  console.log("─────────────────────── Recent Completions ────────────────────────\n");

  const recentCompletions = completedJobs.slice(-5);
  if (recentCompletions.length === 0) {
    console.log("  No completed jobs yet.\n");
  } else {
    for (const job of recentCompletions) {
      const duration = job.completedAt
        ? formatDuration((job.completedAt.getTime() - job.startedAt.getTime()) / 1000)
        : "?";

      let statusIcon: string;
      let statusColor: string;
      switch (job.status) {
        case "completed":
          statusIcon = "✓";
          statusColor = "\x1b[32m";
          break;
        case "failed":
          statusIcon = "✗";
          statusColor = "\x1b[31m";
          break;
        case "cancelled":
          statusIcon = "⊘";
          statusColor = "\x1b[33m";
          break;
        default:
          statusIcon = "?";
          statusColor = "";
      }

      const reset = "\x1b[0m";
      const dim = "\x1b[2m";

      console.log(
        `  ${statusColor}${statusIcon}${reset} ${job.agentName} ${dim}(${duration})${reset}`,
      );
      if (job.error) {
        console.log(`    ${dim}Error:${reset} ${truncate(job.error, 50)}`);
      }
    }
    console.log("");
  }

  // Footer
  console.log("───────────────────────────────────────────────────────────────────");
  console.log("\n  Press Ctrl+C to stop the fleet\n");
}

async function main() {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  // =========================================================================
  // Event Handlers
  // =========================================================================

  manager.on("started", () => {
    schedulerStartedAt = new Date();
    render();
  });

  manager.on("job:created", (payload) => {
    totalJobsRun++;
    jobs.set(payload.job.id, {
      id: payload.job.id,
      agentName: payload.agentName,
      scheduleName: payload.scheduleName ?? null,
      status: "starting",
      startedAt: new Date(),
      completedAt: null,
      outputLines: 0,
      lastOutput: "",
      exitReason: null,
      error: null,
    });
    render();
  });

  manager.on("job:output", (payload) => {
    const job = jobs.get(payload.jobId);
    if (job) {
      job.status = "running";
      job.outputLines += (payload.output.match(/\n/g) || []).length;
      job.lastOutput = payload.output;
      render();
    }
  });

  manager.on("job:completed", (payload) => {
    const job = jobs.get(payload.job.id);
    if (job) {
      job.status = "completed";
      job.completedAt = new Date();
      job.exitReason = payload.exitReason;
      completedJobs.push({ ...job });
      jobs.delete(payload.job.id);
    }
    render();
  });

  manager.on("job:failed", (payload) => {
    totalJobsFailed++;
    const job = jobs.get(payload.job.id);
    if (job) {
      job.status = "failed";
      job.completedAt = new Date();
      job.exitReason = payload.exitReason;
      job.error = payload.error.message;
      completedJobs.push({ ...job });
      jobs.delete(payload.job.id);
    }
    render();
  });

  manager.on("job:cancelled", (payload) => {
    const job = jobs.get(payload.job.id);
    if (job) {
      job.status = "cancelled";
      job.completedAt = new Date();
      completedJobs.push({ ...job });
      jobs.delete(payload.job.id);
    }
    render();
  });

  // =========================================================================
  // Start the Fleet
  // =========================================================================

  await manager.initialize();
  await manager.start();

  // Initial render
  render();

  // Keep rendering spinner animation
  const renderInterval = setInterval(render, 100);

  // =========================================================================
  // Graceful Shutdown
  // =========================================================================

  process.on("SIGINT", async () => {
    clearInterval(renderInterval);

    // Clear screen and show shutdown message
    process.stdout.write("\x1b[2J\x1b[H");
    console.log("\nShutting down fleet...");

    if (jobs.size > 0) {
      console.log(`Waiting for ${jobs.size} active job(s) to complete...`);
    }

    await manager.stop({
      timeout: 30000,
      cancelOnTimeout: true,
    });

    console.log("\nFleet stopped.");
    console.log(`Total jobs run: ${totalJobsRun}`);
    console.log(`Total failed: ${totalJobsFailed}`);

    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
