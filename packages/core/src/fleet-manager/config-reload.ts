/**
 * Config Reload Module
 *
 * Centralizes all configuration reload logic for FleetManager.
 * Provides methods to reload configuration and compute changes between versions.
 *
 * @module config-reload
 */

import type { ResolvedAgent, ResolvedConfig } from "../config/index.js";
import type { ConfigChange, ConfigReloadedPayload } from "./types.js";
import type { FleetManagerContext } from "./context.js";
import { InvalidStateError } from "./errors.js";

// =============================================================================
// Schedule Type for Comparison
// =============================================================================

/**
 * Minimal schedule type for comparison operations
 */
interface ScheduleForComparison {
  type: string;
  interval?: string;
  expression?: string;
  prompt?: string;
}

// =============================================================================
// ConfigReload Class
// =============================================================================

/**
 * ConfigReload provides configuration reload operations for the FleetManager.
 *
 * This class encapsulates the logic for hot-reloading configuration
 * using the FleetManagerContext pattern.
 */
export class ConfigReload {
  constructor(
    private ctx: FleetManagerContext,
    private loadConfiguration: () => Promise<ResolvedConfig>,
    private setConfig: (config: ResolvedConfig) => void,
  ) {}

  /**
   * Reload configuration without restarting the fleet
   *
   * This method provides hot configuration reload capability:
   * 1. Loads and validates the new configuration
   * 2. If validation fails, keeps the old configuration (fails gracefully)
   * 3. Running jobs continue with their original configuration
   * 4. New jobs will use the new configuration
   * 5. Updates the scheduler with new agent definitions and schedules
   * 6. Emits a 'config:reloaded' event with a list of changes
   *
   * @returns The reload result with change details
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {ConfigurationError} If the new configuration is invalid
   */
  async reload(): Promise<ConfigReloadedPayload> {
    const logger = this.ctx.getLogger();
    const status = this.ctx.getStatus();
    const scheduler = this.ctx.getScheduler();

    // Validate state - must be at least initialized
    if (status === "uninitialized") {
      throw new InvalidStateError("reload", status, [
        "initialized",
        "starting",
        "running",
        "stopping",
        "stopped",
      ]);
    }

    logger.info("Reloading configuration...");

    // Store old config for comparison
    const oldConfig = this.ctx.getConfig();

    // Try to load new configuration
    let newConfig: ResolvedConfig;
    try {
      newConfig = await this.loadConfiguration();
    } catch (error) {
      // Log the error but don't update config - fail gracefully
      logger.error(
        `Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.info("Keeping existing configuration");

      // Re-throw so caller knows reload failed
      throw error;
    }

    // Compute changes between old and new config
    const changes = computeConfigChanges(oldConfig, newConfig);

    // Update the stored configuration
    this.setConfig(newConfig);

    // Update the scheduler with new agents (if scheduler exists and is running)
    if (scheduler) {
      scheduler.setAgents(newConfig.agents);
      logger.debug(`Updated scheduler with ${newConfig.agents.length} agents`);
    }

    const timestamp = new Date().toISOString();

    // Build the reload payload
    const payload: ConfigReloadedPayload = {
      agentCount: newConfig.agents.length,
      agentNames: newConfig.agents.map((a) => a.qualifiedName),
      configPath: newConfig.configPath,
      changes,
      timestamp,
    };

    // Emit the config:reloaded event
    this.ctx.emit("config:reloaded", payload);

    logger.info(
      `Configuration reloaded: ${newConfig.agents.length} agents, ${changes.length} changes`,
    );

    return payload;
  }
}

// =============================================================================
// Config Change Computation
// =============================================================================

/**
 * Compute the list of changes between old and new configuration
 *
 * Compares two configuration versions and produces a detailed list of
 * what changed. Changes are categorized by type (added, removed, modified)
 * and category (agent, schedule).
 *
 * @param oldConfig - Previous configuration (null for first load)
 * @param newConfig - New configuration to compare against
 * @returns Array of ConfigChange objects describing all changes
 */
export function computeConfigChanges(
  oldConfig: ResolvedConfig | null,
  newConfig: ResolvedConfig,
): ConfigChange[] {
  const changes: ConfigChange[] = [];

  const oldAgents = oldConfig?.agents ?? [];
  const newAgents = newConfig.agents;

  // Use qualifiedName as the diff key to support nested fleet agents
  const oldAgentMap = new Map(oldAgents.map((a) => [a.qualifiedName, a]));
  const newAgentMap = new Map(newAgents.map((a) => [a.qualifiedName, a]));

  // Find added agents
  for (const agent of newAgents) {
    if (!oldAgentMap.has(agent.qualifiedName)) {
      changes.push({
        type: "added",
        category: "agent",
        name: agent.qualifiedName,
        details: agent.description,
      });

      // Also add all schedules for new agents
      if (agent.schedules) {
        for (const scheduleName of Object.keys(agent.schedules)) {
          changes.push({
            type: "added",
            category: "schedule",
            name: `${agent.qualifiedName}/${scheduleName}`,
          });
        }
      }
    }
  }

  // Find removed agents
  for (const agent of oldAgents) {
    if (!newAgentMap.has(agent.qualifiedName)) {
      changes.push({
        type: "removed",
        category: "agent",
        name: agent.qualifiedName,
      });

      // Also mark all schedules as removed
      if (agent.schedules) {
        for (const scheduleName of Object.keys(agent.schedules)) {
          changes.push({
            type: "removed",
            category: "schedule",
            name: `${agent.qualifiedName}/${scheduleName}`,
          });
        }
      }
    }
  }

  // Find modified agents and schedules
  for (const newAgent of newAgents) {
    const oldAgent = oldAgentMap.get(newAgent.qualifiedName);
    if (!oldAgent) {
      continue; // Already handled as "added"
    }

    // Check for agent-level modifications
    const agentModified = getAgentModifications(oldAgent, newAgent);
    if (agentModified) {
      changes.push({
        type: "modified",
        category: "agent",
        name: newAgent.qualifiedName,
        details: agentModified,
      });
    }

    // Check for schedule changes
    const scheduleChanges = computeScheduleChanges(oldAgent, newAgent);
    changes.push(...scheduleChanges);
  }

  return changes;
}

/**
 * Compute schedule changes between old and new agent configurations
 *
 * @param oldAgent - Previous agent configuration
 * @param newAgent - New agent configuration
 * @returns Array of ConfigChange objects for schedule changes
 */
export function computeScheduleChanges(
  oldAgent: ResolvedAgent,
  newAgent: ResolvedAgent,
): ConfigChange[] {
  const changes: ConfigChange[] = [];

  const oldScheduleNames = new Set(oldAgent.schedules ? Object.keys(oldAgent.schedules) : []);
  const newScheduleNames = new Set(newAgent.schedules ? Object.keys(newAgent.schedules) : []);

  // Use qualifiedName for schedule change names
  const agentKey = newAgent.qualifiedName;

  // Added schedules
  for (const scheduleName of newScheduleNames) {
    if (!oldScheduleNames.has(scheduleName)) {
      changes.push({
        type: "added",
        category: "schedule",
        name: `${agentKey}/${scheduleName}`,
      });
    }
  }

  // Removed schedules
  for (const scheduleName of oldScheduleNames) {
    if (!newScheduleNames.has(scheduleName)) {
      changes.push({
        type: "removed",
        category: "schedule",
        name: `${agentKey}/${scheduleName}`,
      });
    }
  }

  // Modified schedules
  for (const scheduleName of newScheduleNames) {
    if (oldScheduleNames.has(scheduleName)) {
      const oldSchedule = oldAgent.schedules![scheduleName];
      const newSchedule = newAgent.schedules![scheduleName];

      if (isScheduleModified(oldSchedule, newSchedule)) {
        changes.push({
          type: "modified",
          category: "schedule",
          name: `${agentKey}/${scheduleName}`,
          details: getScheduleModificationDetails(oldSchedule, newSchedule),
        });
      }
    }
  }

  return changes;
}

// =============================================================================
// Agent Diff Helpers
// =============================================================================

/**
 * Check if an agent configuration has been modified
 *
 * Returns a description of what changed, or null if not modified.
 *
 * @param oldAgent - Previous agent configuration
 * @param newAgent - New agent configuration
 * @returns Description of modifications, or null if unchanged
 */
export function getAgentModifications(
  oldAgent: ResolvedAgent,
  newAgent: ResolvedAgent,
): string | null {
  const modifications: string[] = [];

  // Check key properties
  if (oldAgent.description !== newAgent.description) {
    modifications.push("description");
  }
  if (oldAgent.model !== newAgent.model) {
    modifications.push("model");
  }
  if (oldAgent.max_turns !== newAgent.max_turns) {
    modifications.push("max_turns");
  }
  if (oldAgent.system_prompt !== newAgent.system_prompt) {
    modifications.push("system_prompt");
  }

  // Check working directory
  const oldWorkingDirectory =
    typeof oldAgent.working_directory === "string"
      ? oldAgent.working_directory
      : oldAgent.working_directory?.root;
  const newWorkingDirectory =
    typeof newAgent.working_directory === "string"
      ? newAgent.working_directory
      : newAgent.working_directory?.root;
  if (oldWorkingDirectory !== newWorkingDirectory) {
    modifications.push("working_directory");
  }

  // Check instances
  const oldMaxConcurrent = oldAgent.instances?.max_concurrent ?? 1;
  const newMaxConcurrent = newAgent.instances?.max_concurrent ?? 1;
  if (oldMaxConcurrent !== newMaxConcurrent) {
    modifications.push("max_concurrent");
  }

  return modifications.length > 0 ? modifications.join(", ") : null;
}

/**
 * Check if an agent has been modified (boolean version)
 *
 * @param oldAgent - Previous agent configuration
 * @param newAgent - New agent configuration
 * @returns True if the agent has been modified
 */
export function isAgentModified(oldAgent: ResolvedAgent, newAgent: ResolvedAgent): boolean {
  return getAgentModifications(oldAgent, newAgent) !== null;
}

// =============================================================================
// Schedule Diff Helpers
// =============================================================================

/**
 * Check if a schedule configuration has been modified
 *
 * @param oldSchedule - Previous schedule configuration
 * @param newSchedule - New schedule configuration
 * @returns True if the schedule has been modified
 */
export function isScheduleModified(
  oldSchedule: ScheduleForComparison,
  newSchedule: ScheduleForComparison,
): boolean {
  return (
    oldSchedule.type !== newSchedule.type ||
    oldSchedule.interval !== newSchedule.interval ||
    oldSchedule.expression !== newSchedule.expression ||
    oldSchedule.prompt !== newSchedule.prompt
  );
}

/**
 * Get a description of what changed in a schedule
 *
 * @param oldSchedule - Previous schedule configuration
 * @param newSchedule - New schedule configuration
 * @returns Human-readable description of the changes
 */
export function getScheduleModificationDetails(
  oldSchedule: ScheduleForComparison,
  newSchedule: ScheduleForComparison,
): string {
  const details: string[] = [];

  if (oldSchedule.type !== newSchedule.type) {
    details.push(`type: ${oldSchedule.type} → ${newSchedule.type}`);
  }
  if (oldSchedule.interval !== newSchedule.interval) {
    details.push(`interval: ${oldSchedule.interval ?? "none"} → ${newSchedule.interval ?? "none"}`);
  }
  if (oldSchedule.expression !== newSchedule.expression) {
    details.push(
      `expression: ${oldSchedule.expression ?? "none"} → ${newSchedule.expression ?? "none"}`,
    );
  }
  if (oldSchedule.prompt !== newSchedule.prompt) {
    details.push("prompt changed");
  }

  return details.join("; ");
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get a summary of configuration changes
 *
 * Provides a human-readable summary of the changes.
 *
 * @param changes - Array of ConfigChange objects
 * @returns Summary string describing the changes
 */
export function getChangesSummary(changes: ConfigChange[]): string {
  const counts = {
    agentsAdded: 0,
    agentsRemoved: 0,
    agentsModified: 0,
    schedulesAdded: 0,
    schedulesRemoved: 0,
    schedulesModified: 0,
  };

  for (const change of changes) {
    if (change.category === "agent") {
      if (change.type === "added") counts.agentsAdded++;
      else if (change.type === "removed") counts.agentsRemoved++;
      else if (change.type === "modified") counts.agentsModified++;
    } else if (change.category === "schedule") {
      if (change.type === "added") counts.schedulesAdded++;
      else if (change.type === "removed") counts.schedulesRemoved++;
      else if (change.type === "modified") counts.schedulesModified++;
    }
  }

  const parts: string[] = [];

  if (counts.agentsAdded > 0) {
    parts.push(`${counts.agentsAdded} agent${counts.agentsAdded > 1 ? "s" : ""} added`);
  }
  if (counts.agentsRemoved > 0) {
    parts.push(`${counts.agentsRemoved} agent${counts.agentsRemoved > 1 ? "s" : ""} removed`);
  }
  if (counts.agentsModified > 0) {
    parts.push(`${counts.agentsModified} agent${counts.agentsModified > 1 ? "s" : ""} modified`);
  }
  if (counts.schedulesAdded > 0) {
    parts.push(`${counts.schedulesAdded} schedule${counts.schedulesAdded > 1 ? "s" : ""} added`);
  }
  if (counts.schedulesRemoved > 0) {
    parts.push(
      `${counts.schedulesRemoved} schedule${counts.schedulesRemoved > 1 ? "s" : ""} removed`,
    );
  }
  if (counts.schedulesModified > 0) {
    parts.push(
      `${counts.schedulesModified} schedule${counts.schedulesModified > 1 ? "s" : ""} modified`,
    );
  }

  return parts.length > 0 ? parts.join(", ") : "no changes";
}

/**
 * Filter changes by category
 *
 * @param changes - Array of ConfigChange objects
 * @param category - Category to filter by ("agent" or "schedule")
 * @returns Filtered array of ConfigChange objects
 */
export function filterChangesByCategory(
  changes: ConfigChange[],
  category: "agent" | "schedule",
): ConfigChange[] {
  return changes.filter((c) => c.category === category);
}

/**
 * Filter changes by type
 *
 * @param changes - Array of ConfigChange objects
 * @param type - Type to filter by ("added", "removed", or "modified")
 * @returns Filtered array of ConfigChange objects
 */
export function filterChangesByType(
  changes: ConfigChange[],
  type: "added" | "removed" | "modified",
): ConfigChange[] {
  return changes.filter((c) => c.type === type);
}

/**
 * Check if there are any agent changes
 *
 * @param changes - Array of ConfigChange objects
 * @returns True if any agent changes exist
 */
export function hasAgentChanges(changes: ConfigChange[]): boolean {
  return changes.some((c) => c.category === "agent");
}

/**
 * Check if there are any schedule changes
 *
 * @param changes - Array of ConfigChange objects
 * @returns True if any schedule changes exist
 */
export function hasScheduleChanges(changes: ConfigChange[]): boolean {
  return changes.some((c) => c.category === "schedule");
}

/**
 * Get names of added agents
 *
 * @param changes - Array of ConfigChange objects
 * @returns Array of added agent names
 */
export function getAddedAgentNames(changes: ConfigChange[]): string[] {
  return changes.filter((c) => c.category === "agent" && c.type === "added").map((c) => c.name);
}

/**
 * Get names of removed agents
 *
 * @param changes - Array of ConfigChange objects
 * @returns Array of removed agent names
 */
export function getRemovedAgentNames(changes: ConfigChange[]): string[] {
  return changes.filter((c) => c.category === "agent" && c.type === "removed").map((c) => c.name);
}

/**
 * Get names of modified agents
 *
 * @param changes - Array of ConfigChange objects
 * @returns Array of modified agent names
 */
export function getModifiedAgentNames(changes: ConfigChange[]): string[] {
  return changes.filter((c) => c.category === "agent" && c.type === "modified").map((c) => c.name);
}
