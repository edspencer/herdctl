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

// =============================================================================
// Concurrency coordination (edspencer/herdctl#376)
// =============================================================================
//
// Schedule-state mutations are read-modify-write on a single shared `state.yaml`.
// Runtime add/remove of a schedule can now race the scheduler's own per-tick
// state writes, so two hazards need coordinating:
//
//   1. Lost updates — two concurrent RMWs each read the old file and write their
//      own change; the second write clobbers the first (e.g. a sibling schedule's
//      status update is dropped). Fixed by serializing every writer per state
//      file through {@link withStateLock}.
//   2. Resurrection — a schedule is removed (its persisted state pruned) while a
//      run for it is still in flight; that run's completion write would recreate
//      the just-deleted entry. Fixed by a tombstone set: {@link deleteScheduleState}
//      records the key, and {@link updateScheduleState} becomes a no-op for a
//      tombstoned key until the schedule is re-armed (which clears the tombstone).
//
// Both structures are process-local, keyed by absolute state-file path, so they
// coordinate every FleetManager/Scheduler sharing one `.herdctl` in this process.

/** Per-state-file promise chain that serializes read-modify-write operations. */
const stateFileLocks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after all previously-enqueued operations on the same state file have
 * settled, so schedule-state RMWs never interleave. A rejection in one operation
 * does not poison the chain — the next operation still runs.
 */
