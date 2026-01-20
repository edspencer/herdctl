/**
 * Tail Job Output Example
 *
 * This example demonstrates:
 * - Real-time streaming of job output using JobManager
 * - Following job output like `tail -f`
 * - Colorized output based on message type
 * - Graceful handling of completed and running jobs
 *
 * Run with: npx tsx examples/library-usage/tail-job-output.ts <job-id>
 *
 * Options:
 *   --no-follow   Exit after replaying existing output
 *   --no-color    Disable colored output
 *   --raw         Output raw JSON messages
 */

import { JobManager, isJobNotFoundError } from "@herdctl/core";
import type { Job } from "@herdctl/core";

// =============================================================================
// Configuration
// =============================================================================

const JOBS_DIR = "./.herdctl/jobs";

// =============================================================================
// ANSI Color Helpers
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
  white: "\x1b[37m",
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// =============================================================================
// Output Message Type (simplified for this example)
// =============================================================================

interface OutputMessage {
  type: string;
  timestamp: string;
  content?: string;
  message?: string; // for error type
  tool_name?: string; // for tool_use type
  result?: unknown; // for tool_result type
}

// =============================================================================
// Output Formatter
// =============================================================================

interface FormatterOptions {
  colorize: boolean;
  raw: boolean;
  showTimestamp: boolean;
}

class OutputFormatter {
  private options: FormatterOptions;

  constructor(options: FormatterOptions) {
    this.options = options;
  }

  format(msg: OutputMessage): string {
    if (this.options.raw) {
      return JSON.stringify(msg);
    }

    const timestamp = this.formatTimestamp(msg.timestamp);
    const content = this.getContent(msg);

    if (!this.options.colorize) {
      const prefix = this.options.showTimestamp
        ? `[${timestamp}] [${msg.type}] `
        : `[${msg.type}] `;
      return prefix + content;
    }

    return this.formatColorized(msg, timestamp, content);
  }

  private getContent(msg: OutputMessage): string {
    // Handle different message types
    if (msg.content !== undefined) {
      return msg.content;
    }
    if (msg.message !== undefined) {
      return msg.message; // error type uses 'message' field
    }
    if (msg.tool_name !== undefined) {
      return `Calling ${msg.tool_name}`;
    }
    if (msg.result !== undefined) {
      return typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
    }
    return "";
  }

  private formatColorized(
    msg: OutputMessage,
    timestamp: string,
    content: string
  ): string {
    let prefix = "";
    let formattedContent = content;

    const ts = this.options.showTimestamp
      ? colorize(`[${timestamp}] `, "dim")
      : "";

    switch (msg.type) {
      case "assistant":
        // Claude's responses - green, no type prefix (cleaner output)
        prefix = ts;
        formattedContent = colorize(content, "green");
        break;

      case "tool_use":
        // Tool use - yellow with type indicator
        prefix = ts + colorize("[tool] ", "yellow");
        formattedContent = content;
        break;

      case "tool_result":
        // Tool result - dim with type indicator
        prefix = ts + colorize("[result] ", "dim");
        formattedContent = colorize(content, "dim");
        break;

      case "system":
        // System messages - magenta
        prefix = ts + colorize("[system] ", "magenta");
        formattedContent = colorize(content, "magenta");
        break;

      case "error":
        // Error messages - red and bold
        prefix = ts + colorize("[error] ", "red");
        formattedContent = colorize(content, "red");
        break;

      default:
        // Unknown types - dim with type indicator
        prefix = ts + colorize(`[${msg.type}] `, "dim");
        formattedContent = content;
    }

    return prefix + formattedContent;
  }

  private formatTimestamp(timestamp?: string): string {
    if (!timestamp) {
      return new Date().toLocaleTimeString();
    }

    // Only show time, not date
    return new Date(timestamp).toLocaleTimeString();
  }
}

// =============================================================================
// Job Output Tailer
// =============================================================================

interface TailOptions {
  jobId: string;
  jobsDir: string;
  follow: boolean;
  colorize: boolean;
  raw: boolean;
  showTimestamp: boolean;
}

