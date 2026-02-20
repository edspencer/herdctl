/**
 * herdctl jobs - List jobs with filtering and pagination
 *
 * Commands:
 * - herdctl jobs                     List recent jobs (last 20)
 * - herdctl jobs --agent <name>      Jobs for specific agent
 * - herdctl jobs --status running    Filter by status
 * - herdctl jobs --limit 50          Custom limit
 * - herdctl jobs --json              JSON output
 */

import { isJobNotFoundError, type Job, type JobFilter, JobManager } from "@herdctl/core";

/**
 * Valid job statuses type
 */
type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobsOptions {
  agent?: string;
  status?: string;
  limit?: number;
  json?: boolean;
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Default job limit
 */
const DEFAULT_LIMIT = 20;

/**
 * Valid job statuses
 */
const VALID_STATUSES = ["pending", "running", "completed", "failed", "cancelled"];

/**
 * Check if colors should be disabled
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  return process.stdout.isTTY === true;
}

/**
 * ANSI color codes
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
};

/**
 * Get a colored string, respecting NO_COLOR
 */
function colorize(text: string, color: keyof typeof colors): string {
  if (!shouldUseColor()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Get status color based on job status
 */
function getStatusColor(status: string): keyof typeof colors {
  switch (status) {
    case "running":
      return "green";
    case "pending":
      return "yellow";
    case "completed":
      return "cyan";
    case "failed":
      return "red";
    case "cancelled":
      return "gray";
    default:
      return "reset";
  }
}

/**
 * Format job status with color
 */
function formatStatus(status: string): string {
  const color = getStatusColor(status);
  return colorize(status, color);
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) {
    return "-";
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${Math.floor(seconds % 60)}s`;
  } else {
    return `${Math.floor(seconds)}s`;
  }
}

/**
 * Format timestamp to local timezone
 */
function _formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format relative time (e.g., "5m ago")
 */
function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const timestamp = new Date(isoTimestamp).getTime();
  const diffMs = now - timestamp;
  const absDiffMs = Math.abs(diffMs);

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d`;
  } else if (hours > 0) {
    timeStr = `${hours}h`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m`;
  } else {
    timeStr = `${seconds}s`;
  }

  return `${timeStr} ago`;
}

/**
 * Format jobs table for console output
 */
function formatJobsTable(jobs: Job[], total: number, _limit: number): string {
  const lines: string[] = [];

  if (jobs.length === 0) {
    lines.push("");
    lines.push(colorize("No jobs found.", "dim"));
    lines.push("");
    return lines.join("\n");
  }

  // Header
  lines.push("");
  lines.push(colorize(`Jobs (${jobs.length}${total > jobs.length ? ` of ${total}` : ""})`, "bold"));
  lines.push("═".repeat(90));

  // Calculate column widths
  const idWidth = Math.max(10, ...jobs.map((j) => j.id.length)) + 2;
  const agentWidth = Math.max(6, ...jobs.map((j) => j.agent.length)) + 2;
  const statusWidth = 12;
  const durationWidth = 10;
  const startedWidth = 16;

  // Table header
  lines.push(
    `${"JOB ID".padEnd(idWidth)}${"AGENT".padEnd(agentWidth)}${"STATUS".padEnd(statusWidth)}${"DURATION".padEnd(durationWidth)}${"STARTED".padEnd(startedWidth)}`,
  );
  lines.push(
    colorize("─".repeat(idWidth + agentWidth + statusWidth + durationWidth + startedWidth), "dim"),
  );

  // Table rows
  for (const job of jobs) {
    const statusStr = formatStatus(job.status);
    const statusPad = shouldUseColor()
      ? statusWidth + colors[getStatusColor(job.status)].length + colors.reset.length
      : statusWidth;

    lines.push(
      `${colorize(job.id, "cyan").padEnd(idWidth + (shouldUseColor() ? colors.cyan.length + colors.reset.length : 0))}${job.agent.padEnd(agentWidth)}${statusStr.padEnd(statusPad)}${formatDuration(job.duration_seconds ?? null).padEnd(durationWidth)}${formatRelativeTime(job.started_at).padEnd(startedWidth)}`,
    );
  }

  if (total > jobs.length) {
    lines.push("");
    lines.push(
      colorize(`Showing ${jobs.length} of ${total} jobs. Use --limit to see more.`, "dim"),
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * JSON output structure for jobs list
 */
interface JobsListJson {
  jobs: Array<{
    id: string;
    agent: string;
    schedule: string | null | undefined;
    status: string;
    triggerType: string;
    startedAt: string;
    finishedAt: string | null | undefined;
    durationSeconds: number | null | undefined;
    exitReason: string | null | undefined;
    summary: string | null | undefined;
  }>;
  total: number;
  limit: number;
}

/**
 * List jobs (herdctl jobs)
 */
export async function jobsCommand(options: JobsOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const isJsonOutput = options.json === true;
  const limit = options.limit ?? DEFAULT_LIMIT;

  // Validate status if provided
  if (options.status && !VALID_STATUSES.includes(options.status)) {
    if (isJsonOutput) {
      console.log(
        JSON.stringify({
          error: {
            code: "INVALID_STATUS",
            message: `Invalid status '${options.status}'. Valid statuses: ${VALID_STATUSES.join(", ")}`,
          },
        }),
      );
      process.exit(1);
    }
    console.error("");
    console.error(`Error: Invalid status '${options.status}'.`);
    console.error(`Valid statuses: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }

  try {
    // Create JobManager directly (no config validation needed for read-only queries)
    const { join } = await import("node:path");
    const jobsDir = join(stateDir, "jobs");

    const jobManager = new JobManager({
      jobsDir,
    });

    // Build filter
    const filter: JobFilter = {
      limit,
    };

    if (options.agent) {
      filter.agent = options.agent;
    }

    if (options.status) {
      filter.status = options.status as JobStatus;
    }

    // Get jobs
    const result = await jobManager.getJobs(filter);

    if (isJsonOutput) {
      const output: JobsListJson = {
        jobs: result.jobs.map((job) => ({
          id: job.id,
          agent: job.agent,
          schedule: job.schedule,
          status: job.status,
          triggerType: job.trigger_type,
          startedAt: job.started_at,
          finishedAt: job.finished_at,
          durationSeconds: job.duration_seconds,
          exitReason: job.exit_reason,
          summary: job.summary,
        })),
        total: result.total,
        limit,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatJobsTable(result.jobs, result.total, limit));
    }
  } catch (error) {
    // Handle specific error types
    if (isJobNotFoundError(error)) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "JOB_NOT_FOUND",
              message: error.message,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    // Generic error
    if (isJsonOutput) {
      console.log(
        JSON.stringify({
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
      process.exit(1);
    }
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
