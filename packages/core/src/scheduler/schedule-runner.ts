/**
 * Schedule Runner for executing triggered schedules
 *
 * Handles the actual execution of scheduled work by:
 * 1. Fetching work items from work sources (if configured)
 * 2. Building prompts from schedule config and work items
 * 3. Invoking the JobExecutor to run the agent
 * 4. Updating schedule state and reporting outcomes
 */

import { createLogger } from "../utils/logger.js";
import type { ResolvedAgent, Schedule } from "../config/index.js";
import type { ScheduleState } from "../state/schemas/fleet-state.js";
import type { RunnerResult } from "../runner/index.js";
import type {
  WorkSourceManager,
  WorkItem,
  WorkResult,
  WorkOutcome,
} from "../work-sources/index.js";
import { join } from "node:path";
import { JobExecutor, RuntimeFactory, type JobExecutorOptions } from "../runner/index.js";
import { getSessionInfo } from "../state/index.js";
import {
  updateScheduleState,
  type ScheduleStateLogger,
} from "./schedule-state.js";
import { calculateNextTrigger } from "./interval.js";
import { calculateNextCronTrigger } from "./cron.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for schedule runner
 */
export interface ScheduleRunnerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Trigger metadata passed to the JobExecutor
 */
export interface TriggerMetadata {
  /** The type of trigger (interval or cron) */
  triggerType: "interval" | "cron";
  /** The name of the schedule that triggered */
  schedule: string;
  /** Work item ID if this run is processing a work item */
  workItemId?: string;
  /** Work item title for reference */
  workItemTitle?: string;
}

/**
 * Options for running a schedule
 */
export interface RunScheduleOptions {
  /** The agent to run */
  agent: ResolvedAgent;
  /** The name of the schedule */
  scheduleName: string;
  /** The schedule configuration */
  schedule: Schedule;
  /** Current schedule state */
  scheduleState: ScheduleState;
  /** Path to the state directory (e.g., .herdctl) */
  stateDir: string;
  /** Optional work source manager for fetching work items */
  workSourceManager?: WorkSourceManager;
  /** Optional logger */
  logger?: ScheduleRunnerLogger;
  /** Optional job executor options */
  executorOptions?: JobExecutorOptions;
}

/**
 * Result of running a schedule, extending RunnerResult with schedule-specific info
 */
export interface ScheduleRunResult extends RunnerResult {
  /** The work item that was processed (if any) */
  workItem?: WorkItem;
  /** Whether a work item was fetched and processed */
  processedWorkItem: boolean;
}

// =============================================================================
// Default Logger
// =============================================================================

const defaultLogger: ScheduleRunnerLogger = createLogger("schedule-runner");

// =============================================================================
// Build Schedule Prompt
// =============================================================================

/**
 * Build the prompt for a scheduled run
 *
 * Constructs the prompt by combining:
 * 1. The schedule's configured prompt (if any)
 * 2. Work item details (if a work item was fetched)
 *
 * @param schedule - The schedule configuration
 * @param workItem - Optional work item fetched from work source
 * @returns The constructed prompt string
 *
 * @example Without work item
 * ```typescript
 * const prompt = buildSchedulePrompt(
 *   { type: 'interval', interval: '1h', prompt: 'Check for updates' }
 * );
 * // => "Check for updates"
 * ```
 *
 * @example With work item
 * ```typescript
 * const prompt = buildSchedulePrompt(
 *   { type: 'interval', interval: '1h', prompt: 'Process this issue:' },
 *   { title: 'Fix bug', description: 'There is a bug in auth.ts', ... }
 * );
 * // => "Process this issue:\n\n## Work Item: Fix bug\n\nThere is a bug in auth.ts\n\n..."
 * ```
 */
export function buildSchedulePrompt(
  schedule: Schedule,
  workItem?: WorkItem
): string {
  const parts: string[] = [];

  // Add schedule prompt if configured
  if (schedule.prompt) {
    parts.push(schedule.prompt);
  }

  // Add work item details if provided
  if (workItem) {
    const workItemSection = formatWorkItem(workItem);
    parts.push(workItemSection);
  }

  // If no prompt and no work item, provide a default
  if (parts.length === 0) {
    return "Execute scheduled task.";
  }

  return parts.join("\n\n");
}

/**
 * Format a work item for inclusion in a prompt
 */
