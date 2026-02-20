/**
 * Fleet Manager module
 *
 * Provides the high-level FleetManager class for library consumers to
 * initialize and run agent fleets with minimal configuration.
 */

// Chat manager interface and types
export type { ChatManagerConnectorState, IChatManager } from "./chat-manager-interface.js";
export { ConfigReload } from "./config-reload.js";
// Context interface for module composition
export type { FleetManagerContext } from "./context.js";
// Main class
export { FleetManager } from "./fleet-manager.js";
export { JobControl } from "./job-control.js";
export { LogStreaming } from "./log-streaming.js";
export { ScheduleExecutor } from "./schedule-executor.js";
export { ScheduleManagement } from "./schedule-management.js";
// Module classes (new pattern for composition)
export { StatusQueries } from "./status-queries.js";

// DiscordManager has moved to @herdctl/discord
// Import it from there: import { DiscordManager } from "@herdctl/discord"

// SlackManager has moved to @herdctl/slack
// Import it from there: import { SlackManager } from "@herdctl/slack"

// Config reload helper functions (still exported for utility use)
export {
  computeConfigChanges,
  computeScheduleChanges,
  filterChangesByCategory,
  filterChangesByType,
  getAddedAgentNames,
  getAgentModifications,
  getChangesSummary,
  getModifiedAgentNames,
  getRemovedAgentNames,
  getScheduleModificationDetails,
  hasAgentChanges,
  hasScheduleChanges,
  isAgentModified,
  isScheduleModified,
} from "./config-reload.js";
// Validation error interface for ConfigurationError
export type { ValidationError } from "./errors.js";
// Error codes and types
// Error classes
// Type guards for error handling
export {
  AgentNotFoundError,
  ConcurrencyLimitError,
  // Error classes
  ConfigurationError,
  // Base error
  FleetManagerError,
  FleetManagerErrorCode,
  type FleetManagerErrorCode as FleetManagerErrorCodeType,
  FleetManagerShutdownError,
  FleetManagerStateDirError,
  InvalidStateError,
  isAgentNotFoundError,
  isConcurrencyLimitError,
  isConfigurationError,
  isFleetManagerError,
  isInvalidStateError,
  // Job control error type guards (US-6)
  isJobCancelError,
  isJobForkError,
  isJobNotFoundError,
  isScheduleNotFoundError,
  // Job control error classes
  JobCancelError,
  JobForkError,
  JobNotFoundError,
  ScheduleNotFoundError,
} from "./errors.js";
// Event emitters (US-4: Extract Event Emitters Module)
export {
  emitAgentStarted,
  emitAgentStopped,
  emitConfigReloaded,
  emitJobCancelled,
  emitJobCompleted,
  emitJobCreated,
  emitJobFailed,
  emitJobForked,
  emitJobOutput,
  emitScheduleSkipped,
  type FleetManagerEventEmitter,
} from "./event-emitters.js";
export type {
  GetJobOptions,
  Job,
  JobFilter,
  JobListResult,
  JobManagerLogger,
  JobManagerOptions,
  JobOutputStream,
  JobOutputStreamEvents,
  JobRetentionConfig,
} from "./job-manager.js";
// Job Manager (US-4)
export { JobManager } from "./job-manager.js";
export type {
  AgentQueueStatus,
  EnqueueOptions,
  EnqueueResult,
  JobPriority,
  JobQueueEventMap,
  JobQueueLogger,
  JobQueueOptions,
  QueuedJob,
  QueueStatus,
  ScheduleSkipResult,
} from "./job-queue.js";
// Job Queue (US-10: Concurrency Control)
export { JobQueue } from "./job-queue.js";
// Log streaming helper functions (still exported for utility use)
export {
  combineLogFilters,
  compareLogLevels,
  createAgentFilter,
  createJobFilter,
  createLogEntry,
  createLogLevelFilter,
  formatLogEntry,
  getLogLevelOrder,
  jobOutputToLogEntry,
  meetsLogLevel,
  shouldYieldLog,
} from "./log-streaming.js";
// Status queries helper functions (still exported for utility use)
export {
  buildAgentInfo,
  buildScheduleInfoList,
  computeFleetCounts,
  type FleetStateSnapshot,
} from "./status-queries.js";
// Types
export type {
  AgentChatStatus,
  AgentInfo,
  AgentStartedPayload,
  AgentStoppedPayload,
  CancelJobResult,
  ConfigChange,
  ConfigReloadedPayload,
  FleetConfigOverrides,
  FleetCounts,
  FleetManagerEventListener,
  // Event types (US-2)
  FleetManagerEventMap,
  FleetManagerEventName,
  FleetManagerEventPayload,
  FleetManagerLogger,
  FleetManagerOptions,
  FleetManagerState,
  FleetManagerStatus,
  // Stop options (US-8)
  FleetManagerStopOptions,
  // Status query types (US-3)
  FleetStatus,
  ForkJobResult,
  // Job control event types (US-6)
  JobCancelledPayload,
  JobCompletedPayload,
  JobCreatedPayload,
  JobFailedPayload,
  JobForkedPayload,
  // Job control types (US-6)
  JobModifications,
  JobOutputPayload,
  LogEntry,
  // Log streaming types (US-11)
  LogLevel,
  LogSource,
  LogStreamOptions,
  ScheduleInfo,
  ScheduleSkippedPayload,
  ScheduleTriggeredPayload,
  SlackErrorPayload,
  SlackMessageErrorPayload,
  // Slack manager event types
  SlackMessageHandledPayload,
  SlackSessionLifecyclePayload,
  // Trigger types (US-5)
  TriggerOptions,
  TriggerResult,
} from "./types.js";
// Working directory helper
export { resolveWorkingDirectory } from "./working-directory-helper.js";
