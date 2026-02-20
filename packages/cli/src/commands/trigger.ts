/**
 * herdctl trigger - Manually trigger an agent
 *
 * Commands:
 * - herdctl trigger <agent>                    Trigger with default schedule
 * - herdctl trigger <agent> --schedule <name>  Trigger specific schedule
 * - herdctl trigger <agent> --prompt "..."     Custom prompt
 * - herdctl trigger <agent> --wait             Wait for job to complete
 * - herdctl trigger <agent> --json             JSON output
 */

import {
  ConfigNotFoundError,
  FleetManager,
  isAgentNotFoundError,
  isConcurrencyLimitError,
  isFleetManagerError,
  isScheduleNotFoundError,
  type LogEntry,
  type SDKMessage,
  type TriggerResult,
} from "@herdctl/core";

export interface TriggerOptions {
  schedule?: string;
  prompt?: string;
  wait?: boolean;
  json?: boolean;
  state?: string;
  config?: string;
  /** Suppress the default output display */
  quiet?: boolean;
}

/**
 * Maximum characters to display for agent output
 */
const MAX_OUTPUT_CHARS = 20000;

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

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
  const message = entry.message;

  return `${timestamp} ${message}`;
}

/**
 * Extract text content from SDK message content blocks
 */
function extractContent(message: SDKMessage): string | undefined {
  // Check for nested message content (SDK structure)
  const apiMessage = message.message as { content?: unknown } | undefined;
  const content = apiMessage?.content ?? message.content;

  if (!content) return undefined;

  // If it's a string, return directly
  if (typeof content === "string") {
    return content;
  }

  // If it's an array of content blocks, extract text
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "type" in block) {
        if (block.type === "text" && "text" in block && typeof block.text === "string") {
          textParts.push(block.text);
        }
      }
    }
    return textParts.length > 0 ? textParts.join("") : undefined;
  }

  return undefined;
}

/**
 * Format an SDK message for streaming output
 *
 * Only streams assistant messages - result messages are skipped since
 * they contain the same content that was already streamed via assistant messages.
 */
function formatStreamingMessage(message: SDKMessage, isJson: boolean): string | null {
  if (isJson) {
    // In JSON mode, include all meaningful messages
    if (message.type === "assistant" || message.type === "result") {
      return JSON.stringify({ type: "message", data: message });
    }
    return null;
  }

  // Handle assistant messages with content
  if (message.type === "assistant") {
    const content = extractContent(message);
    if (content) {
      return content;
    }
    return null; // Skip empty assistant messages
  }

  // Skip result messages - they duplicate assistant content
  // Skip other message types for cleaner output
  return null;
}

/**
 * JSON output structure for trigger result
 */
interface TriggerResultJson {
  success: boolean;
  job: {
    id: string;
    agent: string;
    schedule: string | null;
    startedAt: string;
    prompt?: string;
  };
}

/**
 * JSON output structure for job completion
 */
interface JobCompletionJson {
  success: boolean;
  job: {
    id: string;
    agent: string;
    schedule: string | null;
    startedAt: string;
    finishedAt?: string;
    exitCode?: number;
    status: string;
  };
}

/**
 * Trigger an agent (herdctl trigger)
 */
