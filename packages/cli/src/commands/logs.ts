/**
 * herdctl logs - Show agent logs
 *
 * Commands:
 * - herdctl logs               Recent logs from all agents
 * - herdctl logs <agent>       Logs from specific agent
 * - herdctl logs -f            Follow mode (stream new logs)
 * - herdctl logs -f <agent>    Follow specific agent
 * - herdctl logs --job <id>    Logs from specific job
 * - herdctl logs -n 100        Last 100 lines (default: 50)
 * - herdctl logs --json        JSON output for each log entry
 */

import {
  FleetManager,
  ConfigNotFoundError,
  AgentNotFoundError,
  JobNotFoundError,
  isFleetManagerError,
  JobManager,
  type LogEntry,
  type LogLevel,
  type JobOutputMessage,
} from "@herdctl/core";

export interface LogsOptions {
  follow?: boolean;
  job?: string;
  lines?: string;
  json?: boolean;
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Default number of log lines to show
 */
const DEFAULT_LINES = 50;

/**
 * Check if colors should be disabled
 */
function shouldUseColor(): boolean {
  // NO_COLOR takes precedence (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  // Also check FORCE_COLOR for override
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  // Check if stdout is a TTY
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
  magenta: "\x1b[35m",
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
 * Get color for log level
 */
function getLevelColor(level: LogLevel): keyof typeof colors {
  switch (level) {
    case "error":
      return "red";
    case "warn":
      return "yellow";
    case "info":
      return "green";
    case "debug":
      return "gray";
    default:
      return "reset";
  }
}

/**
 * Get color for log source (output type)
 */
function getSourceColor(source: string, data?: Record<string, unknown>): keyof typeof colors {
  // Check if there's an outputType in the data (from job output)
  const outputType = data?.outputType as string | undefined;
  if (outputType) {
    switch (outputType) {
      case "assistant":
        return "cyan";
      case "tool":
        return "magenta";
      case "result":
        return "blue";
      case "error":
        return "red";
      case "system":
        return "gray";
      default:
        return "reset";
    }
  }

  // Fallback to source-based coloring
  switch (source) {
    case "agent":
      return "cyan";
    case "job":
      return "blue";
    case "scheduler":
      return "magenta";
    case "fleet":
      return "green";
    default:
      return "reset";
  }
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

  // Add job ID if present
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
 * Format a log entry as JSON
 */
function formatLogEntryJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Format a job output message to a displayable string
 */
function formatJobOutputMessage(msg: JobOutputMessage): string {
  switch (msg.type) {
    case "assistant":
      return msg.content ?? "";
    case "tool_use":
      return `[Tool: ${msg.tool_name ?? "unknown"}]`;
    case "tool_result": {
      if (msg.error) {
        return `[Tool Error: ${msg.error}]`;
      }
      const result = msg.result;
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      const truncated = resultStr && resultStr.length > 100 ? `${resultStr.substring(0, 100)}...` : resultStr;
      return `[Result: ${truncated ?? ""}]`;
    }
    case "error":
      return `[Error: ${msg.message ?? "unknown error"}]`;
    case "system":
      return `[System: ${msg.content ?? ""}]`;
    default:
      return "[Unknown]";
  }
}

/**
 * Show logs (herdctl logs)
 */
export async function logsCommand(
  agentName: string | undefined,
  options: LogsOptions
): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const lines = Number.parseInt(options.lines || String(DEFAULT_LINES), 10);
  const isFollowMode = options.follow === true;
  const isJsonOutput = options.json === true;
  const jobId = options.job;

  // Validate lines option
  if (Number.isNaN(lines) || lines < 1) {
    console.error("Error: --lines must be a positive integer");
    process.exit(1);
  }

  // Create FleetManager
  const manager = new FleetManager({
    configPath: options.config,
    stateDir,
  });

  // Track if we're shutting down
  let isShuttingDown = false;

  /**
   * Graceful shutdown handler
   */
  function shutdown(): void {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    if (!isJsonOutput) {
      console.log("");
    }
    process.exit(0);
  }

  // Register signal handlers for follow mode
  if (isFollowMode) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  try {
    // For job-specific logs, use JobManager directly (no config validation needed)
    if (jobId) {
      const { join } = await import("node:path");
      const jobsDir = join(stateDir, "jobs");
      const jobManager = new JobManager({ jobsDir });

      try {
        // Get job to verify it exists and stream output
        const stream = await jobManager.streamJobOutput(jobId);
        const entries: LogEntry[] = [];

        // Convert JobOutputStream events to LogEntry format
        await new Promise<void>((resolve, reject) => {
          stream.on("message", (msg: JobOutputMessage) => {
            if (isShuttingDown) {
              stream.stop();
              return;
            }

            const entry: LogEntry = {
              timestamp: msg.timestamp,
              level: msg.type === "error" ? "error" : "info",
              source: "job",
              jobId,
              message: formatJobOutputMessage(msg),
              data: { outputType: msg.type },
            };

            if (isFollowMode) {
              if (isJsonOutput) {
                console.log(formatLogEntryJson(entry));
              } else {
                console.log(formatLogEntry(entry));
              }
            } else {
              entries.push(entry);
              if (entries.length > lines) {
                entries.shift();
              }
            }
          });

          stream.on("end", () => resolve());
          stream.on("error", (err) => reject(err));
        });

        // Output collected entries for non-follow mode
        if (!isFollowMode) {
          const toOutput = entries.slice(-lines);
          if (toOutput.length === 0) {
            if (!isJsonOutput) {
              console.log("No log entries found.");
            }
          } else {
            for (const entry of toOutput) {
              if (isJsonOutput) {
                console.log(formatLogEntryJson(entry));
              } else {
                console.log(formatLogEntry(entry));
              }
            }
          }
        }
        return;
      } catch (error) {
        if (error instanceof JobNotFoundError) {
          throw error;
        }
        throw error;
      }
    }

    // For agent logs or all logs, need FleetManager with config
    // Initialize to load configuration
    await manager.initialize();

    // Determine which stream to use
    let logStream: AsyncIterable<LogEntry>;

    if (agentName) {
      // Stream logs from specific agent
      logStream = manager.streamAgentLogs(agentName);
    } else {
      // Stream all logs
      logStream = manager.streamLogs({
        level: "info",
        includeHistory: true,
        historyLimit: isFollowMode ? lines : lines,
      });
    }

    // Collect entries for non-follow mode
    const entries: LogEntry[] = [];

    // Process log entries
    for await (const entry of logStream) {
      if (isShuttingDown) {
        break;
      }

      if (isFollowMode) {
        // In follow mode, output immediately
        if (isJsonOutput) {
          console.log(formatLogEntryJson(entry));
        } else {
          console.log(formatLogEntry(entry));
        }
      } else {
        // In non-follow mode, collect entries
        entries.push(entry);

        // Keep only the last N entries
        if (entries.length > lines) {
          entries.shift();
        }

        // For job-specific logs, we need to consume the entire stream
        // For general logs, we can stop early if not in follow mode
        if (!jobId && entries.length >= lines * 2) {
          // We have enough entries, stop collecting
          // (collect 2x to handle filtering)
          break;
        }
      }
    }

    // Output collected entries for non-follow mode
    if (!isFollowMode) {
      const toOutput = entries.slice(-lines);

      if (toOutput.length === 0) {
        if (!isJsonOutput) {
          console.log("No log entries found.");
        }
      } else {
        for (const entry of toOutput) {
          if (isJsonOutput) {
            console.log(formatLogEntryJson(entry));
          } else {
            console.log(formatLogEntry(entry));
          }
        }
      }
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
          })
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

    if (error instanceof AgentNotFoundError) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "AGENT_NOT_FOUND",
              message: error.message,
              agentName: agentName,
            },
          })
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Agent '${agentName}' not found.`);
      console.error("");
      console.error("Run 'herdctl status' to see all agents.");
      process.exit(1);
    }

    if (error instanceof JobNotFoundError) {
      if (isJsonOutput) {
        console.log(
          JSON.stringify({
            error: {
              code: "JOB_NOT_FOUND",
              message: error.message,
              jobId: jobId,
            },
          })
        );
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Job '${jobId}' not found.`);
      console.error("");
      console.error("Run 'herdctl status' to see running jobs.");
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
          })
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

    // Handle stream interruption during shutdown gracefully
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
        })
      );
      process.exit(1);
    }
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
