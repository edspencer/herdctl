/**
 * Self-scheduling MCP server injection
 *
 * When an agent has `self_scheduling.enabled: true`, this module injects the
 * herdctl-scheduler MCP server into the agent's mcp_servers. The MCP server
 * lets the agent create, update, and delete its own dynamic schedules.
 *
 * Called from FleetManager.initialize() after the stateDir is known.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedAgent } from "./loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the compiled scheduler MCP server script.
 * Resolves relative to this file's location in dist/.
 */
function getSchedulerMcpPath(): string {
  // This file: dist/config/self-scheduling.js
  // Target:    dist/mcp/scheduler-mcp.js
  return join(__dirname, "..", "mcp", "scheduler-mcp.js");
}

/**
 * Inject the herdctl-scheduler MCP server into agents that have
 * self_scheduling.enabled. Mutates the agent configs in place.
 *
 * @param agents - Resolved agent configs
 * @param stateDir - Absolute path to the .herdctl state directory
 */
export function injectSchedulerMcpServers(agents: ResolvedAgent[], stateDir: string): void {
  const mcpPath = getSchedulerMcpPath();

  for (const agent of agents) {
    if (!agent.self_scheduling?.enabled) continue;

    const selfScheduling = agent.self_scheduling;

    // Collect static schedule names for collision prevention
    const staticScheduleNames = agent.schedules ? Object.keys(agent.schedules) : [];

    // Initialize mcp_servers map if needed
    if (!agent.mcp_servers) {
      agent.mcp_servers = {};
    }

    // Don't overwrite if operator explicitly declared the server
    if ("herdctl-scheduler" in agent.mcp_servers) continue;

    agent.mcp_servers["herdctl-scheduler"] = {
      command: "node",
      args: [mcpPath],
      env: {
        HERDCTL_AGENT_NAME: agent.qualifiedName,
        HERDCTL_STATE_DIR: stateDir,
        HERDCTL_MAX_SCHEDULES: String(selfScheduling.max_schedules ?? 10),
        HERDCTL_MIN_INTERVAL: selfScheduling.min_interval ?? "5m",
        ...(staticScheduleNames.length > 0 && {
          HERDCTL_STATIC_SCHEDULES: staticScheduleNames.join(","),
        }),
      },
    };
  }
}