async function tailJobOutput(options: TailOptions): Promise<void> {
  const { jobId, jobsDir, follow, colorize: useColors, raw, showTimestamp } = options;

  const jobManager = new JobManager({ jobsDir });
  const formatter = new OutputFormatter({
    colorize: useColors,
    raw,
    showTimestamp,
  });

  // First, get job info
  let job;
  try {
    job = await jobManager.getJob(jobId);
  } catch (error) {
    if (isJobNotFoundError(error)) {
      console.error(
        useColors
          ? colorize(`Error: Job "${error.jobId}" not found`, "red")
          : `Error: Job "${error.jobId}" not found`
      );
      process.exit(1);
    }
    throw error;
  }

  // Print header (unless raw mode)
  if (!raw) {
    printHeader(job, useColors);
  }

  // Track message count
  let messageCount = 0;

  // Stream output
  const stream = await jobManager.streamJobOutput(jobId);

  stream.on("message", (msg) => {
    messageCount++;
    // Cast to our simplified interface for formatting
    const outputMsg = msg as OutputMessage;
    const formatted = formatter.format(outputMsg);

    // Write without adding extra newline (content may already have newlines)
    process.stdout.write(formatted);

    // Add newline if content doesn't end with one
    const content = "content" in msg ? (msg as { content?: string }).content : "";
    if (!content?.endsWith("\n")) {
      process.stdout.write("\n");
    }
  });

  stream.on("end", () => {
    if (!raw) {
      console.log("");
      console.log(
        useColors
          ? colorize("─".repeat(60), "dim")
          : "─".repeat(60)
      );
      console.log(
        useColors
          ? colorize(`End of output (${messageCount} messages)`, "dim")
          : `End of output (${messageCount} messages)`
      );
    }

    if (!follow) {
      process.exit(0);
    }
  });

  stream.on("error", (err) => {
    console.error(
      useColors
        ? colorize(`\nStream error: ${err.message}`, "red")
        : `\nStream error: ${err.message}`
    );
    process.exit(1);
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    stream.stop();
    if (!raw) {
      console.log(
        useColors
          ? colorize("\n\nStreaming stopped.", "dim")
          : "\n\nStreaming stopped."
      );
    }
    process.exit(0);
  });
}

function printHeader(
  job: Job,
  useColors: boolean
): void {
  const line = "═".repeat(60);

  console.log(useColors ? colorize(line, "cyan") : line);
  console.log(
    `Job: ${useColors ? colorize(job.id, "cyan") : job.id}`
  );
  console.log(
    `Agent: ${useColors ? colorize(job.agent, "green") : job.agent}`
  );

  const statusColor =
    job.status === "running"
      ? "yellow"
      : job.status === "completed"
        ? "green"
        : job.status === "failed"
          ? "red"
          : "white";
  console.log(
    `Status: ${useColors ? colorize(job.status, statusColor) : job.status}`
  );

  console.log(`Started: ${job.started_at}`);

  if (job.prompt) {
    const promptPreview =
      job.prompt.slice(0, 60) + (job.prompt.length > 60 ? "..." : "");
    console.log(
      `Prompt: ${useColors ? colorize(promptPreview, "dim") : promptPreview}`
    );
  }

  console.log(useColors ? colorize(line, "cyan") : line);
  console.log("");
}

// =============================================================================
// CLI
// =============================================================================

function printUsage(): void {
  console.log("Usage: npx tsx tail-job-output.ts <job-id> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --no-follow     Exit after replaying existing output");
  console.log("  --no-color      Disable colored output");
  console.log("  --no-timestamp  Hide timestamps");
  console.log("  --raw           Output raw JSON messages (implies --no-color)");
  console.log("  --help          Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  npx tsx tail-job-output.ts job-2024-01-15-abc123");
  console.log("  npx tsx tail-job-output.ts job-2024-01-15-abc123 --no-follow");
  console.log("  npx tsx tail-job-output.ts job-2024-01-15-abc123 --raw > output.jsonl");
}

async function main() {
  const args = process.argv.slice(2);

  // Check for help
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  // Get job ID (first non-option argument)
  const jobId = args.find((arg) => !arg.startsWith("--"));

  if (!jobId) {
    console.error("Error: Job ID is required");
    console.log("");
    printUsage();
    process.exit(1);
  }

  // Parse options
  const follow = !args.includes("--no-follow");
  const raw = args.includes("--raw");
  const colorize = !args.includes("--no-color") && !raw;
  const showTimestamp = !args.includes("--no-timestamp");

  await tailJobOutput({
    jobId,
    jobsDir: JOBS_DIR,
    follow,
    colorize,
    raw,
    showTimestamp,
  });
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
