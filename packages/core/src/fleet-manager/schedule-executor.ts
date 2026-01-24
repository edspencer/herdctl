/**
 * Schedule Executor Module
 *
 * Handles the execution of scheduled jobs when triggered by the Scheduler.
 * This module is responsible for:
 * - Receiving schedule triggers from the Scheduler
 * - Creating and executing jobs via JobExecutor
 * - Emitting appropriate events during job execution
 * - Handling errors gracefully without crashing the fleet
 *
 * @module schedule-executor
 */

import { join } from "node:path";
import { query as claudeSdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { TriggerInfo } from "../scheduler/index.js";
import { JobExecutor, type SDKMessage, type SDKQueryFunction } from "../runner/index.js";
import { getJob } from "../state/index.js";
import type { FleetManagerContext } from "./context.js";

// Cast the SDK query function to our internal type
// The SDK types are slightly different but runtime-compatible
const sdkQuery = claudeSdkQuery as unknown as SDKQueryFunction;
import type {
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
} from "./types.js";
import {
  emitJobCreated as emitJobCreatedFn,
  emitJobOutput as emitJobOutputFn,
  emitJobCompleted as emitJobCompletedFn,
  emitJobFailed as emitJobFailedFn,
} from "./event-emitters.js";

/**
 * ScheduleExecutor handles the execution of scheduled jobs
 *
 * This class encapsulates the logic that was previously in handleScheduleTrigger,
 * providing a cleaner separation of concerns.
 */
export class ScheduleExecutor {
  constructor(private ctx: FleetManagerContext) {}

  /**
   * Execute a scheduled trigger
   *
   * This method executes the agent via JobExecutor when a schedule triggers.
   * It:
   * 1. Emits schedule:triggered event
   * 2. Creates and executes a job via JobExecutor
   * 3. Streams job:output events during execution
   * 4. Emits job:completed or job:failed events when done
   * 5. Handles errors gracefully without crashing the fleet
   *
   * @param info - Trigger information from the Scheduler
   */
  async executeSchedule(info: TriggerInfo): Promise<void> {
    const { agent, scheduleName, schedule } = info;
    const timestamp = new Date().toISOString();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();
    const stateDir = this.ctx.getStateDir();

    logger.info(`Triggering ${agent.name}/${scheduleName}`);

    // Emit legacy event for backwards compatibility
    emitter.emit("schedule:trigger", agent.name, scheduleName);

    // Emit new typed event with full payload
    emitter.emit("schedule:triggered", {
      agentName: agent.name,
      scheduleName,
      schedule,
      timestamp,
    });

    try {
      // Determine the prompt to use (schedule.prompt is the primary source,
      // agent.system_prompt provides agent context but isn't the task prompt)
      const prompt = schedule.prompt ?? "Execute your configured task";

      logger.debug(
        `Schedule ${scheduleName} triggered for agent ${agent.name} ` +
          `(type: ${schedule.type}, prompt: ${prompt.slice(0, 50)}...)`
      );

      // Create the JobExecutor with the Claude SDK query function
      const executor = new JobExecutor(sdkQuery, {
        logger,
      });

      // Track whether we've emitted the job:created event
      let jobId: string | undefined;

      // Execute the job with streaming output
      const result = await executor.execute({
        agent,
        prompt,
        stateDir,
        triggerType: "schedule",
        schedule: scheduleName,
        outputToFile: schedule.outputToFile ?? false,
        onMessage: async (message: SDKMessage) => {
          // Emit job:output events for real-time streaming
          if (jobId) {
            const outputType = this.mapMessageTypeToOutputType(message.type);
            const outputContent = this.extractMessageContent(message);

            if (outputContent) {
              this.emitJobOutput({
                jobId,
                agentName: agent.name,
                output: outputContent,
                outputType,
                timestamp: new Date().toISOString(),
              });
            }
          }
        },
      });

      // Store the jobId for reference
      jobId = result.jobId;

      // Emit job:created event now that we have the job info
      const jobsDir = join(stateDir, "jobs");
      const jobMetadata = await getJob(jobsDir, result.jobId, { logger });

      if (jobMetadata) {
        this.emitJobCreated({
          job: jobMetadata,
          agentName: agent.name,
          scheduleName,
          timestamp: new Date().toISOString(),
        });

        // Emit completion or failure event based on result
        if (result.success) {
          this.emitJobCompleted({
            job: jobMetadata,
            agentName: agent.name,
            exitReason: "success",
            durationSeconds: result.durationSeconds ?? 0,
            timestamp: new Date().toISOString(),
          });

          logger.info(
            `Job ${result.jobId} completed successfully for ${agent.name}/${scheduleName} ` +
              `(${result.durationSeconds}s)`
          );
        } else {
          const error = result.error ?? new Error("Job failed without error details");
          this.emitJobFailed({
            job: jobMetadata,
            agentName: agent.name,
            error,
            exitReason: "error",
            durationSeconds: result.durationSeconds,
            timestamp: new Date().toISOString(),
          });

          logger.warn(
            `Job ${result.jobId} failed for ${agent.name}/${scheduleName}: ${error.message}`
          );
        }
      }

      // Emit legacy completion event for backwards compatibility
      emitter.emit("schedule:complete", agent.name, scheduleName);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Error in ${agent.name}/${scheduleName}: ${err.message}`);
      // Emit legacy error event for backwards compatibility
      emitter.emit("schedule:error", agent.name, scheduleName, err);
      // Don't re-throw - we want to continue running the fleet even if a job fails
    }
  }

  /**
   * Map SDK message type to job output type
   */
  private mapMessageTypeToOutputType(
    messageType: string
  ): "stdout" | "stderr" | "assistant" | "tool" | "system" {
    switch (messageType) {
      case "assistant":
        return "assistant";
      case "tool_use":
      case "tool_result":
        return "tool";
      case "system":
        return "system";
      case "error":
        return "stderr";
      default:
        return "stdout";
    }
  }

  /**
   * Extract content string from SDK message
   */
  private extractMessageContent(message: SDKMessage): string | null {
    // Handle different message types
    if (message.content && typeof message.content === "string") {
      return message.content;
    }

    if (message.message && typeof message.message === "string") {
      return message.message;
    }

    // For tool_use messages, stringify the input
    if (message.type === "tool_use" && message.name && message.input) {
      return `Tool: ${message.name}\n${JSON.stringify(message.input, null, 2)}`;
    }

    // For tool_result messages
    if (message.type === "tool_result" && message.content) {
      return typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content);
    }

    return null;
  }

  // ===========================================================================
  // Event Emission Helpers
  // ===========================================================================

  /**
   * Emit a job:created event
   */
  private emitJobCreated(payload: JobCreatedPayload): void {
    emitJobCreatedFn(this.ctx.getEmitter(), payload);
  }

  /**
   * Emit a job:output event
   */
  private emitJobOutput(payload: JobOutputPayload): void {
    emitJobOutputFn(this.ctx.getEmitter(), payload);
  }

  /**
   * Emit a job:completed event
   */
  private emitJobCompleted(payload: JobCompletedPayload): void {
    emitJobCompletedFn(this.ctx.getEmitter(), payload);
  }

  /**
   * Emit a job:failed event
   */
  private emitJobFailed(payload: JobFailedPayload): void {
    emitJobFailedFn(this.ctx.getEmitter(), payload);
  }
}
