/**
 * Self-scheduling MCP server injection
 *
 * When an agent has `self_scheduling.enabled: true`, this module injects the
 * herdctl-scheduler MCP server into the agent's mcp_servers and appends a
 * system prompt snippet that teaches the agent how to use self-scheduling.
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
 * Build the system prompt snippet for self-scheduling guidance.
 * Tailored to the agent's configured limits.
 */
function buildSchedulingPrompt(
  selfScheduling: NonNullable<ResolvedAgent["self_scheduling"]>,
): string {
  const maxSchedules = selfScheduling.max_schedules ?? 10;
  const minInterval = selfScheduling.min_interval ?? "5m";

  return `# Self-Scheduling

You have the ability to manage your own scheduled tasks using the herdctl scheduling tools. These tools let you create, list, update, and delete dynamic schedules that persist across restarts.

## Available tools
- \`herdctl_create_schedule\` — Create a new recurring schedule (cron or interval)
- \`herdctl_list_schedules\` — List your current dynamic schedules
- \`herdctl_update_schedule\` — Update an existing schedule's timing, prompt, or enabled state
- \`herdctl_delete_schedule\` — Remove a schedule you no longer need

## Guidelines
- **Use these tools** to manage your schedules. Never edit agent.yaml, herdctl.yaml, or any configuration files directly.
- **Cron schedules** use standard cron expressions (e.g., \`0 9 * * 1-5\` for weekday mornings). **Interval schedules** use duration strings (e.g., \`30m\`, \`6h\`, \`1d\`).
- **Be conservative with frequency.** Minimum interval is ${minInterval}. Prefer longer intervals unless the user specifically requests frequent checks.
- **You can have up to ${maxSchedules} dynamic schedules.** Use \`herdctl_list_schedules\` to check your current count before creating new ones. Clean up schedules that are no longer needed.
- **Use TTLs for temporary schedules.** If a schedule is only needed for a limited time (e.g., tracking a delivery, monitoring an event), set \`ttl_hours\` so it auto-expires.
- **Write clear, self-contained prompts.** The prompt field is what you'll receive when the schedule triggers — it should contain enough context for you to act without needing the original conversation.
- **Only create schedules when the user asks** or when it's clearly the right tool for a recurring need the user has expressed. Don't speculatively create schedules.`;
}

/**
 * Inject the herdctl-scheduler MCP server and system prompt into agents that
 * have self_scheduling.enabled. Mutates the agent configs in place.
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

    // Append self-scheduling guidance to the agent's system prompt
    const schedulingPrompt = buildSchedulingPrompt(selfScheduling);
    if (agent.system_prompt) {
      agent.system_prompt = agent.system_prompt + "\n\n" + schedulingPrompt;
    } else {
      agent.system_prompt = schedulingPrompt;
    }
  }
}
