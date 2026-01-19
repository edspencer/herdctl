/**
 * Configuration loader for herdctl
 *
 * Provides a single entry point to load and resolve all configuration:
 * - Auto-discovers herdctl.yaml by walking up the directory tree
 * - Loads fleet config and all referenced agent configs
 * - Merges fleet defaults into agent configs
 * - Interpolates environment variables
 * - Validates the entire configuration tree
 */

import { readFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ZodError } from "zod";
import {
  FleetConfigSchema,
  AgentConfigSchema,
  type FleetConfig,
  type AgentConfig,
} from "./schema.js";
import { ConfigError, FileReadError, SchemaValidationError } from "./parser.js";
import { mergeAgentConfig, type ExtendedDefaults } from "./merge.js";
import { interpolateConfig, type InterpolateOptions } from "./interpolate.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default config file names to search for
 */
export const CONFIG_FILE_NAMES = ["herdctl.yaml", "herdctl.yml"] as const;

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Error thrown when no configuration file is found
 */
export class ConfigNotFoundError extends ConfigError {
  public readonly searchedPaths: string[];
  public readonly startDirectory: string;

  constructor(startDirectory: string, searchedPaths: string[]) {
    super(
      `No herdctl configuration file found. ` +
        `Searched from '${startDirectory}' up to filesystem root. ` +
        `Create a herdctl.yaml file to get started.`
    );
    this.name = "ConfigNotFoundError";
    this.searchedPaths = searchedPaths;
    this.startDirectory = startDirectory;
  }
}

/**
 * Error thrown when agent loading fails
 */
export class AgentLoadError extends ConfigError {
  public readonly agentPath: string;
  public readonly agentName?: string;

  constructor(agentPath: string, cause: Error, agentName?: string) {
    const nameInfo = agentName ? ` (${agentName})` : "";
    super(`Failed to load agent '${agentPath}'${nameInfo}: ${cause.message}`);
    this.name = "AgentLoadError";
    this.agentPath = agentPath;
    this.agentName = agentName;
    this.cause = cause;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * A fully resolved agent configuration with computed properties
 */
export interface ResolvedAgent extends AgentConfig {
  /**
   * The absolute path to the agent configuration file
   */
  configPath: string;
}

/**
 * A fully resolved configuration with all agents loaded and merged
 */
export interface ResolvedConfig {
  /**
   * The parsed and validated fleet configuration
   */
  fleet: FleetConfig;

  /**
   * All agent configurations, fully resolved with defaults merged
   */
  agents: ResolvedAgent[];

  /**
   * The absolute path to the fleet configuration file
   */
  configPath: string;

  /**
   * The directory containing the fleet configuration
   */
  configDir: string;
}

/**
 * Options for the loadConfig function
 */
export interface LoadConfigOptions {
  /**
   * Custom environment variables for interpolation
   * Defaults to process.env
   */
  env?: Record<string, string | undefined>;

  /**
   * Whether to interpolate environment variables
   * Defaults to true
   */
  interpolate?: boolean;

  /**
   * Whether to merge fleet defaults into agent configs
   * Defaults to true
   */
  mergeDefaults?: boolean;
}

// =============================================================================
// File Discovery
// =============================================================================

/**
 * Check if a file exists and is accessible
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a configuration file by walking up the directory tree
 *
 * Searches for herdctl.yaml or herdctl.yml starting from the given directory
 * and walking up to the filesystem root (similar to how git finds .git).
 *
 * @param startDir - The directory to start searching from
 * @returns The absolute path to the config file, or null if not found
 */
export async function findConfigFile(
  startDir: string
): Promise<{ path: string; searchedPaths: string[] } | null> {
  const searchedPaths: string[] = [];
  let currentDir = resolve(startDir);

  while (true) {
    // Check for each possible config file name
    for (const fileName of CONFIG_FILE_NAMES) {
      const configPath = join(currentDir, fileName);
      searchedPaths.push(configPath);

      if (await fileExists(configPath)) {
        return { path: configPath, searchedPaths };
      }
    }

    // Move up to parent directory
    const parentDir = dirname(currentDir);

    // Stop if we've reached the root
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

// =============================================================================
// Internal Parsing Functions
// =============================================================================

/**
 * Parse and validate fleet config from YAML content
 */
function parseFleetYaml(content: string, filePath: string): FleetConfig {
  let rawConfig: unknown;
  try {
    rawConfig = parseYaml(content);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const position = error.linePos?.[0];
      const locationInfo = position
        ? ` at line ${position.line}, column ${position.col}`
        : "";
      throw new ConfigError(
        `Invalid YAML syntax in '${filePath}'${locationInfo}: ${error.message}`
      );
    }
    throw error;
  }

  // Handle empty files
  if (rawConfig === null || rawConfig === undefined) {
    rawConfig = {};
  }

  try {
    return FleetConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SchemaValidationError(error);
    }
    throw error;
  }
}

/**
 * Parse and validate agent config from YAML content
 */
function parseAgentYaml(content: string, filePath: string): AgentConfig {
  let rawConfig: unknown;
  try {
    rawConfig = parseYaml(content);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const position = error.linePos?.[0];
      const locationInfo = position
        ? ` at line ${position.line}, column ${position.col}`
        : "";
      throw new ConfigError(
        `Invalid YAML syntax in '${filePath}'${locationInfo}: ${error.message}`
      );
    }
    throw error;
  }

  // Handle empty files
  if (rawConfig === null || rawConfig === undefined) {
    rawConfig = {};
  }

  try {
    return AgentConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      }));
      const issueMessages = issues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join("\n");
      throw new ConfigError(
        `Agent configuration validation failed in '${filePath}':\n${issueMessages}`
      );
    }
    throw error;
  }
}

