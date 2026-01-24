/**
 * Job Control Module
 *
 * Centralizes all job control logic for FleetManager.
 * Provides methods to trigger, cancel, and fork jobs.
 *
 * @module job-control
 */

import { join } from "node:path";

import { createJob, getJob, updateJob } from "../state/index.js";
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
    private getAgentInfoFn: () => Promise<AgentInfo[]>
  ) {}

  /**
   * Manually trigger an agent outside its normal schedule
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
    options?: TriggerOptions
  ): Promise<TriggerResult> {
    const status = this.ctx.getStatus();
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    const scheduler = this.ctx.getScheduler();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError(
        "trigger",
        status,
        ["initialized", "running", "stopped"]
      );
    }

    // Find the agent
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    // If a schedule name is provided, validate it exists
    let schedule: { type: string; prompt?: string } | undefined;
    if (scheduleName) {
      if (!agent.schedules || !(scheduleName in agent.schedules)) {
        const availableSchedules = agent.schedules
          ? Object.keys(agent.schedules)
          : [];
        throw new ScheduleNotFoundError(agentName, scheduleName, {
          availableSchedules,
        });
      }
      schedule = agent.schedules[scheduleName];
    }

    // Check concurrency limits unless bypassed
    if (!options?.bypassConcurrencyLimit) {
      const maxConcurrent = agent.instances?.max_concurrent ?? 1;
      const runningCount = scheduler?.getRunningJobCount(agentName) ?? 0;

      if (runningCount >= maxConcurrent) {
        throw new ConcurrencyLimitError(agentName, runningCount, maxConcurrent);
      }
    }

    // Determine the prompt to use
    const prompt = options?.prompt ?? schedule?.prompt ?? undefined;

    // Create the job
    const jobsDir = join(stateDir, "jobs");
    const job = await createJob(jobsDir, {
      agent: agentName,
      trigger_type: "manual",
      schedule: scheduleName ?? null,
      prompt: prompt ?? null,
    });

    const timestamp = new Date().toISOString();

    logger.info(
      `Manually triggered ${agentName}${scheduleName ? `/${scheduleName}` : ""} - job ${job.id}`
    );

    // Emit job:created event
    emitter.emit("job:created", {
      job,
      agentName,
      scheduleName: scheduleName ?? null,
      timestamp,
    });

    // Build and return the result
    return {
      jobId: job.id,
      agentName,
      scheduleName: scheduleName ?? null,
      startedAt: job.started_at,
      prompt,
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
  async cancelJob(
    jobId: string,
    options?: { timeout?: number }
  ): Promise<CancelJobResult> {
    const status = this.ctx.getStatus();
    const stateDir = this.ctx.getStateDir();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError(
        "cancelJob",
        status,
        ["initialized", "running", "stopped"]
      );
    }

    const jobsDir = join(stateDir, "jobs");
    const timeout = options?.timeout ?? 10000;

    // Get the job to verify it exists and check its status
    const job = await getJob(jobsDir, jobId, { logger });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const timestamp = new Date().toISOString();
    let terminationType: 'graceful' | 'forced' | 'already_stopped';
    let durationSeconds: number | undefined;

    // If job is already not running, return early
    if (job.status !== "running" && job.status !== "pending") {
      logger.info(
        `Job ${jobId} is already ${job.status}, no cancellation needed`
      );

      terminationType = 'already_stopped';

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

      terminationType = 'graceful';

    } catch (error) {
      logger.error(
        `Failed to update job status: ${(error as Error).message}`
      );
      throw new JobCancelError(jobId, 'process_error', {
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

    logger.info(
      `Job ${jobId} cancelled (${terminationType}) after ${durationSeconds}s`
    );

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
  async forkJob(
    jobId: string,
    modifications?: JobModifications
  ): Promise<ForkJobResult> {
    const status = this.ctx.getStatus();
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    const logger = this.ctx.getLogger();
    const emitter = this.ctx.getEmitter();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError(
        "forkJob",
        status,
        ["initialized", "running", "stopped"]
      );
    }

    const jobsDir = join(stateDir, "jobs");

    // Get the original job
    const originalJob = await getJob(jobsDir, jobId, { logger });

    if (!originalJob) {
      throw new JobForkError(jobId, 'job_not_found');
    }

    // Verify the agent exists in config
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === originalJob.agent);

    if (!agent) {
      throw new JobForkError(jobId, 'agent_not_found', {
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

    logger.info(
      `Forked job ${jobId} to new job ${newJob.id} for agent ${originalJob.agent}`
    );

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
        logger.debug(
          `Cancelled job ${jobId}: ${result.terminationType}`
        );
      } catch (error) {
        logger.warn(
          `Failed to cancel job ${jobId}: ${(error as Error).message}`
        );
      }
    });

    await Promise.all(cancelPromises);
    logger.info("All jobs cancelled");
  }
}
