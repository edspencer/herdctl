/**
 * herdctl status - Show fleet and agent status
 *
 * Commands:
 * - herdctl status               Overview of all agents
 * - herdctl status <agent>       Detailed status of specific agent
 * - herdctl status --json        JSON output for scripting
 */

import {
  FleetManager,
  ConfigNotFoundError,
  AgentNotFoundError,
  isFleetManagerError,
  type FleetStatus,
  type AgentInfo,
  type ScheduleInfo,
} from "@herdctl/core";

export interface StatusOptions {
  json?: boolean;
  state?: string;
  config?: string;
}

/**
 * Default state directory
 */
const DEFAULT_STATE_DIR = ".herdctl";

/**
 * Check if colors should be disabled
 */
function shouldUseColor(): boolean {
  // NO_COLOR takes precedence (https://no-color.org/)
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  // Also check FORCE_COLOR for override
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  // Check if stdout is a TTY
  return process.stdout.isTTY === true;
}

/**
 * ANSI color codes
 */
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Get a colored string, respecting NO_COLOR
 */
function colorize(text: string, color: keyof typeof colors): string {
  if (!shouldUseColor()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Format relative time (e.g., "in 45m", "5m ago")
 */
function formatRelativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return "-";
  }

  const now = Date.now();
  const timestamp = new Date(isoTimestamp).getTime();
  const diffMs = timestamp - now;
  const absDiffMs = Math.abs(diffMs);

  // Convert to appropriate unit
  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeStr: string;
  if (days > 0) {
    timeStr = `${days}d`;
  } else if (hours > 0) {
    timeStr = `${hours}h`;
  } else if (minutes > 0) {
    timeStr = `${minutes}m`;
  } else {
    timeStr = `${seconds}s`;
  }

  // Future time or past time
  if (diffMs > 0) {
    return `in ${timeStr}`;
  } else if (diffMs < 0) {
    return `${timeStr} ago`;
  } else {
    return "now";
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number | null): string {
  if (seconds === null) {
    return "-";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(" ");
}

/**
 * Get status color based on status string
 */
function getStatusColor(status: string): keyof typeof colors {
  switch (status) {
    case "running":
      return "green";
    case "idle":
    case "stopped":
    case "initialized":
      return "yellow";
    case "error":
      return "red";
    default:
      return "reset";
  }
}

/**
 * Format agent status with color
 */
function formatStatus(status: string): string {
  const color = getStatusColor(status);
  return colorize(status, color);
}

/**
 * Get status indicator symbol
 */
function getStatusIndicator(status: string): string {
  switch (status) {
    case "running":
      return colorize("●", "green");
    case "idle":
      return colorize("○", "yellow");
    case "error":
      return colorize("●", "red");
    default:
      return colorize("○", "reset");
  }
}

/**
 * Check if any agents are in sub-fleets (non-empty fleetPath)
 */
function hasSubFleets(agents: AgentInfo[]): boolean {
  return agents.some(a => a.fleetPath && a.fleetPath.length > 0);
}

/**
 * Group agents by their fleet path for hierarchical display
 */
function groupAgentsByFleet(agents: AgentInfo[]): { rootAgents: AgentInfo[]; fleetGroups: Map<string, AgentInfo[]> } {
  const rootAgents: AgentInfo[] = [];
  const fleetGroups = new Map<string, AgentInfo[]>();

  for (const agent of agents) {
    if (!agent.fleetPath || agent.fleetPath.length === 0) {
      rootAgents.push(agent);
    } else {
      const fleetKey = agent.fleetPath.join(".");
      const group = fleetGroups.get(fleetKey) ?? [];
      group.push(agent);
      fleetGroups.set(fleetKey, group);
    }
  }

  return { rootAgents, fleetGroups };
}

/**
 * Format agents in a hierarchical fleet view
 */
function formatFleetHierarchy(agents: AgentInfo[]): string[] {
  const lines: string[] = [];
  const { rootAgents, fleetGroups } = groupAgentsByFleet(agents);

  // Display fleet groups first
  for (const [fleetKey, groupAgents] of fleetGroups) {
    lines.push(`${colorize("▼", "bold")} ${colorize(fleetKey, "bold")}`);
    for (const agent of groupAgents) {
      const indicator = getStatusIndicator(agent.status);
      const nextRun = getNextScheduleRun(agent.schedules);
      const nextRunStr = nextRun ? colorize(` (next: ${formatRelativeTime(nextRun)})`, "dim") : "";
      lines.push(`    ${indicator} ${agent.name}   ${colorize(`(${agent.status})`, "dim")}${nextRunStr}`);
    }
  }

  // Display root-level agents (ungrouped)
  for (const agent of rootAgents) {
    const indicator = getStatusIndicator(agent.status);
    const nextRun = getNextScheduleRun(agent.schedules);
    const nextRunStr = nextRun ? colorize(` (next: ${formatRelativeTime(nextRun)})`, "dim") : "";
    lines.push(`${indicator} ${agent.name}   ${colorize(`(${agent.status})`, "dim")}${nextRunStr}`);
  }

  return lines;
}

/**
 * Format fleet overview table
 */
function formatFleetOverview(status: FleetStatus, agents: AgentInfo[]): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(colorize("Fleet Status", "bold"));
  lines.push("═".repeat(60));

  // Fleet state
  lines.push(`State:      ${formatStatus(status.state)}`);
  lines.push(`Uptime:     ${formatUptime(status.uptimeSeconds)}`);

  // Counts
  lines.push("");
  lines.push(colorize("Counts", "bold"));
  lines.push("─".repeat(30));
  lines.push(`Agents:     ${status.counts.totalAgents} total (${colorize(String(status.counts.runningAgents), "green")} running, ${colorize(String(status.counts.idleAgents), "yellow")} idle, ${colorize(String(status.counts.errorAgents), "red")} error)`);
  lines.push(`Schedules:  ${status.counts.totalSchedules} total (${status.counts.runningSchedules} running)`);
  lines.push(`Jobs:       ${status.counts.runningJobs} running`);

  // Scheduler info
  if (status.scheduler.status !== "stopped") {
    lines.push("");
    lines.push(colorize("Scheduler", "bold"));
    lines.push("─".repeat(30));
    lines.push(`Status:     ${formatStatus(status.scheduler.status)}`);
    lines.push(`Checks:     ${status.scheduler.checkCount}`);
    lines.push(`Triggers:   ${status.scheduler.triggerCount}`);
    if (status.scheduler.lastCheckAt) {
      lines.push(`Last check: ${formatRelativeTime(status.scheduler.lastCheckAt)}`);
    }
  }

  // Agents section
  if (agents.length > 0) {
    lines.push("");
    lines.push(colorize("Agents", "bold"));
    lines.push("─".repeat(60));

    if (hasSubFleets(agents)) {
      // Hierarchical display for composed fleets
      lines.push(...formatFleetHierarchy(agents));
    } else {
      // Flat table for single-fleet configs (unchanged from today)
      const nameWidth = Math.max(6, ...agents.map(a => a.name.length)) + 2;
      const statusWidth = 10;
      const schedWidth = 10;
      const nextRunWidth = 15;

      lines.push(
        `${"NAME".padEnd(nameWidth)}${"STATUS".padEnd(statusWidth)}${"SCHEDULES".padEnd(schedWidth)}${"NEXT RUN".padEnd(nextRunWidth)}`
      );
      lines.push(colorize("─".repeat(nameWidth + statusWidth + schedWidth + nextRunWidth), "dim"));

      // Table rows
      for (const agent of agents) {
        const nextRun = getNextScheduleRun(agent.schedules);
        lines.push(
          `${agent.name.padEnd(nameWidth)}${formatStatus(agent.status).padEnd(statusWidth + (shouldUseColor() ? colors.reset.length + colors[getStatusColor(agent.status)].length : 0))}${String(agent.scheduleCount).padEnd(schedWidth)}${formatRelativeTime(nextRun).padEnd(nextRunWidth)}`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Get the next scheduled run time across all schedules
 */
function getNextScheduleRun(schedules: ScheduleInfo[]): string | null {
  let earliest: string | null = null;

  for (const schedule of schedules) {
    if (schedule.nextRunAt) {
      if (!earliest || new Date(schedule.nextRunAt) < new Date(earliest)) {
        earliest = schedule.nextRunAt;
      }
    }
  }

  return earliest;
}

/**
 * Format agent detail view
 */
function formatAgentDetail(agent: AgentInfo): string {
  const lines: string[] = [];

  // Header — show qualifiedName if in a sub-fleet, otherwise just name
  const displayName = agent.qualifiedName !== agent.name ? agent.qualifiedName : agent.name;
  lines.push("");
  lines.push(colorize(`Agent: ${displayName}`, "bold"));
  lines.push("═".repeat(60));

  // Basic info
  if (agent.fleetPath && agent.fleetPath.length > 0) {
    lines.push(`Fleet:       ${agent.fleetPath.join(".")}`);
  }
  if (agent.description) {
    lines.push(`Description: ${agent.description}`);
  }
  lines.push(`Status:      ${formatStatus(agent.status)}`);
  if (agent.errorMessage) {
    lines.push(`Error:       ${colorize(agent.errorMessage, "red")}`);
  }

  // Configuration
  lines.push("");
  lines.push(colorize("Configuration", "bold"));
  lines.push("─".repeat(30));
  if (agent.model) {
    lines.push(`Model:       ${agent.model}`);
  }
  if (agent.working_directory) {
    lines.push(`Working Directory: ${agent.working_directory}`);
  }
  lines.push(`Concurrency: ${agent.runningCount}/${agent.maxConcurrent}`);

  // Job info
  lines.push("");
  lines.push(colorize("Jobs", "bold"));
  lines.push("─".repeat(30));
  lines.push(`Running:     ${agent.runningCount}`);
  if (agent.currentJobId) {
    lines.push(`Current:     ${colorize(agent.currentJobId, "cyan")}`);
  }
  if (agent.lastJobId) {
    lines.push(`Last:        ${colorize(agent.lastJobId, "dim")}`);
  }

  // Schedules
  if (agent.schedules.length > 0) {
    lines.push("");
    lines.push(colorize("Schedules", "bold"));
    lines.push("─".repeat(60));

    for (const schedule of agent.schedules) {
      lines.push("");
      lines.push(`  ${colorize(schedule.name, "bold")} (${schedule.type})`);
      lines.push(`    Status:   ${formatStatus(schedule.status)}`);

      if (schedule.interval) {
        lines.push(`    Interval: ${schedule.interval}`);
      }
      if (schedule.expression) {
        lines.push(`    Cron:     ${schedule.expression}`);
      }

      lines.push(`    Last run: ${formatRelativeTime(schedule.lastRunAt)}`);
      lines.push(`    Next run: ${formatRelativeTime(schedule.nextRunAt)}`);

      if (schedule.lastError) {
        lines.push(`    Error:    ${colorize(schedule.lastError, "red")}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * JSON output structure for fleet status
 */
interface FleetStatusJson {
  fleet: FleetStatus;
  agents: AgentInfo[];
}

/**
 * JSON output structure for agent status
 */
interface AgentStatusJson {
  agent: AgentInfo;
}

/**
 * Show fleet status (herdctl status)
 */
export async function statusCommand(
  agentName: string | undefined,
  options: StatusOptions
): Promise<void> {
  const stateDir = options.state || DEFAULT_STATE_DIR;

  // Create FleetManager
  const manager = new FleetManager({
    configPath: options.config,
    stateDir,
  });

  try {
    // Initialize to load configuration
    await manager.initialize();

    if (agentName) {
      // Agent detail view
      const agent = await manager.getAgentInfoByName(agentName);

      if (options.json) {
        const output: AgentStatusJson = { agent };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(formatAgentDetail(agent));
      }
    } else {
      // Fleet overview
      const status = await manager.getFleetStatus();
      const agents = await manager.getAgentInfo();

      if (options.json) {
        const output: FleetStatusJson = { fleet: status, agents };
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(formatFleetOverview(status, agents));
      }
    }
  } catch (error) {
    // Handle specific error types
    if (error instanceof ConfigNotFoundError) {
      if (options.json) {
        console.log(JSON.stringify({
          error: {
            code: "CONFIG_NOT_FOUND",
            message: "No configuration file found",
            startDirectory: error.startDirectory,
          },
        }, null, 2));
        process.exit(1);
      }
      console.error("");
      console.error("Error: No configuration file found.");
      console.error(`Searched from: ${error.startDirectory}`);
      console.error("");
      console.error("Run 'herdctl init' to create a configuration file.");
      process.exit(1);
    }

    if (error instanceof AgentNotFoundError) {
      if (options.json) {
        console.log(JSON.stringify({
          error: {
            code: "AGENT_NOT_FOUND",
            message: error.message,
            agentName: agentName,
          },
        }, null, 2));
        process.exit(1);
      }
      console.error("");
      console.error(`Error: Agent '${agentName}' not found.`);
      console.error("");
      console.error("Run 'herdctl status' to see all agents.");
      process.exit(1);
    }

    if (isFleetManagerError(error)) {
      if (options.json) {
        console.log(JSON.stringify({
          error: {
            code: error.code,
            message: error.message,
          },
        }, null, 2));
        process.exit(1);
      }
      console.error("");
      console.error(`Error: ${error.message}`);
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
      process.exit(1);
    }

    // Generic error
    if (options.json) {
      console.log(JSON.stringify({
        error: {
          code: "UNKNOWN_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      }, null, 2));
      process.exit(1);
    }
    console.error("");
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
