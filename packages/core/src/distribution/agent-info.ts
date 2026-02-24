/**
 * Agent Information Module
 *
 * Provides detailed information about a specific agent in the fleet.
 * Gathers data from multiple sources:
 * - agent.yaml (name, description, schedules)
 * - metadata.json (installation info for installed agents)
 * - herdctl.json (repository metadata)
 * - Environment variable scanning
 * - File listing
 */

import * as fs from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

import { createLogger } from "../utils/logger.js";
import { type DiscoveredAgent, discoverAgents } from "./agent-discovery.js";
import { type AgentRepoMetadata, AgentRepoMetadataSchema } from "./agent-repo-metadata.js";
import { type EnvScanResult, scanEnvVariables } from "./env-scanner.js";
import type { InstallationMetadata } from "./installation-metadata.js";

const logger = createLogger("distribution:agent-info");

// =============================================================================
// Types
// =============================================================================

/**
 * Detailed information about an agent
 */
export interface AgentDetailedInfo {
  /** Agent name */
  name: string;
  /** Agent description (from agent.yaml) */
  description?: string;
  /** Whether installed via herdctl agent add */
  installed: boolean;
  /** Full installation metadata (source, timestamp, etc.) */
  metadata?: InstallationMetadata;
  /** Full path to agent directory */
  path: string;
  /** Relative config path (e.g., ./agents/my-agent/agent.yaml) */
  configPath: string;
  /** Version (from metadata source or herdctl.json) */
  version?: string;
  /** herdctl.json metadata if present */
  repoMetadata?: AgentRepoMetadata;
  /** Environment variables scanned from agent.yaml */
  envVariables?: EnvScanResult;
  /** Schedules configured in agent.yaml (record of name -> schedule config) */
  schedules?: Record<string, unknown>;
  /** Whether a workspace directory exists */
  hasWorkspace: boolean;
  /** List of files in the agent directory */
  files: string[];
}

/**
 * Options for getting agent information
 */
export interface AgentInfoOptions {
  /** Agent name to look up */
  name: string;
  /** Path to herdctl.yaml */
  configPath: string;
  /** Base directory of the project */
  baseDir?: string;
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
 * Read a file as text, returning null if it fails
 */
async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Safely read and parse a JSON file
 */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Recursively list files in a directory
 * Excludes .git and node_modules directories
 */
async function listFilesRecursive(
  dir: string,
  baseDir: string = dir,
  excludeDirs: Set<string> = new Set([".git", "node_modules"]),
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) {
          const subFiles = await listFilesRecursive(fullPath, baseDir, excludeDirs);
          files.push(...subFiles);
        }
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch {
    // Directory might not exist or be readable
    return [];
  }

  return files.sort();
}

/**
 * Extract schedules from parsed agent.yaml
 */
function extractSchedules(agentYaml: Record<string, unknown>): Record<string, unknown> | undefined {
  const schedules = agentYaml.schedules;
  if (!schedules || typeof schedules !== "object") {
    return undefined;
  }
  return schedules as Record<string, unknown>;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Get detailed information about a specific agent
 *
 * This function:
 * 1. Uses discoverAgents() to find the agent by name
 * 2. If not found, returns null
 * 3. If found, gathers additional details:
 *    - Scans agent.yaml for environment variables
 *    - Extracts schedules from agent.yaml
 *    - Reads herdctl.json if present
 *    - Checks for workspace directory
 *    - Lists all files in the agent directory
 *
 * @param options - Options including agent name and config path
 * @returns Detailed agent information or null if not found
 *
 * @example
 * ```typescript
 * const info = await getAgentInfo({
 *   name: "website-monitor",
 *   configPath: "/path/to/herdctl.yaml"
 * });
 *
 * if (info) {
 *   console.log(`Agent: ${info.name}`);
 *   console.log(`Installed: ${info.installed}`);
 *   console.log(`Has workspace: ${info.hasWorkspace}`);
 * }
 * ```
 */
export async function getAgentInfo(options: AgentInfoOptions): Promise<AgentDetailedInfo | null> {
  const { name, configPath, baseDir } = options;

  logger.debug("Getting agent info", { name, configPath });

  // ==========================================================================
  // Step 1: Find the agent using discovery
  // ==========================================================================
  let discoveryResult;
  try {
    discoveryResult = await discoverAgents({ configPath, baseDir });
  } catch (error) {
    logger.debug("Discovery failed", { error });
    return null;
  }

  // Find the agent by name
  const agent: DiscoveredAgent | undefined = discoveryResult.agents.find((a) => a.name === name);
  if (!agent) {
    logger.debug("Agent not found", { name });
    return null;
  }

  logger.debug("Agent found, gathering additional info", { name, path: agent.path });

  // ==========================================================================
  // Step 2: Read agent.yaml for env vars and schedules
  // ==========================================================================
  const agentYamlPath = join(agent.path, "agent.yaml");
  const agentYamlContent = await readTextFile(agentYamlPath);

  let envVariables: EnvScanResult | undefined;
  let schedules: Record<string, unknown> | undefined;

  if (agentYamlContent) {
    // Scan for environment variables
    envVariables = scanEnvVariables(agentYamlContent);
    if (envVariables.variables.length === 0) {
      envVariables = undefined;
    }

    // Parse YAML to extract schedules
    try {
      const parsed = parseYaml(agentYamlContent);
      if (parsed && typeof parsed === "object") {
        schedules = extractSchedules(parsed as Record<string, unknown>);
      }
    } catch {
      logger.debug("Failed to parse agent.yaml for schedules", { path: agentYamlPath });
    }
  }

  // ==========================================================================
  // Step 3: Read herdctl.json if present
  // ==========================================================================
  const herdctlJsonPath = join(agent.path, "herdctl.json");
  let repoMetadata: AgentRepoMetadata | undefined;

  const herdctlJsonRaw = await readJsonFile<unknown>(herdctlJsonPath);
  if (herdctlJsonRaw) {
    const result = AgentRepoMetadataSchema.safeParse(herdctlJsonRaw);
    if (result.success) {
      repoMetadata = result.data;
    } else {
      logger.debug("herdctl.json failed schema validation", { path: herdctlJsonPath });
    }
  }

  // ==========================================================================
  // Step 4: Check for workspace directory
  // ==========================================================================
  const workspacePath = join(agent.path, "workspace");
  const hasWorkspace = await pathExists(workspacePath);

  // ==========================================================================
  // Step 5: List files in agent directory
  // ==========================================================================
  const files = await listFilesRecursive(agent.path);

  // ==========================================================================
  // Step 6: Assemble and return the result
  // ==========================================================================
  const info: AgentDetailedInfo = {
    name: agent.name,
    description: agent.description,
    installed: agent.installed,
    metadata: agent.metadata,
    path: agent.path,
    configPath: agent.configPath,
    version: agent.version,
    repoMetadata,
    envVariables,
    schedules,
    hasWorkspace,
    files,
  };

  logger.debug("Agent info gathered", {
    name: info.name,
    installed: info.installed,
    hasWorkspace: info.hasWorkspace,
    fileCount: info.files.length,
    hasEnvVars: !!info.envVariables,
    hasSchedules: !!info.schedules,
  });

  return info;
}
