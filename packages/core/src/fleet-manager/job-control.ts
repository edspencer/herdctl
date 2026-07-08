/**
 * Job Control Module
 *
 * Centralizes all job control logic for FleetManager.
 * Provides methods to trigger, cancel, and fork jobs.
 *
 * @module job-control
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { HookEvent, ResolvedAgent } from "../config/index.js";
import { type HookContext, HookExecutor } from "../hooks/index.js";
import {
  JobExecutor,
  RuntimeFactory,
  type RuntimeSession,
  SDKRuntime,
  type SlashCommand,
} from "../runner/index.js";
import { createJob, getJob, getSessionInfo, readJobOutputAll, updateJob } from "../state/index.js";
import type { JobMetadata } from "../state/schemas/job-metadata.js";
import type { FleetManagerContext } from "./context.js";
import {
  AgentNotFoundError,
  ConcurrencyLimitError,
  InvalidStateError,
  InvalidWorkingDirectoryOverrideError,
  JobCancelError,
  JobForkError,
  JobNotFoundError,
  ScheduleNotFoundError,
  StreamingSessionUnsupportedError,
} from "./errors.js";
import type {
  AgentInfo,
  CancelJobResult,
  ChatSessionOptions,
  ForkJobResult,
  JobModifications,
  TriggerOptions,
  TriggerResult,
} from "./types.js";

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
  /**
   * In-memory registry of currently-running jobs to their AbortController, keyed
   * by job id. A job is registered the moment its id is known (via the executor's
   * `onJobCreated`) and removed when the run finishes. {@link cancelJob} consults
   * this to actually interrupt a live run — without it, cancelling only rewrote
   * the job's status file while the agent process kept running.
   */
  private readonly runningControllers = new Map<string, AbortController>();

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

    // Apply a per-trigger working-directory override, if provided. We build an
    // "effective agent" — a shallow clone of the resolved agent with its
    // working_directory replaced — and pass that to the runtime and executor.
    // Every cwd-dependent consumer (RuntimeFactory/CLI cwd, toSDKOptions cwd,
    // Docker workspace mount, and session/transcript resolution) reads
    // agent.working_directory, so swapping it at this single chokepoint makes
    // them all honor the override without changing default behavior when the
    // option is omitted.
    const effectiveAgent = applyWorkingDirectoryOverride(agent, options?.workingDirectory);

    // Determine the prompt to use (priority: options > schedule > agent default > fallback)
    const prompt =
      options?.prompt ?? schedule?.prompt ?? agent.default_prompt ?? "Execute your configured task";

    const timestamp = new Date().toISOString();

    logger.debug(`Manually triggered ${agentName}${scheduleName ? `/${scheduleName}` : ""}`);

    // Get existing session for conversation continuity (unless explicitly provided)
    // This prevents unexpected logouts by automatically resuming the agent's session
    // Note: resume=null means "explicitly start fresh" (e.g. new Slack thread),
    // while resume=undefined means "use fallback session lookup"
    // A fork names its own source session (options.fork) and must NOT inherit
    // the agent's last session as a resume target — skip the fallback lookup.
    let sessionId = options?.resume ?? undefined;
    if (sessionId === undefined && options?.resume !== null && !options?.fork) {
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

    // Create the JobExecutor and execute the job.
    // Use the effective agent so a per-trigger working-directory override flows
    // into the runtime (process cwd / SDK cwd / Docker workspace mount) and into
    // session/transcript resolution.
    const runtime = RuntimeFactory.create(effectiveAgent, { stateDir });
    const executor = new JobExecutor(runtime, { logger });

    // Cancellation support: give this run an AbortController and register it under
    // its job id (known once the executor creates the job record, via
    // onJobCreated) so cancelJob() can actually interrupt the live process — the
    // CLI runtime kills its subprocess on this signal, the SDK runtime aborts its
    // query. Registered on creation, removed in the finally below.
    const abortController = new AbortController();
    let registeredJobId: string | undefined;

    // Execute the job - this creates the job record and runs it
    // Note: Job output is written to JSONL by JobExecutor; log streaming picks it up
    // If onMessage callback is provided, it will be called for each SDK message
    let result: Awaited<ReturnType<typeof executor.execute>>;
    try {
      result = await executor.execute({
        agent: effectiveAgent,
        prompt,
        stateDir,
        triggerType: (options?.triggerType ??
          "manual") as import("../state/schemas/job-metadata.js").TriggerType,
        schedule: scheduleName,
        outputToFile: schedule?.outputToFile ?? false,
        onMessage: options?.onMessage,
        onJobCreated: (id) => {
          registeredJobId = id;
          this.runningControllers.set(id, abortController);
          options?.onJobCreated?.(id);
        },
        resume: sessionId,
        fork: options?.fork,
        forkedFrom: options?.forkedFrom,
        injectedMcpServers: options?.injectedMcpServers,
        systemPromptAppend: options?.systemPromptAppend,
        abortController,
      });
    } finally {
      if (registeredJobId) {
        this.runningControllers.delete(registeredJobId);
      }
    }

    // If the run was cancelled mid-flight, cancelJob() has already recorded the
    // cancellation and emitted job:cancelled — don't also emit a job:completed /
    // job:failed for the aborted run.
    if (abortController.signal.aborted) {
      logger.info(`Job ${result.jobId} was cancelled`);
      return {
        jobId: result.jobId,
        agentName,
        scheduleName: scheduleName ?? null,
        startedAt: timestamp,
        prompt,
        success: false,
        sessionId: result.sessionId,
        error: result.error,
        errorDetails: result.errorDetails,
      };
    }

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

        // Execute hooks for completed job (effective agent so hook cwd matches
        // the directory this job actually ran in when an override was used)
        await this.executeHooks(effectiveAgent, jobMetadata, "completed", scheduleName);
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

        // Execute hooks for failed job (effective agent — see completed case)
        await this.executeHooks(effectiveAgent, jobMetadata, "failed", scheduleName, error.message);
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
   * Open a long-lived streaming chat session for an agent.
   *
   * Resolves the agent using the same working-directory-override and session
   * resume semantics as {@link trigger}, then returns a live {@link RuntimeSession}
   * backed by the SDK's streaming-input mode. Unlike {@link trigger}, this does
   * **not** create a job record or drain to completion — it hands back a handle
   * the caller drives across many turns and must {@link RuntimeSession.close}
   * when finished.
   *
   * This is the entry point for interactive features that need the SDK's control
   * requests: sending follow-up turns, running slash commands like `/compact`
   * (sent as user messages), interrupting the current turn, and listing the
   * available commands. Those are only available in streaming mode.
   *
   * The session always runs on the SDK runtime (the only streaming-capable one),
   * regardless of the agent's configured `runtime` — see the body for why this is
   * safe for `cli`-configured agents.
   *
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {StreamingSessionUnsupportedError} If the agent is Docker-wrapped
   *   (the container runner wraps batch execution, not this streaming path)
   */
  async openChatSession(agentName: string, options?: ChatSessionOptions): Promise<RuntimeSession> {
    const status = this.ctx.getStatus();
    const config = this.ctx.getConfig();
    const stateDir = this.ctx.getStateDir();
    const logger = this.ctx.getLogger();

    // Validate state
    if (status === "uninitialized") {
      throw new InvalidStateError("openChatSession", status, ["initialized", "running", "stopped"]);
    }

    // Find the agent by qualified name
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.qualifiedName === agentName);
    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    // Apply a per-session working-directory override, mirroring trigger().
    const effectiveAgent = applyWorkingDirectoryOverride(agent, options?.workingDirectory);

    // Resolve resume session id (same precedence as trigger): explicit value
    // wins; null = fresh; undefined = fall back to the agent's stored session.
    let sessionId = options?.resume ?? undefined;
    if (sessionId === undefined && options?.resume !== null) {
      try {
        const sessionsDir = join(stateDir, "sessions");
        const sessionTimeout = agent.session?.timeout ?? "24h";
        const existingSession = await getSessionInfo(sessionsDir, agent.qualifiedName, {
          timeout: sessionTimeout,
          logger,
        });
        if (existingSession?.session_id) {
          sessionId = existingSession.session_id;
          logger.debug(`Resuming session for ${agent.qualifiedName}: ${sessionId}`);
        }
      } catch (error) {
        logger.warn(
          `Failed to get session info for ${agent.qualifiedName}: ${(error as Error).message}`,
        );
        // Continue without resume — session failure shouldn't block the session.
      }
    }

    // Streaming sessions ALWAYS run on the SDK runtime — it is the only runtime
    // whose control requests (interrupt / supportedCommands / streamInput) are
    // available, and they are "only supported when streaming input/output is
    // used". The agent's configured `runtime` governs batch/trigger execution
    // (e.g. `cli` for Claude subscription auth); a streaming session uses the SDK
    // runtime independently, authenticating the same way (CLAUDE_CODE_OAUTH_TOKEN)
    // and sharing the on-disk session store, so a session created by the CLI
    // runtime resumes cleanly here. Docker-wrapped agents are unsupported: the
    // container runner wraps the batch runtime, not this streaming path.
    if (effectiveAgent.docker?.enabled) {
      throw new StreamingSessionUnsupportedError(agentName, { runtime: "docker" });
    }

    const runtime = new SDKRuntime();
    logger.info(`Opening streaming chat session for ${agentName} (sdk runtime)`);
    return runtime.openSession({
      agent: effectiveAgent,
      prompt: options?.prompt ?? "",
      resume: sessionId,
      injectedMcpServers: options?.injectedMcpServers,
      systemPromptAppend: options?.systemPromptAppend,
    });
  }

  /**
   * List the slash commands available to an agent in one shot.
   *
   * A convenience over {@link openChatSession}: it opens a streaming session,
   * queries {@link RuntimeSession.listCommands}, and **always closes the session**
   * (in a `finally`, even if the listing throws) so callers never have to manage
   * the underlying `claude` subprocess lifecycle themselves. Use it to populate a
   * slash-command autocomplete without hand-holding a live session.
   *
   * The returned list is the full `SlashCommand[]` — `{ name, description,
   * argumentHint }` per command (built-ins + project `.claude/commands` + any
   * MCP-provided commands, exactly as the CLI reports them for the resolved
   * session's cwd/config). Pass the same {@link ChatSessionOptions} as
   * `openChatSession` (notably `workingDirectory` and `injectedMcpServers`) so the
   * list reflects the intended project context.
   *
   * **Cost:** each call spawns and tears down a `claude` subprocess (~seconds).
   * The command list is essentially static per project, so callers that query it
   * repeatedly should cache the result.
   *
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {StreamingSessionUnsupportedError} If the agent is Docker-wrapped
   *   (surfaced unchanged from {@link openChatSession})
   */
  async listAgentCommands(
    agentName: string,
    options?: ChatSessionOptions,
  ): Promise<SlashCommand[]> {
    const session = await this.openChatSession(agentName, options);
    try {
      return await session.listCommands();
    } finally {
      // Guarantee teardown of the underlying subprocess on every path,
      // including when listCommands() throws.
      await session.close();
    }
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
    const _timeout = options?.timeout ?? 10000;

    // Get the job to verify it exists and check its status
    const job = await getJob(jobsDir, jobId, { logger });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    // Actually interrupt the live run. If this process is executing the job, its
    // AbortController is registered here — aborting it kills the CLI subprocess /
    // aborts the SDK query, so the agent genuinely stops (rather than only having
    // its status file rewritten while it keeps running). Jobs owned by another
    // process won't be in the registry; those fall back to the status-file update
    // below (best-effort, unchanged behavior).
    const controller = this.runningControllers.get(jobId);
    if (controller) {
      logger.info(`Aborting in-flight job ${jobId}`);
      controller.abort();
      this.runningControllers.delete(jobId);
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

/**
 * Apply a per-trigger working-directory override to a resolved agent.
 *
 * Returns a shallow clone of `agent` whose `working_directory` is replaced with
 * the (normalized, absolute) override. When `override` is `undefined`, the
 * original agent is returned unchanged so default behavior is preserved exactly.
 *
 * The override is validated to be a non-empty string and is resolved to an
 * absolute path against `process.cwd()` when relative — matching how
 * `addAgent` / the config loader normalize a relative `working_directory`.
 *
 * @param agent - The resolved agent from the loaded config
 * @param override - Optional per-trigger working directory (absolute or relative)
 * @returns The original agent (no override) or a clone with the override applied
 * @throws {InvalidWorkingDirectoryOverrideError} If the override is provided but
 *   not a non-empty string
 */
function applyWorkingDirectoryOverride(
  agent: ResolvedAgent,
  override: string | undefined,
): ResolvedAgent {
  if (override === undefined) {
    return agent;
  }

  if (typeof override !== "string" || override.trim() === "") {
    throw new InvalidWorkingDirectoryOverrideError(override);
  }

  // Resolve relative overrides to absolute paths so session/transcript lookup
  // (which encodes the absolute cwd) matches what Claude Code actually uses.
  const absolute = isAbsolute(override) ? override : resolve(process.cwd(), override);

  return {
    ...agent,
    working_directory: absolute,
  };
}
