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
  resolveSystemTimeZone,
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
//
// NOTE: the runtime-mutation plumbing added for edspencer/herdctl#376 —
// `armScheduleState`, `deleteScheduleState`, `setScheduleTombstone`,
// `clearScheduleTombstone`, `isScheduleTombstoned` — is deliberately NOT re-exported
// here. The package root does `export *` from this module, so re-exporting them
// would leak internal mutators onto the public `@herdctl/core` semver surface.
// Internal callers (scheduler, schedule-management) and tests import them directly
// from `./schedule-state.js`. Consumers use the `FleetManager` methods instead.
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