/**
 * Resolve an agent path relative to the fleet config directory
 */
function resolveAgentPath(agentPath: string, fleetConfigDir: string): string {
  if (agentPath.startsWith("/")) {
    return agentPath;
  }
  return resolve(fleetConfigDir, agentPath);
}

// =============================================================================
// Main Loading Function
// =============================================================================

/**
 * Load complete configuration from a file path or by auto-discovery
 *
 * This function:
 * 1. Finds the config file (if not provided, searches up directory tree)
 * 2. Parses and validates the fleet configuration
 * 3. Loads and validates all referenced agent configurations
 * 4. Interpolates environment variables (optional)
 * 5. Merges fleet defaults into agent configs (optional)
 * 6. Returns a fully resolved configuration object
 *
 * @param configPath - Path to herdctl.yaml, or directory to search from.
 *                     If not provided, searches from current working directory.
 * @param options - Loading options
 * @returns A fully resolved configuration
 * @throws {ConfigNotFoundError} If no config file is found
 * @throws {FileReadError} If a config file cannot be read
 * @throws {ConfigError} If YAML syntax is invalid
 * @throws {SchemaValidationError} If configuration fails validation
 * @throws {AgentLoadError} If an agent configuration fails to load
 *
 * @example
 * ```typescript
 * // Auto-discover config file
 * const config = await loadConfig();
 *
 * // Load from specific path
 * const config = await loadConfig("./my-project/herdctl.yaml");
 *
 * // Load from specific directory
 * const config = await loadConfig("./my-project");
 *
 * // Load without environment interpolation
 * const config = await loadConfig(undefined, { interpolate: false });
 * ```
 */
export async function loadConfig(
  configPath?: string,
  options: LoadConfigOptions = {}
): Promise<ResolvedConfig> {
  const {
    env = process.env,
    interpolate = true,
    mergeDefaults = true,
  } = options;

  // Determine the config file path
  let resolvedConfigPath: string;
  let searchedPaths: string[] = [];

  if (configPath) {
    // Check if it's a file or directory
    const isYamlFile =
      configPath.endsWith(".yaml") || configPath.endsWith(".yml");

    if (isYamlFile) {
      // Treat as direct file path
      resolvedConfigPath = resolve(configPath);
    } else {
      // Treat as directory - search from there
      const found = await findConfigFile(configPath);
      if (!found) {
        throw new ConfigNotFoundError(configPath, searchedPaths);
      }
      resolvedConfigPath = found.path;
      searchedPaths = found.searchedPaths;
    }
  } else {
    // Auto-discover from current working directory
    const found = await findConfigFile(process.cwd());
    if (!found) {
      throw new ConfigNotFoundError(process.cwd(), searchedPaths);
    }
    resolvedConfigPath = found.path;
    searchedPaths = found.searchedPaths;
  }

  // Read the fleet config file
  let fleetContent: string;
  try {
    fleetContent = await readFile(resolvedConfigPath, "utf-8");
  } catch (error) {
    throw new FileReadError(
      resolvedConfigPath,
      error instanceof Error ? error : undefined
    );
  }

  // Parse the fleet config
  let fleetConfig = parseFleetYaml(fleetContent, resolvedConfigPath);

  // Interpolate environment variables in fleet config
  if (interpolate) {
    fleetConfig = interpolateConfig(fleetConfig, { env });
  }

  const configDir = dirname(resolvedConfigPath);

  // Load all agent configs
  const agents: ResolvedAgent[] = [];

  // FleetConfigSchema has default of [], so agents is always defined
  const agentRefs = fleetConfig.agents;

  for (const agentRef of agentRefs) {
    const agentPath = resolveAgentPath(agentRef.path, configDir);

    // Read agent config file
    let agentContent: string;
    try {
      agentContent = await readFile(agentPath, "utf-8");
    } catch (error) {
      throw new AgentLoadError(
        agentRef.path,
        new FileReadError(agentPath, error instanceof Error ? error : undefined)
      );
    }

    // Parse and validate agent config
    let agentConfig: AgentConfig;
    try {
      agentConfig = parseAgentYaml(agentContent, agentPath);
    } catch (error) {
      throw new AgentLoadError(
        agentRef.path,
        error instanceof Error ? error : new Error(String(error))
      );
    }

    // Interpolate environment variables in agent config
    if (interpolate) {
      agentConfig = interpolateConfig(agentConfig, { env });
    }

    // Merge fleet defaults into agent config
    if (mergeDefaults && fleetConfig.defaults) {
      agentConfig = mergeAgentConfig(
        fleetConfig.defaults as ExtendedDefaults,
        agentConfig
      );
    }

    agents.push({
      ...agentConfig,
      configPath: agentPath,
    });
  }

  return {
    fleet: fleetConfig,
    agents,
    configPath: resolvedConfigPath,
    configDir,
  };
}

/**
 * Load configuration without throwing on errors
 *
 * @param configPath - Path to herdctl.yaml or directory to search from
 * @param options - Loading options
 * @returns Success result with config, or failure result with error
 */
export async function safeLoadConfig(
  configPath?: string,
  options: LoadConfigOptions = {}
): Promise<
  | { success: true; data: ResolvedConfig }
  | { success: false; error: ConfigError }
> {
  try {
    const config = await loadConfig(configPath, options);
    return { success: true, data: config };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new ConfigError(
        error instanceof Error ? error.message : String(error)
      ),
    };
  }
}
