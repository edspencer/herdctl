/**
 * Status Queries Module
 *
 * Centralizes all status query logic for FleetManager.
 * Provides methods to query fleet status, agent information, and related helpers.
 *
 * @module status-queries
 */

import type { ResolvedAgent } from "../config/index.js";
import type { AgentState, FleetState } from "../state/schemas/fleet-state.js";
import { readFleetState } from "../state/fleet-state.js";
import type { Scheduler } from "../scheduler/index.js";
import type {
  FleetStatus,
  AgentInfo,
  AgentDiscordStatus,
  AgentSlackStatus,
  ScheduleInfo,
  FleetCounts,
} from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError } from "./errors.js";
import type { DiscordManager } from "./discord-manager.js";
import type { SlackManager } from "./slack-manager.js";

// =============================================================================
// Fleet State Snapshot Type
// =============================================================================

/**
 * Snapshot of fleet state from disk
 *
 * This is an alias for FleetState with required agents field
 * (since we always ensure it's populated even if empty).
 */
export type FleetStateSnapshot = FleetState;

// =============================================================================
// StatusQueries Class
// =============================================================================

/**
 * StatusQueries provides all status query operations for the FleetManager.
 *
 * This class encapsulates the logic for querying fleet status, agent information,
 * and related data using the FleetManagerContext pattern.
 */
export class StatusQueries {
  constructor(private ctx: FleetManagerContext) {}

  /**
   * Read fleet state from disk for status queries
   *
   * This provides a consistent snapshot of the fleet state.
   *
   * @returns Fleet state snapshot with agents and fleet-level state
   */
  async readFleetStateSnapshot(): Promise<FleetStateSnapshot> {
    const stateDirInfo = this.ctx.getStateDirInfo();
    const logger = this.ctx.getLogger();

    if (!stateDirInfo) {
      // Not initialized yet, return empty state
      return { fleet: {}, agents: {} };
    }

    return await readFleetState(stateDirInfo.stateFile, {
      logger: { warn: logger.warn },
    });
  }

  /**
   * Get overall fleet status
   *
   * Returns a comprehensive snapshot of the fleet state including:
   * - Current state and uptime
   * - Agent counts (total, idle, running, error)
   * - Job counts
   * - Scheduler information
   *
   * This method works whether the fleet is running or stopped.
   *
   * @returns A consistent FleetStatus snapshot
   */
  async getFleetStatus(): Promise<FleetStatus> {
    // Get agent info to compute counts
    const agentInfoList = await this.getAgentInfo();

    // Compute counts from agent info
    const counts = computeFleetCounts(agentInfoList);

    // Compute uptime
    const startedAt = this.ctx.getStartedAt();
    const stoppedAt = this.ctx.getStoppedAt();
    let uptimeSeconds: number | null = null;
    if (startedAt) {
      const startTime = new Date(startedAt).getTime();
      const endTime = stoppedAt ? new Date(stoppedAt).getTime() : Date.now();
      uptimeSeconds = Math.floor((endTime - startTime) / 1000);
    }

    // Get scheduler state
    const scheduler = this.ctx.getScheduler();
    const schedulerState = scheduler?.getState();

    return {
      state: this.ctx.getStatus(),
      uptimeSeconds,
      initializedAt: this.ctx.getInitializedAt(),
      startedAt,
      stoppedAt,
      counts,
      scheduler: {
        status: schedulerState?.status ?? "stopped",
        checkCount: schedulerState?.checkCount ?? 0,
        triggerCount: schedulerState?.triggerCount ?? 0,
        lastCheckAt: schedulerState?.lastCheckAt ?? null,
        checkIntervalMs: this.ctx.getCheckInterval(),
      },
      lastError: this.ctx.getLastError(),
    };
  }

  /**
   * Get information about all configured agents
   *
   * Returns detailed information for each agent including:
   * - Current status and job information
   * - Schedule details with runtime state
   * - Configuration details
   * - Discord connection state (if configured)
   *
   * This method works whether the fleet is running or stopped.
   *
   * @returns Array of AgentInfo objects with current state
   */
  async getAgentInfo(): Promise<AgentInfo[]> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];

    // Read fleet state for runtime information
    const fleetState = await this.readFleetStateSnapshot();

    // Get Discord manager for connection status
    const discordManager = this.ctx.getDiscordManager?.() as DiscordManager | undefined;

    // Get Slack manager for connection status
    const slackManager = this.ctx.getSlackManager?.() as SlackManager | undefined;

    return agents.map((agent) => {
      const agentState = fleetState.agents[agent.name];
      return buildAgentInfo(agent, agentState, this.ctx.getScheduler(), discordManager, slackManager);
    });
  }

  /**
   * Get information about a specific agent by name
   *
   * Returns detailed information for the specified agent including:
   * - Current status and job information
   * - Schedule details with runtime state
   * - Configuration details
   * - Discord connection state (if configured)
   *
   * This method works whether the fleet is running or stopped.
   *
   * @param name - The agent name to look up
   * @returns AgentInfo for the specified agent
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async getAgentInfoByName(name: string): Promise<AgentInfo> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    const agent = agents.find((a) => a.name === name);

    if (!agent) {
      throw new AgentNotFoundError(name);
    }

    // Read fleet state for runtime information
    const fleetState = await this.readFleetStateSnapshot();
    const agentState = fleetState.agents[name];

    // Get Discord manager for connection status
    const discordManager = this.ctx.getDiscordManager?.() as DiscordManager | undefined;

    // Get Slack manager for connection status
    const slackManager = this.ctx.getSlackManager?.() as SlackManager | undefined;

    return buildAgentInfo(agent, agentState, this.ctx.getScheduler(), discordManager, slackManager);
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Build AgentInfo from configuration and state
 *
 * @param agent - Resolved agent configuration
 * @param agentState - Runtime agent state (optional)
 * @param scheduler - Scheduler instance for running job counts (optional)
 * @param discordManager - Discord manager for connection status (optional)
 * @returns Complete AgentInfo object
 */
