/**
 * Job Control Module
 *
 * Centralizes all job control logic for FleetManager.
 * Provides methods to trigger, cancel, and fork jobs.
 *
 * @module job-control
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";

import { createJob, getJob, updateJob, readJobOutputAll, getSessionInfo } from "../state/index.js";
import { JobExecutor, RuntimeFactory } from "../runner/index.js";
import { HookExecutor, type HookContext } from "../hooks/index.js";
import type { ResolvedAgent, HookEvent } from "../config/index.js";
import type { JobMetadata } from "../state/schemas/job-metadata.js";
import type {
  TriggerOptions,
  TriggerResult,
  JobModifications,
  CancelJobResult,
  ForkJobResult,
  AgentInfo,
} from "./types.js";
import type { FleetManagerContext } from "./context.js";
import {
  AgentNotFoundError,
  ScheduleNotFoundError,
  ConcurrencyLimitError,
  InvalidStateError,
  JobNotFoundError,
  JobCancelError,
  JobForkError,
} from "./errors.js";

// =============================================================================
// JobControl Class
// =============================================================================

/**
 * JobControl provides job control operations for the FleetManager.
 *
 * This class encapsulates the logic for triggering, cancelling, and forking jobs
 * using the FleetManagerContext pattern.
 */
export class JobControl {
  constructor(
    private ctx: FleetManagerContext,
    private getAgentInfoFn: () => Promise<AgentInfo[]>,
  ) {}

  /**
   * Manually trigger an agent outside its normal schedule
   *
   * This method triggers an agent and executes the job immediately.
   * The job runs asynchronously in the background unless options.wait is true.
   *
   * @param agentName - Name of the agent to trigger
   * @param scheduleName - Optional schedule name to use for configuration
   * @param options - Optional runtime options to override defaults
   * @returns The created job information
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the specified schedule doesn't exist
   * @throws {ConcurrencyLimitError} If the agent is at capacity
   */
  async trigger(
    agentName: string,
    scheduleName?: string,
    options?: TriggerOptions,
  ): Promise<TriggerResult> {
    const status = this.ctx.getStatus();
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    const scheduler = this.ctx.getScheduler();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError("trigger", status, ["initialized", "running", "stopped"]);
    }

    // Find the agent by qualified name
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.qualifiedName === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    // If a schedule name is provided, validate it exists
    let schedule: { type: string; prompt?: string; outputToFile?: boolean } | undefined;
    if (scheduleName) {
      if (!agent.schedules || !(scheduleName in agent.schedules)) {
        const availableSchedules = agent.schedules ? Object.keys(agent.schedules) : [];
        throw new ScheduleNotFoundError(agentName, scheduleName, {
          availableSchedules,
        });
      }
      schedule = agent.schedules[scheduleName] as typeof schedule;
    }

    // Check concurrency limits unless bypassed
    if (!options?.bypassConcurrencyLimit) {
      const maxConcurrent = agent.instances?.max_concurrent ?? 1;
      const runningCount = scheduler?.getRunningJobCount(agentName) ?? 0;

      if (runningCount >= maxConcurrent) {
        throw new ConcurrencyLimitError(agentName, runningCount, maxConcurrent);
      }
    }

    // Determine the prompt to use (priority: options > schedule > agent default > fallback)
    const prompt =
      options?.prompt ?? schedule?.prompt ?? agent.default_prompt ?? "Execute your configured task";

    const timestamp = new Date().toISOString();

    logger.debug(`Manually triggered ${agentName}${scheduleName ? `/${scheduleName}` : ""}`);

    // Get existing session for conversation continuity (unless explicitly provided)
    // This prevents unexpected logouts by automatically resuming the agent's session
    // Note: resume=null means "explicitly start fresh" (e.g. new Slack thread),
    // while resume=undefined means "use fallback session lookup"
    let sessionId = options?.resume ?? undefined;
    if (sessionId === undefined && options?.resume !== null) {
      try {
        const sessionsDir = join(stateDir, "sessions");
        // Use session timeout config for expiry validation (default: 24h)
        const sessionTimeout = agent.session?.timeout ?? "24h";
        const existingSession = await getSessionInfo(sessionsDir, agent.qualifiedName, {
          timeout: sessionTimeout,
          logger,
        });
        if (existingSession?.session_id) {
          sessionId = existingSession.session_id;
          logger.debug(`Found valid session for ${agent.qualifiedName}: ${sessionId}`);
        }
      } catch (error) {
        logger.warn(
          `Failed to get session info for ${agent.qualifiedName}: ${(error as Error).message}`,
        );
        // Continue without resume - session failure shouldn't block execution
      }
    }

