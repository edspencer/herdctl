/**
 * Scheduler module for herdctl
 *
 * Provides interval parsing, scheduling utilities, and the Scheduler class
 * for agent fleet management.
 */

// Errors
export * from "./errors.js";

// Interval parsing and scheduling
export {
  parseInterval,
  calculateNextTrigger,
  isScheduleDue,
} from "./interval.js";

// Cron expression parsing
export {
  parseCronExpression,
  getNextCronTrigger,
  calculateNextCronTrigger,
  isValidCronExpression,
  type ParsedCronExpression,
  type CronParseOptions,
} from "./cron.js";

// Schedule state management
export {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
  type ScheduleStateLogger,
  type ScheduleStateOptions,
  type ScheduleStateUpdates,
} from "./schedule-state.js";

// Scheduler types
export type {
  SchedulerOptions,
  SchedulerStatus,
  SchedulerState,
  SchedulerLogger,
  ScheduleCheckResult,
  ScheduleSkipReason,
  TriggerInfo,
  SchedulerTriggerCallback,
  AgentScheduleInfo,
  StopOptions,
} from "./types.js";

// Scheduler class
export { Scheduler } from "./scheduler.js";

// Schedule runner
export {
  runSchedule,
  buildSchedulePrompt,
  type RunScheduleOptions,
  type ScheduleRunResult,
  type ScheduleRunnerLogger,
  type TriggerMetadata,
} from "./schedule-runner.js";
