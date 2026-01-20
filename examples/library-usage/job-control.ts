/**
 * Job Control Example
 *
 * This example demonstrates:
 * - Manual triggering with different options
 * - Job cancellation
 * - Job forking
 * - Log streaming
 *
 * Run with: npx tsx examples/library-usage/job-control.ts
 */

import {
  FleetManager,
  isJobNotFoundError,
  isAgentNotFoundError,
  isScheduleNotFoundError,
  isConcurrencyLimitError,
} from "@herdctl/core";

async function main() {
  const manager = new FleetManager({
    configPath: "./herdctl.yaml",
    stateDir: "./.herdctl",
  });

  await manager.initialize();
  await manager.start();

  try {
    // =========================================================================
    // Manual Triggering Examples
    // =========================================================================

    console.log("--- Trigger Examples ---\n");

    // Trigger with agent defaults (no schedule)
    try {
      const result = await manager.trigger("my-agent");
      console.log(`Basic trigger - Job ID: ${result.jobId}`);
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        console.log(`Skipping: Agent "${error.agentName}" not found`);
      }
    }

    // Trigger a specific schedule
    try {
      const result = await manager.trigger("my-agent", "hourly");
      console.log(`Schedule trigger - Job ID: ${result.jobId}`);
      console.log(`  Prompt used: ${result.prompt}`);
    } catch (error) {
      if (isScheduleNotFoundError(error)) {
        console.log(`Skipping: Schedule "${error.scheduleName}" not found`);
      }
    }

    // Trigger with custom prompt (overrides schedule prompt)
    try {
      const result = await manager.trigger("my-agent", "hourly", {
        prompt: "Review only critical issues",
      });
      console.log(`Custom prompt trigger - Job ID: ${result.jobId}`);
    } catch (error) {
      // Handle errors
    }

    // Force trigger even when at concurrency limit
    try {
      const result = await manager.trigger("my-agent", undefined, {
        bypassConcurrencyLimit: true,
        prompt: "Urgent: Process this immediately",
      });
      console.log(`Bypass trigger - Job ID: ${result.jobId}`);
    } catch (error) {
      if (isConcurrencyLimitError(error)) {
        console.log(`Agent at capacity: ${error.currentJobs}/${error.limit}`);
      }
    }

    // =========================================================================
    // Job Cancellation Example
    // =========================================================================

    console.log("\n--- Job Cancellation Example ---\n");

    // Create a job to cancel
    let jobId: string | undefined;
    try {
      const triggerResult = await manager.trigger("my-agent");
      jobId = triggerResult.jobId;
      console.log(`Created job: ${jobId}`);

      // Cancel with default timeout (10 seconds for graceful shutdown)
      const cancelResult = await manager.cancelJob(jobId);
      console.log(`Cancelled job: ${cancelResult.jobId}`);
      console.log(`  Success: ${cancelResult.success}`);
      console.log(`  Termination type: ${cancelResult.terminationType}`);
    } catch (error) {
      if (isJobNotFoundError(error)) {
        console.log(`Job not found: ${error.jobId}`);
      } else if (isAgentNotFoundError(error)) {
        console.log(`Skipping cancellation demo: no agents configured`);
      }
    }

    // Cancel with custom timeout
    if (jobId) {
      try {
        const result = await manager.cancelJob(jobId, {
          timeout: 30000, // 30 seconds for graceful shutdown
        });
        console.log(`Custom timeout cancel: ${result.terminationType}`);
      } catch (error) {
        // Job may already be stopped
      }
    }

    // =========================================================================
    // Job Forking Example
    // =========================================================================

    console.log("\n--- Job Forking Example ---\n");

    // Create a job to fork from
    try {
      const originalJob = await manager.trigger("my-agent", undefined, {
        prompt: "Original task prompt",
      });
      console.log(`Original job: ${originalJob.jobId}`);

      // Fork with same configuration
      const forked1 = await manager.forkJob(originalJob.jobId);
      console.log(`Forked job (same config): ${forked1.jobId}`);
      console.log(`  Forked from: ${forked1.forkedFromJobId}`);

      // Fork with modified prompt
      const forked2 = await manager.forkJob(originalJob.jobId, {
        prompt: "Continue the task with additional focus on testing",
      });
      console.log(`Forked job (new prompt): ${forked2.jobId}`);

      // Fork with different schedule
      const forked3 = await manager.forkJob(originalJob.jobId, {
        schedule: "nightly",
      });
      console.log(`Forked job (different schedule): ${forked3.jobId}`);
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        console.log(`Skipping fork demo: no agents configured`);
      }
    }

    // =========================================================================
    // Log Streaming Examples
    // =========================================================================

    console.log("\n--- Log Streaming Examples ---\n");

    // Stream all logs (async iterator)
    console.log("Streaming fleet logs (Ctrl+C to stop)...\n");
    const logStream = manager.streamLogs({
      level: "info",
      includeHistory: true,
      historyLimit: 100,
    });

    // Stream for a limited time
    let streamComplete = false;
    const streamTimeout = setTimeout(() => {
      streamComplete = true;
      console.log("\n(Log streaming demo complete)");
    }, 3000);

    try {
      for await (const log of logStream) {
        console.log(`[${log.level}] [${log.source}] ${log.message}`);
        // Break after timeout
        if (streamComplete) break;
      }
    } catch {
      // Iterator stopped
    }

    clearTimeout(streamTimeout);

    // Stream logs for a specific agent
    try {
      const agents = await manager.getAgentInfo();
      if (agents.length > 0) {
        console.log(`\nStreaming logs for agent: ${agents[0].name}`);
        const agentLogs = manager.streamAgentLogs(agents[0].name);
        let count = 0;
        for await (const log of agentLogs) {
          console.log(`[${log.jobId}] ${log.message}`);
          if (++count >= 5) break; // Limit output
        }
      }
    } catch (error) {
      if (isAgentNotFoundError(error)) {
        console.log("No agents to stream logs from");
      }
    }

    // Stream logs for a specific job
    if (jobId) {
      try {
        console.log(`\nStreaming logs for job: ${jobId}`);
        const jobLogs = manager.streamJobOutput(jobId);
        let count = 0;
        for await (const log of jobLogs) {
          console.log(`${log.message}`);
          if (++count >= 10) break; // Limit output
        }
      } catch (error) {
        if (isJobNotFoundError(error)) {
          console.log("Job not found for log streaming");
        }
      }
    }
  } finally {
    // Cleanup
    await manager.stop();
    console.log("\nFleet stopped.");
  }
}

main().catch(console.error);
