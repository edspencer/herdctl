/**
 * herdctl job - Show job details and logs
 *
 * Commands:
 * - herdctl job <id>          Show job details
 * - herdctl job <id> --logs   Show job output
 * - herdctl job <id> --json   JSON output
 */

import { isJobNotFoundError, type Job, JobManager } from "@herdctl/core";

export interface JobOptions {
  logs?: boolean;
  json?: boolean;
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

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
function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return "-";
  }

  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m ${Math.floor(seconds % 60)}s`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${Math.floor(seconds % 60)}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${Math.floor(seconds % 60)}s`;
  } else {
    return `${Math.floor(seconds)}s`;
  }
}

/**
 * Format timestamp to local timezone
 */
function formatTimestamp(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) {
    return "-";
  }
  const date = new Date(isoTimestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Format job details for console output
 */
function formatJobDetails(job: Job): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(colorize(`Job: ${job.id}`, "bold"));
  lines.push("═".repeat(60));

  // Basic info
  lines.push(`Agent:        ${job.agent}`);
  if (job.schedule) {
    lines.push(`Schedule:     ${job.schedule}`);
  }
  lines.push(`Status:       ${formatStatus(job.status)}`);
  lines.push(`Trigger Type: ${job.trigger_type}`);

  // Timing
  lines.push("");
  lines.push(colorize("Timing", "bold"));
  lines.push("─".repeat(30));
  lines.push(`Started:      ${formatTimestamp(job.started_at)}`);
  lines.push(`Finished:     ${formatTimestamp(job.finished_at)}`);
  lines.push(`Duration:     ${formatDuration(job.duration_seconds)}`);

  // Exit info
  if (job.exit_reason) {
    lines.push("");
    lines.push(colorize("Exit Info", "bold"));
    lines.push("─".repeat(30));
    const exitColor = job.exit_reason === "success" ? "green" : "red";
    lines.push(`Exit Reason:  ${colorize(job.exit_reason, exitColor)}`);
  }

  // Session info
  if (job.session_id || job.forked_from) {
    lines.push("");
    lines.push(colorize("Session", "bold"));
    lines.push("─".repeat(30));
    if (job.session_id) {
      lines.push(`Session ID:   ${colorize(job.session_id, "dim")}`);
    }
    if (job.forked_from) {
      lines.push(`Forked From:  ${colorize(job.forked_from, "cyan")}`);
    }
  }

  // Prompt
  if (job.prompt) {
    lines.push("");
    lines.push(colorize("Prompt", "bold"));
    lines.push("─".repeat(30));
    // Truncate long prompts
    const maxPromptLength = 500;
    if (job.prompt.length > maxPromptLength) {
      lines.push(`${job.prompt.substring(0, maxPromptLength)}...`);
    } else {
      lines.push(job.prompt);
    }
  }

  // Summary
  if (job.summary) {
    lines.push("");
    lines.push(colorize("Summary", "bold"));
    lines.push("─".repeat(30));
    lines.push(job.summary);
  }

  // Output file
  if (job.output_file) {
    lines.push("");
    lines.push(colorize("Output File", "bold"));
    lines.push("─".repeat(30));
    lines.push(colorize(job.output_file, "dim"));
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * JSON output structure for job details
 */
interface JobDetailJson {
  job: {
    id: string;
    agent: string;
    schedule: string | null | undefined;
    status: string;
    triggerType: string;
    exitReason: string | null | undefined;
    sessionId: string | null | undefined;
    forkedFrom: string | null | undefined;
    startedAt: string;
    finishedAt: string | null | undefined;
    durationSeconds: number | null | undefined;
    prompt: string | null | undefined;
    summary: string | null | undefined;
    outputFile: string | null | undefined;
  };
}

/**
 * JobOutputMessage type for the output array
 * Based on the discriminated union from @herdctl/core
 */
type JobOutputMessage = {
  type: "system" | "assistant" | "tool_use" | "tool_result" | "error";
  timestamp: string;
  // Optional fields depending on type
  content?: string;
  tool_name?: string;
  tool_use_id?: string;
  input?: unknown;
  result?: unknown;
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
  subtype?: string;
};

/**
 * Format raw output message for console display
 */
function formatOutputMessage(entry: JobOutputMessage): void {
  switch (entry.type) {
    case "assistant":
      if (entry.content) {
        process.stdout.write(entry.content);
      }
      break;
    case "tool_use":
      if (entry.tool_name) {
        console.log(colorize(`[Tool: ${entry.tool_name}]`, "dim"));
      }
      break;
    case "tool_result":
      if (entry.result !== undefined) {
        const resultStr =
          typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result);
        const truncated = resultStr.length > 100 ? `${resultStr.substring(0, 100)}...` : resultStr;
        console.log(colorize(`[Result: ${truncated}]`, "dim"));
      }
      if (entry.error) {
        console.log(colorize(`[Tool Error: ${entry.error}]`, "red"));
      }
      break;
    case "error":
      if (entry.message) {
        console.log(colorize(`[Error: ${entry.message}]`, "red"));
      }
      break;
    case "system":
      if (entry.content) {
        console.log(colorize(`[System: ${entry.content}]`, "yellow"));
      }
      break;
  }
}

/**
 * Show job details (herdctl job)
 */
export async function jobCommand(jobId: string, options: JobOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const isJsonOutput = options.json === true;
  const showLogs = options.logs === true;

  // Track if we're shutting down (for log streaming)
  let isShuttingDown = false;

  /**
   * Graceful shutdown handler for log streaming
   */
  function shutdown(): void {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    if (!isJsonOutput) {
      console.log("");
      console.log(colorize("Interrupted.", "yellow"));
    }
    process.exit(130);
  }

  try {
    // Create JobManager directly (no config validation needed for read-only queries)
    const { join } = await import("node:path");
    const jobsDir = join(stateDir, "jobs");

    const jobManager = new JobManager({
      jobsDir,
    });

    // Get job with output if logs requested
    const job = await jobManager.getJob(jobId, {
      includeOutput: showLogs,
    });

    if (showLogs) {
      // Stream logs mode
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      if (isJsonOutput) {
        // Output job metadata first
        const jobJson: JobDetailJson = {
          job: {
            id: job.id,
            agent: job.agent,
            schedule: job.schedule,
            status: job.status,
            triggerType: job.trigger_type,
            exitReason: job.exit_reason,
            sessionId: job.session_id,
            forkedFrom: job.forked_from,
            startedAt: job.started_at,
            finishedAt: job.finished_at,
            durationSeconds: job.duration_seconds,
            prompt: job.prompt,
            summary: job.summary,
            outputFile: job.output_file,
          },
        };
        console.log(JSON.stringify(jobJson));

        // Output each log entry as NDJSON
        if (job.output) {
          for (const entry of job.output) {
            console.log(JSON.stringify(entry));
          }
        }
      } else {
        // Show job header
        console.log("");
        console.log(colorize(`Job: ${job.id}`, "bold"));
        console.log(
          `Agent: ${job.agent} | Status: ${formatStatus(job.status)} | Duration: ${formatDuration(job.duration_seconds)}`,
        );
        console.log("═".repeat(80));
        console.log("");

        // Show existing output
        if (job.output && job.output.length > 0) {
          for (const entry of job.output) {
            if (isShuttingDown) break;
            formatOutputMessage(entry as JobOutputMessage);
          }
          console.log("");
        } else {
          console.log(colorize("No output available for this job.", "dim"));
          console.log("");
        }

        // If job is still running, stream live output using JobManager
        if (job.status === "running" || job.status === "pending") {
          console.log(colorize("Streaming live output (Ctrl+C to stop)...", "dim"));
          console.log("");

          try {
            const stream = await jobManager.streamJobOutput(jobId);

            await new Promise<void>((resolve, reject) => {
              stream.on("message", (msg) => {
                if (isShuttingDown) {
                  stream.stop();
                  return;
                }
                formatOutputMessage(msg as JobOutputMessage);
              });

              stream.on("end", () => resolve());
              stream.on("error", (err) => reject(err));
            });

            if (!isShuttingDown) {
              console.log("");
              console.log(colorize("Job completed.", "green"));
            }
          } catch (streamError) {
            if (!isShuttingDown) {
              console.log("");
              console.log(
                colorize(
                  `Stream error: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
                  "red",
                ),
              );
            }
          }
        }
      }
    } else {
      // Details mode
      if (isJsonOutput) {
        const output: JobDetailJson = {
          job: {
            id: job.id,
            agent: job.agent,
            schedule: job.schedule,
            status: job.status,
            triggerType: job.trigger_type,
            exitReason: job.exit_reason,
            sessionId: job.session_id,
            forkedFrom: job.forked_from,
            startedAt: job.started_at,
            finishedAt: job.finished_at,
            durationSeconds: job.duration_seconds,
            prompt: job.prompt,
            summary: job.summary,
            outputFile: job.output_file,
          },
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(formatJobDetails(job));
        console.log(`Run 'herdctl job ${jobId} --logs' to view job output.`);
        console.log("");
      }
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
              jobId: jobId,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Job '${jobId}' not found.`);
      console.error("");
      console.error("Run 'herdctl jobs' to see recent jobs.");
      process.exit(1);
    }

    // Handle interruption during shutdown gracefully
    if (isShuttingDown) {
      return;
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
