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

    logger.info(
      `${isReplace ? "Updated" : "Added"} schedule ${agent.qualifiedName}/${scheduleName} programmatically`,
    );

    return this.getSchedule(agent.qualifiedName, scheduleName);
  }

  /**
   * Remove a single schedule from an agent at runtime.
   *
   * Deletes the schedule key from the stored agent's `schedules` map, re-pushes
   * the updated agent list to the scheduler, and — critically — prunes the
   * schedule's persisted state via `deleteScheduleState` and clears the in-memory
   * scheduler bookkeeping (`runningSchedules`/`warnedSchedules`) via
   * `Scheduler.clearScheduleTracking`. Without the prune, a later re-add of the
   * same name would inherit the removed schedule's stale `last_run_at`/`disabled`
   * status, because the scheduler decides disabled/next-run from state, not config
   * (edspencer/herdctl#376). A `config:reloaded` event is emitted.
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

    // Prune persisted state so a re-added name doesn't inherit stale
    // last_run_at / disabled status (edspencer/herdctl#376).
    const { deleteScheduleState } = await import("../scheduler/schedule-state.js");
    await deleteScheduleState(stateDir, agent.qualifiedName, scheduleName, {
      logger: { warn: logger.warn },
    });

    // Clear in-memory scheduler bookkeeping keyed by this schedule.
    this.ctx.getScheduler()?.clearScheduleTracking(agent.qualifiedName, scheduleName);

    logger.info(`Removed schedule ${agent.qualifiedName}/${scheduleName} programmatically`);
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
