/**
 * Agent Remover for herdctl
 *
 * Handles the filesystem and config operations for removing an installed agent.
 * This includes:
 * - Deleting the agent directory (optionally preserving workspace)
 * - Removing the agent reference from herdctl.yaml
 * - Scanning for env variables to report back to the user
 */

import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";

import { FleetManagerError, type FleetManagerErrorCode } from "../fleet-manager/errors.js";
import { createLogger } from "../utils/logger.js";
import { type DiscoveredAgent, discoverAgents } from "./agent-discovery.js";
import { type EnvScanResult, scanEnvVariables } from "./env-scanner.js";
import { FleetConfigError, removeAgentFromFleetConfig } from "./fleet-config-updater.js";

const logger = createLogger("distribution:remover");

// =============================================================================
// Types
// =============================================================================

/**
 * Options for removing an agent
 */
export interface RemoveOptions {
  /** Agent name to remove */
  name: string;
  /** Path to herdctl.yaml */
  configPath: string;
  /** Base directory of the project (defaults to dirname of configPath) */
  baseDir?: string;
  /** If true, preserve workspace/ directory contents */
  keepWorkspace?: boolean;
}

/**
 * Result of removing an agent
 */
export interface RemoveResult {
  /** The agent name that was removed */
  agentName: string;
  /** The path that was removed */
  removedPath: string;
  /** Whether files were actually deleted */
  filesRemoved: boolean;
  /** Whether the fleet config was updated */
  configUpdated: boolean;
  /** Environment variables that were used by this agent (for user reference) */
  envVariables?: EnvScanResult;
  /** Whether workspace was preserved */
  workspacePreserved: boolean;
}

// =============================================================================
// Error Classes
// =============================================================================

/** Error code: Agent not found in fleet config */
export const AGENT_NOT_FOUND: FleetManagerErrorCode = "AGENT_NOT_FOUND";

/**
 * Error thrown when agent removal fails
 */
