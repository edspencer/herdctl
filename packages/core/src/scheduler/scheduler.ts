/**
 * Scheduler class for managing agent schedule execution
 *
 * The Scheduler continuously checks all agents' interval and cron schedules and triggers
 * due agents according to their configured schedules.
 */

import { createLogger } from "../utils/logger.js";
import type { ResolvedAgent } from "../config/index.js";
import { calculateNextTrigger, isScheduleDue } from "./interval.js";
import { calculateNextCronTrigger, calculatePreviousCronTrigger, isValidCronExpression } from "./cron.js";
import {
  getScheduleState,
  updateScheduleState,
  type ScheduleStateLogger,
} from "./schedule-state.js";
import type {
  SchedulerOptions,
  SchedulerStatus,
  SchedulerState,
  SchedulerLogger,
  ScheduleCheckResult,
  ScheduleSkipReason,
  TriggerInfo,
  SchedulerTriggerCallback,
  StopOptions,
} from "./types.js";
import { SchedulerShutdownError } from "./errors.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default check interval in milliseconds (1 second)
 */
const DEFAULT_CHECK_INTERVAL = 1000;

/**
 * Default shutdown timeout in milliseconds (30 seconds)
 */
const DEFAULT_SHUTDOWN_TIMEOUT = 30000;

// =============================================================================
// Default Logger
// =============================================================================

/**
 * Create a default console-based logger
 */
function createDefaultLogger(): SchedulerLogger {
  return createLogger("scheduler");
}

// =============================================================================
// Scheduler Class
// =============================================================================

/**
 * Scheduler for managing agent schedule execution
 *
 * The Scheduler runs a polling loop that:
 * 1. Checks all agents' interval and cron schedules on each iteration
 * 2. Skips unsupported schedule types (webhook, chat)
 * 3. Skips disabled schedules
 * 4. Skips agents at max_concurrent capacity
 * 5. Triggers due schedules via the onTrigger callback
 *
 * @example
 * ```typescript
 * const scheduler = new Scheduler({
 *   stateDir: '.herdctl',
 *   checkInterval: 1000, // 1 second
 *   onTrigger: async (info) => {
 *     console.log(`Triggering ${info.agent.name}/${info.scheduleName}`);
 *     await runAgent(info.agent, info.schedule);
 *   },
 * });
 *
 * // Start the scheduler
 * await scheduler.start(agents);
 *
 * // Later, stop the scheduler
 * await scheduler.stop();
 * ```
 */
export class Scheduler {
  private readonly checkInterval: number;
  private readonly stateDir: string;
  private readonly logger: SchedulerLogger;
  private readonly onTrigger?: SchedulerTriggerCallback;

  private status: SchedulerStatus = "stopped";
  private abortController: AbortController | null = null;
  private agents: ResolvedAgent[] = [];
  private runningSchedules: Map<string, Set<string>> = new Map();
  private runningJobs: Map<string, Promise<void>> = new Map();

  private startedAt: string | null = null;
  private checkCount = 0;
  private triggerCount = 0;
  private lastCheckAt: string | null = null;

  constructor(options: SchedulerOptions) {
    this.checkInterval = options.checkInterval ?? DEFAULT_CHECK_INTERVAL;
    this.stateDir = options.stateDir;
    this.logger = options.logger ?? createDefaultLogger();
    this.onTrigger = options.onTrigger;
  }

  /**
   * Check if the scheduler is currently running
   */
  isRunning(): boolean {
    return this.status === "running";
  }

  /**
   * Get the current scheduler status
   */
  getStatus(): SchedulerStatus {
    return this.status;
  }

  /**
   * Get detailed scheduler state for monitoring
   */
  getState(): SchedulerState {
    return {
      status: this.status,
      startedAt: this.startedAt,
      checkCount: this.checkCount,
      triggerCount: this.triggerCount,
      lastCheckAt: this.lastCheckAt,
    };
  }

  /**
   * Start the scheduler polling loop
   *
   * @param agents - The agents to schedule
   * @throws Error if scheduler is already running
   */
  async start(agents: ResolvedAgent[]): Promise<void> {
    if (this.status === "running") {
      throw new Error("Scheduler is already running");
    }

    if (this.status === "stopping") {
      throw new Error("Scheduler is stopping, wait for it to complete");
    }

    this.agents = agents;
    this.status = "running";
    this.abortController = new AbortController();
    this.startedAt = new Date().toISOString();
    this.checkCount = 0;
    this.triggerCount = 0;
    this.runningSchedules.clear();
    this.runningJobs.clear();

    this.logger.debug(
      `Scheduler started with ${agents.length} agents, check interval: ${this.checkInterval}ms`
    );

    // Run the polling loop
    await this.runLoop();
  }

