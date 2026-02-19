/**
 * herdctl start - Start the fleet
 *
 * Commands:
 * - herdctl start                              Start all agents
 * - herdctl start --config ./path/to/config    Custom config path
 * - herdctl start --state ./path/to/state      Custom state directory
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  FleetManager,
  ConfigNotFoundError,
  isFleetManagerError,
  setLogHandler,
  shouldLog,
  type FleetConfigOverrides,
  type FleetStatus,
  type LogEntry,
  type LogLevel,
} from "@herdctl/core";

import {
  colorize,
  colors,
  getLevelColor,
  getMessageColor,
  getSourceColor,
} from "../utils/colors.js";

export interface StartOptions {
  config?: string;
  state?: string;
  verbose?: boolean;
  web?: boolean;
  webPort?: number;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Format a FleetStatus for startup display
 */
function formatStartupStatus(status: FleetStatus): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("Fleet Status");
  lines.push("============");
  lines.push(`State: ${status.state}`);
  lines.push(`Agents: ${status.counts.totalAgents}`);
  lines.push(`Schedules: ${status.counts.totalSchedules}`);

  if (status.startedAt) {
    lines.push(`Started: ${new Date(status.startedAt).toLocaleString()}`);
  }

  lines.push("");
  lines.push("Press Ctrl+C to stop the fleet");
  lines.push("");

  return lines.join("\n");
}

/**
 * Format timestamp to local timezone
 */
function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return date.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Format a log entry for console output with colors
 */
function formatLogEntry(entry: LogEntry): string {
  const timestamp = colorize(formatTimestamp(entry.timestamp), "dim");
  const level = colorize(entry.level.toUpperCase().padEnd(5), getLevelColor(entry.level));

  // Build source label
  let sourceLabel = "";
  if (entry.agentName) {
    sourceLabel = colorize(`[${entry.agentName}]`, getSourceColor("agent", entry.data));
  } else if (entry.source) {
    sourceLabel = colorize(`[${entry.source}]`, getSourceColor(entry.source, entry.data));
  }

  // Add job ID if present (truncated for readability)
  const jobInfo = entry.jobId
    ? colorize(` (${entry.jobId.substring(0, 12)})`, "dim")
    : "";

  // Format the message with output type coloring if available
  let message = entry.message;
  const outputType = entry.data?.outputType as string | undefined;
  if (outputType) {
    message = colorize(message, getSourceColor("", entry.data));
  }

  return `${timestamp} ${level} ${sourceLabel}${jobInfo} ${message}`;
}

/**
 * Write PID file to state directory
 */
async function writePidFile(stateDir: string): Promise<string> {
  const pidFile = path.join(stateDir, "herdctl.pid");
  const pid = process.pid.toString();

  // Ensure state directory exists
  await fs.promises.mkdir(stateDir, { recursive: true });

  await fs.promises.writeFile(pidFile, pid, "utf-8");
  return pidFile;
}

/**
 * Remove PID file from state directory
 */
async function removePidFile(stateDir: string): Promise<void> {
  const pidFile = path.join(stateDir, "herdctl.pid");

  try {
    await fs.promises.unlink(pidFile);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Start the fleet
 */
export async function startCommand(options: StartOptions): Promise<void> {
  // Set log level based on verbose flag (must happen before FleetManager creation)
  if (options.verbose) {
    process.env.HERDCTL_LOG_LEVEL = 'debug';
  }

  // Register global colorized log handler for all createLogger instances
  setLogHandler((level, prefix, message, data) => {
    if (!shouldLog(level)) return;
    const levelStr = colorize(level.toUpperCase().padEnd(5), getLevelColor(level));
    const prefixStr = colorize(`[${prefix}]`, getSourceColor(prefix));
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    const msgColor = getMessageColor(message);
    const msgStr = msgColor ? `${msgColor}${message}${dataStr}${colors.reset}` : `${message}${dataStr}`;
    console.log(`${levelStr} ${prefixStr} ${msgStr}`);
  });

  const stateDir = options.state || DEFAULT_STATE_DIR;

  // Build config overrides from CLI flags
  let configOverrides: FleetConfigOverrides | undefined;
  if (options.web !== undefined || options.webPort !== undefined) {
    configOverrides = {
      web: {
        ...(options.web !== undefined && { enabled: options.web }),
        ...(options.webPort !== undefined && { port: options.webPort }),
      },
    };
  }

  console.log("Starting fleet...");

  // Create FleetManager (uses global log handler automatically)
  const manager = new FleetManager({
    configPath: options.config,
    stateDir,
    configOverrides,
  });

  // Track if we're shutting down to prevent multiple shutdown attempts
  let isShuttingDown = false;

  /**
   * Graceful shutdown handler
   */
  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log("");
    console.log(`Received ${signal}, shutting down gracefully...`);

    try {
      await manager.stop({
        waitForJobs: true,
        timeout: 30000,
        cancelOnTimeout: true,
      });

      await removePidFile(stateDir);

      console.log("Fleet stopped successfully.");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error instanceof Error ? error.message : String(error));
      await removePidFile(stateDir);
      process.exit(1);
    }
  }

  // Register signal handlers
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    // Initialize the fleet manager
    await manager.initialize();

    // Start the fleet
    await manager.start();

    // Write PID file
    const pidFile = await writePidFile(stateDir);
    console.log(`PID file written: ${pidFile}`);

    // Get and display startup status
    const status = await manager.getFleetStatus();
    console.log(formatStartupStatus(status));

    // Stream logs to stdout
    // This keeps the process running since it's an async iterator
    try {
      for await (const entry of manager.streamLogs({ level: "info", includeHistory: false })) {
        console.log(formatLogEntry(entry));
      }
    } catch (error) {
      // If the log stream ends (e.g., during shutdown), that's expected
      if (!isShuttingDown) {
        throw error;
      }
    }

  } catch (error) {
    // Handle specific error types
    if (error instanceof ConfigNotFoundError) {
      console.error("");
      console.error("Error: No configuration file found.");
      console.error(`Searched from: ${error.startDirectory}`);
      console.error("");
      console.error("Run 'herdctl init' to create a configuration file.");
      process.exit(1);
    }

    if (isFleetManagerError(error)) {
      console.error("");
      console.error(`Error: ${error.message}`);
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
      process.exit(1);
    }

    // Generic error
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
