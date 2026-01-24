/**
 * Schedule Management Module
 *
 * Centralizes all schedule management logic for FleetManager.
 * Provides methods to query, enable, and disable schedules.
 *
 * @module schedule-management
 */

import type { ScheduleInfo } from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError, ScheduleNotFoundError } from "./errors.js";
import { buildScheduleInfoList, type FleetStateSnapshot } from "./status-queries.js";

// =============================================================================
// ScheduleManagement Class
// =============================================================================

/**
 * ScheduleManagement provides all schedule management operations for the FleetManager.
 *
 * This class encapsulates the logic for querying, enabling, and disabling schedules
 * using the FleetManagerContext pattern.
 */
export class ScheduleManagement {
  constructor(
    private ctx: FleetManagerContext,
    private readFleetStateSnapshotFn: () => Promise<FleetStateSnapshot>
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
      const agentState = fleetState.agents[agent.name];
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
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    const fleetState = await this.readFleetStateSnapshotFn();
    const agentState = fleetState.agents[agentName];
    const schedule = agent.schedules[scheduleName];
    const scheduleState = agentState?.schedules?.[scheduleName];

    return {
      name: scheduleName,
      agentName,
      type: schedule.type,
      interval: schedule.interval,
      expression: schedule.expression,
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
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to enabled (idle)
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agentName,
      scheduleName,
      { status: "idle" },
      { logger: { warn: logger.warn } }
    );

    logger.info(`Enabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
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
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to disabled
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      stateDir,
      agentName,
      scheduleName,
      { status: "disabled" },
      { logger: { warn: logger.warn } }
    );

    logger.info(`Disabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
  }
}
