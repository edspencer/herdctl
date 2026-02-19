/**
 * Fleet Manager module
 *
 * Provides the high-level FleetManager class for library consumers to
 * initialize and run agent fleets with minimal configuration.
 */

// Main class
export { FleetManager } from "./fleet-manager.js";

// Context interface for module composition
export type { FleetManagerContext } from "./context.js";

// Module classes (new pattern for composition)
export { StatusQueries } from "./status-queries.js";
export { ScheduleManagement } from "./schedule-management.js";
export { ConfigReload } from "./config-reload.js";
export { JobControl } from "./job-control.js";
export { LogStreaming } from "./log-streaming.js";
export { ScheduleExecutor } from "./schedule-executor.js";

// Chat manager interface and types
export type { IChatManager, ChatManagerConnectorState } from "./chat-manager-interface.js";

// DiscordManager has moved to @herdctl/discord
// Import it from there: import { DiscordManager } from "@herdctl/discord"

// SlackManager has moved to @herdctl/slack
// Import it from there: import { SlackManager } from "@herdctl/slack"

// Event emitters (US-4: Extract Event Emitters Module)
export {
  emitConfigReloaded,
  emitAgentStarted,
  emitAgentStopped,
  emitScheduleSkipped,
  emitJobCreated,
  emitJobOutput,
  emitJobCompleted,
  emitJobFailed,
  emitJobCancelled,
  emitJobForked,
  type FleetManagerEventEmitter,
} from "./event-emitters.js";

// Status queries helper functions (still exported for utility use)
export {
  buildAgentInfo,
  buildScheduleInfoList,
  computeFleetCounts,
  type FleetStateSnapshot,
} from "./status-queries.js";

// Config reload helper functions (still exported for utility use)
export {
  computeConfigChanges,
  computeScheduleChanges,
  getAgentModifications,
  isAgentModified,
  isScheduleModified,
  getScheduleModificationDetails,
  getChangesSummary,
  filterChangesByCategory,
  filterChangesByType,
  hasAgentChanges,
  hasScheduleChanges,
  getAddedAgentNames,
  getRemovedAgentNames,
  getModifiedAgentNames,
} from "./config-reload.js";

// Log streaming helper functions (still exported for utility use)
export {
  jobOutputToLogEntry,
  shouldYieldLog,
  getLogLevelOrder,
  compareLogLevels,
  meetsLogLevel,
  createLogLevelFilter,
  createAgentFilter,
  createJobFilter,
  combineLogFilters,
  createLogEntry,
  formatLogEntry,
} from "./log-streaming.js";

// Working directory helper
export { resolveWorkingDirectory } from "./working-directory-helper.js";

// Job Manager (US-4)
export { JobManager } from "./job-manager.js";

// Job Queue (US-10: Concurrency Control)
export { JobQueue } from "./job-queue.js";
export type {
  JobQueueOptions,
  JobQueueLogger,
  JobPriority,
  QueuedJob,
  EnqueueOptions,
  EnqueueResult,
  ScheduleSkipResult,
  AgentQueueStatus,
  QueueStatus,
  JobQueueEventMap,
} from "./job-queue.js";
export type {
  Job,
  JobFilter,
  JobListResult,
  GetJobOptions,
  JobRetentionConfig,
  JobManagerOptions,
  JobManagerLogger,
  JobOutputStreamEvents,
  JobOutputStream,
} from "./job-manager.js";

// Types
export type {
  FleetManagerOptions,
  FleetConfigOverrides,
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerLogger,
  // Event types (US-2)
  FleetManagerEventMap,
  FleetManagerEventName,
  FleetManagerEventPayload,
  FleetManagerEventListener,
  ConfigChange,
  ConfigReloadedPayload,
  AgentStartedPayload,
  AgentStoppedPayload,
  ScheduleTriggeredPayload,
  ScheduleSkippedPayload,
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
  // Job control event types (US-6)
  JobCancelledPayload,
  JobForkedPayload,
  // Slack manager event types
  SlackMessageHandledPayload,
  SlackMessageErrorPayload,
  SlackErrorPayload,
  SlackSessionLifecyclePayload,
  // Status query types (US-3)
  FleetStatus,
  AgentInfo,
  AgentChatStatus,
  ScheduleInfo,
  FleetCounts,
  // Trigger types (US-5)
  TriggerOptions,
  TriggerResult,
  // Job control types (US-6)
  JobModifications,
  CancelJobResult,
  ForkJobResult,
  // Stop options (US-8)
  FleetManagerStopOptions,
  // Log streaming types (US-11)
  LogLevel,
  LogSource,
  LogEntry,
  LogStreamOptions,
} from "./types.js";

// Error codes and types
export {
  FleetManagerErrorCode,
  type FleetManagerErrorCode as FleetManagerErrorCodeType,
} from "./errors.js";

// Error classes
export {
  // Base error
  FleetManagerError,
  // Error classes
  ConfigurationError,
  AgentNotFoundError,
  JobNotFoundError,
  ScheduleNotFoundError,
  InvalidStateError,
  ConcurrencyLimitError,
  FleetManagerStateDirError,
  FleetManagerShutdownError,
  // Job control error classes
  JobCancelError,
  JobForkError,
} from "./errors.js";

// Validation error interface for ConfigurationError
export type { ValidationError } from "./errors.js";

// Type guards for error handling
export {
  isFleetManagerError,
  isConfigurationError,
  isAgentNotFoundError,
  isJobNotFoundError,
  isScheduleNotFoundError,
  isInvalidStateError,
  isConcurrencyLimitError,
  // Job control error type guards (US-6)
  isJobCancelError,
  isJobForkError,
} from "./errors.js";
