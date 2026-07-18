/**
 * Schedule Management Module
 *
 * Centralizes all schedule management logic for FleetManager.
 * Provides methods to query, enable, disable, add, and remove schedules.
 *
 * @module schedule-management
 */

import {
  type ResolvedAgent,
  type ResolvedConfig,
  type Schedule,
  ScheduleSchema,
} from "../config/index.js";
import type { FleetManagerContext } from "./context.js";
import {
  AgentNotFoundError,
  ConfigurationError,
  ScheduleMutationDisabledError,
  ScheduleNotFoundError,
} from "./errors.js";
import { buildScheduleInfoList, type FleetStateSnapshot } from "./status-queries.js";
import type { ConfigChange, ScheduleInfo } from "./types.js";

// =============================================================================
// ScheduleManagement Class
// =============================================================================

/**
 * ScheduleManagement provides all schedule management operations for the FleetManager.
 *
 * This class encapsulates the logic for querying, enabling, disabling, adding, and
 * removing schedules using the FleetManagerContext pattern.
 *
 * Runtime add/remove of a single schedule ({@link setAgentSchedule} /
 * {@link removeAgentSchedule}) is gated behind `allowScheduleMutation` — supplied
 * as {@link isMutationAllowed} — so a deployment must opt in before schedules can
 * be mutated programmatically (edspencer/herdctl#376).
 */
export class ScheduleManagement {
  constructor(
    private ctx: FleetManagerContext,
    private readFleetStateSnapshotFn: () => Promise<FleetStateSnapshot>,
    private setConfig: (config: ResolvedConfig) => void,
    private isMutationAllowed: () => boolean,
  ) {}

  /**
   * Get all schedules across all agents
   *
   * Returns a list of all configured schedules with their current state,
   * including next trigger times.
   *
   * @returns Array of ScheduleInfo objects with current state
   */
  async getSchedules(): Promise<ScheduleInfo[]> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    const fleetState = await this.readFleetStateSnapshotFn();

    const allSchedules: ScheduleInfo[] = [];

    for (const agent of agents) {
      const agentState = fleetState.agents[agent.qualifiedName];
      const schedules = buildScheduleInfoList(agent, agentState);
      allSchedules.push(...schedules);
    }