function formatWorkItem(workItem: WorkItem): string {
  const lines: string[] = [];

  lines.push(`## Work Item: ${workItem.title}`);
  lines.push("");

  if (workItem.description) {
    lines.push(workItem.description);
    lines.push("");
  }

  // Add metadata
  const metadata: string[] = [];
  metadata.push(`- **Source:** ${workItem.source}`);
  metadata.push(`- **ID:** ${workItem.externalId}`);
  metadata.push(`- **Priority:** ${workItem.priority}`);

  if (workItem.labels.length > 0) {
    metadata.push(`- **Labels:** ${workItem.labels.join(", ")}`);
  }

  if (workItem.url) {
    metadata.push(`- **URL:** ${workItem.url}`);
  }

  lines.push(metadata.join("\n"));

  return lines.join("\n");
}

// =============================================================================
// Run Schedule
// =============================================================================

/**
 * Execute a triggered schedule
 *
 * This function handles the complete lifecycle of a scheduled execution:
 * 1. Updates schedule state to 'running'
 * 2. Fetches work item from work source (if configured)
 * 3. Builds the prompt from schedule config and work item
 * 4. Invokes the JobExecutor to run the agent
 * 5. Reports outcome to work source (if applicable)
 * 6. Updates schedule state with last_run_at and next_run_at
 *
 * @param options - Options for running the schedule
 * @returns Result of the schedule execution
 *
 * @example Basic usage
 * ```typescript
 * const result = await runSchedule({
 *   agent: resolvedAgent,
 *   scheduleName: 'hourly',
 *   schedule: { type: 'interval', interval: '1h', prompt: 'Check status' },
 *   scheduleState: { status: 'idle', last_run_at: null },
 *   stateDir: '.herdctl',
 * });
 *
 * console.log(`Job ${result.jobId} completed: ${result.success}`);
 * ```
 *
 * @example With work source
 * ```typescript
 * const result = await runSchedule({
 *   agent: resolvedAgent,
 *   scheduleName: 'issue-processor',
 *   schedule: {
 *     type: 'interval',
 *     interval: '5m',
 *     prompt: 'Process this GitHub issue:',
 *     work_source: { type: 'github', owner: 'org', repo: 'repo' }
 *   },
 *   scheduleState: { status: 'idle', last_run_at: null },
 *   stateDir: '.herdctl',
 *   sdkQuery: query,
 *   workSourceManager: manager,
 * });
 *
 * if (result.workItem) {
 *   console.log(`Processed work item: ${result.workItem.title}`);
 * }
 * ```
 */