export class AgentRemoveError extends FleetManagerError {
  constructor(message: string, code: FleetManagerErrorCode) {
    super(message, { code });
    this.name = "AgentRemoveError";
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely read a file's contents
 */
async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Delete a directory and all its contents, optionally preserving the workspace subdirectory
 */
async function deleteAgentDirectory(
  agentDir: string,
  keepWorkspace: boolean,
): Promise<{ deleted: boolean; workspacePreserved: boolean }> {
  // Check if directory exists
  if (!(await pathExists(agentDir))) {
    logger.debug("Agent directory does not exist, nothing to delete", { path: agentDir });
    return { deleted: false, workspacePreserved: false };
  }

  const workspacePath = join(agentDir, "workspace");
  const hasWorkspace = await pathExists(workspacePath);

  if (keepWorkspace && hasWorkspace) {
    // Delete everything except workspace/
    logger.debug("Preserving workspace, deleting other files", { path: agentDir });

    const entries = await fs.readdir(agentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "workspace") {
        continue;
      }

      const entryPath = join(agentDir, entry.name);
      await fs.rm(entryPath, { recursive: true, force: true });
      logger.debug("Deleted entry", { path: entryPath });
    }

    return { deleted: true, workspacePreserved: true };
  } else {
    // Delete the entire directory
    logger.debug("Deleting entire agent directory", { path: agentDir });
    await fs.rm(agentDir, { recursive: true, force: true });
    return { deleted: true, workspacePreserved: false };
  }
}

/**
 * Find an agent by name in the discovery result
 */
function findAgentByName(agents: DiscoveredAgent[], name: string): DiscoveredAgent | undefined {
  return agents.find((agent) => agent.name === name);
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Remove an agent from the fleet
 *
 * This function:
 * 1. Uses discoverAgents() to find the agent by name
 * 2. Scans agent.yaml for env variables (before deleting!) to report them
 * 3. Deletes the agent directory (optionally preserving workspace/)
 * 4. Removes the agent reference from herdctl.yaml
 *
 * @param options - Remove options including agent name and config path
 * @returns Result indicating what was removed
 * @throws {AgentRemoveError} When the agent is not found
 *
 * @example
 * ```typescript
 * const result = await removeAgent({
 *   name: "my-agent",
 *   configPath: "/path/to/herdctl.yaml"
 * });
 *
 * if (result.filesRemoved) {
 *   console.log(`Deleted: ${result.removedPath}`);
 * }
 *
 * if (result.envVariables?.variables.length > 0) {
 *   console.log("You may want to clean up these env vars:");
 *   for (const v of result.envVariables.variables) {
 *     console.log(`  ${v.name}`);
 *   }
 * }
 * ```
 */
export async function removeAgent(options: RemoveOptions): Promise<RemoveResult> {
  const { name, configPath, keepWorkspace = false } = options;
  const baseDir = options.baseDir ?? dirname(configPath);

  logger.info("Removing agent", { name, configPath, keepWorkspace });

  // ==========================================================================
  // Step 1: Discover agents to find the one we want to remove
  // ==========================================================================
  const discoveryResult = await discoverAgents({ configPath, baseDir });
  const agent = findAgentByName(discoveryResult.agents, name);

  if (!agent) {
    throw new AgentRemoveError(
      `Agent '${name}' not found in fleet configuration. Run 'herdctl agent list' to see available agents.`,
      AGENT_NOT_FOUND,
    );
  }

  logger.debug("Found agent to remove", {
    name: agent.name,
    path: agent.path,
    configPath: agent.configPath,
  });

  // ==========================================================================
  // Step 2: Scan for env variables BEFORE deleting (for user reference)
  // ==========================================================================
  let envVariables: EnvScanResult | undefined;

  const agentYamlPath = join(agent.path, "agent.yaml");
  const agentYamlContent = await readFileContent(agentYamlPath);

  if (agentYamlContent) {
    envVariables = scanEnvVariables(agentYamlContent);
    logger.debug("Scanned env variables", {
      total: envVariables.variables.length,
      required: envVariables.required.length,
      optional: envVariables.optional.length,
    });
  }

  // ==========================================================================
  // Step 3: Delete the agent directory
  // ==========================================================================
  const { deleted: filesRemoved, workspacePreserved } = await deleteAgentDirectory(
    agent.path,
    keepWorkspace,
  );

  logger.debug("Directory deletion result", {
    filesRemoved,
    workspacePreserved,
    path: agent.path,
  });

  // ==========================================================================
  // Step 4: Remove the agent reference from herdctl.yaml
  // ==========================================================================
  let configUpdated = false;

  try {
    const configResult = await removeAgentFromFleetConfig({
      configPath,
      agentPath: agent.configPath,
    });

    configUpdated = configResult.modified;

    if (configResult.modified) {
      logger.info("Removed agent from fleet config", { agentPath: agent.configPath });
    } else if (!configResult.alreadyExists) {
      logger.debug("Agent was not in fleet config", { agentPath: agent.configPath });
    }
  } catch (error) {
    // Config update failure shouldn't fail the overall operation
    // (files are already deleted at this point)
    if (error instanceof FleetConfigError) {
      logger.warn("Failed to update fleet config, but files were removed", {
        error: error.message,
        code: error.code,
      });
    } else {
      logger.warn("Unexpected error updating fleet config", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ==========================================================================
  // Return result
  // ==========================================================================
  const result: RemoveResult = {
    agentName: agent.name,
    removedPath: agent.path,
    filesRemoved,
    configUpdated,
    envVariables,
    workspacePreserved,
  };

  logger.info("Agent removal complete", {
    agentName: result.agentName,
    filesRemoved: result.filesRemoved,
    configUpdated: result.configUpdated,
    workspacePreserved: result.workspacePreserved,
  });

  return result;
}
