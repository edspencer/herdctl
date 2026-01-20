/**
 * Event type definitions for FleetManager real-time event subscription
 *
 * Provides strongly-typed event definitions for all FleetManager state changes,
 * allowing UI developers to subscribe to real-time updates as jobs start,
 * complete, and produce output.
 */

import type { ResolvedAgent, Schedule } from "../config/index.js";
import type {
  JobMetadata,
  JobStatus,
  ExitReason,
} from "../state/schemas/job-metadata.js";

// =============================================================================
// Event Payload Types
// =============================================================================

/**
 * Describes a single configuration change detected during reload
 */
export interface ConfigChange {
  /** Type of change */
  type: "added" | "removed" | "modified";
  /** Category of the change */
  category: "agent" | "schedule" | "defaults";
  /** Name of the changed item (agent name or "agent/schedule" for schedules) */
  name: string;
  /** Optional details about what changed */
  details?: string;
}

/**
 * Payload for config:reloaded event
 */
export interface ConfigReloadedPayload {
  /** Number of agents in the new configuration */
  agentCount: number;
  /** Names of agents in the new configuration */
  agentNames: string[];
  /** Path to the configuration file that was reloaded */
  configPath: string;
  /** List of changes detected during reload */
  changes: ConfigChange[];
  /** ISO timestamp when the reload occurred */
  timestamp: string;
}

/**
 * Payload for agent:started event
 */
export interface AgentStartedPayload {
  /** Agent that was started */
  agent: ResolvedAgent;
  /** ISO timestamp when the agent was started */
  timestamp: string;
}

/**
 * Payload for agent:stopped event
 */
export interface AgentStoppedPayload {
  /** Name of the agent that was stopped */
  agentName: string;
  /** ISO timestamp when the agent was stopped */
  timestamp: string;
  /** Reason for stopping (if applicable) */
  reason?: string;
}

/**
 * Payload for schedule:triggered event
 */
export interface ScheduleTriggeredPayload {
  /** Name of the agent whose schedule triggered */
  agentName: string;
  /** Name of the schedule that triggered */
  scheduleName: string;
  /** Schedule configuration */
  schedule: Schedule;
  /** ISO timestamp when the trigger occurred */
  timestamp: string;
}

/**
 * Payload for schedule:skipped event
 */
export interface ScheduleSkippedPayload {
  /** Name of the agent whose schedule was skipped */
  agentName: string;
  /** Name of the schedule that was skipped */
  scheduleName: string;
  /** Reason why the schedule was skipped */
  reason: "already_running" | "disabled" | "max_concurrent" | "work_source_empty";
  /** ISO timestamp when the skip occurred */
  timestamp: string;
}

/**
 * Payload for job:created event
 */
export interface JobCreatedPayload {
  /** The job metadata */
  job: JobMetadata;
  /** Name of the agent executing the job */
  agentName: string;
  /** Schedule name that triggered the job (if applicable) */
  scheduleName?: string;
  /** ISO timestamp when the job was created */
  timestamp: string;
}

/**
 * Payload for job:output event
 *
 * Emitted when a job produces output during execution.
 * This allows UI to display real-time streaming output.
 */
export interface JobOutputPayload {
  /** Job ID */
  jobId: string;
  /** Name of the agent executing the job */
  agentName: string;
  /** Output chunk from the job */
  output: string;
  /** Type of output */
  outputType: "stdout" | "stderr" | "assistant" | "tool" | "system";
  /** ISO timestamp when the output was produced */
  timestamp: string;
}

/**
 * Payload for job:completed event
 */
export interface JobCompletedPayload {
  /** The completed job metadata */
  job: JobMetadata;
  /** Name of the agent that executed the job */
  agentName: string;
  /** How the job exited */
  exitReason: ExitReason;
  /** Duration of the job in seconds */
  durationSeconds: number;
  /** ISO timestamp when the job completed */
  timestamp: string;
}

/**
 * Payload for job:failed event
 */
export interface JobFailedPayload {
  /** The failed job metadata */
  job: JobMetadata;
  /** Name of the agent that executed the job */
  agentName: string;
  /** The error that caused the failure */
  error: Error;
  /** How the job exited */
  exitReason: ExitReason;
  /** Duration of the job in seconds (if applicable) */
  durationSeconds?: number;
  /** ISO timestamp when the job failed */
  timestamp: string;
}

/**
 * Payload for job:cancelled event (US-6)
 */
export interface JobCancelledPayload {
  /** The cancelled job metadata */
  job: JobMetadata;
  /** Name of the agent that was executing the job */
  agentName: string;
  /** How the job was terminated: 'graceful' (SIGTERM), 'forced' (SIGKILL), or 'already_stopped' */
  terminationType: 'graceful' | 'forced' | 'already_stopped';
  /** Duration of the job in seconds before cancellation */
  durationSeconds?: number;
  /** ISO timestamp when the job was cancelled */
  timestamp: string;
}

/**
 * Payload for job:forked event (US-6)
 */
