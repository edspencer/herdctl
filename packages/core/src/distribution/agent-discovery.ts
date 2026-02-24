/**
 * Agent Discovery for herdctl
 *
 * Scans the filesystem to discover agents referenced in herdctl.yaml.
 * Identifies which agents were installed via `herdctl agent add` (have metadata.json)
 * vs manually created agents.
 */

import * as fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { FleetManagerError, type FleetManagerErrorCode } from "../fleet-manager/errors.js";
import { createLogger } from "../utils/logger.js";
import { type InstallationMetadata, InstallationMetadataSchema } from "./installation-metadata.js";

const logger = createLogger("distribution:discovery");

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a discovered agent
 */
export interface DiscoveredAgent {
  /** Agent name (from agent.yaml or directory name) */
  name: string;
  /** Whether this agent was installed via herdctl agent add (has metadata.json) */
  installed: boolean;
  /** Installation metadata (only for installed agents) */
  metadata?: InstallationMetadata;
  /** Absolute path to the agent directory */
  path: string;
  /** Relative path to agent.yaml (as referenced in fleet config) */
  configPath: string;
  /** Agent description (from agent.yaml if available) */
  description?: string;
  /** Agent version (from metadata.json source, or herdctl.json) */
  version?: string;
}

/**
 * Options for discovering agents
 */
export interface DiscoveryOptions {
  /** Path to herdctl.yaml */
  configPath: string;
  /** Base directory of the project (defaults to dirname of configPath) */
  baseDir?: string;
}

/**
 * Result of agent discovery
 */
export interface DiscoveryResult {
  /** All discovered agents (installed + manual) */
  agents: DiscoveredAgent[];
}

// =============================================================================
// Error Classes
// =============================================================================

/** Error code: herdctl.yaml doesn't exist */
export const DISCOVERY_CONFIG_NOT_FOUND: FleetManagerErrorCode = "DISCOVERY_CONFIG_NOT_FOUND";

/** Error code: herdctl.yaml is invalid */
export const DISCOVERY_CONFIG_INVALID: FleetManagerErrorCode = "DISCOVERY_CONFIG_INVALID";

/**
 * Error thrown when agent discovery fails
 */
