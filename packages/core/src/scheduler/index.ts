/**
 * Scheduler module for herdctl
 *
 * Provides interval parsing, scheduling utilities, and the Scheduler class
 * for agent fleet management.
 */

// Cron expression parsing
export {
  type CronParseOptions,
  calculateNextCronTrigger,
  getNextCronTrigger,
  isValidCronExpression,
  type ParsedCronExpression,
  parseCronExpression,
} from "./cron.js";
// Errors
export * from "./errors.js";
// Interval parsing and scheduling
export {
  calculateNextTrigger,
  isScheduleDue,
  parseInterval,
} from "./interval.js";
// Schedule runner
export {
  buildSchedulePrompt,
  type RunScheduleOptions,
  runSchedule,
  type ScheduleRunnerLogger,
  type ScheduleRunResult,
  type TriggerMetadata,
} from "./schedule-runner.js";
// Schedule state management
export {
  getAgentScheduleStates,
  getScheduleState,
  type ScheduleStateLogger,
  type ScheduleStateOptions,
  type ScheduleStateUpdates,
  updateScheduleState,
} from "./schedule-state.js";

// Scheduler class
export { Scheduler } from "./scheduler.js";
// Scheduler types
export type {
  AgentScheduleInfo,
  ScheduleCheckResult,
  SchedulerLogger,
  SchedulerOptions,
  SchedulerState,
  SchedulerStatus,
  SchedulerTriggerCallback,
  ScheduleSkipReason,
  StopOptions,
  TriggerInfo,
} from "./types.js";