    // Create the JobExecutor and execute the job
    const runtime = RuntimeFactory.create(agent, { stateDir });
    const executor = new JobExecutor(runtime, { logger });

    // Execute the job - this creates the job record and runs it
    // Note: Job output is written to JSONL by JobExecutor; log streaming picks it up
    // If onMessage callback is provided, it will be called for each SDK message
    const result = await executor.execute({
      agent,
      prompt,
      stateDir,
      triggerType: (options?.triggerType ??
        "manual") as import("../state/schemas/job-metadata.js").TriggerType,
      schedule: scheduleName,
      outputToFile: schedule?.outputToFile ?? false,
      onMessage: options?.onMessage,
      resume: sessionId,
      injectedMcpServers: options?.injectedMcpServers,
    });

    // Emit job:created event
    const jobsDir = join(stateDir, "jobs");
    const jobMetadata = await getJob(jobsDir, result.jobId, { logger });

    if (jobMetadata) {
      emitter.emit("job:created", {
        job: jobMetadata,
        agentName,
        scheduleName: scheduleName ?? null,
        timestamp,
      });

      // Emit completion or failure event based on result
      if (result.success) {
        emitter.emit("job:completed", {
          job: jobMetadata,
          agentName,
          exitReason: "success",
          durationSeconds: result.durationSeconds ?? 0,
          timestamp: new Date().toISOString(),
        });

        // Execute hooks for completed job
        await this.executeHooks(agent, jobMetadata, "completed", scheduleName);
      } else {
        const error = result.error ?? new Error("Job failed without error details");
        emitter.emit("job:failed", {
          job: jobMetadata,
          agentName,
          error,
          exitReason: "error",
          durationSeconds: result.durationSeconds,
          timestamp: new Date().toISOString(),
        });

        // Execute hooks for failed job
        await this.executeHooks(agent, jobMetadata, "failed", scheduleName, error.message);
      }
    }

    logger.info(
      `Job ${result.jobId} ${result.success ? "completed" : "failed"} ` +
        `(${result.durationSeconds ?? 0}s)`,
    );

