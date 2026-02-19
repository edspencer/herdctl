/**
 * Schedule Executor Module
 *
 * Handles the execution of scheduled jobs when triggered by the Scheduler.
 * This module is responsible for:
 * - Receiving schedule triggers from the Scheduler
 * - Creating and executing jobs via JobExecutor
 * - Emitting appropriate events during job execution
 * - Executing post-job hooks (shell, webhook, discord)
 * - Handling errors gracefully without crashing the fleet
 *
 * @module schedule-executor
 */

import { join, dirname } from "node:path";
import type { TriggerInfo } from "../scheduler/index.js";
import type { ResolvedAgent, HookEvent } from "../config/index.js";
import { JobExecutor, RuntimeFactory, type SDKMessage } from "../runner/index.js";
import { getJob } from "../state/index.js";
import type { JobMetadata } from "../state/schemas/job-metadata.js";
import { HookExecutor, type HookContext } from "../hooks/index.js";
import type { FleetManagerContext } from "./context.js";
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
  private hookExecutor: HookExecutor;

  constructor(private ctx: FleetManagerContext) {
    // Create hook executor with fleet manager logger
    this.hookExecutor = new HookExecutor({
      logger: ctx.getLogger(),
    });
  }

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

    logger.info(`Triggering ${agent.qualifiedName}/${scheduleName}`);

    // Emit typed event with full payload
    emitter.emit("schedule:triggered", {
      agentName: agent.qualifiedName,
      scheduleName,
      schedule,
      timestamp,
    });

    try {
      // Determine the prompt to use (priority: schedule > agent default > fallback)
      const prompt = schedule.prompt ?? agent.default_prompt ?? "Execute your configured task";

      logger.debug(
        `Schedule ${scheduleName} triggered for agent ${agent.qualifiedName} ` +
          `(type: ${schedule.type}, prompt: ${prompt.slice(0, 50)}...)`,
      );

      // Create the JobExecutor with the runtime
      const runtime = RuntimeFactory.create(agent, { stateDir });
      const executor = new JobExecutor(runtime, {
        logger,
      });

      // Track job ID for streaming - set via onJobCreated callback before execution starts
      let jobId: string | undefined;

      // Execute the job with streaming output
      const result = await executor.execute({
        agent,
        prompt,
        stateDir,
        triggerType: "schedule",
        schedule: scheduleName,
        outputToFile: schedule.outputToFile ?? false,
        onJobCreated: (id: string) => {
          // Set jobId early so onMessage can emit events during execution
          jobId = id;
          logger.debug(`Job ${id} created for ${agent.qualifiedName}/${scheduleName}`);
        },
        onMessage: async (message: SDKMessage) => {
          // Emit job:output events for real-time streaming
          if (jobId) {
            const outputType = this.mapMessageTypeToOutputType(message.type);
            const outputContent = this.extractMessageContent(message);

            if (outputContent) {
              this.emitJobOutput({
                jobId,
                agentName: agent.qualifiedName,
                output: outputContent,
                outputType,
                timestamp: new Date().toISOString(),
              });
            }
          }
        },
      });

      // Emit job:created event now that we have the job info
      const jobsDir = join(stateDir, "jobs");
      const jobMetadata = await getJob(jobsDir, result.jobId, { logger });

      if (jobMetadata) {
        this.emitJobCreated({
          job: jobMetadata,
          agentName: agent.qualifiedName,
          scheduleName,
          timestamp: new Date().toISOString(),
        });

        // Emit completion or failure event based on result
        if (result.success) {
          this.emitJobCompleted({
            job: jobMetadata,
            agentName: agent.qualifiedName,
            exitReason: "success",
            durationSeconds: result.durationSeconds ?? 0,
            timestamp: new Date().toISOString(),
          });

          logger.info(
            `Job ${result.jobId} completed successfully for ${agent.qualifiedName}/${scheduleName} ` +
              `(${result.durationSeconds}s)`,
          );

          // Execute after_run hooks for completed jobs
          await this.executeHooks(agent, jobMetadata, "completed", scheduleName);
        } else {
          const error = result.error ?? new Error("Job failed without error details");
          this.emitJobFailed({
            job: jobMetadata,
            agentName: agent.qualifiedName,
            error,
            exitReason: "error",
            durationSeconds: result.durationSeconds,
            timestamp: new Date().toISOString(),
          });

          logger.warn(
            `Job ${result.jobId} failed for ${agent.qualifiedName}/${scheduleName}: ${error.message}`,
          );

          // Execute hooks for failed jobs (both after_run and on_error)
          await this.executeHooks(agent, jobMetadata, "failed", scheduleName, error.message);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Error in ${agent.qualifiedName}/${scheduleName}: ${err.message}`);
      // Don't re-throw - we want to continue running the fleet even if a job fails
    }
  }

  /**
   * Map SDK message type to job output type
   */
  private mapMessageTypeToOutputType(
    messageType: string,
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
  // Hook Execution
  // ===========================================================================

  /**
   * Execute hooks for a completed or failed job
   *
   * @param agent - The agent configuration
   * @param jobMetadata - The job metadata
   * @param event - The hook event type
   * @param scheduleName - The schedule name (if applicable)
   * @param errorMessage - Error message (if job failed)
   */
  private async executeHooks(
    agent: ResolvedAgent,
    jobMetadata: JobMetadata,
    event: HookEvent,
    scheduleName?: string,
    errorMessage?: string,
  ): Promise<void> {
    const logger = this.ctx.getLogger();

    // Check if agent has any hooks configured
    if (!agent.hooks) {
      return;
    }

    // Build hook context from job metadata
    const context = this.buildHookContext(agent, jobMetadata, event, scheduleName, errorMessage);

    // Update hook executor cwd to agent's workspace if available
    const agentWorkspace = this.resolveAgentWorkspace(agent);
    if (agentWorkspace) {
      // Create a new hook executor with the agent's workspace as cwd
      const hookExecutor = new HookExecutor({
        logger,
        cwd: agentWorkspace,
      });

      // Execute after_run hooks (run for all events)
      if (agent.hooks.after_run && agent.hooks.after_run.length > 0) {
        logger.debug(`Executing ${agent.hooks.after_run.length} after_run hook(s)`);
        const afterRunResult = await hookExecutor.executeHooks(agent.hooks, context, "after_run");

        if (afterRunResult.shouldFailJob) {
          logger.warn(
            `Hook failure with continue_on_error=false detected for job ${jobMetadata.id}`,
          );
        }
      }

      // Execute on_error hooks (only for failed events)
      if (event === "failed" && agent.hooks.on_error && agent.hooks.on_error.length > 0) {
        logger.debug(`Executing ${agent.hooks.on_error.length} on_error hook(s)`);
        const onErrorResult = await hookExecutor.executeHooks(agent.hooks, context, "on_error");

        if (onErrorResult.shouldFailJob) {
          logger.warn(
            `on_error hook failure with continue_on_error=false detected for job ${jobMetadata.id}`,
          );
        }
      }
    } else {
      // Use default hook executor (no specific cwd)
      if (agent.hooks.after_run && agent.hooks.after_run.length > 0) {
        logger.debug(`Executing ${agent.hooks.after_run.length} after_run hook(s)`);
        await this.hookExecutor.executeHooks(agent.hooks, context, "after_run");
      }

      if (event === "failed" && agent.hooks.on_error && agent.hooks.on_error.length > 0) {
        logger.debug(`Executing ${agent.hooks.on_error.length} on_error hook(s)`);
        await this.hookExecutor.executeHooks(agent.hooks, context, "on_error");
      }
    }
  }

  /**
   * Build HookContext from job metadata and agent info
   */
  private buildHookContext(
    agent: ResolvedAgent,
    jobMetadata: JobMetadata,
    event: HookEvent,
    scheduleName?: string,
    errorMessage?: string,
  ): HookContext {
    const completedAt = jobMetadata.finished_at ?? new Date().toISOString();
    const startedAt = new Date(jobMetadata.started_at);
    const completedAtDate = new Date(completedAt);
    const durationMs = completedAtDate.getTime() - startedAt.getTime();

    return {
      event,
      job: {
        id: jobMetadata.id,
        agentId: agent.qualifiedName,
        scheduleName: scheduleName ?? jobMetadata.schedule ?? undefined,
        startedAt: jobMetadata.started_at,
        completedAt,
        durationMs,
      },
      result: {
        success: event === "completed",
        output: jobMetadata.summary ?? "",
        error: errorMessage,
      },
      agent: {
        id: agent.qualifiedName,
        name: agent.identity?.name ?? agent.name,
      },
    };
  }

  /**
   * Resolve the agent's working directory path
   */
  private resolveAgentWorkspace(agent: ResolvedAgent): string | undefined {
    if (!agent.working_directory) {
      return undefined;
    }

    // If working directory is a string, it's the path directly
    if (typeof agent.working_directory === "string") {
      return agent.working_directory;
    }

    // If working directory is an object with root property
    return agent.working_directory.root;
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