function withStateLock<T>(stateFilePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = stateFileLocks.get(stateFilePath) ?? Promise.resolve();
  // `then(fn, fn)` runs fn once, whether prev fulfilled or rejected.
  const result = prev.then(fn, fn);
  // Store a non-throwing tail as the new lock so a rejection can't wedge it.
  stateFileLocks.set(
    stateFilePath,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/** Keys of schedules whose state has been pruned and must not be resurrected. */
const tombstonedSchedules = new Set<string>();

function tombstoneKey(stateFilePath: string, agentName: string, scheduleName: string): string {
  // JSON-encode the tuple so no separator can collide with a path/name that
  // happens to contain the delimiter.
  return JSON.stringify([stateFilePath, agentName, scheduleName]);
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

  return withStateLock(stateFilePath, async () => {
    // Resurrection guard: if this schedule has been pruned (removed at runtime)
    // and not re-armed, an in-flight run's trailing state write must NOT recreate
    // its entry. Return the would-be value without persisting it.
    if (tombstonedSchedules.has(tombstoneKey(stateFilePath, agentName, scheduleName))) {
      return { ...createDefaultScheduleState(), ...updates };
    }

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
  });
}

/**
 * Delete the persisted state for a single schedule.
 *
 * Removes the `scheduleName` entry from the agent's `schedules` map in fleet
 * state and writes the result back. This is the prune step for runtime schedule
 * removal (edspencer/herdctl#376): without it, a removed schedule's persisted
 * `last_run_at` / `status` (notably a lingering `disabled`) would survive, and a
 * later re-add of the same name would silently inherit that stale state — the
 * scheduler reads state, not config, to decide disabled/next-run (scheduler.ts).
 *
 * A no-op (no write) if the agent or schedule has no persisted state, so callers
 * need not check existence first. The rest of the agent's state and its other
 * schedules are left untouched.
 *
 * Does not itself tombstone the key — suppressing a still-in-flight run's
 * trailing write is the caller's responsibility via {@link setScheduleTombstone}
 * (see `removeAgentSchedule`), so the tombstone can be set *synchronously* before
 * this async prune and can't be clobbered by a concurrent re-arm.
 *
 * @param stateDir - Path to the state directory (e.g., .herdctl)
 * @param agentName - Name of the agent (qualified name is the state key)
 * @param scheduleName - Name of the schedule to prune
 * @param options - Options including logger
 * @returns `true` if state was pruned, `false` if there was nothing to prune
 *
 * @example
 * ```typescript
 * // After removing a schedule from an agent's config:
 * await deleteScheduleState('.herdctl', 'my-agent', 'hourly');
 * ```
 */
export async function deleteScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  options: ScheduleStateOptions = {},
): Promise<boolean> {
  const stateFilePath = getStateFilePath(stateDir);

  return withStateLock(stateFilePath, async () => {
    const fleetState = await readFleetState(stateFilePath, options);

    const agentState = fleetState.agents[agentName];
    if (!agentState?.schedules || !(scheduleName in agentState.schedules)) {
      // Nothing persisted for this schedule — leave state untouched.
      return false;
    }

    const { [scheduleName]: _removed, ...remainingSchedules } = agentState.schedules;

    const updatedFleetState: FleetState = {
      ...fleetState,
      agents: {
        ...fleetState.agents,
        [agentName]: {
          ...agentState,
          schedules: remainingSchedules,
        },
      },
    };

    await writeFleetState(stateFilePath, updatedFleetState);

    return true;
  });
}

/**
 * Prepare a schedule's persisted state so it is eligible to fire when (re-)armed
 * at runtime (edspencer/herdctl#376).
 *
 * Called by `setAgentSchedule`. It does two things under the state-file lock:
 * Normalizes a lingering `disabled` status to `idle` (clearing `last_error`).
 * Adding/replacing a schedule only mutates config, but the scheduler skips a
 * schedule whose *persisted* status is `disabled` — so without this a
 * set-after-disable would silently never fire, contradicting the "immediately
 * eligible to fire" contract. Other statuses (e.g. `running`) and `last_run_at`
 * are left untouched so an in-flight run and interval cadence are preserved.
 *
 * Note: this does NOT lift the resurrection tombstone. That is coordinated with
 * the active execution generation elsewhere ({@link Scheduler.setAgents} lifts it
 * for a re-armed key only when no run is in flight; the in-flight run's
 * `executeJob` finally lifts it on completion). Clearing it here unconditionally
 * would let a still-in-flight removed run's trailing write contaminate the
 * re-added schedule. Because removal prunes persisted state, a re-add after a
 * remove finds no entry here and is a no-op — so nothing to un-suppress anyway.
 *
 * @returns `true` if a `disabled` status was normalized to `idle`, else `false`.
 */
export async function armScheduleState(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  options: ScheduleStateOptions = {},
): Promise<boolean> {
  const stateFilePath = getStateFilePath(stateDir);

  return withStateLock(stateFilePath, async () => {
    const fleetState = await readFleetState(stateFilePath, options);
    const agentState = fleetState.agents[agentName];
    const scheduleState = agentState?.schedules?.[scheduleName];

    // Only a persisted `disabled` status blocks arming; nothing else to do.
    if (!agentState || !scheduleState || scheduleState.status !== "disabled") {
      return false;
    }

    const updatedFleetState: FleetState = {
      ...fleetState,
      agents: {
        ...fleetState.agents,
        [agentName]: {
          ...agentState,
          schedules: {
            ...agentState.schedules,
            [scheduleName]: { ...scheduleState, status: "idle", last_error: null },
          },
        },
      },
    };

    await writeFleetState(stateFilePath, updatedFleetState);

    return true;
  });
}

/**
 * Lift the resurrection tombstone for a schedule, so its persisted state can be
 * written again (edspencer/herdctl#376).
 *
 * A synchronous, in-memory Set delete — no state-file I/O — so it is safe to call
 * from the scheduler's synchronous `setAgents`. This is the universal un-tombstone
 * hook: it is called for every schedule present in an updated agent list (so
 * `reload()` / `addAgent({replace:true})` / `setAgentSchedule` all re-arm a
 * removed name cleanly, not just `setAgentSchedule`), when an in-flight run for a
 * removed schedule completes, and when a removal happens with no in-flight run to
 * suppress. Without it a stale tombstone would make every `updateScheduleState`
 * for the re-armed name a silent no-op — `last_run_at` never persists, the
 * schedule reads as perpetually "due", and it runaway-fires every tick.
 *
 * A no-op if the key is not tombstoned.
 */
export function clearScheduleTombstone(
  stateDir: string,
  agentName: string,
  scheduleName: string,
): void {
  tombstonedSchedules.delete(tombstoneKey(getStateFilePath(stateDir), agentName, scheduleName));
}

/**
 * Tombstone a schedule so subsequent {@link updateScheduleState} calls for it are
 * suppressed (edspencer/herdctl#376) — used to stop a still-in-flight run for a
 * just-removed schedule from resurrecting its persisted state.
 *
 * A synchronous, in-memory Set add — deliberately not part of the async
 * {@link deleteScheduleState} so the caller can set it with no `await` gap in
 * which a concurrent re-arm's {@link clearScheduleTombstone} could race ahead.
 * The tombstone is bounded: it is lifted when the schedule is re-armed via
 * `setAgents`, when the in-flight run completes (scheduler `executeJob` finally),
 * or by the remover when there is no in-flight run.
 */
export function setScheduleTombstone(
  stateDir: string,
  agentName: string,
  scheduleName: string,
): void {
  tombstonedSchedules.add(tombstoneKey(getStateFilePath(stateDir), agentName, scheduleName));
}

/**
 * Whether a schedule is currently tombstoned (test/introspection helper).
 */
export function isScheduleTombstoned(
  stateDir: string,
  agentName: string,
  scheduleName: string,
): boolean {
  return tombstonedSchedules.has(tombstoneKey(getStateFilePath(stateDir), agentName, scheduleName));
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