export class AgentDiscoveryError extends FleetManagerError {
  constructor(message: string, code: FleetManagerErrorCode) {
    super(message, { code });
    this.name = "AgentDiscoveryError";
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
 * Safely read and parse a YAML file
 */
async function readYamlFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = parseYaml(content);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse agent reference from fleet config
 *
 * Fleet config agents can be:
 * - Object form: { path: "./agents/my-agent/agent.yaml" }
 * - String form: "./agents/my-agent/agent.yaml" (less common)
 */
function parseAgentReference(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object" && "path" in entry) {
    const pathValue = (entry as Record<string, unknown>).path;
    if (typeof pathValue === "string") {
      return pathValue;
    }
  }
  return null;
}

/**
 * Extract agent info from agent.yaml
 */
interface AgentYamlInfo {
  name: string;
  description?: string;
}

function extractAgentYamlInfo(parsed: Record<string, unknown>): AgentYamlInfo | null {
  const name = parsed.name;
  if (typeof name !== "string" || name.trim() === "") {
    return null;
  }

  const result: AgentYamlInfo = { name };

  // Extract description if present
  const description = parsed.description;
  if (typeof description === "string" && description.trim() !== "") {
    result.description = description;
  }

  return result;
}

/**
 * Read and validate installation metadata from metadata.json
 */
async function readInstallationMetadata(agentDir: string): Promise<InstallationMetadata | null> {
  const metadataPath = join(agentDir, "metadata.json");
  const raw = await readJsonFile<unknown>(metadataPath);

  if (!raw) {
    return null;
  }

  // Validate with Zod schema
  const result = InstallationMetadataSchema.safeParse(raw);
  if (!result.success) {
    logger.debug("Invalid metadata.json, skipping", { path: metadataPath });
    return null;
  }

  return result.data;
}

/**
 * Read version from herdctl.json if present
 */
async function readHerdctlJsonVersion(agentDir: string): Promise<string | undefined> {
  const herdctlJsonPath = join(agentDir, "herdctl.json");
  const parsed = await readJsonFile<Record<string, unknown>>(herdctlJsonPath);

  if (parsed && typeof parsed.version === "string") {
    return parsed.version;
  }

  return undefined;
}

// =============================================================================
// Main Discovery Function
// =============================================================================

/**
 * Discover agents referenced in the fleet configuration
 *
 * This function:
 * 1. Reads herdctl.yaml and extracts agent references
 * 2. For each reference, checks if the agent directory exists
 * 3. Reads agent.yaml to get name and description
 * 4. Checks for metadata.json to determine if installed via herdctl
 * 5. Returns all discovered agents sorted by name
 *
 * @param options - Discovery options including config path
 * @returns Discovery result with list of agents
 * @throws {AgentDiscoveryError} When discovery fails
 *
 * @example
 * ```typescript
 * const result = await discoverAgents({
 *   configPath: "/path/to/herdctl.yaml"
 * });
 *
 * for (const agent of result.agents) {
 *   console.log(`${agent.name}: ${agent.installed ? 'installed' : 'manual'}`);
 * }
 * ```
 */
export async function discoverAgents(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { configPath } = options;
  const baseDir = options.baseDir ?? dirname(configPath);

  logger.debug("Starting agent discovery", { configPath, baseDir });

  // ==========================================================================
  // Step 1: Read fleet config
  // ==========================================================================
  if (!(await pathExists(configPath))) {
    throw new AgentDiscoveryError(
      `Fleet config not found at ${configPath}. Run 'herdctl init fleet' to create one.`,
      DISCOVERY_CONFIG_NOT_FOUND,
    );
  }

  const fleetConfig = await readYamlFile(configPath);
  if (!fleetConfig) {
    throw new AgentDiscoveryError(
      `Failed to parse fleet config at ${configPath}`,
      DISCOVERY_CONFIG_INVALID,
    );
  }

  // ==========================================================================
  // Step 2: Extract agent references
  // ==========================================================================
  const agentsArray = fleetConfig.agents;
  if (!Array.isArray(agentsArray)) {
    logger.debug("No agents array in fleet config, returning empty result");
    return { agents: [] };
  }

  const agents: DiscoveredAgent[] = [];

  // ==========================================================================
  // Step 3: Process each agent reference
  // ==========================================================================
  for (const entry of agentsArray) {
    const agentPath = parseAgentReference(entry);
    if (!agentPath) {
      logger.debug("Skipping invalid agent reference", { entry });
      continue;
    }

    // Resolve the agent.yaml path relative to baseDir
    const absoluteAgentYamlPath = resolve(baseDir, agentPath);
    const agentDir = dirname(absoluteAgentYamlPath);

    // Check if agent directory exists
    if (!(await pathExists(agentDir))) {
      logger.debug("Agent directory not found, skipping", { path: agentDir });
      continue;
    }

    // Read agent.yaml
    const agentYaml = await readYamlFile(absoluteAgentYamlPath);
    let name: string;
    let description: string | undefined;

    if (agentYaml) {
      const info = extractAgentYamlInfo(agentYaml);
      if (info) {
        name = info.name;
        description = info.description;
      } else {
        // Fallback to directory name if agent.yaml doesn't have valid name
        name = dirname(agentPath).split("/").pop() ?? "unknown";
        logger.debug("agent.yaml missing name, using directory name", { name, path: agentPath });
      }
    } else {
      // agent.yaml doesn't exist or is invalid, use directory name
      name = dirname(agentPath).split("/").pop() ?? "unknown";
      logger.debug("agent.yaml not found or invalid, using directory name", {
        name,
        path: agentPath,
      });
    }

    // Check for metadata.json (indicates installed via herdctl)
    const metadata = await readInstallationMetadata(agentDir);
    const installed = metadata !== null;

    // Get version from metadata or herdctl.json
    let version: string | undefined;
    if (metadata?.source?.version) {
      version = metadata.source.version;
    } else {
      version = await readHerdctlJsonVersion(agentDir);
    }

    agents.push({
      name,
      installed,
      metadata: metadata ?? undefined,
      path: agentDir,
      configPath: agentPath,
      description,
      version,
    });

    logger.debug("Discovered agent", {
      name,
      installed,
      path: agentDir,
      version,
    });
  }

  // ==========================================================================
  // Step 4: Sort by name and return
  // ==========================================================================
  agents.sort((a, b) => a.name.localeCompare(b.name));

  logger.info("Agent discovery complete", {
    total: agents.length,
    installed: agents.filter((a) => a.installed).length,
    manual: agents.filter((a) => !a.installed).length,
  });

  return { agents };
}
