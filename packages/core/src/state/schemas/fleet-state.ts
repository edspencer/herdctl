/**
 * Zod schemas for fleet state (state.yaml)
 *
 * Defines the schema for tracking fleet-wide state including agent status
 */

import { z } from "zod";

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
});

// =============================================================================
// Type Exports
// =============================================================================

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
