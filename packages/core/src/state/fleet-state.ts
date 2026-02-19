/**
 * Fleet state management (state.yaml)
 *
 * Provides functions for reading, writing, and updating fleet state.
 * Handles missing files gracefully and corrupted files with warnings.
 */

import { ZodError } from "zod";
import {
  FleetStateSchema,
  createInitialFleetState,
  type FleetState,
  type AgentState,
} from "./schemas/fleet-state.js";
import { safeReadYaml } from "./utils/reads.js";
import { atomicWriteYaml } from "./utils/atomic.js";
import { StateFileError } from "./errors.js";
import { createLogger } from "../utils/logger.js";

/**
 * Logger interface for warning messages
 */
export interface StateLogger {
  warn: (message: string) => void;
}

/**
 * Default console logger
 */
const defaultLogger: StateLogger = createLogger("fleet-state");

/**
 * Options for reading fleet state
 */
export interface ReadFleetStateOptions {
  /**
   * Logger for warning messages (e.g., corrupted file warnings)
   * Default: console.warn
   */
  logger?: StateLogger;
}

/**
 * Options for writing fleet state
 */
export interface WriteFleetStateOptions {
  /**
   * YAML indent level
   * Default: 2
   */
  indent?: number;
}

/**
 * Read and validate fleet state from state.yaml
 *
 * Handles:
 * - Missing file: Returns default empty state
 * - Corrupted file: Logs warning, returns default empty state
 * - Valid file: Returns validated FleetState
 *
 * @param stateFilePath - Path to state.yaml file
 * @param options - Read options including logger
 * @returns Validated FleetState object
 *
 * @example
 * ```typescript
 * const state = await readFleetState('.herdctl/state.yaml');
 * console.log(state.fleet.started_at);
 * console.log(state.agents);
 * ```
 */
export async function readFleetState(
  stateFilePath: string,
  options: ReadFleetStateOptions = {},
): Promise<FleetState> {
  const logger = options.logger ?? defaultLogger;

  // Attempt to read the file
  const readResult = await safeReadYaml<unknown>(stateFilePath);

  // Handle file not found - return default state
  if (!readResult.success) {
    if (readResult.error.code === "ENOENT") {
      return createInitialFleetState();
    }
    // For other read errors, log and return default
    logger.warn(
      `Failed to read state file '${stateFilePath}': ${readResult.error.message}. Using default state.`,
    );
    return createInitialFleetState();
  }

  // Handle empty file - return default state
  if (readResult.data === null || readResult.data === undefined) {
    return createInitialFleetState();
  }

  // Validate against schema
  try {
    return FleetStateSchema.parse(readResult.data);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join(", ");
      logger.warn(`Corrupted state file '${stateFilePath}': ${issues}. Using default state.`);
      return createInitialFleetState();
    }
    // Unexpected error - log and return default
    logger.warn(
      `Unexpected error parsing state file '${stateFilePath}': ${(error as Error).message}. Using default state.`,
    );
    return createInitialFleetState();
  }
}

/**
 * Write fleet state to state.yaml atomically
 *
 * Uses atomic write (write to temp file, then rename) to prevent corruption.
 *
 * @param stateFilePath - Path to state.yaml file
 * @param state - FleetState object to write
 * @param options - Write options
 * @throws {StateFileError} If write fails
 *
 * @example
 * ```typescript
 * const state = await readFleetState('.herdctl/state.yaml');
 * state.fleet.started_at = new Date().toISOString();
 * await writeFleetState('.herdctl/state.yaml', state);
 * ```
 */
export async function writeFleetState(
  stateFilePath: string,
  state: FleetState,
  options: WriteFleetStateOptions = {},
): Promise<void> {
  // Validate before writing
  const validatedState = FleetStateSchema.parse(state);

  try {
    await atomicWriteYaml(stateFilePath, validatedState, {
      indent: options.indent ?? 2,
    });
  } catch (error) {
    throw new StateFileError(
      `Failed to write state file '${stateFilePath}': ${(error as Error).message}`,
      stateFilePath,
      "write",
      error as Error,
    );
  }
}

/**
 * Partial updates for agent state
 */
export type AgentStateUpdates = Partial<AgentState>;

/**
 * Update a single agent's state within the fleet state
 *
 * This is a convenience function that:
 * 1. Reads current state
 * 2. Applies partial updates to the specified agent
 * 3. Writes the updated state back atomically
 *
 * If the agent doesn't exist, it will be created with the provided updates.
 *
 * @param stateFilePath - Path to state.yaml file
 * @param agentName - Qualified name of the agent (e.g., "herdctl.security-auditor" or just "my-agent" for root-level)
 * @param updates - Partial AgentState updates to apply
 * @param options - Options for read/write operations
 * @returns The updated FleetState
 * @throws {StateFileError} If write fails
 *
 * @example
 * ```typescript
 * // Mark agent as running with a job
 * await updateAgentState('.herdctl/state.yaml', 'my-agent', {
 *   status: 'running',
 *   current_job: 'job-123',
 * });
 *
 * // Clear error state
 * await updateAgentState('.herdctl/state.yaml', 'my-agent', {
 *   status: 'idle',
 *   error_message: null,
 * });
 * ```
 */
export async function updateAgentState(
  stateFilePath: string,
  agentName: string,
  updates: AgentStateUpdates,
  options: ReadFleetStateOptions & WriteFleetStateOptions = {},
): Promise<FleetState> {
  // Read current state
  const currentState = await readFleetState(stateFilePath, options);

  // Get current agent state or create new one
  const currentAgentState = currentState.agents[agentName] ?? { status: "idle" };

  // Merge updates
  const updatedAgentState: AgentState = {
    ...currentAgentState,
    ...updates,
  };

  // Update the state
  const updatedState: FleetState = {
    ...currentState,
    agents: {
      ...currentState.agents,
      [agentName]: updatedAgentState,
    },
  };

  // Write back
  await writeFleetState(stateFilePath, updatedState, options);

  return updatedState;
}

/**
 * Initialize fleet state with started_at timestamp if not already set
 *
 * @param stateFilePath - Path to state.yaml file
 * @param options - Options for read/write operations
 * @returns The initialized FleetState
 */
export async function initializeFleetState(
  stateFilePath: string,
  options: ReadFleetStateOptions & WriteFleetStateOptions = {},
): Promise<FleetState> {
  const currentState = await readFleetState(stateFilePath, options);

  // Only set started_at if not already set
  if (!currentState.fleet.started_at) {
    const updatedState: FleetState = {
      ...currentState,
      fleet: {
        ...currentState.fleet,
        started_at: new Date().toISOString(),
      },
    };
    await writeFleetState(stateFilePath, updatedState, options);
    return updatedState;
  }

  return currentState;
}

/**
 * Remove an agent from the fleet state
 *
 * @param stateFilePath - Path to state.yaml file
 * @param agentName - Qualified name of the agent to remove
 * @param options - Options for read/write operations
 * @returns The updated FleetState
 */
export async function removeAgentState(
  stateFilePath: string,
  agentName: string,
  options: ReadFleetStateOptions & WriteFleetStateOptions = {},
): Promise<FleetState> {
  const currentState = await readFleetState(stateFilePath, options);

  // Create new agents map without the specified agent
  const { [agentName]: _, ...remainingAgents } = currentState.agents;

  const updatedState: FleetState = {
    ...currentState,
    agents: remainingAgents,
  };

  await writeFleetState(stateFilePath, updatedState, options);
  return updatedState;
}
