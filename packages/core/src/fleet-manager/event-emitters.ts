/**
 * Event Emitters Module
 *
 * Centralizes all event emission logic for FleetManager.
 * Provides type-safe event emission helpers with clear contracts.
 *
 * @module event-emitters
 */

import type {
  AgentStartedPayload,
  AgentStoppedPayload,
  ConfigReloadedPayload,
  JobCancelledPayload,
  JobCompletedPayload,
  JobCreatedPayload,
  JobFailedPayload,
  JobForkedPayload,
  JobOutputPayload,
  ScheduleSkippedPayload,
} from "./event-types.js";

// =============================================================================
// Event Emitter Interface
// =============================================================================

/**
 * Interface for objects that can emit FleetManager events.
 *
 * This is satisfied by Node's EventEmitter and allows the event
 * emission functions to work with any compatible emitter.
 */
export interface FleetManagerEventEmitter {
  emit(event: string | symbol, ...args: unknown[]): boolean;
}

// =============================================================================
// Event Emission Functions
// =============================================================================

/**
 * Emit a config:reloaded event
 *
 * Called when configuration is hot-reloaded. Consumers can subscribe
 * to track configuration changes in real-time.
 *
 * @param emitter - The event emitter instance
 * @param payload - Configuration reload details
 */
export function emitConfigReloaded(
  emitter: FleetManagerEventEmitter,
  payload: ConfigReloadedPayload,
): void {
  emitter.emit("config:reloaded", payload);
}

/**
 * Emit an agent:started event
 *
 * Called when an agent is started/registered with the fleet.
 * This happens during initialization or when new agents are added via reload.
 *
 * @param emitter - The event emitter instance
 * @param payload - Agent start details
 */
export function emitAgentStarted(
  emitter: FleetManagerEventEmitter,
  payload: AgentStartedPayload,
): void {
  emitter.emit("agent:started", payload);
}

/**
 * Emit an agent:stopped event
 *
 * Called when an agent is stopped/unregistered from the fleet.
 * This happens during shutdown or when agents are removed via reload.
 *
 * @param emitter - The event emitter instance
 * @param payload - Agent stop details
 */
export function emitAgentStopped(
  emitter: FleetManagerEventEmitter,
  payload: AgentStoppedPayload,
): void {
  emitter.emit("agent:stopped", payload);
}

/**
 * Emit a schedule:skipped event
 *
 * Called when a schedule check is skipped. This can happen when:
 * - The agent is already running (already_running)
 * - The schedule is disabled (disabled)
 * - Max concurrent limit reached (max_concurrent)
 * - Work source returned no items (work_source_empty)
 *
 * @param emitter - The event emitter instance
 * @param payload - Schedule skip details including reason
 */
export function emitScheduleSkipped(
  emitter: FleetManagerEventEmitter,
  payload: ScheduleSkippedPayload,
): void {
  emitter.emit("schedule:skipped", payload);
}

/**
 * Emit a job:created event
 *
 * Called when a new job is created. The job status will be 'pending'
 * at this point. Consumers can track job creation for monitoring.
 *
 * @param emitter - The event emitter instance
 * @param payload - Job creation details
 */
export function emitJobCreated(
  emitter: FleetManagerEventEmitter,
  payload: JobCreatedPayload,
): void {
  emitter.emit("job:created", payload);
}

/**
 * Emit a job:output event
 *
 * Called when a job produces output during execution.
 * This enables real-time streaming of output to UIs.
 *
 * @param emitter - The event emitter instance
 * @param payload - Job output details including the output chunk
 */
export function emitJobOutput(emitter: FleetManagerEventEmitter, payload: JobOutputPayload): void {
  emitter.emit("job:output", payload);
}

/**
 * Emit a job:completed event
 *
 * Called when a job completes successfully. The job status will be
 * 'completed' and includes duration information.
 *
 * @param emitter - The event emitter instance
 * @param payload - Job completion details
 */
export function emitJobCompleted(
  emitter: FleetManagerEventEmitter,
  payload: JobCompletedPayload,
): void {
  emitter.emit("job:completed", payload);
}

/**
 * Emit a job:failed event
 *
 * Called when a job fails. The job status will be 'failed' or
 * 'cancelled' and includes the error that caused the failure.
 *
 * @param emitter - The event emitter instance
 * @param payload - Job failure details including error
 */
export function emitJobFailed(emitter: FleetManagerEventEmitter, payload: JobFailedPayload): void {
  emitter.emit("job:failed", payload);
}

/**
 * Emit a job:cancelled event
 *
 * Called when a job is cancelled. The job status will be 'cancelled'.
 * Includes information about how the job was terminated (graceful vs forced).
 *
 * @param emitter - The event emitter instance
 * @param payload - Job cancellation details
 */
export function emitJobCancelled(
  emitter: FleetManagerEventEmitter,
  payload: JobCancelledPayload,
): void {
  emitter.emit("job:cancelled", payload);
}

/**
 * Emit a job:forked event
 *
 * Called when a job is forked to create a new job based on an
 * existing job's configuration. The new job inherits context from
 * the original.
 *
 * @param emitter - The event emitter instance
 * @param payload - Job fork details including both jobs
 */
export function emitJobForked(emitter: FleetManagerEventEmitter, payload: JobForkedPayload): void {
  emitter.emit("job:forked", payload);
}