    // Build and return the result
    return {
      jobId: result.jobId,
      agentName,
      scheduleName: scheduleName ?? null,
      startedAt: jobMetadata?.started_at ?? timestamp,
      prompt,
      success: result.success,
      sessionId: result.sessionId,
      error: result.error,
      errorDetails: result.errorDetails,
    };
  }

  /**
   * Cancel a running job gracefully
   *
   * @param jobId - ID of the job to cancel
   * @param options - Optional cancellation options
   * @returns Result of the cancellation operation
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {JobNotFoundError} If the job doesn't exist
   */
  async cancelJob(jobId: string, options?: { timeout?: number }): Promise<CancelJobResult> {
    const status = this.ctx.getStatus();
    const stateDir = this.ctx.getStateDir();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError("cancelJob", status, ["initialized", "running", "stopped"]);
    }

    const jobsDir = join(stateDir, "jobs");
    const timeout = options?.timeout ?? 10000;

    // Get the job to verify it exists and check its status
    const job = await getJob(jobsDir, jobId, { logger });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const timestamp = new Date().toISOString();
    let terminationType: "graceful" | "forced" | "already_stopped";
    let durationSeconds: number | undefined;

    // If job is already not running, return early
    if (job.status !== "running" && job.status !== "pending") {
      logger.info(`Job ${jobId} is already ${job.status}, no cancellation needed`);

      terminationType = "already_stopped";

      // Calculate duration if we have finished_at
      if (job.finished_at) {
        const startTime = new Date(job.started_at).getTime();
        const endTime = new Date(job.finished_at).getTime();
        durationSeconds = Math.round((endTime - startTime) / 1000);
      }

      return {
        jobId,
        success: true,
        terminationType,
        canceledAt: timestamp,
      };
    }

    // Calculate duration
    const startTime = new Date(job.started_at).getTime();
    const endTime = new Date(timestamp).getTime();
    durationSeconds = Math.round((endTime - startTime) / 1000);

    logger.info(`Cancelling job ${jobId} for agent ${job.agent}`);

    // Update job status to cancelled
    try {
      await updateJob(jobsDir, jobId, {
        status: "cancelled",
        exit_reason: "cancelled",
        finished_at: timestamp,
      });

      terminationType = "graceful";
    } catch (error) {
      logger.error(`Failed to update job status: ${(error as Error).message}`);
      throw new JobCancelError(jobId, "process_error", {
        cause: error as Error,
      });
    }

    // Emit job:cancelled event
    const updatedJob = await getJob(jobsDir, jobId, { logger });
    if (updatedJob) {
      emitter.emit("job:cancelled", {
        job: updatedJob,
        agentName: job.agent,
        terminationType,
        durationSeconds,
        timestamp,
      });
    }

    logger.info(`Job ${jobId} cancelled (${terminationType}) after ${durationSeconds}s`);

    return {
      jobId,
      success: true,
      terminationType,
      canceledAt: timestamp,
    };
  }

  /**
   * Fork a job to create a new job based on an existing one
   *
   * @param jobId - ID of the job to fork
   * @param modifications - Optional modifications to apply to the forked job
   * @returns Result of the fork operation including the new job ID
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {JobNotFoundError} If the original job doesn't exist
   * @throws {JobForkError} If the job cannot be forked
   */
  async forkJob(jobId: string, modifications?: JobModifications): Promise<ForkJobResult> {
    const status = this.ctx.getStatus();
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError("forkJob", status, ["initialized", "running", "stopped"]);
    }

    const jobsDir = join(stateDir, "jobs");

    // Get the original job
    const originalJob = await getJob(jobsDir, jobId, { logger });

    if (!originalJob) {
      throw new JobForkError(jobId, "job_not_found");
    }

    // Verify the agent exists in config
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.qualifiedName === originalJob.agent);

    if (!agent) {
      throw new JobForkError(jobId, "agent_not_found", {
        message: `Agent "${originalJob.agent}" for job "${jobId}" not found in current configuration`,
      });
    }

    // Determine the prompt to use
    const prompt = modifications?.prompt ?? originalJob.prompt ?? undefined;

    // Determine the schedule to use
    const scheduleName = modifications?.schedule ?? originalJob.schedule ?? undefined;

    // Create the new job
    const timestamp = new Date().toISOString();
    const newJob = await createJob(jobsDir, {
      agent: originalJob.agent,
      trigger_type: "fork",
      schedule: scheduleName ?? null,
      prompt: prompt ?? null,
      forked_from: jobId,
    });

    logger.info(`Forked job ${jobId} to new job ${newJob.id} for agent ${originalJob.agent}`);

    // Emit job:created event
    emitter.emit("job:created", {
      job: newJob,
      agentName: originalJob.agent,
      scheduleName: scheduleName ?? undefined,
      timestamp,
    });

    // Emit job:forked event
    emitter.emit("job:forked", {
      job: newJob,
      originalJob,
      agentName: originalJob.agent,
      timestamp,
    });

    return {
      jobId: newJob.id,
      forkedFromJobId: jobId,
      agentName: originalJob.agent,
      startedAt: newJob.started_at,
      prompt,
    };
  }

  /**
   * Get the final output from a completed job
   *
   * Reads the job's JSONL file and extracts the last meaningful content:
   * either a tool_result with result, or an assistant message with content.
   *
   * @param jobId - ID of the job to get output from
   * @returns The final output string, or empty string if not found
   */
  async getJobFinalOutput(jobId: string): Promise<string> {
    const stateDir = this.ctx.getStateDir();
    const jobsDir = join(stateDir, "jobs");
    return this.extractJobOutput(jobsDir, jobId);
  }

  /**
   * Cancel all running jobs during shutdown
   *
   * @param cancelTimeout - Timeout for each job cancellation
   */
  async cancelRunningJobs(cancelTimeout: number): Promise<void> {
    const logger = this.ctx.getLogger();

    // Get all running jobs from the fleet status
    const agentInfoList = await this.getAgentInfoFn();

    const runningJobIds: string[] = [];
    for (const agent of agentInfoList) {
      if (agent.currentJobId) {
        runningJobIds.push(agent.currentJobId);
      }
    }

    if (runningJobIds.length === 0) {
      logger.debug("No running jobs to cancel");
      return;
    }

    logger.info(`Cancelling ${runningJobIds.length} running job(s)...`);

    // Cancel all jobs in parallel
    const cancelPromises = runningJobIds.map(async (jobId) => {
      try {
        const result = await this.cancelJob(jobId, { timeout: cancelTimeout });
        logger.debug(`Cancelled job ${jobId}: ${result.terminationType}`);
      } catch (error) {
        logger.warn(`Failed to cancel job ${jobId}: ${(error as Error).message}`);
      }
    });

    await Promise.all(cancelPromises);
    logger.info("All jobs cancelled");
  }

  // ===========================================================================
  // Hook Execution
  // ===========================================================================

  /**
   * Execute hooks for a job (after_run and on_error)
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

    // Build hook context from job metadata (reads actual output from JSONL)
    const stateDir = this.ctx.getStateDir();
    const jobsDir = join(stateDir, "jobs");
    const context = await this.buildHookContext(
      agent,
      jobMetadata,
      jobsDir,
      event,
      scheduleName,
      errorMessage,
    );

    // Resolve agent workspace for hook execution
    const agentWorkspace = this.resolveAgentWorkspace(agent);

    // Create hook executor with appropriate cwd
    const hookExecutor = new HookExecutor({
      logger,
      cwd: agentWorkspace,
    });

    // Execute after_run hooks (run for all events)
    if (agent.hooks.after_run && agent.hooks.after_run.length > 0) {
      logger.debug(`Executing ${agent.hooks.after_run.length} after_run hook(s)`);
      const afterRunResult = await hookExecutor.executeHooks(agent.hooks, context, "after_run");

      if (afterRunResult.shouldFailJob) {
        logger.warn(`Hook failure with continue_on_error=false detected for job ${jobMetadata.id}`);
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
  }

  /**
   * Build HookContext from job metadata and agent info
   * Reads the actual job output from the JSONL file and agent metadata
   */
  private async buildHookContext(
    agent: ResolvedAgent,
    jobMetadata: JobMetadata,
    jobsDir: string,
    event: HookEvent,
    scheduleName?: string,
    errorMessage?: string,
  ): Promise<HookContext> {
    const completedAt = jobMetadata.finished_at ?? new Date().toISOString();
    const startedAt = new Date(jobMetadata.started_at);
    const completedAtDate = new Date(completedAt);
    const durationMs = completedAtDate.getTime() - startedAt.getTime();

    // Read the actual job output from JSONL file
    const output = await this.extractJobOutput(jobsDir, jobMetadata.id);

    // Read agent-provided metadata file (if it exists)
    const metadata = await this.readAgentMetadata(agent);

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
        output,
        error: errorMessage,
      },
      agent: {
        id: agent.qualifiedName,
        name: agent.identity?.name ?? agent.name,
      },
      metadata,
    };
  }

  /**
   * Read agent-provided metadata from the configured metadata file
   *
   * Agents can write a JSON file (default: metadata.json in workspace) with
   * arbitrary structured data that gets included in the HookContext.
   * This allows conditional hook execution via the `when` field.
   */
  private async readAgentMetadata(
    agent: ResolvedAgent,
  ): Promise<Record<string, unknown> | undefined> {
    const logger = this.ctx.getLogger();
    const config = this.ctx.getConfig();

    // Determine workspace path (fall back to fleet config directory)
    const workspace = this.resolveAgentWorkspace(agent) ?? config?.configDir;
    if (!workspace) {
      return undefined;
    }

    // Determine metadata file path (default: metadata.json)
    const metadataFileName = agent.metadata_file ?? "metadata.json";
    const metadataPath = join(workspace, metadataFileName);

    try {
      const content = await readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(content);

      if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
        logger.warn(`Agent metadata file ${metadataPath} is not a JSON object, ignoring`);
        return undefined;
      }

      logger.debug(`Read agent metadata from ${metadataPath}`);
      return metadata as Record<string, unknown>;
    } catch (error) {
      // File not found is expected - agent may not write metadata
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }

      // Log other errors but don't fail hook execution
      logger.warn(
        `Failed to read agent metadata from ${metadataPath}: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * Extract the final output from a job's JSONL file
   *
   * Prioritizes assistant text content over tool results since that's what
   * humans care about - the agent's actual response, not raw tool output.
   */
  private async extractJobOutput(jobsDir: string, jobId: string): Promise<string> {
    const logger = this.ctx.getLogger();

    try {
      const messages = await readJobOutputAll(jobsDir, jobId, { logger });

      // Collect all assistant messages with text content (in order)
      const assistantTexts: string[] = [];
      for (const msg of messages) {
        if (msg.type === "assistant" && "content" in msg && msg.content) {
          assistantTexts.push(msg.content);
        }
      }

      // Return the last assistant message if we have any
      if (assistantTexts.length > 0) {
        return assistantTexts[assistantTexts.length - 1];
      }

      // Fallback: look for tool_result with meaningful content
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.type === "tool_result" && "result" in msg && msg.result !== undefined) {
          const result = msg.result;
          return typeof result === "string" ? result : JSON.stringify(result, null, 2);
        }
      }

      return "";
    } catch (error) {
      logger.warn(`Failed to read job output for ${jobId}: ${(error as Error).message}`);
      return "";
    }
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
}
