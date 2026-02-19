/**
 * YAML configuration parser for herdctl
 *
 * Parses herdctl.yaml files and validates them against the FleetConfig schema
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ZodError } from "zod";
import {
  type AgentConfig,
  AgentConfigSchema,
  type FleetConfig,
  FleetConfigSchema,
} from "./schema.js";

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error class for configuration errors
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Error thrown when YAML syntax is invalid
 */
export class YamlSyntaxError extends ConfigError {
  public readonly line?: number;
  public readonly column?: number;
  public readonly originalError: YAMLParseError;

  constructor(error: YAMLParseError) {
    const position = error.linePos?.[0];
    const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";

    super(`Invalid YAML syntax${locationInfo}: ${error.message}`);
    this.name = "YamlSyntaxError";
    this.line = position?.line;
    this.column = position?.col;
    this.originalError = error;
  }
}

/**
 * Error thrown when schema validation fails
 */
export class SchemaValidationError extends ConfigError {
  public readonly issues: SchemaIssue[];

  constructor(error: ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
      code: issue.code,
    }));

    const issueMessages = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");

    super(`Configuration validation failed:\n${issueMessages}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export interface SchemaIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Error thrown when a file cannot be read
 */
export class FileReadError extends ConfigError {
  public readonly filePath: string;

  constructor(filePath: string, cause?: Error) {
    const message = cause
      ? `Failed to read file '${filePath}': ${cause.message}`
      : `Failed to read file '${filePath}'`;
    super(message);
    this.name = "FileReadError";
    this.filePath = filePath;
    this.cause = cause;
  }
}

/**
 * Error thrown when agent configuration validation fails
 */
export class AgentValidationError extends ConfigError {
  public readonly issues: SchemaIssue[];
  public readonly filePath: string;

  constructor(error: ZodError, filePath: string) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
      code: issue.code,
    }));

    const issueMessages = issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");

    super(`Agent configuration validation failed in '${filePath}':\n${issueMessages}`);
    this.name = "AgentValidationError";
    this.issues = issues;
    this.filePath = filePath;
  }
}

/**
 * Error thrown when agent YAML syntax is invalid
 */
export class AgentYamlSyntaxError extends ConfigError {
  public readonly line?: number;
  public readonly column?: number;
  public readonly filePath: string;
  public readonly originalError: YAMLParseError;

  constructor(error: YAMLParseError, filePath: string) {
    const position = error.linePos?.[0];
    const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";

    super(`Invalid YAML syntax in '${filePath}'${locationInfo}: ${error.message}`);
    this.name = "AgentYamlSyntaxError";
    this.line = position?.line;
    this.column = position?.col;
    this.filePath = filePath;
    this.originalError = error;
  }
}

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Parse a YAML string into a FleetConfig object
 *
 * @param yamlContent - The raw YAML string to parse
 * @returns A validated FleetConfig object
 * @throws {YamlSyntaxError} If the YAML syntax is invalid
 * @throws {SchemaValidationError} If the configuration fails schema validation
 */
export function parseFleetConfig(yamlContent: string): FleetConfig {
  // Parse YAML
  let rawConfig: unknown;
  try {
    rawConfig = parseYaml(yamlContent);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      throw new YamlSyntaxError(error);
    }
    throw error;
  }

  // Handle empty files
  if (rawConfig === null || rawConfig === undefined) {
    rawConfig = {};
  }

  // Validate against schema
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
 * Validate a configuration object without parsing YAML
 *
 * @param config - The configuration object to validate
 * @returns A validated FleetConfig object
 * @throws {SchemaValidationError} If the configuration fails schema validation
 */
export function validateFleetConfig(config: unknown): FleetConfig {
  try {
    return FleetConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SchemaValidationError(error);
    }
    throw error;
  }
}

/**
 * Check if a configuration is valid without throwing
 *
 * @param yamlContent - The raw YAML string to check
 * @returns An object with success status and either the config or error
 */
export function safeParseFleetConfig(
  yamlContent: string,
): { success: true; data: FleetConfig } | { success: false; error: ConfigError } {
  try {
    const config = parseFleetConfig(yamlContent);
    return { success: true, data: config };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new ConfigError(error instanceof Error ? error.message : String(error)),
    };
  }
}

// =============================================================================
// Agent Config Parser Functions
// =============================================================================

/**
 * Parse a YAML string into an AgentConfig object
 *
 * @param yamlContent - The raw YAML string to parse
 * @param filePath - The file path for error context (optional)
 * @returns A validated AgentConfig object
 * @throws {AgentYamlSyntaxError} If the YAML syntax is invalid
 * @throws {AgentValidationError} If the configuration fails schema validation
 */
export function parseAgentConfig(yamlContent: string, filePath: string = "<unknown>"): AgentConfig {
  // Parse YAML
  let rawConfig: unknown;
  try {
    rawConfig = parseYaml(yamlContent);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      throw new AgentYamlSyntaxError(error, filePath);
    }
    throw error;
  }

  // Handle empty files - let Zod handle validation since 'name' is required
  if (rawConfig === null || rawConfig === undefined) {
    rawConfig = {};
  }

  // Validate against schema
  try {
    return AgentConfigSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AgentValidationError(error, filePath);
    }
    throw error;
  }
}

/**
 * Validate an agent configuration object without parsing YAML
 *
 * @param config - The configuration object to validate
 * @param filePath - The file path for error context (optional)
 * @returns A validated AgentConfig object
 * @throws {AgentValidationError} If the configuration fails schema validation
 */
export function validateAgentConfig(config: unknown, filePath: string = "<unknown>"): AgentConfig {
  try {
    return AgentConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AgentValidationError(error, filePath);
    }
    throw error;
  }
}

/**
 * Check if an agent configuration is valid without throwing
 *
 * @param yamlContent - The raw YAML string to check
 * @param filePath - The file path for error context (optional)
 * @returns An object with success status and either the config or error
 */
export function safeParseAgentConfig(
  yamlContent: string,
  filePath: string = "<unknown>",
): { success: true; data: AgentConfig } | { success: false; error: ConfigError } {
  try {
    const config = parseAgentConfig(yamlContent, filePath);
    return { success: true, data: config };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new ConfigError(error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Resolve an agent file path relative to a base path (typically fleet config location)
 *
 * @param agentPath - The agent path from fleet config (can be relative or absolute)
 * @param basePath - The base path to resolve from (typically the fleet config directory)
 * @returns The resolved absolute path
 */
export function resolveAgentPath(agentPath: string, basePath: string): string {
  // If the agent path is already absolute, return it as-is
  if (agentPath.startsWith("/")) {
    return agentPath;
  }

  // Resolve relative path from the base path
  return resolve(basePath, agentPath);
}

/**
 * Load and parse an agent configuration file
 *
 * @param agentPath - Path to the agent YAML file
 * @param fleetConfigPath - Path to the fleet config file (for resolving relative paths)
 * @returns A validated AgentConfig object
 * @throws {FileReadError} If the file cannot be read
 * @throws {AgentYamlSyntaxError} If the YAML syntax is invalid
 * @throws {AgentValidationError} If the configuration fails schema validation
 */
export async function loadAgentConfig(
  agentPath: string,
  fleetConfigPath?: string,
): Promise<AgentConfig> {
  // Resolve the path if a fleet config path is provided
  const resolvedPath = fleetConfigPath
    ? resolveAgentPath(agentPath, dirname(fleetConfigPath))
    : agentPath;

  // Read the file
  let content: string;
  try {
    content = await readFile(resolvedPath, "utf-8");
  } catch (error) {
    throw new FileReadError(resolvedPath, error instanceof Error ? error : undefined);
  }

  // Parse and validate
  return parseAgentConfig(content, resolvedPath);
}