export async function triggerCommand(agentName: string, options: TriggerOptions): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;
  const isJsonOutput = options.json === true;
  const isWaitMode = options.wait === true;

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
      console.log(colorize("Interrupted. Job continues running in background.", "yellow"));
    }
    process.exit(130); // 128 + SIGINT (2)
  }

  // Register signal handlers for wait mode
  if (isWaitMode) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  try {
    // Initialize to load configuration
    await manager.initialize();

    // Track if we've printed any streaming content
    let hasStreamedContent = false;
    const _streamBuffer = ""; // Buffer for accumulating partial content

    /**
     * Callback for streaming messages during execution
     */
    const onMessage = (message: SDKMessage): void => {
      if (isJsonOutput) {
        // In JSON mode, output each message as JSON
        const formatted = formatStreamingMessage(message, true);
        if (formatted) {
          console.log(formatted);
          hasStreamedContent = true;
        }
      } else if (!options.quiet) {
        // In normal mode, stream assistant content
        const formatted = formatStreamingMessage(message, false);
        if (formatted) {
          // Print the content with a newline for clean output
          console.log(formatted);
          hasStreamedContent = true;
        }
      }
    };

    // Trigger the agent
    let result: TriggerResult;
    try {
      result = await manager.trigger(agentName, options.schedule, {
        prompt: options.prompt,
        onMessage,
      });
    } catch (error) {
      // Handle specific trigger errors
      if (isAgentNotFoundError(error)) {
        if (isJsonOutput) {
          console.log(
            JSON.stringify({
              error: {
                code: "AGENT_NOT_FOUND",
                message: error.message,
                agentName: agentName,
              },
            }),
          );
          process.exit(1);
        }
        console.error("");
        console.error(`Error: Agent '${agentName}' not found.`);
        console.error("");
        console.error("Run 'herdctl status' to see all agents.");
        process.exit(1);
      }

      if (isScheduleNotFoundError(error)) {
        if (isJsonOutput) {
          console.log(
            JSON.stringify({
              error: {
                code: "SCHEDULE_NOT_FOUND",
                message: error.message,
                agentName: agentName,
                scheduleName: options.schedule,
              },
            }),
          );
          process.exit(1);
        }
        console.error("");
        console.error(`Error: Schedule '${options.schedule}' not found for agent '${agentName}'.`);
        console.error("");
        console.error(`Run 'herdctl status ${agentName}' to see available schedules.`);
        process.exit(1);
      }

      if (isConcurrencyLimitError(error)) {
        if (isJsonOutput) {
          console.log(
            JSON.stringify({
              error: {
                code: "CONCURRENCY_LIMIT",
                message: error.message,
                agentName: agentName,
              },
            }),
          );
          process.exit(1);
        }
        console.error("");
        console.error(`Error: Agent '${agentName}' is at concurrency limit.`);
        console.error(error.message);
        console.error("");
        console.error("Wait for current jobs to complete or check 'herdctl status'.");
        process.exit(1);
      }

      throw error;
    }

    // Add newline after streamed content if we printed anything
    if (hasStreamedContent && !isJsonOutput) {
      console.log(""); // Ensure we're on a new line after streaming
      console.log("");
    }

    // Show job info
    if (isJsonOutput) {
      const output: TriggerResultJson = {
        success: true,
        job: {
          id: result.jobId,
          agent: result.agentName,
          schedule: result.scheduleName,
          startedAt: result.startedAt,
          prompt: result.prompt,
        },
      };
      console.log(JSON.stringify(output));
    } else {
      console.log(colorize("Job completed", "green"));
      console.log(`Job ID:   ${colorize(result.jobId, "cyan")}`);
      console.log(`Agent:    ${result.agentName}`);
      if (result.scheduleName) {
        console.log(`Schedule: ${result.scheduleName}`);
      }
      if (result.prompt) {
        const truncatedPrompt =
          result.prompt.length > 60 ? `${result.prompt.substring(0, 60)}...` : result.prompt;
        console.log(`Prompt:   ${colorize(truncatedPrompt, "dim")}`);
      }
      console.log("");
    }

    // Display final output only if we didn't stream anything (fallback)
    if (!isJsonOutput && options.quiet !== true && !hasStreamedContent) {
      const finalOutput = await manager.getJobFinalOutput(result.jobId);
      if (finalOutput) {
        console.log(colorize("─".repeat(60), "dim"));
        if (finalOutput.length > MAX_OUTPUT_CHARS) {
          const remaining = finalOutput.length - MAX_OUTPUT_CHARS;
          console.log(finalOutput.substring(0, MAX_OUTPUT_CHARS));
          console.log("");
          console.log(
            colorize(`... [truncated: ${remaining.toLocaleString()} more characters]`, "yellow"),
          );
        } else {
          console.log(finalOutput);
        }
        console.log(colorize("─".repeat(60), "dim"));
        console.log("");
      }
    }

    // If not wait mode, we're done
    if (!isWaitMode) {
      if (!isJsonOutput) {
        console.log(`Run 'herdctl logs --job ${result.jobId}' to view detailed logs.`);
      }
      return;
    }

    // Wait mode: stream job output until completion
    if (!isJsonOutput) {
      console.log(colorize("Streaming job output...", "dim"));
      console.log("");
    }

    let exitCode = 0;
    let jobStatus = "completed";
    let finishedAt: string | undefined;

    try {
      // Stream job output
      for await (const entry of manager.streamJobOutput(result.jobId)) {
        if (isShuttingDown) {
          break;
        }

        if (isJsonOutput) {
          console.log(JSON.stringify(entry));
        } else {
          console.log(formatLogEntry(entry));
        }
      }

      // Job stream ended - fetch final job status
      // Note: In a full implementation, we would fetch the job metadata here
      // to get the actual exit code and status. For now, we assume success
      // if the stream completed without error.
      finishedAt = new Date().toISOString();
    } catch (_streamError) {
      // Stream error - job may have failed
      if (!isShuttingDown) {
        exitCode = 1;
        jobStatus = "error";
        finishedAt = new Date().toISOString();
      }
    }

    // Output final status in JSON mode
    if (isJsonOutput && !isShuttingDown) {
      const output: JobCompletionJson = {
        success: exitCode === 0,
        job: {
          id: result.jobId,
          agent: result.agentName,
          schedule: result.scheduleName,
          startedAt: result.startedAt,
          finishedAt,
          exitCode,
          status: jobStatus,
        },
      };
      // Print a newline before final status in JSON mode
      console.log("");
      console.log(JSON.stringify(output));
    } else if (!isShuttingDown) {
      console.log("");
      if (exitCode === 0) {
        console.log(colorize("Job completed successfully.", "green"));
      } else {
        console.log(colorize(`Job finished with exit code ${exitCode}.`, "red"));
      }
    }

    // Exit with job's exit code
    process.exit(exitCode);
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
