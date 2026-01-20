/**
 * CI/CD Runner Example
 *
 * Run herdctl as part of your CI/CD pipeline with proper exit codes.
 * Designed for use with GitHub Actions, GitLab CI, or any CI system.
 *
 * Usage:
 *   INPUT_AGENT=my-agent INPUT_PROMPT="Run tests" npx tsx examples/recipes/ci-runner.ts
 *
 * Environment Variables:
 *   INPUT_AGENT   - Agent name to trigger (default: "ci-agent")
 *   INPUT_PROMPT  - Optional prompt override
 *   JOB_TIMEOUT   - Job timeout in ms (default: 1200000 = 20 minutes)
 *   HERDCTL_CONFIG - Config path (default: "./herdctl.yaml")
 *   HERDCTL_STATE  - State dir (default: "./.herdctl")
 *
 * Exit Codes:
 *   0 - Success
 *   1 - Job failed or error
 *   2 - Configuration error
 *   3 - Timeout
 */

import { FleetManager, isAgentNotFoundError, isConfigurationError } from "@herdctl/core";

interface RunResult {
  success: boolean;
  jobId?: string;
  duration?: number;
  error?: string;
  exitCode: number;
}

async function runCIJob(): Promise<RunResult> {
  // Parse environment variables
  const agentName = process.env.INPUT_AGENT || process.env.DEFAULT_AGENT || "ci-agent";
  const prompt = process.env.INPUT_PROMPT;
  const timeout = parseInt(process.env.JOB_TIMEOUT || "1200000", 10); // 20 min default
  const configPath = process.env.HERDCTL_CONFIG || "./herdctl.yaml";
  const stateDir = process.env.HERDCTL_STATE || "./.herdctl";

  // Log configuration
  console.log("=== CI Runner Configuration ===");
  console.log(`Agent:      ${agentName}`);
  console.log(`Config:     ${configPath}`);
  console.log(`State Dir:  ${stateDir}`);
  console.log(`Timeout:    ${timeout / 1000}s`);
  if (prompt) {
    console.log(`Prompt:     ${prompt}`);
  }
  console.log("================================\n");

  const manager = new FleetManager({
    configPath,
    stateDir,
    logger: {
      debug: () => {}, // Suppress debug logs in CI
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  });

  try {
    // Initialize
    console.log("Initializing fleet...");
    await manager.initialize();
    console.log(`Loaded ${manager.state.agentCount} agent(s)`);

    // Validate agent exists
    const agents = await manager.getAgentInfo();
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) {
      console.error(`\n::error::Agent not found: ${agentName}`);
      console.error(`Available agents: ${agents.map((a) => a.name).join(", ") || "none"}`);
      return { success: false, exitCode: 2, error: `Agent not found: ${agentName}` };
    }

    // Start fleet
    await manager.start();

    // Trigger the agent
    console.log(`\nTriggering agent: ${agentName}`);
    const startTime = Date.now();

    const result = await manager.trigger(agentName, undefined, { prompt });
    console.log(`Job started: ${result.jobId}`);
    console.log("");

    // Stream output with GitHub Actions grouping
    let outputLines = 0;
    const MAX_OUTPUT_LINES = 10000;

    manager.on("job:output", (payload) => {
      if (payload.job.id === result.jobId) {
        if (outputLines < MAX_OUTPUT_LINES) {
          process.stdout.write(payload.output);
          outputLines++;
        } else if (outputLines === MAX_OUTPUT_LINES) {
          console.log("\n[Output truncated after 10000 lines]");
          outputLines++;
        }
      }
    });

    // Wait for completion or timeout
    type CompletionResult = {
      completed: true;
      success: boolean;
      duration?: number;
      error?: string;
    } | {
      completed: false;
      success: false;
      error: string;
    };

    const completionPromise = new Promise<CompletionResult>((resolve) => {
      manager.on("job:completed", (payload) => {
        if (payload.job.id === result.jobId) {
          resolve({
            completed: true,
            success: true,
            duration: payload.durationSeconds,
          });
        }
      });

      manager.on("job:failed", (payload) => {
        if (payload.job.id === result.jobId) {
          resolve({
            completed: true,
            success: false,
            duration: (Date.now() - startTime) / 1000,
            error: payload.error.message,
          });
        }
      });
    });

    const timeoutPromise = new Promise<CompletionResult>((resolve) => {
      setTimeout(() => {
        resolve({
          completed: false,
          success: false,
          error: `Job timed out after ${timeout / 1000}s`,
        });
      }, timeout);
    });

    const outcome = await Promise.race([completionPromise, timeoutPromise]);

    // Handle timeout
    if (!outcome.completed) {
      console.error(`\n::error::${outcome.error}`);

      // Attempt to cancel the job
      console.log("Attempting to cancel job...");
      try {
        await manager.cancelJob(result.jobId, { timeout: 10000 });
        console.log("Job cancelled");
      } catch (cancelError) {
        console.error("Failed to cancel job:", cancelError);
      }

      return {
        success: false,
        jobId: result.jobId,
        exitCode: 3,
        error: outcome.error,
      };
    }

    // Log result
    console.log("");
    if (outcome.success) {
      console.log(`::notice::Job completed successfully in ${outcome.duration}s`);
      return {
        success: true,
        jobId: result.jobId,
        duration: outcome.duration,
        exitCode: 0,
      };
    } else {
      console.error(`::error::Job failed: ${outcome.error}`);
      return {
        success: false,
        jobId: result.jobId,
        duration: outcome.duration,
        error: outcome.error,
        exitCode: 1,
      };
    }
  } catch (error) {
    if (isConfigurationError(error)) {
      console.error(`::error::Configuration error: ${error.message}`);
      if (error.hasValidationErrors()) {
        for (const ve of error.validationErrors) {
          console.error(`  - ${ve.path}: ${ve.message}`);
        }
      }
      return { success: false, exitCode: 2, error: error.message };
    }

    if (isAgentNotFoundError(error)) {
      console.error(`::error::Agent not found: ${error.agentName}`);
      return { success: false, exitCode: 2, error: error.message };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`::error::Unexpected error: ${errorMessage}`);
    return { success: false, exitCode: 1, error: errorMessage };
  } finally {
    // Always stop cleanly
    console.log("\nStopping fleet...");
    await manager.stop({ timeout: 10000, cancelOnTimeout: true });
    console.log("Fleet stopped");
  }
}

// Output GitHub Actions summary if available
function writeJobSummary(result: RunResult): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const fs = require("fs");
  const status = result.success ? ":white_check_mark: Success" : ":x: Failed";
  const duration = result.duration ? `${result.duration.toFixed(1)}s` : "N/A";

  const summary = `
## Job Result

| Field | Value |
|-------|-------|
| Status | ${status} |
| Job ID | \`${result.jobId || "N/A"}\` |
| Duration | ${duration} |
${result.error ? `| Error | ${result.error} |` : ""}
`;

  fs.appendFileSync(summaryFile, summary);
}

// Main entry point
console.log("=== herdctl CI Runner ===\n");

runCIJob()
  .then((result) => {
    writeJobSummary(result);

    console.log("\n=== Summary ===");
    console.log(`Status:   ${result.success ? "SUCCESS" : "FAILED"}`);
    if (result.jobId) console.log(`Job ID:   ${result.jobId}`);
    if (result.duration) console.log(`Duration: ${result.duration.toFixed(1)}s`);
    if (result.error) console.log(`Error:    ${result.error}`);
    console.log(`Exit:     ${result.exitCode}`);

    process.exit(result.exitCode);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
