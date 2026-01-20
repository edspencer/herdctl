/**
 * Type definitions for the Scheduler module
 *
 * Provides interfaces for scheduler configuration, status tracking,
 * and agent trigger callbacks.
 */

import type { ResolvedAgent, Schedule } from "../config/index.js";
import type { ScheduleState } from "../state/schemas/fleet-state.js";

// =============================================================================
// Stop Options
// =============================================================================

/**
 * Options for stopping the scheduler
 */
export interface StopOptions {
  /**
   * Whether to wait for running jobs to complete before stopping
   * Default: true
   */
  waitForJobs?: boolean;

  /**
   * Maximum time in milliseconds to wait for running jobs to complete
   * Only applies when waitForJobs is true
   * Default: 30000 (30 seconds)
   */
  timeout?: number;
}

// =============================================================================
// Scheduler Options
// =============================================================================

/**
 * Logger interface for scheduler operations
 */
export interface SchedulerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for configuring the Scheduler
 */
export interface SchedulerOptions {
  /**
   * Interval in milliseconds between schedule checks
   * Default: 1000 (1 second)
   */
  checkInterval?: number;

  /**
   * Path to the state directory (e.g., .herdctl)
   */
  stateDir: string;

  /**
   * Logger for scheduler operations
   * Default: console-based logger
   */
  logger?: SchedulerLogger;

  /**
   * Callback invoked when a schedule is due and should trigger an agent run
   */
  onTrigger?: SchedulerTriggerCallback;
}

// =============================================================================
// Scheduler Status
// =============================================================================

/**
 * Current status of the scheduler
 */
export type SchedulerStatus = "stopped" | "running" | "stopping";

/**
 * Detailed scheduler state for monitoring
 */
export interface SchedulerState {
  /**
   * Current scheduler status
   */
  status: SchedulerStatus;

  /**
   * ISO timestamp of when the scheduler was started
   */
  startedAt: string | null;

  /**
   * Total number of schedule checks performed
   */
  checkCount: number;

  /**
   * Total number of triggers fired
   */
  triggerCount: number;

  /**
   * ISO timestamp of last schedule check
   */
  lastCheckAt: string | null;
}

// =============================================================================
// Schedule Status Types
// =============================================================================

/**
 * Reason why a schedule was skipped
 */
export type ScheduleSkipReason =
  | "disabled" // Schedule status is 'disabled'
  | "unsupported_type" // Schedule type is not 'interval' or 'cron' (e.g., webhook, chat)
  | "not_due" // Schedule is not due yet
  | "at_capacity" // Agent is at max_concurrent capacity
  | "already_running"; // Schedule is already running

/**
 * Result of checking a single schedule
 */
export interface ScheduleCheckResult {
  /**
   * Name of the agent
   */
  agentName: string;

  /**
   * Name of the schedule
   */
  scheduleName: string;

  /**
   * Whether the schedule should be triggered
   */
  shouldTrigger: boolean;

  /**
   * If not triggered, the reason why
   */
  skipReason?: ScheduleSkipReason;
}

// =============================================================================
// Trigger Callback
// =============================================================================

/**
 * Information about a triggered schedule
 */
export interface TriggerInfo {
  /**
   * The agent configuration
   */
  agent: ResolvedAgent;

  /**
   * Name of the schedule that triggered
   */
  scheduleName: string;

  /**
   * The schedule configuration
   */
  schedule: Schedule;

  /**
   * Current schedule state
   */
  scheduleState: ScheduleState;
}

/**
 * Callback invoked when a schedule triggers
 *
 * The callback should return a promise that resolves when the agent run completes.
 * The scheduler will update schedule state based on completion/failure.
 */
export type SchedulerTriggerCallback = (info: TriggerInfo) => Promise<void>;

// =============================================================================
// Agent Check Info
// =============================================================================

/**
 * Information about an agent's schedules for checking
 */
export interface AgentScheduleInfo {
  /**
   * The resolved agent configuration
   */
  agent: ResolvedAgent;

  /**
   * Map of schedule names to their configurations
   */
  schedules: Record<string, Schedule>;

  /**
   * Current running instance count for this agent
   */
  runningCount: number;

  /**
   * Maximum concurrent instances allowed
   */
  maxConcurrent: number;
}