export interface JobForkedPayload {
  /** The newly created forked job metadata */
  job: JobMetadata;
  /** The original job that was forked */
  originalJob: JobMetadata;
  /** Name of the agent executing the forked job */
  agentName: string;
  /** ISO timestamp when the job was forked */
  timestamp: string;
}

// =============================================================================
// Fleet Manager Event Map
// =============================================================================

/**
 * Strongly-typed event map for FleetManager
 *
 * This interface defines all events that can be emitted by the FleetManager,
 * along with their payload types. Use this with TypeScript's typed EventEmitter
 * pattern for full type safety.
 *
 * @example
 * ```typescript
 * const manager = new FleetManager({ ... });
 *
 * // Subscribe to job events
 * manager.on('job:created', (payload) => {
 *   console.log(`Job ${payload.job.id} created for ${payload.agentName}`);
 * });
 *
 * manager.on('job:output', (payload) => {
 *   process.stdout.write(payload.output);
 * });
 *
 * manager.on('job:completed', (payload) => {
 *   console.log(`Job ${payload.job.id} completed in ${payload.durationSeconds}s`);
 * });
 * ```
 */
export interface FleetManagerEventMap {
  // ===========================================================================
  // Lifecycle Events
  // ===========================================================================

  /**
   * Emitted when FleetManager initialization completes successfully.
   * At this point, config is loaded and state directory is ready.
   */
  initialized: [];

  /**
   * Emitted when the FleetManager scheduler starts running.
   * Agent schedules are now being monitored.
   */
  started: [];

  /**
   * Emitted when the FleetManager stops.
   * All jobs have completed or timed out.
   */
  stopped: [];

  /**
   * Emitted when the configuration is reloaded (hot reload).
   * This may happen when config files change on disk.
   */
  "config:reloaded": [payload: ConfigReloadedPayload];

  // ===========================================================================
  // Agent Events
  // ===========================================================================

  /**
   * Emitted when an agent is started/registered with the fleet.
   */
  "agent:started": [payload: AgentStartedPayload];

  /**
   * Emitted when an agent is stopped/unregistered from the fleet.
   */
  "agent:stopped": [payload: AgentStoppedPayload];

  // ===========================================================================
  // Schedule Events
  // ===========================================================================

  /**
   * Emitted when a schedule triggers an agent run.
   * This is emitted before the job is created.
   */
  "schedule:triggered": [payload: ScheduleTriggeredPayload];

  /**
   * Emitted when a schedule check is skipped.
   * This happens when the agent is already running or disabled.
   */
  "schedule:skipped": [payload: ScheduleSkippedPayload];

  // ===========================================================================
  // Job Events
  // ===========================================================================

  /**
   * Emitted when a new job is created.
   * The job status will be 'pending' at this point.
   */
  "job:created": [payload: JobCreatedPayload];

  /**
   * Emitted when a job produces output.
   * This allows real-time streaming of job output to UIs.
   */
  "job:output": [payload: JobOutputPayload];

  /**
   * Emitted when a job completes successfully.
   * The job status will be 'completed'.
   */
  "job:completed": [payload: JobCompletedPayload];

  /**
   * Emitted when a job fails.
   * The job status will be 'failed' or 'cancelled'.
   */
  "job:failed": [payload: JobFailedPayload];

  /**
   * Emitted when a job is cancelled (US-6).
   * The job status will be 'cancelled'.
   */
  "job:cancelled": [payload: JobCancelledPayload];

  /**
   * Emitted when a job is forked (US-6).
   * A new job is created based on an existing job's configuration.
   */
  "job:forked": [payload: JobForkedPayload];

  // ===========================================================================
  // Error Events
  // ===========================================================================

  /**
   * Emitted when an error occurs in the FleetManager.
   * This is a catch-all for errors that aren't tied to a specific job.
   */
  error: [error: Error];

  // ===========================================================================
  // Legacy Events (backwards compatibility)
  // ===========================================================================

  /**
   * Legacy event: Emitted when a schedule triggers an agent run.
   * @deprecated Use 'schedule:triggered' event instead for typed payload.
   */
  "schedule:trigger": [agentName: string, scheduleName: string];

  /**
   * Legacy event: Emitted when an agent run completes successfully.
   * @deprecated Use 'job:completed' event instead for typed payload.
   */
  "schedule:complete": [agentName: string, scheduleName: string];

  /**
   * Legacy event: Emitted when an agent run fails.
   * @deprecated Use 'job:failed' event instead for typed payload.
   */
  "schedule:error": [agentName: string, scheduleName: string, error: Error];
}

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Extract event names from the event map
 */
export type FleetManagerEventName = keyof FleetManagerEventMap;

/**
 * Extract payload type for a specific event
 */
export type FleetManagerEventPayload<E extends FleetManagerEventName> =
  FleetManagerEventMap[E] extends [infer P] ? P : void;

/**
 * Event listener type for a specific event
 */
export type FleetManagerEventListener<E extends FleetManagerEventName> = (
  ...args: FleetManagerEventMap[E]
) => void;