    return allSchedules;
  }

  /**
   * Get a specific schedule by agent name and schedule name
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The schedule info with current state
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async getSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    // Try qualified name first, fall back to local name
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules ? Object.keys(agent.schedules) : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    const fleetState = await this.readFleetStateSnapshotFn();
    const agentState = fleetState.agents[agent.qualifiedName];
    const schedule = agent.schedules[scheduleName];
    const scheduleState = agentState?.schedules?.[scheduleName];

    return {
      name: scheduleName,
      agentName,
      type: schedule.type,
      interval: schedule.interval,
      cron: schedule.cron,
      status: scheduleState?.status ?? "idle",
      lastRunAt: scheduleState?.last_run_at ?? null,
      nextRunAt: scheduleState?.next_run_at ?? null,
      lastError: scheduleState?.last_error ?? null,
    };
  }

  /**
   * Enable a disabled schedule
   *
   * Enables a schedule that was previously disabled, allowing it to trigger
   * again on its configured interval. The enabled state is persisted to the
   * state directory and survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async enableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();

    // Validate the agent and schedule exist
    const agents = config?.agents ?? [];
    // Try qualified name first, fall back to local name
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules ? Object.keys(agent.schedules) : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to enabled (idle) — use qualifiedName as the state key
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agent.qualifiedName,
      scheduleName,
      { status: "idle" },
      { logger: { warn: logger.warn } },
    );

    logger.info(`Enabled schedule ${agent.qualifiedName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agent.qualifiedName, scheduleName);
  }

  /**
   * Disable a schedule
   *
   * Disables a schedule, preventing it from triggering on its configured
   * interval. The schedule remains in the configuration but won't run until
   * re-enabled. The disabled state is persisted to the state directory and
   * survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   */
  async disableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const config = this.ctx.getConfig();
    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();

    // Validate the agent and schedule exist
    const agents = config?.agents ?? [];
    // Try qualified name first, fall back to local name
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules ? Object.keys(agent.schedules) : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to disabled — use qualifiedName as the state key
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agent.qualifiedName,
      scheduleName,
      { status: "disabled" },
      { logger: { warn: logger.warn } },
    );

    logger.info(`Disabled schedule ${agent.qualifiedName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agent.qualifiedName, scheduleName);
  }

  /**
   * Add or replace a single schedule on an already-registered agent at runtime.
   *
   * Unlike {@link enableSchedule}/{@link disableSchedule} (which flip persisted
   * state), this changes the agent's *configuration*: the schedule is validated
   * against {@link ScheduleSchema}, set on the stored agent's `schedules` map, and
   * the updated agent list is re-pushed to the scheduler. Arming reads live
   * `agent.schedules` each tick, so the schedule is immediately eligible to fire
   * (or, when re-registering an existing name, picks up the new timing) without a
   * `reload()` or whole-agent `addAgent(replace)` round trip. A `config:reloaded`
   * event describing the change is emitted.
   *
   * Gated behind `allowScheduleMutation` (see {@link ScheduleMutationDisabledError}).
   *
   * @param agentName - Qualified or local name of an existing agent
   * @param scheduleName - The schedule key to set
   * @param schedule - The schedule definition (validated against ScheduleSchema)
   * @returns The resulting schedule info
   * @throws {ScheduleMutationDisabledError} If schedule mutation is not enabled
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ConfigurationError} If the schedule fails validation
   */
  async setAgentSchedule(
    agentName: string,
    scheduleName: string,
    schedule: Schedule | Record<string, unknown>,
  ): Promise<ScheduleInfo> {
    this.assertMutationAllowed("setAgentSchedule");

    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();
    const { config, agent } = this.requireAgent(agentName);

    // Validate against the schema so runtime input gets the same defaults
    // (e.g. enabled/resume_session) and coercions a file-loaded schedule would.
    let validated: Schedule;
    try {
      validated = ScheduleSchema.parse(schedule);
    } catch (error) {
      throw new ConfigurationError(
        `Invalid schedule configuration for "${agentName}/${scheduleName}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }

    const isReplace = Boolean(agent.schedules && scheduleName in agent.schedules);
    const updatedAgent: ResolvedAgent = {
      ...agent,
      schedules: { ...(agent.schedules ?? {}), [scheduleName]: validated },
    };

    this.commitAgent(config, agent, updatedAgent, {
      type: isReplace ? "modified" : "added",
      category: "schedule",
      name: `${agent.qualifiedName}/${scheduleName}`,
      details: validated.type,
    });

    // Arm the persisted state: lift any tombstone from a prior removal and
    // normalize a lingering `disabled` status to `idle`. Config-only changes
    // don't touch state, but the scheduler skips a schedule whose *persisted*
    // status is `disabled` — so a set-after-disable would otherwise never fire,
    // contradicting the "immediately eligible to fire" contract (#376).
    const { armScheduleState } = await import("../scheduler/schedule-state.js");
    const clearedDisabled = await armScheduleState(stateDir, agent.qualifiedName, scheduleName, {
      logger: { warn: logger.warn },
    });

    logger.info(
      `${isReplace ? "Updated" : "Added"} schedule ${agent.qualifiedName}/${scheduleName} programmatically` +
        (clearedDisabled ? " (cleared disabled state)" : ""),
    );

    return this.getSchedule(agent.qualifiedName, scheduleName);
  }

  /**
   * Remove a single schedule from an agent at runtime.
   *
   * Removal is coordinated as one lifecycle operation so it is safe to call while
   * the scheduler is actively firing (edspencer/herdctl#376):
   * 1. Drop the schedule from the stored agent's `schedules` map and re-push via
   *    `scheduler.setAgents(...)` — arming reads live config each tick, so this
   *    stops any *future* fire immediately.
   * 2. Prune the schedule's persisted state via `deleteScheduleState`, which also
   *    **tombstones** the key: the read-modify-write is serialized per state file
   *    (so a concurrent sibling update can't be lost), and any still-in-flight
   *    run's trailing state write is suppressed rather than resurrecting the
   *    just-deleted entry.
   * 3. Clear only the scheduler's warn-once bookkeeping via
   *    `clearScheduleTracking`. An in-flight run's entry in the running set is
   *    deliberately retained until that run's own `finally` clears it, so a
   *    same-name re-add is correctly skipped as "already running" rather than
   *    starting a second concurrent execution.
   *
   * The removed schedule's own in-flight run (if any) is not cancelled — it
   * finishes naturally and its trailing writes are absorbed by the tombstone. A
   * `config:reloaded` event is emitted.
   *
   * Deferred (documented in the PR): full generation-fencing of an old run's
   * completion write after a same-name re-add. The tombstone prevents
   * resurrection of deleted state; the residual is that a re-add during an
   * old run's tail may see one `idle`/`next_run` write from that run — bounded,
   * non-resurrecting, and self-correcting on the next tick.
   *
   * Gated behind `allowScheduleMutation` (see {@link ScheduleMutationDisabledError}).
   *
   * @param agentName - Qualified or local name of an existing agent
   * @param scheduleName - The schedule key to remove
   * @returns `true` if a schedule was removed, `false` if the agent had no such schedule
   * @throws {ScheduleMutationDisabledError} If schedule mutation is not enabled
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  async removeAgentSchedule(agentName: string, scheduleName: string): Promise<boolean> {
    this.assertMutationAllowed("removeAgentSchedule");

    const logger = this.ctx.getLogger();
    const stateDir = this.ctx.getStateDir();
    const { config, agent } = this.requireAgent(agentName);

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      logger.debug(
        `removeAgentSchedule: no schedule "${scheduleName}" on agent "${agent.qualifiedName}"`,
      );
      return false;
    }

    const { [scheduleName]: _removed, ...remainingSchedules } = agent.schedules;
    const updatedAgent: ResolvedAgent = { ...agent, schedules: remainingSchedules };

    this.commitAgent(config, agent, updatedAgent, {
      type: "removed",
      category: "schedule",
      name: `${agent.qualifiedName}/${scheduleName}`,
    });

    const wasRunning =
      this.ctx.getScheduler()?.isScheduleRunning(agent.qualifiedName, scheduleName) ?? false;

    // Prune persisted state (serialized RMW) and tombstone the key so a trailing
    // write from any in-flight run can't resurrect it (edspencer/herdctl#376).
    const { deleteScheduleState } = await import("../scheduler/schedule-state.js");
    await deleteScheduleState(stateDir, agent.qualifiedName, scheduleName, {
      logger: { warn: logger.warn },
    });

    // Clear only the warn-once bookkeeping; an in-flight run's running-set entry
    // is retained until it completes (see clearScheduleTracking).
    this.ctx.getScheduler()?.clearScheduleTracking(agent.qualifiedName, scheduleName);

    logger.info(
      `Removed schedule ${agent.qualifiedName}/${scheduleName} programmatically` +
        (wasRunning ? " (a run is still in flight and will finish)" : ""),
    );
    return true;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Throw {@link ScheduleMutationDisabledError} unless the deployment has opted
   * into programmatic schedule mutation.
   */
  private assertMutationAllowed(operation: string): void {
    if (!this.isMutationAllowed()) {
      throw new ScheduleMutationDisabledError(operation);
    }
  }

  /**
   * Resolve an agent by qualified name (preferred) or local name from the loaded
   * config, throwing {@link AgentNotFoundError} if absent.
   */
  private requireAgent(agentName: string): { config: ResolvedConfig; agent: ResolvedAgent } {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!config || !agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    return { config, agent };
  }

  /**
   * Replace one agent in the stored config with an updated copy, push the new
   * agent list to the scheduler, and emit a `config:reloaded` event. Mirrors
   * `AgentManagement.commit`, the single seam for programmatic config mutation.
   */
  private commitAgent(
    config: ResolvedConfig,
    previous: ResolvedAgent,
    updated: ResolvedAgent,
    change: ConfigChange,
  ): void {
    const newAgents = config.agents.map((a) => (a === previous ? updated : a));
    const newConfig: ResolvedConfig = { ...config, agents: newAgents };
    this.setConfig(newConfig);

    this.ctx.getScheduler()?.setAgents(newAgents);

    this.ctx.emit("config:reloaded", {
      agentCount: newAgents.length,
      agentNames: newAgents.map((a) => a.qualifiedName),
      configPath: config.configPath,
      changes: [change],
      timestamp: new Date().toISOString(),
    });
  }
}
