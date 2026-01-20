/**
 * Colored Terminal Output Example
 *
 * This example demonstrates:
 * - Streaming job output with ANSI colors
 * - Different styling based on output type (stdout, stderr, assistant, tool, system)
 * - Formatting timestamps and job metadata
 * - Real-time output streaming to terminal
 *
 * Run with: npx tsx examples/library-usage/colored-output.ts
 */

import { FleetManager, JobOutputPayload } from "@herdctl/core";

// =========================================================================
// ANSI Color Definitions
// =========================================================================

const colors = {
  // Basic colors
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  // Bright foreground colors
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  // Background colors
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
} as const;

// =========================================================================
// Color Helper Functions
// =========================================================================

function colorize(text: string, ...styles: (keyof typeof colors)[]): string {
  const colorCodes = styles.map((style) => colors[style]).join("");
  return `${colorCodes}${text}${colors.reset}`;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// =========================================================================
// Output Formatting
// =========================================================================

// Output type configuration
const outputStyles: Record<
  JobOutputPayload["outputType"],
  {
    label: string;
    labelColor: (keyof typeof colors)[];
    textColor: (keyof typeof colors)[];
  }
> = {
  stdout: {
    label: "out",
    labelColor: ["brightBlack"],
    textColor: [],
  },
  stderr: {
    label: "err",
    labelColor: ["red", "bold"],
    textColor: ["red"],
  },
  assistant: {
    label: "claude",
    labelColor: ["green", "bold"],
    textColor: ["green"],
  },
  tool: {
    label: "tool",
    labelColor: ["yellow", "bold"],
    textColor: ["yellow"],
  },
  system: {
    label: "sys",
    labelColor: ["magenta", "bold"],
    textColor: ["magenta"],
  },
};

function formatOutput(payload: JobOutputPayload): string {
  const style = outputStyles[payload.outputType];
  const timestamp = colorize(formatTimestamp(payload.timestamp), "dim");
  const agent = colorize(payload.agentName, "cyan");
  const label = colorize(`[${style.label}]`, ...style.labelColor);

  // Format the output text
  let output = payload.output;
  if (style.textColor.length > 0) {
    output = colorize(output, ...style.textColor);
  }

  // Handle multi-line output with proper indentation
  const lines = output.split("\n");
  if (lines.length === 1) {
    return `${timestamp} ${agent} ${label} ${output}`;
  }

  // For multi-line, put prefix on first line and indent rest
  const prefix = `${timestamp} ${agent} ${label} `;
  const indent = " ".repeat(27); // Approximate width of prefix without ANSI codes

  return lines
    .map((line, i) => (i === 0 ? `${prefix}${line}` : `${indent}${line}`))
    .join("\n");
}

// =========================================================================
// Job Lifecycle Formatting
// =========================================================================

function printJobCreated(
  jobId: string,
  agentName: string,
  scheduleName: string | undefined,
): void {
  const border = colorize("━".repeat(60), "blue");
  const icon = colorize("▶", "blue", "bold");
  const jobLabel = colorize("Job Started", "blue", "bold");
  const id = colorize(jobId.slice(0, 30), "dim");
  const agent = colorize(agentName, "cyan", "bold");
  const schedule = scheduleName
    ? colorize(scheduleName, "yellow")
    : colorize("manual", "dim");

  console.log(`\n${border}`);
  console.log(`${icon} ${jobLabel}`);
  console.log(`  ID:       ${id}`);
  console.log(`  Agent:    ${agent}`);
  console.log(`  Schedule: ${schedule}`);
  console.log(`${border}\n`);
}

function printJobCompleted(
  jobId: string,
  agentName: string,
  durationSeconds: number,
  exitReason: string,
): void {
  const border = colorize("━".repeat(60), "green");
  const icon = colorize("✓", "green", "bold");
  const jobLabel = colorize("Job Completed", "green", "bold");
  const duration = colorize(`${durationSeconds.toFixed(1)}s`, "green");
  const reason = colorize(exitReason, "dim");

  console.log(`\n${border}`);
  console.log(`${icon} ${jobLabel}`);
  console.log(`  Agent:    ${colorize(agentName, "cyan")}`);
  console.log(`  Duration: ${duration}`);
  console.log(`  Exit:     ${reason}`);
  console.log(`${border}\n`);
}

function printJobFailed(
  jobId: string,
  agentName: string,
  errorMessage: string,
  durationSeconds: number | undefined,
): void {
  const border = colorize("━".repeat(60), "red");
  const icon = colorize("✗", "red", "bold");
  const jobLabel = colorize("Job Failed", "red", "bold");
  const error = colorize(errorMessage, "red");

  console.log(`\n${border}`);
  console.log(`${icon} ${jobLabel}`);
  console.log(`  Agent:    ${colorize(agentName, "cyan")}`);
  if (durationSeconds !== undefined) {
    console.log(`  Duration: ${colorize(`${durationSeconds.toFixed(1)}s`, "dim")}`);
  }
  console.log(`  Error:    ${error}`);
  console.log(`${border}\n`);
}

function printJobCancelled(
  jobId: string,
  agentName: string,
  terminationType: string,
): void {
  const border = colorize("━".repeat(60), "yellow");
  const icon = colorize("⊘", "yellow", "bold");
  const jobLabel = colorize("Job Cancelled", "yellow", "bold");
  const termType = colorize(terminationType, "yellow");

  console.log(`\n${border}`);
  console.log(`${icon} ${jobLabel}`);
  console.log(`  Agent:       ${colorize(agentName, "cyan")}`);
  console.log(`  Termination: ${termType}`);
  console.log(`${border}\n`);
}

// =========================================================================
// Main Application
// =========================================================================

async function main() {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  // Track active jobs for output
  const activeJobs = new Set<string>();

  // =========================================================================
  // Event Handlers
  // =========================================================================

  manager.on("initialized", () => {
    console.log(colorize("\n[Fleet] Initialized\n", "dim"));
  });

  manager.on("started", () => {
    console.log(colorize("[Fleet] Scheduler started\n", "dim"));
    console.log(
      colorize("Waiting for scheduled triggers... Press Ctrl+C to stop.\n", "dim"),
    );
  });

  manager.on("schedule:triggered", (payload) => {
    const msg = `[Schedule] ${payload.agentName}/${payload.scheduleName} triggered`;
    console.log(colorize(msg, "brightBlack"));
  });

  manager.on("job:created", (payload) => {
    activeJobs.add(payload.job.id);
    printJobCreated(payload.job.id, payload.agentName, payload.scheduleName);
  });

  manager.on("job:output", (payload) => {
    // Only show output for active jobs
    if (activeJobs.has(payload.jobId)) {
      process.stdout.write(formatOutput(payload));
      // Add newline if output doesn't end with one
      if (!payload.output.endsWith("\n")) {
        process.stdout.write("\n");
      }
    }
  });

  manager.on("job:completed", (payload) => {
    activeJobs.delete(payload.job.id);
    printJobCompleted(
      payload.job.id,
      payload.agentName,
      payload.durationSeconds,
      payload.exitReason,
    );
  });

  manager.on("job:failed", (payload) => {
    activeJobs.delete(payload.job.id);
    printJobFailed(
      payload.job.id,
      payload.agentName,
      payload.error.message,
      payload.durationSeconds,
    );
  });

  manager.on("job:cancelled", (payload) => {
    activeJobs.delete(payload.job.id);
    printJobCancelled(payload.job.id, payload.agentName, payload.terminationType);
  });

  manager.on("error", (error) => {
    console.error(colorize(`\n[Fleet Error] ${error.message}\n`, "red", "bold"));
  });

  // =========================================================================
  // Start the Fleet
  // =========================================================================

  console.log(colorize("\n╔════════════════════════════════════════╗", "blue"));
  console.log(colorize("║   Colored Output Streaming Example     ║", "blue"));
  console.log(colorize("╚════════════════════════════════════════╝\n", "blue"));

  await manager.initialize();
  await manager.start();

  // =========================================================================
  // Graceful Shutdown
  // =========================================================================

  process.on("SIGINT", async () => {
    console.log(colorize("\n\nReceived SIGINT, shutting down...", "yellow"));

    if (activeJobs.size > 0) {
      console.log(
        colorize(`Waiting for ${activeJobs.size} active job(s)...`, "yellow"),
      );
    }

    await manager.stop({
      timeout: 30000,
      cancelOnTimeout: true,
    });

    console.log(colorize("\nFleet stopped.\n", "green"));
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(colorize(`Fatal error: ${error.message}`, "red", "bold"));
  process.exit(1);
});