export async function runSchedule(
  options: RunScheduleOptions
): Promise<ScheduleRunResult> {
  const {
    agent,
    scheduleName,
    schedule,
    stateDir,
    workSourceManager,
    logger = defaultLogger,
    executorOptions,
  } = options;

  const stateLogger: ScheduleStateLogger = { warn: logger.warn };

  logger.info(`Running schedule ${agent.name}/${scheduleName}`);

  // Step 1: Update schedule state to 'running'
  await updateScheduleState(
    stateDir,
    agent.name,
    scheduleName,
    {
      status: "running",
      last_run_at: new Date().toISOString(),
    },
    { logger: stateLogger }
  );

  let workItem: WorkItem | undefined;
  let processedWorkItem = false;

  try {
    // Step 2: Fetch work item if schedule has work_source configured
    if (schedule.work_source && workSourceManager) {
      logger.debug(
        `Fetching work item for ${agent.name}/${scheduleName} from ${schedule.work_source.type}`
      );

      const workResult = await workSourceManager.getNextWorkItem(agent, {
        autoClaim: true,
      });

      if (workResult.item && workResult.claimed) {
        workItem = workResult.item;
        processedWorkItem = true;
        logger.info(
          `Claimed work item ${workItem.id}: ${workItem.title}`
        );
      } else if (workResult.item && !workResult.claimed) {
        // Work item found but claim failed (race condition)
        logger.warn(
          `Work item ${workResult.item.id} found but claim failed: ${workResult.claimResult?.reason}`
        );
      } else {
        // No work available
        logger.debug(
          `No work items available for ${agent.name}/${scheduleName}`
        );
      }
    }

    // Step 3: Build the prompt
    const prompt = buildSchedulePrompt(schedule, workItem);

    // Step 4: Build trigger metadata
    const triggerMetadata: TriggerMetadata = {
      triggerType: schedule.type === "cron" ? "cron" : "interval",
      schedule: scheduleName,
    };

    if (workItem) {
      triggerMetadata.workItemId = workItem.id;
      triggerMetadata.workItemTitle = workItem.title;
    }

    // Step 5: Get existing session for conversation continuity
    // This prevents unexpected logouts by resuming the agent's session
    // Session expiry is validated using the agent's session.timeout config (default: 24h)
    // By default, sessions are resumed unless explicitly disabled via resume_session: false
    let sessionId: string | undefined;
    if (schedule.resume_session !== false) {
      try {
        const sessionsDir = join(stateDir, "sessions");
        // Use session timeout config for expiry validation to prevent resuming stale sessions
        // Default to 24h if not configured - this prevents unexpected logouts from expired server-side sessions
        const sessionTimeout = agent.session?.timeout ?? "24h";
        const existingSession = await getSessionInfo(sessionsDir, agent.name, {
          timeout: sessionTimeout,
          logger,
          runtime: agent.runtime ?? "sdk",
        });
        if (existingSession?.session_id) {
          sessionId = existingSession.session_id;
          logger.debug(
            `Found valid session for ${agent.name}: ${sessionId}`
          );
        } else {
          logger.debug(
            `No valid session for ${agent.name} (expired or not found), starting fresh`
          );
        }
      } catch (error) {
        logger.warn(
          `Failed to get session info for ${agent.name}: ${(error as Error).message}`
        );
        // Continue without resume - session failure shouldn't block execution
      }
    }

    // Step 6: Execute the agent via JobExecutor
    const runtime = RuntimeFactory.create(agent, { stateDir });
    const executor = new JobExecutor(runtime, executorOptions);

    const runnerResult = await executor.execute({
      agent,
      prompt,
      stateDir,
      triggerType: "schedule",
      schedule: scheduleName,
      resume: sessionId,
    });

    // Step 7: Report outcome to work source if we processed a work item
    if (workItem && workSourceManager) {
      const workResult = buildWorkResult(runnerResult);

      try {
        await workSourceManager.reportOutcome(workItem.id, workResult, {
          agent,
        });
        logger.info(
          `Reported outcome for work item ${workItem.id}: ${workResult.outcome}`
        );
      } catch (reportError) {
        logger.error(
          `Failed to report outcome for work item ${workItem.id}: ${(reportError as Error).message}`
        );
        // Don't fail the overall run if reporting fails
      }
    }

    // Step 8: Calculate next trigger time based on schedule type
    const nextTrigger = calculateNextScheduleTrigger(schedule);

    // Step 9: Update schedule state with success
    await updateScheduleState(
      stateDir,
      agent.name,
      scheduleName,
      {
        status: "idle",
        next_run_at: nextTrigger?.toISOString() ?? null,
        last_error: runnerResult.success ? null : runnerResult.error?.message,
      },
      { logger: stateLogger }
    );

    logger.info(
      `Completed schedule ${agent.name}/${scheduleName}: ${runnerResult.success ? "success" : "failed"}`
    );

    return {
      ...runnerResult,
      workItem,
      processedWorkItem,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error(
      `Error running schedule ${agent.name}/${scheduleName}: ${errorMessage}`
    );

    // Release work item if we claimed one and execution failed unexpectedly
    if (workItem && workSourceManager) {
      try {
        await workSourceManager.releaseWorkItem(workItem.id, {
          agent,
          reason: `Unexpected error: ${errorMessage}`,
          addComment: true,
        });
        logger.info(`Released work item ${workItem.id} due to error`);
      } catch (releaseError) {
        logger.error(
          `Failed to release work item ${workItem.id}: ${(releaseError as Error).message}`
        );
      }
    }

    // Calculate next trigger time even on error
    const nextTrigger = calculateNextScheduleTrigger(schedule);

    // Update schedule state with error
    await updateScheduleState(
      stateDir,
      agent.name,
      scheduleName,
      {
        status: "idle",
        next_run_at: nextTrigger?.toISOString() ?? null,
        last_error: errorMessage,
      },
      { logger: stateLogger }
    );

    // Re-throw to let caller handle
    throw error;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate the next trigger time for a schedule based on its type
 *
 * @param schedule - The schedule configuration
 * @returns The next trigger time as a Date, or null if the schedule type is unsupported
 */
function calculateNextScheduleTrigger(schedule: Schedule): Date | null {
  if (schedule.type === "interval" && schedule.interval) {
    return calculateNextTrigger(new Date(), schedule.interval);
  } else if (schedule.type === "cron" && schedule.expression) {
    return calculateNextCronTrigger(schedule.expression);
  }
  return null;
}

/**
 * Build a WorkResult from a RunnerResult for reporting to work sources
 */
function buildWorkResult(runnerResult: RunnerResult): WorkResult {
  const outcome: WorkOutcome = runnerResult.success ? "success" : "failure";

  return {
    outcome,
    summary:
      runnerResult.summary ?? (runnerResult.success ? "Task completed successfully" : "Task failed"),
    error: runnerResult.error?.message,
    artifacts: runnerResult.jobId ? [`job:${runnerResult.jobId}`] : undefined,
  };
}
