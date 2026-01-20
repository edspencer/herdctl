/**
 * Job History Viewer Example
 *
 * This example demonstrates:
 * - Using JobManager for job queries
 * - Filtering jobs by agent, status, and date
 * - Pagination through large job lists
 * - Building statistics from job history
 * - Viewing job details with output preview
 *
 * Run with: npx tsx examples/library-usage/job-history-viewer.ts
 */

import { JobManager, isJobNotFoundError } from "@herdctl/core";
import type { Job, JobFilter, JobStatus } from "@herdctl/core";

// =============================================================================
// Configuration
// =============================================================================

const JOBS_DIR = "./.herdctl/jobs";
const PAGE_SIZE = 10;

// =============================================================================
// JobHistoryViewer Class
// =============================================================================

interface ViewerOptions {
  jobsDir: string;
  pageSize?: number;
}

interface JobSummary {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
  duration: string | null;
  trigger: string;
}

interface JobDetails {
  metadata: {
    id: string;
    agent: string;
    status: JobStatus;
    startedAt: string;
    finishedAt: string | null | undefined;
    triggerType: string;
    schedule: string | null | undefined;
    exitReason: string | null | undefined;
    prompt: string | null | undefined;
    forkedFrom: string | null | undefined;
  };
  outputPreview: string;
  outputLineCount: number;
}

interface Statistics {
  total: number;
  byStatus: Record<string, number>;
  byAgent: Record<string, number>;
  byTriggerType: Record<string, number>;
  averageDurationSeconds: number | null;
}

class JobHistoryViewer {
  private jobManager: JobManager;
  private pageSize: number;

  constructor(options: ViewerOptions) {
    this.jobManager = new JobManager({
      jobsDir: options.jobsDir,
    });
    this.pageSize = options.pageSize ?? PAGE_SIZE;
  }

  /**
   * List jobs with pagination
   */
  async listJobs(
    page: number = 0,
    filter?: {
      agent?: string;
      status?: JobStatus;
      since?: Date;
      until?: Date;
    }
  ): Promise<{
    jobs: JobSummary[];
    page: number;
    totalPages: number;
    total: number;
  }> {
    const jobFilter: JobFilter = {
      agent: filter?.agent,
      status: filter?.status,
      startedAfter: filter?.since,
      startedBefore: filter?.until,
      limit: this.pageSize,
      offset: page * this.pageSize,
    };

    const { jobs, total } = await this.jobManager.getJobs(jobFilter);

    return {
      jobs: jobs.map((job) => this.toJobSummary(job)),
      page,
      totalPages: Math.ceil(total / this.pageSize),
      total,
    };
  }

