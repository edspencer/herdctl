/**
 * Schedule state management
 *
 * Provides functions for reading and updating schedule state within fleet state.
 * Schedule state is stored per-agent in the `schedules` map within AgentState.
 */

import { join } from "node:path";
import { readFleetState, writeFleetState } from "../state/fleet-state.js";
import {
  createDefaultScheduleState,
  type FleetState,
  type ScheduleState,
} from "../state/schemas/fleet-state.js";
import { STATE_FILE_NAME } from "../state/types.js";
import { createLogger } from "../utils/logger.js";

/**
 * Logger interface for warning messages
 */
export interface ScheduleStateLogger {
  warn: (message: string) => void;
}

/**
 * Default console logger
 */
const _defaultLogger: ScheduleStateLogger = createLogger("schedule-state");

/**
 * Options for schedule state operations
 */
export interface ScheduleStateOptions {
  /**
   * Logger for warning messages
   * Default: console.warn
   */
  logger?: ScheduleStateLogger;
}

/**
 * Partial updates for schedule state
 */
export type ScheduleStateUpdates = Partial<ScheduleState>;

/**
 * Get the state file path from a state directory
 */
function getStateFilePath(stateDir: string): string {
  return join(stateDir, STATE_FILE_NAME);
}

/**
 * Get the schedule state for a specific agent and schedule
 *
 * Returns default state if the agent or schedule doesn't exist.
 *
 * @param stateDir - Path to the state directory (e.g., .herdctl)
 * @param agentName - Name of the agent
 * @param scheduleName - Name of the schedule
 * @param options - Options including logger
 * @returns The schedule state, or default state if not found
 *
 * @example
 * ```typescript
 * const state = await getScheduleState('.herdctl', 'my-agent', 'hourly');
 * console.log(state.last_run_at);
 * console.log(state.next_run_at);
 * console.log(state.status);
 * ```
 */
export async function getScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  options: ScheduleStateOptions = {},
): Promise<ScheduleState> {
  const stateFilePath = getStateFilePath(stateDir);
  const fleetState = await readFleetState(stateFilePath, options);

  const agentState = fleetState.agents[agentName];
  if (!agentState || !agentState.schedules) {
    return createDefaultScheduleState();
  }

  const scheduleState = agentState.schedules[scheduleName];
  if (!scheduleState) {
    return createDefaultScheduleState();
  }

  return scheduleState;
}

/**
 * Update the schedule state for a specific agent and schedule
 *
 * This function:
 * 1. Reads current fleet state
 * 2. Applies partial updates to the specified schedule
 * 3. Writes the updated state back atomically
 *
 * If the agent or schedule doesn't exist, it will be created.
 *
 * @param stateDir - Path to the state directory (e.g., .herdctl)
 * @param agentName - Name of the agent
 * @param scheduleName - Name of the schedule
 * @param updates - Partial ScheduleState updates to apply
 * @param options - Options including logger
 * @returns The updated ScheduleState
 *
 * @example
 * ```typescript
 * // Mark schedule as running
 * await updateScheduleState('.herdctl', 'my-agent', 'hourly', {
 *   status: 'running',
 *   last_run_at: new Date().toISOString(),
 * });
 *
 * // Record error
 * await updateScheduleState('.herdctl', 'my-agent', 'hourly', {
 *   status: 'idle',
 *   last_error: 'Container exited with code 1',
 * });
 *
 * // Clear error
 * await updateScheduleState('.herdctl', 'my-agent', 'hourly', {
 *   last_error: null,
 * });
 * ```
 */
export async function updateScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  updates: ScheduleStateUpdates,
  options: ScheduleStateOptions = {},
): Promise<ScheduleState> {
  const stateFilePath = getStateFilePath(stateDir);
  const fleetState = await readFleetState(stateFilePath, options);

  // Get or create agent state
  const currentAgentState = fleetState.agents[agentName] ?? { status: "idle" };

  // Get current schedules map or create empty one
  const currentSchedules = currentAgentState.schedules ?? {};

  // Get current schedule state or create default
  const currentScheduleState = currentSchedules[scheduleName] ?? createDefaultScheduleState();

  // Merge updates
  const updatedScheduleState: ScheduleState = {
    ...currentScheduleState,
    ...updates,
  };

  // Update the fleet state
  const updatedFleetState: FleetState = {
    ...fleetState,
    agents: {
      ...fleetState.agents,
      [agentName]: {
        ...currentAgentState,
        schedules: {
          ...currentSchedules,
          [scheduleName]: updatedScheduleState,
        },
      },
    },
  };

  // Write back
  await writeFleetState(stateFilePath, updatedFleetState);

  return updatedScheduleState;
}

/**
 * Get all schedule states for a specific agent
 *
 * Returns an empty object if the agent doesn't exist or has no schedules.
 *
 * @param stateDir - Path to the state directory (e.g., .herdctl)
 * @param agentName - Name of the agent
 * @param options - Options including logger
 * @returns Map of schedule names to their state
 *
 * @example
 * ```typescript
 * const schedules = await getAgentScheduleStates('.herdctl', 'my-agent');
 * for (const [name, state] of Object.entries(schedules)) {
 *   console.log(`${name}: ${state.status}, last run: ${state.last_run_at}`);
 * }
 * ```
 */
export async function getAgentScheduleStates(
  stateDir: string,
  agentName: string,
  options: ScheduleStateOptions = {},
): Promise<Record<string, ScheduleState>> {
  const stateFilePath = getStateFilePath(stateDir);
  const fleetState = await readFleetState(stateFilePath, options);

  const agentState = fleetState.agents[agentName];
  if (!agentState || !agentState.schedules) {
    return {};
  }

  return agentState.schedules;
}
