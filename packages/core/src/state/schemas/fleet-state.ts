/**
 * Zod schemas for fleet state (state.yaml)
 *
 * Defines the schema for tracking fleet-wide state including agent status
 */

import { z } from "zod";

// =============================================================================
// Schedule State Schemas
// =============================================================================

/**
 * Possible states for a schedule
 */
export const ScheduleStatusSchema = z.enum(["idle", "running", "disabled"]);

/**
 * State information for a single schedule
 */
export const ScheduleStateSchema = z.object({
  /** ISO timestamp of when this schedule last ran */
  last_run_at: z.string().nullable().optional(),
  /** ISO timestamp of when this schedule will next run */
  next_run_at: z.string().nullable().optional(),
  /** Current status of the schedule */
  status: ScheduleStatusSchema.default("idle"),
  /** Last error message if the schedule encountered an error */
  last_error: z.string().nullable().optional(),
});

// =============================================================================
// Agent Status Schemas
// =============================================================================

/**
 * Possible states for an agent
 */
export const AgentStatusSchema = z.enum(["idle", "running", "error"]);

/**
 * State information for a single agent
 */
export const AgentStateSchema = z.object({
  /** Current status of the agent */
  status: AgentStatusSchema.default("idle"),
  /** ID of the currently running job, if any */
  current_job: z.string().nullable().optional(),
  /** ID of the last completed job */
  last_job: z.string().nullable().optional(),
  /** Name of the schedule that will trigger the next run */
  next_schedule: z.string().nullable().optional(),
  /** ISO timestamp of when the next scheduled run will occur */
  next_trigger_at: z.string().nullable().optional(),
  /** Docker container ID if running in container */
  container_id: z.string().nullable().optional(),
  /** Error message if status is 'error' */
  error_message: z.string().nullable().optional(),
  /** Map of schedule names to their state */
  schedules: z.record(z.string(), ScheduleStateSchema).optional(),
});

// =============================================================================
// Session Wake Schemas
// =============================================================================

/**
 * A herdctl-owned wake captured from a streaming session's `session_crons`, so
 * the fleet scheduler can re-trigger it after the session is reaped
 * (edspencer/herdctl#307). Keyed by the SDK cron `id` at the top level of state.
 */
export const SessionWakeSchema = z.object({
  /** SDK cron id — the reconciliation key across turns. */
  id: z.string(),
  /** Qualified agent name that owns the session. */
  agent: z.string(),
  /** Session id to resume when the wake fires. */
  sessionId: z.string(),
  /** Cron expression (a one-shot wakeup encodes a single fire time). */
  schedule: z.string(),
  /** `false` for one-shot wakeups; `true` for recurring crons. */
  recurring: z.boolean(),
  /** Prompt injected into the resumed session. */
  prompt: z.string(),
  /** Resolved absolute next fire time (ISO). */
  nextRunAt: z.string(),
  /** ISO capture time — anchors the 7-day recurring expiry. */
  createdAt: z.string(),
});

// =============================================================================
// Fleet State Schemas
// =============================================================================

/**
 * Fleet metadata stored in state.yaml
 */
export const FleetMetadataSchema = z.object({
  /** ISO timestamp of when the fleet was first started */
  started_at: z.string().optional(),
});

/**
 * Top-level fleet state schema (state.yaml)
 */
export const FleetStateSchema = z.object({
  /** Fleet metadata */
  fleet: FleetMetadataSchema.optional().default({}),
  /** Map of agent names to their current state */
  agents: z.record(z.string(), AgentStateSchema).optional().default({}),
  /** Captured session wakes keyed by SDK cron id (see {@link SessionWakeSchema}). */
  session_wakes: z.record(z.string(), SessionWakeSchema).optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;
export type SessionWake = z.infer<typeof SessionWakeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type FleetMetadata = z.infer<typeof FleetMetadataSchema>;
export type FleetState = z.infer<typeof FleetStateSchema>;

// =============================================================================
// Default State
// =============================================================================

/**
 * Create a new empty fleet state
 */
export function createInitialFleetState(): FleetState {
  return {
    fleet: {},
    agents: {},
  };
}

/**
 * Create a default schedule state
 */
export function createDefaultScheduleState(): ScheduleState {
  return {
    last_run_at: null,
    next_run_at: null,
    status: "idle",
    last_error: null,
  };
}