  /**
   * Get detailed job information
   */
  async getJobDetails(jobId: string): Promise<JobDetails | null> {
    try {
      const job = await this.jobManager.getJob(jobId, {
        includeOutput: true,
      });

      // Extract assistant output for preview
      const assistantOutput = (job.output ?? [])
        .filter((msg) => msg.type === "assistant")
        .map((msg) => ("content" in msg ? msg.content : "") ?? "")
        .join("");

      return {
        metadata: {
          id: job.id,
          agent: job.agent,
          status: job.status,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
          triggerType: job.trigger_type,
          schedule: job.schedule,
          exitReason: job.exit_reason,
          prompt: job.prompt,
          forkedFrom: job.forked_from,
        },
        outputPreview:
          assistantOutput.slice(0, 500) +
          (assistantOutput.length > 500 ? "..." : ""),
        outputLineCount: (job.output ?? []).length,
      };
    } catch (error) {
      if (isJobNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get job statistics
   */
  async getStatistics(since?: Date): Promise<Statistics> {
    const { jobs } = await this.jobManager.getJobs({
      startedAfter: since,
    });

    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byTriggerType: Record<string, number> = {};
    let totalDuration = 0;
    let durationCount = 0;

    for (const job of jobs) {
      // Count by status
      byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;

      // Count by agent
      byAgent[job.agent] = (byAgent[job.agent] ?? 0) + 1;

      // Count by trigger type
      byTriggerType[job.trigger_type] =
        (byTriggerType[job.trigger_type] ?? 0) + 1;

      // Calculate duration for completed jobs
      if (job.finished_at) {
        const start = new Date(job.started_at).getTime();
        const end = new Date(job.finished_at).getTime();
        totalDuration += (end - start) / 1000;
        durationCount++;
      }
    }

    return {
      total: jobs.length,
      byStatus,
      byAgent,
      byTriggerType,
      averageDurationSeconds:
        durationCount > 0 ? totalDuration / durationCount : null,
    };
  }

  /**
   * Search jobs by prompt content
   */
  async searchByPrompt(
    searchTerm: string,
    limit: number = 20
  ): Promise<JobSummary[]> {
    const { jobs } = await this.jobManager.getJobs({
      limit: 1000, // Search through recent jobs
    });

    const matches = jobs
      .filter(
        (job) =>
          job.prompt &&
          job.prompt.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .slice(0, limit);

    return matches.map((job) => this.toJobSummary(job));
  }

  /**
   * Get recent failed jobs
   */
  async getRecentFailures(limit: number = 10): Promise<JobSummary[]> {
    const { jobs } = await this.jobManager.getJobs({
      status: "failed",
      limit,
    });

    return jobs.map((job) => this.toJobSummary(job));
  }

  /**
   * Get jobs for a specific agent
   */
  async getAgentJobs(
    agentName: string,
    limit: number = 20
  ): Promise<JobSummary[]> {
    const { jobs } = await this.jobManager.getJobs({
      agent: agentName,
      limit,
    });

    return jobs.map((job) => this.toJobSummary(job));
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private toJobSummary(job: Job): JobSummary {
    return {
      id: job.id,
      agent: job.agent,
      status: job.status,
      startedAt: job.started_at,
      duration: this.formatDuration(job.started_at, job.finished_at ?? null),
      trigger: job.schedule
        ? `schedule:${job.schedule}`
        : job.forked_from
          ? `fork:${job.forked_from.slice(0, 12)}...`
          : "manual",
    };
  }

  private formatDuration(
    startedAt: string,
    finishedAt: string | null
  ): string | null {
    if (!finishedAt) return null;

    const start = new Date(startedAt).getTime();
    const end = new Date(finishedAt).getTime();
    const seconds = Math.floor((end - start) / 1000);

    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

// =============================================================================
// Console Formatting Helpers
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return colorize(status, "green");
    case "failed":
      return colorize(status, "red");
    case "running":
      return colorize(status, "yellow");
    case "cancelled":
      return colorize(status, "magenta");
    case "pending":
      return colorize(status, "cyan");
    default:
      return status;
  }
}

function printJobTable(jobs: JobSummary[]): void {
  if (jobs.length === 0) {
    console.log(colorize("  No jobs found.", "dim"));
    return;
  }

  // Print header
  console.log(
    colorize(
      `  ${"ID".padEnd(35)} ${"Agent".padEnd(20)} ${"Status".padEnd(12)} ${"Duration".padEnd(10)} ${"Trigger"}`,
      "dim"
    )
  );
  console.log(colorize("  " + "-".repeat(100), "dim"));

  // Print rows
  for (const job of jobs) {
    const id = job.id.slice(0, 33) + (job.id.length > 33 ? ".." : "");
    const agent = job.agent.slice(0, 18) + (job.agent.length > 18 ? ".." : "");
    const duration = job.duration ?? colorize("running", "yellow");

    console.log(
      `  ${id.padEnd(35)} ${agent.padEnd(20)} ${statusColor(job.status).padEnd(21)} ${duration.padEnd(10)} ${job.trigger}`
    );
  }
}

function printStatistics(stats: Statistics): void {
  console.log(`  Total jobs: ${colorize(String(stats.total), "bold")}`);
  console.log("");

  // Status breakdown
  console.log("  By Status:");
  for (const [status, count] of Object.entries(stats.byStatus)) {
    const bar = "█".repeat(Math.min(count, 50));
    console.log(`    ${statusColor(status).padEnd(20)} ${String(count).padStart(5)} ${colorize(bar, "dim")}`);
  }
  console.log("");

  // Agent breakdown
  console.log("  By Agent:");
  const sortedAgents = Object.entries(stats.byAgent).sort(
    ([, a], [, b]) => b - a
  );
  for (const [agent, count] of sortedAgents.slice(0, 5)) {
    const bar = "█".repeat(Math.min(count, 50));
    console.log(`    ${agent.padEnd(20)} ${String(count).padStart(5)} ${colorize(bar, "cyan")}`);
  }
  if (sortedAgents.length > 5) {
    console.log(colorize(`    ... and ${sortedAgents.length - 5} more agents`, "dim"));
  }
  console.log("");

  // Trigger type breakdown
  console.log("  By Trigger Type:");
  for (const [trigger, count] of Object.entries(stats.byTriggerType)) {
    console.log(`    ${trigger.padEnd(15)} ${count}`);
  }
  console.log("");

  // Average duration
  if (stats.averageDurationSeconds !== null) {
    const avgDuration =
      stats.averageDurationSeconds < 60
        ? `${stats.averageDurationSeconds.toFixed(1)}s`
        : `${(stats.averageDurationSeconds / 60).toFixed(1)}m`;
    console.log(`  Average Duration: ${colorize(avgDuration, "cyan")}`);
  }
}

// =============================================================================
// Demo / CLI
// =============================================================================

async function runDemo() {
  const viewer = new JobHistoryViewer({
    jobsDir: JOBS_DIR,
    pageSize: PAGE_SIZE,
  });

  console.log(colorize("\n╔════════════════════════════════════════════════════════════════╗", "cyan"));
  console.log(colorize("║                      JOB HISTORY VIEWER                        ║", "cyan"));
  console.log(colorize("╚════════════════════════════════════════════════════════════════╝\n", "cyan"));

  // Show recent jobs
  console.log(colorize("═══ Recent Jobs ═══", "bold"));
  console.log("");

  const result = await viewer.listJobs(0);
  printJobTable(result.jobs);
  console.log("");
  console.log(
    colorize(
      `  Page ${result.page + 1} of ${result.totalPages} (${result.total} total jobs)`,
      "dim"
    )
  );
  console.log("");

  // Show statistics
  console.log(colorize("═══ Statistics (Last 7 Days) ═══", "bold"));
  console.log("");

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stats = await viewer.getStatistics(weekAgo);
  printStatistics(stats);
  console.log("");

  // Show recent failures
  console.log(colorize("═══ Recent Failures ═══", "bold"));
  console.log("");

  const failures = await viewer.getRecentFailures(5);
  if (failures.length === 0) {
    console.log(colorize("  No recent failures.", "green"));
  } else {
    printJobTable(failures);
  }
  console.log("");

  // Show a job detail if we have jobs
  if (result.jobs.length > 0) {
    const firstJobId = result.jobs[0].id;
    console.log(colorize("═══ Job Details ═══", "bold"));
    console.log(colorize(`  Showing details for: ${firstJobId}`, "dim"));
    console.log("");

    const details = await viewer.getJobDetails(firstJobId);
    if (details) {
      console.log(`  ${colorize("ID:", "dim")} ${details.metadata.id}`);
      console.log(`  ${colorize("Agent:", "dim")} ${details.metadata.agent}`);
      console.log(`  ${colorize("Status:", "dim")} ${statusColor(details.metadata.status)}`);
      console.log(`  ${colorize("Started:", "dim")} ${details.metadata.startedAt}`);
      console.log(`  ${colorize("Finished:", "dim")} ${details.metadata.finishedAt ?? "still running"}`);
      console.log(`  ${colorize("Trigger:", "dim")} ${details.metadata.triggerType}${details.metadata.schedule ? ` (${details.metadata.schedule})` : ""}`);
      console.log(`  ${colorize("Exit Reason:", "dim")} ${details.metadata.exitReason ?? "n/a"}`);

      if (details.metadata.prompt) {
        const promptPreview =
          details.metadata.prompt.slice(0, 80) +
          (details.metadata.prompt.length > 80 ? "..." : "");
        console.log(`  ${colorize("Prompt:", "dim")} ${promptPreview}`);
      }

      console.log(`  ${colorize("Output Lines:", "dim")} ${details.outputLineCount}`);

      if (details.outputPreview) {
        console.log("");
        console.log(colorize("  Output Preview:", "dim"));
        console.log(colorize("  ─────────────────────────────────────────", "dim"));
        const lines = details.outputPreview.split("\n").slice(0, 5);
        for (const line of lines) {
          console.log(`  ${line.slice(0, 70)}${line.length > 70 ? "..." : ""}`);
        }
        if (details.outputPreview.split("\n").length > 5) {
          console.log(colorize("  ...", "dim"));
        }
      }
    }
    console.log("");
  }

  console.log(colorize("─".repeat(66), "dim"));
  console.log(colorize("  Use JobManager directly for programmatic access.", "dim"));
  console.log(colorize("  See: docs/library-reference/job-manager.mdx", "dim"));
  console.log("");
}

// Run the demo
runDemo().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
