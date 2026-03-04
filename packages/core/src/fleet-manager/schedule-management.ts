/**
 * Schedule Management Module
 *
 * Centralizes all schedule management logic for FleetManager.
 * Provides methods to query, enable, and disable schedules.
 *
 * @module schedule-management
 */

import { listDynamicSchedules, loadAllDynamicSchedules } from "../scheduler/dynamic-schedules.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError, ScheduleNotFoundError } from "./errors.js";
import { buildScheduleInfoList, type FleetStateSnapshot } from "./status-queries.js";
import type { ScheduleInfo } from "./types.js";

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
    private readFleetStateSnapshotFn: () => Promise<FleetStateSnapshot>,
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
    const stateDir = this.ctx.getStateDir();

    const allSchedules: ScheduleInfo[] = [];

    // Load dynamic schedules from disk
    let dynamicSchedules = new Map<
      string,
      Record<
        string,
        { type: string; interval?: string; cron?: string; prompt?: string; enabled?: boolean }
      >
    >();
    try {
      dynamicSchedules = (await loadAllDynamicSchedules(stateDir)) as typeof dynamicSchedules;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.ctx.getLogger().warn(`Failed to load dynamic schedules: ${msg}`);
    }

    for (const agent of agents) {
      const agentState = fleetState.agents[agent.qualifiedName];
      const schedules = buildScheduleInfoList(agent, agentState);
      allSchedules.push(...schedules);

      // Add dynamic schedules for this agent
      const agentDynamic = dynamicSchedules.get(agent.qualifiedName);
      if (agentDynamic) {
        const staticNames = new Set(agent.schedules ? Object.keys(agent.schedules) : []);
        for (const [name, schedule] of Object.entries(agentDynamic)) {
          // Skip if a static schedule with the same name exists (static wins)
          if (staticNames.has(name)) continue;

          const scheduleState = agentState?.schedules?.[name];
          allSchedules.push({
            name,
            agentName: agent.qualifiedName,
            type: schedule.type,
            interval: schedule.interval,
            cron: schedule.cron,
            status: scheduleState?.status ?? "idle",
            lastRunAt: scheduleState?.last_run_at ?? null,
            nextRunAt: scheduleState?.next_run_at ?? null,
            lastError: scheduleState?.last_error ?? null,
            source: "dynamic",
          });
        }
      }
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

    const fleetState = await this.readFleetStateSnapshotFn();
    const agentState = fleetState.agents[agent.qualifiedName];

    // Check static schedules first
    if (agent.schedules && scheduleName in agent.schedules) {
      const schedule = agent.schedules[scheduleName];
      const scheduleState = agentState?.schedules?.[scheduleName];
      return {
        name: scheduleName,
        agentName: agent.qualifiedName,
        type: schedule.type,
        interval: schedule.interval,
        cron: schedule.cron,
        status: scheduleState?.status ?? "idle",
        lastRunAt: scheduleState?.last_run_at ?? null,
        nextRunAt: scheduleState?.next_run_at ?? null,
        lastError: scheduleState?.last_error ?? null,
        source: "static",
      };
    }

    // Fall back to dynamic schedules
    const stateDir = this.ctx.getStateDir();
    let dynamicScheduleNames: string[] = [];
    try {
      const dynamic = await listDynamicSchedules(stateDir, agent.qualifiedName);
      dynamicScheduleNames = Object.keys(dynamic);
      if (scheduleName in dynamic) {
        const schedule = dynamic[scheduleName];
        const scheduleState = agentState?.schedules?.[scheduleName];
        return {
          name: scheduleName,
          agentName: agent.qualifiedName,
          type: schedule.type,
          interval: schedule.interval,
          cron: schedule.cron,
          status: scheduleState?.status ?? "idle",
          lastRunAt: scheduleState?.last_run_at ?? null,
          nextRunAt: scheduleState?.next_run_at ?? null,
          lastError: scheduleState?.last_error ?? null,
          source: "dynamic",
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.ctx
        .getLogger()
        .warn(`Failed to load dynamic schedules for ${agent.qualifiedName}: ${msg}`);
    }

    const staticNames = agent.schedules ? Object.keys(agent.schedules) : [];
    const availableSchedules = [...new Set([...staticNames, ...dynamicScheduleNames])];
    throw new ScheduleNotFoundError(agentName, scheduleName, {
      availableSchedules,
    });
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

    // Validate the agent exists
    const agents = config?.agents ?? [];
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    // Verify the schedule exists (static or dynamic)
    await this.getSchedule(agent.qualifiedName, scheduleName);

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

    // Validate the agent exists
    const agents = config?.agents ?? [];
    const agent =
      agents.find((a) => a.qualifiedName === agentName) ?? agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.qualifiedName),
      });
    }

    // Verify the schedule exists (static or dynamic)
    await this.getSchedule(agent.qualifiedName, scheduleName);

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
}
