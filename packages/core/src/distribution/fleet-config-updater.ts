/**
 * Fleet Config Updater for Agent Distribution
 *
 * Programmatically updates herdctl.yaml to add or remove agent references.
 * Preserves comments and formatting by using yaml's parseDocument approach.
 */

import * as fs from "node:fs/promises";
import { isMap, isSeq, parseDocument, YAMLParseError } from "yaml";

import { FleetManagerError, type FleetManagerErrorCode } from "../fleet-manager/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("distribution:fleet-config");

// =============================================================================
// Types
// =============================================================================

/**
 * Options for fleet config operations
 */
export interface FleetConfigUpdateOptions {
  /** Path to the herdctl.yaml file */
  configPath: string;
  /** Relative path to the agent's yaml file (e.g., "./agents/my-agent/agent.yaml") */
  agentPath: string;
}

/**
 * Result of a fleet config update operation
 */
export interface FleetConfigUpdateResult {
  /** Whether the config was actually modified */
  modified: boolean;
  /** The agent path that was added or removed */
  agentPath: string;
  /** Whether this agent was already referenced (for add) or not found (for remove) */
  alreadyExists: boolean;
}

// =============================================================================
// Error Classes
// =============================================================================

/** Error code: herdctl.yaml doesn't exist */
export const CONFIG_NOT_FOUND: FleetManagerErrorCode = "CONFIG_NOT_FOUND";

/** Error code: herdctl.yaml is invalid YAML */
export const CONFIG_PARSE_ERROR: FleetManagerErrorCode = "CONFIG_PARSE_ERROR";

/** Error code: couldn't write the updated config */
export const CONFIG_WRITE_ERROR: FleetManagerErrorCode = "CONFIG_WRITE_ERROR";

/**
 * Error thrown when fleet config operations fail
 */