  /**
   * Stop the scheduler gracefully
   *
   * Signals the polling loop to stop and optionally waits for running jobs to complete.
   *
   * @param options - Options for shutdown behavior
   * @param options.waitForJobs - Whether to wait for running jobs to complete (default: true)
   * @param options.timeout - Maximum time to wait for jobs in milliseconds (default: 30000)
   * @throws SchedulerShutdownError if timeout is reached while waiting for jobs
   */
  async stop(options?: StopOptions): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    const waitForJobs = options?.waitForJobs ?? true;
    const timeout = options?.timeout ?? DEFAULT_SHUTDOWN_TIMEOUT;

    this.status = "stopping";
    this.logger.info("Scheduler stopping...");

    // Signal the loop to stop - this prevents new triggers from starting
    this.abortController?.abort();

    // Wait a tick for the loop to recognize the abort
    await new Promise((resolve) => setImmediate(resolve));

    // Optionally wait for running jobs to complete
    if (waitForJobs && this.runningJobs.size > 0) {
      this.logger.info(
        `Waiting for ${this.runningJobs.size} running job(s) to complete...`
      );

      const runningJobPromises = Array.from(this.runningJobs.values());

      // Create a timeout promise
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), timeout);
      });

      // Race all running jobs against the timeout
      const result = await Promise.race([
        Promise.all(runningJobPromises).then(() => "completed" as const),
        timeoutPromise,
      ]);

      if (result === "timeout") {
        const runningJobCount = this.runningJobs.size;
        this.status = "stopped";
        this.abortController = null;
        this.logger.error(
          `Shutdown timed out with ${runningJobCount} job(s) still running`
        );
        throw new SchedulerShutdownError(
          `Scheduler shutdown timed out after ${timeout}ms with ${runningJobCount} job(s) still running`,
          { timedOut: true, runningJobCount }
        );
      }

      this.logger.info("All running jobs completed");
    }

    this.status = "stopped";
    this.abortController = null;
    this.logger.info("Scheduler stopped");
  }

  /**
   * Update the list of agents to schedule
   *
   * Can be called while the scheduler is running to add/remove agents.
   */
  setAgents(agents: ResolvedAgent[]): void {
    this.agents = agents;
    this.logger.debug(`Updated agents list: ${agents.length} agents`);
  }

  /**
   * Main polling loop
   */
  private async runLoop(): Promise<void> {
    const signal = this.abortController?.signal;

    while (this.status === "running" && !signal?.aborted) {
      try {
        await this.checkAllSchedules();
      } catch (error) {
        this.logger.error(
          `Error during schedule check: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Sleep until next check, but allow interruption via AbortController
      if (this.status === "running" && !signal?.aborted) {
        await this.sleep(this.checkInterval, signal);
      }
    }
  }

  /**
   * Sleep for the specified duration, interruptible via AbortSignal
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);

      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }

  /**
   * Check all agents' schedules and trigger due ones
   */
  private async checkAllSchedules(): Promise<void> {
    this.checkCount++;
    this.lastCheckAt = new Date().toISOString();

    for (const agent of this.agents) {
      if (!agent.schedules) {
        continue;
      }

      for (const [scheduleName, schedule] of Object.entries(agent.schedules)) {
        const result = await this.checkSchedule(agent, scheduleName, schedule);

        if (result.shouldTrigger) {
          await this.triggerSchedule(agent, scheduleName, schedule);
        }
      }
    }
  }

  /**
   * Check if a single schedule should be triggered
   */
  private async checkSchedule(
    agent: ResolvedAgent,
    scheduleName: string,
    schedule: { type: string; interval?: string; expression?: string; enabled?: boolean }
  ): Promise<ScheduleCheckResult> {
    const baseResult = {
      agentName: agent.name,
      scheduleName,
    };

    // Skip disabled schedules (config-level check)
    if (schedule.enabled === false) {
      this.logger.debug(
        `Skipping ${agent.name}/${scheduleName}: schedule is disabled in config`
      );
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "disabled" as ScheduleSkipReason,
      };
    }

    // Skip unsupported schedule types (webhook, chat)
    if (schedule.type !== "interval" && schedule.type !== "cron") {
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "unsupported_type" as ScheduleSkipReason,
      };
    }

    // Get current schedule state
    const stateLogger: ScheduleStateLogger = { warn: this.logger.warn };
    const scheduleState = await getScheduleState(
      this.stateDir,
      agent.name,
      scheduleName,
      { logger: stateLogger }
    );

    // Skip disabled schedules
    if (scheduleState.status === "disabled") {
      this.logger.debug(
        `Skipping ${agent.name}/${scheduleName}: schedule is disabled`
      );
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "disabled" as ScheduleSkipReason,
      };
    }

    // Skip if already running (tracked locally)
    const agentRunning = this.runningSchedules.get(agent.name);
    if (agentRunning?.has(scheduleName)) {
      this.logger.debug(
        `Skipping ${agent.name}/${scheduleName}: already running`
      );
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "already_running" as ScheduleSkipReason,
      };
    }

    // Check max_concurrent capacity
    const maxConcurrent = agent.session?.max_turns
      ? 1
      : this.getMaxConcurrent(agent);
    const runningCount = agentRunning?.size ?? 0;

    if (runningCount >= maxConcurrent) {
      this.logger.debug(
        `Skipping ${agent.name}/${scheduleName}: at max capacity (${runningCount}/${maxConcurrent})`
      );
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "at_capacity" as ScheduleSkipReason,
      };
    }

    // Calculate next trigger time based on schedule type
    const lastRunAt = scheduleState.last_run_at
      ? new Date(scheduleState.last_run_at)
      : null;

    let nextTrigger: Date;

    if (schedule.type === "interval") {
      if (!schedule.interval) {
        this.logger.warn(
          `Skipping ${agent.name}/${scheduleName}: interval schedule missing interval value`
        );
        return {
          ...baseResult,
          shouldTrigger: false,
          skipReason: "unsupported_type" as ScheduleSkipReason,
        };
      }
      nextTrigger = calculateNextTrigger(lastRunAt, schedule.interval);
    } else {
      // schedule.type === "cron"
      if (!schedule.expression) {
        this.logger.warn(
          `Skipping ${agent.name}/${scheduleName}: cron schedule missing expression value`
        );
        return {
          ...baseResult,
          shouldTrigger: false,
          skipReason: "unsupported_type" as ScheduleSkipReason,
        };
      }

      // Validate cron expression (defense in depth - should be validated at config load time)
      if (!isValidCronExpression(schedule.expression)) {
        this.logger.warn(
          `Skipping ${agent.name}/${scheduleName}: invalid cron expression "${schedule.expression}"`
        );
        return {
          ...baseResult,
          shouldTrigger: false,
          skipReason: "unsupported_type" as ScheduleSkipReason,
        };
      }

      const now = new Date();

      if (lastRunAt) {
        // Calculate next cron occurrence after the last run.
        // When this time is <= now, isScheduleDue() will trigger it.
        // When it's in the future, the schedule waits.
        // If multiple occurrences were missed (e.g. scheduler was down),
        // only one catch-up trigger fires because last_run_at updates to now
        // on trigger, making the next calculation return a future time.
        nextTrigger = calculateNextCronTrigger(schedule.expression, lastRunAt);
      } else {
        // For NEW cron schedules (no lastRunAt), determine if we're in a "trigger window"
        // We use the previous cron time as a reference point and compare with current time
        const previousTrigger = calculatePreviousCronTrigger(schedule.expression);
        const nextFutureTrigger = calculateNextCronTrigger(schedule.expression);

        // Calculate the cron interval (time between previous and next)
        const intervalMs = nextFutureTrigger.getTime() - previousTrigger.getTime();

        // Allow triggering if we're within the first portion of the interval after a cron time
        // For very fast crons (<= 1 minute), use half the interval
        // For slower crons, use 1/60th of the interval (capped at 5 minutes)
        const triggerWindowMs = intervalMs <= 60000
          ? Math.floor(intervalMs / 2) // Half interval for fast crons (up to 30s for 1-minute cron)
          : Math.min(Math.floor(intervalMs / 60), 5 * 60 * 1000); // Max 5 minutes

        const timeSincePrevious = now.getTime() - previousTrigger.getTime();

        if (timeSincePrevious <= triggerWindowMs) {
          // We're within the trigger window after the previous cron time
          // Use previousTrigger as nextTrigger so we're "due"
          nextTrigger = previousTrigger;
        } else {
          // We're past the trigger window, wait for the next scheduled time
          nextTrigger = nextFutureTrigger;
        }
      }
    }

    // Check if schedule is due
    if (!isScheduleDue(nextTrigger)) {
      return {
        ...baseResult,
        shouldTrigger: false,
        skipReason: "not_due" as ScheduleSkipReason,
      };
    }

    return {
      ...baseResult,
      shouldTrigger: true,
    };
  }

  /**
   * Get max_concurrent for an agent, defaulting to 1
   *
   * Reads from agent.instances.max_concurrent, which may come from:
   * - Agent-specific config
   * - Fleet defaults (merged during config loading)
   */
  private getMaxConcurrent(agent: ResolvedAgent): number {
    return agent.instances?.max_concurrent ?? 1;
  }

  /**
   * Get the count of currently running jobs for a specific agent
   *
   * This is useful for monitoring and debugging concurrency behavior.
   *
   * @param agentName - The name of the agent to check
   * @returns The number of currently running jobs for this agent
   */
  getRunningJobCount(agentName: string): number {
    return this.runningSchedules.get(agentName)?.size ?? 0;
  }

  /**
   * Get the total count of running jobs across all agents
   *
   * This is useful for monitoring overall scheduler load.
   *
   * @returns The total number of currently running jobs
   */
  getTotalRunningJobCount(): number {
    return this.runningJobs.size;
  }

  /**
   * Trigger a schedule and update state
   */
  private async triggerSchedule(
    agent: ResolvedAgent,
    scheduleName: string,
    schedule: { type: string; interval?: string; expression?: string; prompt?: string }
  ): Promise<void> {
    this.logger.info(`Triggering ${agent.name}/${scheduleName}`);
    this.triggerCount++;

    // Create a unique key for this job
    const jobKey = `${agent.name}/${scheduleName}`;

    // Mark schedule as running
    if (!this.runningSchedules.has(agent.name)) {
      this.runningSchedules.set(agent.name, new Set());
    }
    this.runningSchedules.get(agent.name)!.add(scheduleName);

    const stateLogger: ScheduleStateLogger = { warn: this.logger.warn };

    // Update schedule state to running
    await updateScheduleState(
      this.stateDir,
      agent.name,
      scheduleName,
      {
        status: "running",
        last_run_at: new Date().toISOString(),
      },
      { logger: stateLogger }
    );

    // Create and track the job promise
    const jobPromise = this.executeJob(agent, scheduleName, schedule);
    this.runningJobs.set(jobKey, jobPromise);

    try {
      await jobPromise;
    } finally {
      // Remove from running jobs tracking
      this.runningJobs.delete(jobKey);
    }
  }

  /**
   * Execute the actual job logic
   */
  private async executeJob(
    agent: ResolvedAgent,
    scheduleName: string,
    schedule: { type: string; interval?: string; expression?: string; prompt?: string }
  ): Promise<void> {
    const stateLogger: ScheduleStateLogger = { warn: this.logger.warn };

    try {
      // Get current schedule state for trigger info
      const scheduleState = await getScheduleState(
        this.stateDir,
        agent.name,
        scheduleName,
        { logger: stateLogger }
      );

      // Invoke the trigger callback if provided
      if (this.onTrigger) {
        const triggerInfo: TriggerInfo = {
          agent,
          scheduleName,
          schedule: schedule as TriggerInfo["schedule"],
          scheduleState,
        };

        await this.onTrigger(triggerInfo);
      }

      // Calculate next trigger time based on schedule type
      let nextTrigger: Date | null = null;
      if (schedule.type === "interval" && schedule.interval) {
        nextTrigger = calculateNextTrigger(new Date(), schedule.interval);
      } else if (schedule.type === "cron" && schedule.expression) {
        nextTrigger = calculateNextCronTrigger(schedule.expression);
      }

      // Update schedule state to idle with next run time
      await updateScheduleState(
        this.stateDir,
        agent.name,
        scheduleName,
        {
          status: "idle",
          next_run_at: nextTrigger?.toISOString() ?? null,
          last_error: null,
        },
        { logger: stateLogger }
      );

      this.logger.info(`Completed ${agent.name}/${scheduleName}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Update schedule state with error
      await updateScheduleState(
        this.stateDir,
        agent.name,
        scheduleName,
        {
          status: "idle",
          last_error: errorMessage,
        },
        { logger: stateLogger }
      );

      this.logger.error(`Error in ${agent.name}/${scheduleName}: ${errorMessage}`);
    } finally {
      // Mark schedule as no longer running
      this.runningSchedules.get(agent.name)?.delete(scheduleName);
    }
  }
}