export function buildAgentInfo(
  agent: ResolvedAgent,
  agentState?: AgentState,
  scheduler?: Scheduler | null,
  discordManager?: DiscordManager,
  slackManager?: SlackManager
): AgentInfo {
  // Build schedule info
  const schedules = buildScheduleInfoList(agent, agentState);

  // Get running count from scheduler or state
  const runningCount = scheduler?.getRunningJobCount(agent.name) ?? 0;

  // Determine working directory path
  let working_directory: string | undefined;
  if (typeof agent.working_directory === "string") {
    working_directory = agent.working_directory;
  } else if (agent.working_directory?.root) {
    working_directory = agent.working_directory.root;
  }

  // Build Discord status
  const discord = buildDiscordStatus(agent, discordManager);

  // Build Slack status
  const slack = buildSlackStatus(agent, slackManager);

  return {
    name: agent.name,
    description: agent.description,
    status: agentState?.status ?? "idle",
    currentJobId: agentState?.current_job ?? null,
    lastJobId: agentState?.last_job ?? null,
    maxConcurrent: agent.instances?.max_concurrent ?? 1,
    runningCount,
    errorMessage: agentState?.error_message ?? null,
    scheduleCount: schedules.length,
    schedules,
    model: agent.model,
    working_directory,
    discord,
    slack,
  };
}

/**
 * Build Discord status for an agent
 *
 * @param agent - Resolved agent configuration
 * @param discordManager - Discord manager instance (optional)
 * @returns AgentDiscordStatus object
 */
function buildDiscordStatus(
  agent: ResolvedAgent,
  discordManager?: DiscordManager
): AgentDiscordStatus | undefined {
  // Check if agent has Discord configured
  const hasDiscordConfig = agent.chat?.discord !== undefined;

  if (!hasDiscordConfig) {
    return undefined;
  }

  // Get connector state if available
  const connector = discordManager?.getConnector(agent.name);
  if (!connector) {
    return {
      configured: true,
      connectionStatus: "disconnected",
    };
  }

  const state = connector.getState();
  return {
    configured: true,
    connectionStatus: state.status,
    botUsername: state.botUser?.username,
    lastError: state.lastError ?? undefined,
  };
}

/**
 * Build Slack status for an agent
 *
 * @param agent - Resolved agent configuration
 * @param slackManager - Slack manager instance (optional)
 * @returns AgentSlackStatus object
 */
function buildSlackStatus(
  agent: ResolvedAgent,
  slackManager?: SlackManager
): AgentSlackStatus | undefined {
  const hasSlackConfig = agent.chat?.slack !== undefined;

  if (!hasSlackConfig) {
    return undefined;
  }

  if (!slackManager || !slackManager.hasAgent(agent.name)) {
    return {
      configured: true,
      connectionStatus: "disconnected",
    };
  }

  const state = slackManager.getState();
  if (!state) {
    return {
      configured: true,
      connectionStatus: "disconnected",
    };
  }

  return {
    configured: true,
    connectionStatus: state.status,
    botUsername: state.botUser?.username,
    lastError: state.lastError ?? undefined,
  };
}

/**
 * Build schedule info list from agent configuration and state
 *
 * @param agent - Resolved agent configuration
 * @param agentState - Runtime agent state (optional)
 * @returns Array of ScheduleInfo objects
 */
export function buildScheduleInfoList(
  agent: ResolvedAgent,
  agentState?: AgentState
): ScheduleInfo[] {
  if (!agent.schedules) {
    return [];
  }

  return Object.entries(agent.schedules).map(([name, schedule]) => {
    const scheduleState = agentState?.schedules?.[name];

    return {
      name,
      agentName: agent.name,
      type: schedule.type,
      interval: schedule.interval,
      expression: schedule.expression,
      status: scheduleState?.status ?? "idle",
      lastRunAt: scheduleState?.last_run_at ?? null,
      nextRunAt: scheduleState?.next_run_at ?? null,
      lastError: scheduleState?.last_error ?? null,
    };
  });
}

/**
 * Compute fleet counts from agent info list
 *
 * @param agentInfoList - List of AgentInfo objects
 * @returns FleetCounts with summary statistics
 */
export function computeFleetCounts(agentInfoList: AgentInfo[]): FleetCounts {
  let idleAgents = 0;
  let runningAgents = 0;
  let errorAgents = 0;
  let totalSchedules = 0;
  let runningSchedules = 0;
  let runningJobs = 0;

  for (const agent of agentInfoList) {
    switch (agent.status) {
      case "idle":
        idleAgents++;
        break;
      case "running":
        runningAgents++;
        break;
      case "error":
        errorAgents++;
        break;
    }

    totalSchedules += agent.scheduleCount;
    runningJobs += agent.runningCount;

    for (const schedule of agent.schedules) {
      if (schedule.status === "running") {
        runningSchedules++;
      }
    }
  }

  return {
    totalAgents: agentInfoList.length,
    idleAgents,
    runningAgents,
    errorAgents,
    totalSchedules,
    runningSchedules,
    runningJobs,
  };
}