export class FleetConfigError extends FleetManagerError {
  constructor(message: string, code: FleetManagerErrorCode) {
    super(message, { code });
    this.name = "FleetConfigError";
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the fleet config file, preserving document structure
 */
async function readFleetConfig(configPath: string): Promise<ReturnType<typeof parseDocument>> {
  // Check if file exists
  if (!(await fileExists(configPath))) {
    throw new FleetConfigError(
      `Fleet config not found at ${configPath}. Run 'herdctl init fleet' to create one.`,
      CONFIG_NOT_FOUND,
    );
  }

  // Read file content
  let content: string;
  try {
    content = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    const error = err as Error;
    throw new FleetConfigError(`Failed to read fleet config: ${error.message}`, CONFIG_NOT_FOUND);
  }

  // Parse YAML preserving document structure
  try {
    const doc = parseDocument(content);

    // parseDocument may not throw but can store errors in doc.errors
    if (doc.errors && doc.errors.length > 0) {
      const firstError = doc.errors[0];
      const position = firstError.linePos?.[0];
      const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";
      throw new FleetConfigError(
        `Invalid YAML syntax in fleet config${locationInfo}: ${firstError.message}`,
        CONFIG_PARSE_ERROR,
      );
    }

    return doc;
  } catch (err) {
    // Re-throw FleetConfigError as-is
    if (err instanceof FleetConfigError) {
      throw err;
    }
    if (err instanceof YAMLParseError) {
      const position = err.linePos?.[0];
      const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";
      throw new FleetConfigError(
        `Invalid YAML syntax in fleet config${locationInfo}: ${err.message}`,
        CONFIG_PARSE_ERROR,
      );
    }
    throw new FleetConfigError(
      `Failed to parse fleet config: ${(err as Error).message}`,
      CONFIG_PARSE_ERROR,
    );
  }
}

/**
 * Write the fleet config back to disk
 */
async function writeFleetConfig(
  configPath: string,
  doc: ReturnType<typeof parseDocument>,
): Promise<void> {
  try {
    await fs.writeFile(configPath, doc.toString(), "utf-8");
  } catch (err) {
    const error = err as Error;
    throw new FleetConfigError(
      `Failed to write fleet config: ${error.message}`,
      CONFIG_WRITE_ERROR,
    );
  }
}

/**
 * Check if an agent path already exists in the agents array
 */
function findAgentInArray(
  agentsNode: ReturnType<typeof parseDocument>["contents"],
  agentPath: string,
): number {
  if (!isSeq(agentsNode)) {
    return -1;
  }

  for (let i = 0; i < agentsNode.items.length; i++) {
    const item = agentsNode.items[i];
    // Handle both object form { path: "..." } and string form "..."
    if (isMap(item)) {
      const pathNode = item.get("path");
      if (typeof pathNode === "string" && pathNode === agentPath) {
        return i;
      }
    } else if (typeof item === "string" && item === agentPath) {
      return i;
    }
    // Also check the JSON value if it's a scalar node
    const itemValue =
      item && typeof item === "object" && "toJSON" in item
        ? (item as { toJSON: () => unknown }).toJSON()
        : item;
    if (typeof itemValue === "object" && itemValue !== null && "path" in itemValue) {
      if ((itemValue as { path: string }).path === agentPath) {
        return i;
      }
    }
    if (typeof itemValue === "string" && itemValue === agentPath) {
      return i;
    }
  }

  return -1;
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Add an agent reference to the fleet config's agents array
 *
 * This function:
 * 1. Reads the herdctl.yaml file, preserving comments and formatting
 * 2. Checks if the agent path already exists in the agents array
 * 3. If not, appends a new entry to the agents array
 * 4. Writes the updated config back to disk
 *
 * @param options - Update options including config path and agent path
 * @returns Result indicating if the config was modified
 * @throws {FleetConfigError} When the operation fails
 *
 * @example
 * ```typescript
 * const result = await addAgentToFleetConfig({
 *   configPath: "/path/to/herdctl.yaml",
 *   agentPath: "./agents/my-agent/agent.yaml"
 * });
 *
 * if (result.modified) {
 *   console.log(`Added agent reference: ${result.agentPath}`);
 * } else if (result.alreadyExists) {
 *   console.log(`Agent already referenced: ${result.agentPath}`);
 * }
 * ```
 */
export async function addAgentToFleetConfig(
  options: FleetConfigUpdateOptions,
): Promise<FleetConfigUpdateResult> {
  const { configPath, agentPath } = options;

  logger.debug("Adding agent to fleet config", { configPath, agentPath });

  // Read and parse the config
  const doc = await readFleetConfig(configPath);

  // Get the agents node
  const agentsNode = doc.get("agents", true);

  // Check for duplicate
  if (findAgentInArray(agentsNode, agentPath) !== -1) {
    logger.debug("Agent already exists in fleet config", { agentPath });
    return {
      modified: false,
      agentPath,
      alreadyExists: true,
    };
  }

  // Create the new agent reference node
  const agentRef = doc.createNode({ path: agentPath });

  // Add to agents array
  if (isSeq(agentsNode)) {
    // Already a sequence ([] or block) - append to it
    agentsNode.items.push(agentRef);
    logger.debug("Appended agent to existing agents array", { agentPath });
  } else {
    // No agents key or it's not a sequence - set it
    doc.set("agents", doc.createNode([{ path: agentPath }]));
    logger.debug("Created agents array with agent", { agentPath });
  }

  // Write the updated config
  await writeFleetConfig(configPath, doc);

  logger.info("Added agent to fleet config", { configPath, agentPath });

  return {
    modified: true,
    agentPath,
    alreadyExists: false,
  };
}

/**
 * Remove an agent reference from the fleet config's agents array
 *
 * This function:
 * 1. Reads the herdctl.yaml file, preserving comments and formatting
 * 2. Finds the agent path in the agents array
 * 3. If found, removes the entry from the agents array
 * 4. Writes the updated config back to disk
 *
 * @param options - Update options including config path and agent path
 * @returns Result indicating if the config was modified
 * @throws {FleetConfigError} When the operation fails
 *
 * @example
 * ```typescript
 * const result = await removeAgentFromFleetConfig({
 *   configPath: "/path/to/herdctl.yaml",
 *   agentPath: "./agents/my-agent/agent.yaml"
 * });
 *
 * if (result.modified) {
 *   console.log(`Removed agent reference: ${result.agentPath}`);
 * } else if (!result.alreadyExists) {
 *   console.log(`Agent was not referenced: ${result.agentPath}`);
 * }
 * ```
 */
export async function removeAgentFromFleetConfig(
  options: FleetConfigUpdateOptions,
): Promise<FleetConfigUpdateResult> {
  const { configPath, agentPath } = options;

  logger.debug("Removing agent from fleet config", { configPath, agentPath });

  // Read and parse the config
  const doc = await readFleetConfig(configPath);

  // Get the agents node
  const agentsNode = doc.get("agents", true);

  // Check if agents array exists and is a sequence
  if (!isSeq(agentsNode)) {
    logger.debug("No agents array in fleet config", { agentPath });
    return {
      modified: false,
      agentPath,
      alreadyExists: false,
    };
  }

  // Find the agent in the array
  const index = findAgentInArray(agentsNode, agentPath);

  if (index === -1) {
    logger.debug("Agent not found in fleet config", { agentPath });
    return {
      modified: false,
      agentPath,
      alreadyExists: false,
    };
  }

  // Remove the agent from the array
  agentsNode.items.splice(index, 1);
  logger.debug("Removed agent from agents array", { agentPath, index });

  // Write the updated config
  await writeFleetConfig(configPath, doc);

  logger.info("Removed agent from fleet config", { configPath, agentPath });

  return {
    modified: true,
    agentPath,
    alreadyExists: true,
  };
}
