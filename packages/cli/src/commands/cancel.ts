/**
 * herdctl cancel - Cancel a running job
 *
 * Commands:
 * - herdctl cancel <id>          Cancel running job (with confirmation)
 * - herdctl cancel <id> --force  Force cancel (SIGKILL)
 * - herdctl cancel <id> --yes    Skip confirmation prompt
 */

import {
  ConfigNotFoundError,
  FleetManager,
  isFleetManagerError,
  isJobCancelError,
  isJobNotFoundError,
  JobManager,
} from "@herdctl/core";
import { confirm } from "@inquirer/prompts";

export interface CancelOptions {
  force?: boolean;
  yes?: boolean;
  json?: boolean;
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Default cancel timeout (10 seconds)
 */
const DEFAULT_CANCEL_TIMEOUT = 10000;

/**
 * Force cancel timeout (1 second for SIGTERM before SIGKILL)
 */
const FORCE_CANCEL_TIMEOUT = 1000;

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
 * JSON output structure for cancel result
 */
interface CancelResultJson {
  success: boolean;
  jobId: string;
  terminationType: "graceful" | "forced" | "already_stopped";
  canceledAt: string;
}

/**
 * Cancel a running job (herdctl cancel)
 */
export async function cancelCommand(jobId: string, options: CancelOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const isJsonOutput = options.json === true;
  const skipConfirmation = options.yes === true;
  const forceCancel = options.force === true;

  // Create FleetManager
  const manager = new FleetManager({
    configPath: options.config,
    stateDir,
  });

  try {
    // Initialize to load configuration
    await manager.initialize();

    // First, check if the job exists and is running
    const { join } = await import("node:path");
    const jobsDir = join(stateDir, "jobs");

    const jobManager = new JobManager({
      jobsDir,
    });

    // Get job to check status
    const job = await jobManager.getJob(jobId);

    // Check if job is running
    if (job.status !== "running" && job.status !== "pending") {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "JOB_NOT_RUNNING",
              message: `Job '${jobId}' is not running (status: ${job.status})`,
              jobId: jobId,
              status: job.status,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Job '${jobId}' is not running.`);
      console.error(`Current status: ${job.status}`);
      console.error("");
      console.error("Only running or pending jobs can be cancelled.");
      process.exit(1);
    }

    // Show job info and ask for confirmation (unless --yes)
    if (!skipConfirmation && !isJsonOutput) {
      console.log("");
      console.log(colorize("Job to cancel:", "bold"));
      console.log(`  ID:     ${colorize(job.id, "cyan")}`);
      console.log(`  Agent:  ${job.agent}`);
      console.log(`  Status: ${colorize(job.status, "green")}`);
      if (job.schedule) {
        console.log(`  Schedule: ${job.schedule}`);
      }
      console.log("");

      if (forceCancel) {
        console.log(
          colorize("WARNING: Force cancel will immediately kill the process (SIGKILL).", "yellow"),
        );
        console.log(colorize("This may leave the job in an inconsistent state.", "yellow"));
        console.log("");
      }

      const confirmed = await confirm({
        message: forceCancel
          ? "Are you sure you want to force cancel this job?"
          : "Are you sure you want to cancel this job?",
        default: false,
      });

      if (!confirmed) {
        console.log("");
        console.log("Cancelled.");
        process.exit(0);
      }
    }

    // Cancel the job
    const timeout = forceCancel ? FORCE_CANCEL_TIMEOUT : DEFAULT_CANCEL_TIMEOUT;

    if (!isJsonOutput) {
      console.log("");
      console.log(colorize(forceCancel ? "Force cancelling job..." : "Cancelling job...", "dim"));
    }

    const result = await manager.cancelJob(jobId, { timeout });

    // Output result
    if (isJsonOutput) {
      const output: CancelResultJson = {
        success: result.success,
        jobId: result.jobId,
        terminationType: result.terminationType,
        canceledAt: result.canceledAt,
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log("");
      if (result.success) {
        switch (result.terminationType) {
          case "graceful":
            console.log(colorize("Job cancelled successfully.", "green"));
            console.log(`The job responded to termination signal and exited cleanly.`);
            break;
          case "forced":
            console.log(colorize("Job force cancelled.", "yellow"));
            console.log(
              `The job was forcefully killed after failing to respond to termination signal.`,
            );
            break;
          case "already_stopped":
            console.log(colorize("Job was already stopped.", "yellow"));
            console.log(`The job was not running when cancel was attempted.`);
            break;
        }
      } else {
        console.log(colorize("Failed to cancel job.", "red"));
      }
      console.log("");
      console.log(`Job ID: ${colorize(result.jobId, "cyan")}`);
      console.log(`Cancelled at: ${new Date(result.canceledAt).toLocaleString()}`);
      console.log("");
    }

    // Exit with appropriate code
    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    // Handle specific error types
    if (error instanceof ConfigNotFoundError) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "CONFIG_NOT_FOUND",
              message: "No configuration file found",
              startDirectory: error.startDirectory,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error("Error: No configuration file found.");
      console.error(`Searched from: ${error.startDirectory}`);
      console.error("");
      console.error("Run 'herdctl init' to create a configuration file.");
      process.exit(1);
    }

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

    if (isJobCancelError(error)) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "JOB_CANCEL_ERROR",
              message: error.message,
              jobId: error.jobId,
              reason: error.reason,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Failed to cancel job '${jobId}'.`);
      console.error(error.message);
      process.exit(1);
    }

    if (isFleetManagerError(error)) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: error.code,
              message: error.message,
            },
          }),
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: ${error.message}`);
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
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
