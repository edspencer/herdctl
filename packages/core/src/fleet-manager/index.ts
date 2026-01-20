/**
 * Fleet Manager module
 *
 * Provides the high-level FleetManager class for library consumers to
 * initialize and run agent fleets with minimal configuration.
 */

// Main class
export { FleetManager } from "./fleet-manager.js";

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
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerLogger,
  FleetManagerEvents,
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
  // Status query types (US-3)
  FleetStatus,
  AgentInfo,
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
  // New error classes (US-12)
  ConfigurationError,
  AgentNotFoundError,
  JobNotFoundError,
  ScheduleNotFoundError,
  InvalidStateError,
  ConcurrencyLimitError,
  // Job control error classes (US-6)
  JobCancelError,
  JobForkError,
  // Legacy error classes (backwards compatibility)
  FleetManagerStateError,
  FleetManagerConfigError,
  FleetManagerStateDirError,
  FleetManagerShutdownError,
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
