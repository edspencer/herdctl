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
  AgentChatStatus,
  ScheduleInfo,
  FleetCounts,
} from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { AgentNotFoundError } from "./errors.js";
import type { IChatManager } from "./chat-manager-interface.js";

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
   * - Chat connection state (if configured)
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

    // Get chat managers for connection status
    const chatManagers = this.ctx.getChatManagers?.() ?? new Map<string, IChatManager>();

    return agents.map((agent) => {
      const agentState = fleetState.agents[agent.qualifiedName];
      return buildAgentInfo(agent, agentState, this.ctx.getScheduler(), chatManagers);
    });
  }

  /**
   * Get information about a specific agent by name
   *
   * Accepts either a qualified name (e.g., "herdctl.security-auditor") or a
   * local name (e.g., "security-auditor"). Qualified names are matched first;
   * if no match is found, falls back to matching by local name.
   *
   * Returns detailed information for the specified agent including:
   * - Current status and job information
   * - Schedule details with runtime state
   * - Configuration details
   * - Chat connection state (if configured)
   *
   * This method works whether the fleet is running or stopped.
   *
   * @param name - The agent qualified name or local name to look up
   * @returns AgentInfo for the specified agent
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async getAgentInfoByName(name: string): Promise<AgentInfo> {
    const config = this.ctx.getConfig();
    const agents = config?.agents ?? [];
    // Try qualified name first, fall back to local name
    const agent = agents.find((a) => a.qualifiedName === name)
      ?? agents.find((a) => a.name === name);

    if (!agent) {
      throw new AgentNotFoundError(name);
    }

    // Read fleet state for runtime information
    const fleetState = await this.readFleetStateSnapshot();
    const agentState = fleetState.agents[agent.qualifiedName];

    // Get chat managers for connection status
    const chatManagers = this.ctx.getChatManagers?.() ?? new Map<string, IChatManager>();

    return buildAgentInfo(agent, agentState, this.ctx.getScheduler(), chatManagers);
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
 * @param chatManagers - Map of chat managers for connection status (optional)
 * @returns Complete AgentInfo object
 */
export function buildAgentInfo(
  agent: ResolvedAgent,
  agentState?: AgentState,
  scheduler?: Scheduler | null,
  chatManagers?: Map<string, IChatManager>
): AgentInfo {
  // Build schedule info
  const schedules = buildScheduleInfoList(agent, agentState);

  // Get running count from scheduler or state (use qualifiedName as the key)
  const runningCount = scheduler?.getRunningJobCount(agent.qualifiedName) ?? 0;

  // Determine working directory path
  let working_directory: string | undefined;
  if (typeof agent.working_directory === "string") {
    working_directory = agent.working_directory;
  } else if (agent.working_directory?.root) {
    working_directory = agent.working_directory.root;
  }

  // Build chat status for all platforms
  const chat = buildChatStatuses(agent, chatManagers);

  return {
    name: agent.name,
    qualifiedName: agent.qualifiedName,
    fleetPath: agent.fleetPath,
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
    chat,
  };
}

/**
 * Build chat status for a single platform
 *
 * @param platform - Platform name (e.g., "discord", "slack")
 * @param manager - Chat manager instance
 * @param agentName - Agent name to get status for
 * @returns AgentChatStatus object
 */
function buildChatStatus(
  platform: string,
  manager: IChatManager,
  agentName: string
): AgentChatStatus {
  if (!manager.hasAgent(agentName)) {
    return {
      configured: true,
      connectionStatus: "disconnected",
    };
  }

  const state = manager.getState(agentName);
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
 * Build chat statuses for all configured platforms
 *
 * @param agent - Resolved agent configuration
 * @param chatManagers - Map of platform name to chat manager
 * @returns Record of platform name to chat status, or undefined if no chat configured
 */
function buildChatStatuses(
  agent: ResolvedAgent,
  chatManagers?: Map<string, IChatManager>
): Record<string, AgentChatStatus> | undefined {
  // Map of platform config keys to check
  const platformConfigs: Record<string, unknown> = {
    discord: agent.chat?.discord,
    slack: agent.chat?.slack,
  };

  const result: Record<string, AgentChatStatus> = {};
  let hasAny = false;

  for (const [platform, config] of Object.entries(platformConfigs)) {
    if (config !== undefined) {
      hasAny = true;
      const manager = chatManagers?.get(platform);
      if (manager) {
        result[platform] = buildChatStatus(platform, manager, agent.qualifiedName);
      } else {
        result[platform] = {
          configured: true,
          connectionStatus: "disconnected",
        };
      }
    }
  }

  return hasAny ? result : undefined;
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
      agentName: agent.qualifiedName,
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
