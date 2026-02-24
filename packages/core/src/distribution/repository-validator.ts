/**
 * Repository Validation for Agent Distribution
 *
 * Validates that a directory is a valid agent repository by checking:
 * - agent.yaml exists and is valid YAML conforming to AgentConfigSchema
 * - docker.network is not "none" (agents need network access for Anthropic API)
 * - herdctl.json is valid if present
 * - Optional files like CLAUDE.md and README.md
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";

import { type AgentConfig, AgentConfigSchema } from "../config/schema.js";
import { createLogger } from "../utils/logger.js";
import { type AgentRepoMetadata, AgentRepoMetadataSchema } from "./agent-repo-metadata.js";

const logger = createLogger("distribution:validator");

// =============================================================================
// Types
// =============================================================================

/**
 * Validation message representing an error or warning
 */
export interface ValidationMessage {
  /** Machine-readable code like 'MISSING_AGENT_YAML', 'INVALID_AGENT_YAML' */
  code: string;
  /** Human-readable description of the issue */
  message: string;
  /** File path relative to repository root (if applicable) */
  path?: string;
}

/**
 * Result of repository validation
 */
export interface ValidationResult {
  /** Whether the repository is valid for installation */
  valid: boolean;
  /** Agent name from agent.yaml (if valid) */
  agentName: string | null;
  /** Parsed agent configuration (if valid) */
  agentConfig: AgentConfig | null;
  /** Parsed repository metadata from herdctl.json (if present and valid) */
  repoMetadata: AgentRepoMetadata | null;
  /** Errors that prevent installation */
  errors: ValidationMessage[];
  /** Warnings the user should know about */
  warnings: ValidationMessage[];
}

// =============================================================================
// Error Codes
// =============================================================================

/** Error: agent.yaml not found */
export const MISSING_AGENT_YAML = "MISSING_AGENT_YAML";
/** Error: agent.yaml is not valid YAML */
export const YAML_PARSE_ERROR = "YAML_PARSE_ERROR";
/** Error: agent.yaml fails schema validation */
export const INVALID_AGENT_YAML = "INVALID_AGENT_YAML";
/** Error: docker.network is set to "none" */
export const DOCKER_NETWORK_NONE = "DOCKER_NETWORK_NONE";
/** Error: herdctl.json is not valid JSON */
export const JSON_PARSE_ERROR = "JSON_PARSE_ERROR";
/** Error: herdctl.json fails schema validation */
export const INVALID_HERDCTL_JSON = "INVALID_HERDCTL_JSON";

/** Warning: no herdctl.json (optional but recommended) */
export const MISSING_HERDCTL_JSON = "MISSING_HERDCTL_JSON";
/** Warning: name in agent.yaml differs from name in herdctl.json */
export const NAME_MISMATCH = "NAME_MISMATCH";
/** Warning: no CLAUDE.md file (optional but recommended) */
export const MISSING_CLAUDE_MD = "MISSING_CLAUDE_MD";
/** Warning: no README.md (optional but recommended) */
export const MISSING_README = "MISSING_README";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a file exists
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
 * Read and parse YAML file
 */
async function readYamlFile(
  filePath: string,
): Promise<
  { success: true; data: unknown } | { success: false; error: string; isYamlError: boolean }
> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = parseYaml(content);
    return { success: true, data };
  } catch (err) {
    if (err instanceof YAMLParseError) {
      const position = err.linePos?.[0];
      const locationInfo = position ? ` at line ${position.line}, column ${position.col}` : "";
      return {
        success: false,
        error: `Invalid YAML syntax${locationInfo}: ${err.message}`,
        isYamlError: true,
      };
    }
    // File read error
    const error = err as Error;
    return { success: false, error: error.message, isYamlError: false };
  }
}

/**
 * Read and parse JSON file
 */
async function readJsonFile(
  filePath: string,
): Promise<
  { success: true; data: unknown } | { success: false; error: string; isJsonError: boolean }
> {
  try {
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    return { success: true, data };
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { success: false, error: `Invalid JSON: ${err.message}`, isJsonError: true };
    }
    // File read error
    const error = err as Error;
    return { success: false, error: error.message, isJsonError: false };
  }
}

// =============================================================================
// Main Validator
// =============================================================================

/**
 * Validate a directory as an agent repository
 *
 * Checks that the directory contains valid agent repository files:
 * - agent.yaml (required) - must be valid YAML conforming to AgentConfigSchema
 * - herdctl.json (optional) - if present, must be valid JSON conforming to AgentRepoMetadataSchema
 * - CLAUDE.md (optional) - recommended for agent identity
 * - README.md (optional) - recommended for documentation
 *
 * Also performs safety checks:
 * - docker.network cannot be "none" (agents need network for Anthropic API)
 *
 * @param dirPath - Absolute path to the directory to validate
 * @returns Validation result with errors, warnings, and parsed configurations
 *
 * @example
 * ```typescript
 * const result = await validateRepository("/tmp/my-agent");
 * if (result.valid) {
 *   console.log(`Agent ${result.agentName} is valid`);
 * } else {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export async function validateRepository(dirPath: string): Promise<ValidationResult> {
  logger.debug("Validating repository", { path: dirPath });

  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  let agentName: string | null = null;
  let agentConfig: AgentConfig | null = null;
  let repoMetadata: AgentRepoMetadata | null = null;

  // ==========================================================================
  // 1. Check and validate agent.yaml (required)
  // ==========================================================================
  const agentYamlPath = join(dirPath, "agent.yaml");
  const agentYamlExists = await fileExists(agentYamlPath);

  if (!agentYamlExists) {
    logger.debug("agent.yaml not found", { path: agentYamlPath });
    errors.push({
      code: MISSING_AGENT_YAML,
      message:
        "Required file agent.yaml not found. Every agent repository must have an agent.yaml file.",
      path: "agent.yaml",
    });
  } else {
    // Read and parse YAML
    const yamlResult = await readYamlFile(agentYamlPath);

    if (!yamlResult.success) {
      logger.debug("Failed to parse agent.yaml", { error: yamlResult.error });
      errors.push({
        code: yamlResult.isYamlError ? YAML_PARSE_ERROR : MISSING_AGENT_YAML,
        message: yamlResult.error,
        path: "agent.yaml",
      });
    } else {
      // ==========================================================================
      // 2. Check docker.network BEFORE schema validation (provides clearer error)
      // Note: AgentDockerSchema doesn't include 'network' field (it's fleet-level only),
      // but we want to give a specific error message if someone sets network: none
      // ==========================================================================
      const rawData = yamlResult.data as Record<string, unknown>;
      const dockerConfig = rawData?.docker as Record<string, unknown> | undefined;
      if (dockerConfig?.network === "none") {
        logger.debug("docker.network is set to none", { docker: dockerConfig });
        errors.push({
          code: DOCKER_NETWORK_NONE,
          message:
            'docker.network is set to "none", which would prevent the agent from accessing Anthropic APIs. ' +
            "Agents require network access. Remove the network field (bridge is the default at fleet level) " +
            'or set it at the fleet level to "bridge" or "host".',
          path: "agent.yaml",
        });
      }

      // Validate against AgentConfigSchema
      const schemaResult = AgentConfigSchema.safeParse(yamlResult.data);

      if (!schemaResult.success) {
        const issues = schemaResult.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        logger.debug("agent.yaml schema validation failed", { issues });
        errors.push({
          code: INVALID_AGENT_YAML,
          message: `agent.yaml validation failed: ${issues}`,
          path: "agent.yaml",
        });
      } else {
        agentConfig = schemaResult.data;
        agentName = schemaResult.data.name;
        logger.debug("agent.yaml is valid", { name: agentName });
      }
    }
  }

  // ==========================================================================
  // 3. Check and validate herdctl.json (optional)
  // ==========================================================================
  const herdctlJsonPath = join(dirPath, "herdctl.json");
  const herdctlJsonExists = await fileExists(herdctlJsonPath);

  if (!herdctlJsonExists) {
    logger.debug("herdctl.json not found (optional)", { path: herdctlJsonPath });
    warnings.push({
      code: MISSING_HERDCTL_JSON,
      message:
        "No herdctl.json found. This file is optional but recommended for registry listing and installation metadata.",
      path: "herdctl.json",
    });
  } else {
    // Read and parse JSON
    const jsonResult = await readJsonFile(herdctlJsonPath);

    if (!jsonResult.success) {
      logger.debug("Failed to parse herdctl.json", { error: jsonResult.error });
      errors.push({
        code: jsonResult.isJsonError ? JSON_PARSE_ERROR : INVALID_HERDCTL_JSON,
        message: jsonResult.error,
        path: "herdctl.json",
      });
    } else {
      // Validate against AgentRepoMetadataSchema
      const schemaResult = AgentRepoMetadataSchema.safeParse(jsonResult.data);

      if (!schemaResult.success) {
        const issues = schemaResult.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        logger.debug("herdctl.json schema validation failed", { issues });
        errors.push({
          code: INVALID_HERDCTL_JSON,
          message: `herdctl.json validation failed: ${issues}`,
          path: "herdctl.json",
        });
      } else {
        repoMetadata = schemaResult.data;
        logger.debug("herdctl.json is valid", { name: repoMetadata.name });

        // ==========================================================================
        // 4. Check name consistency between agent.yaml and herdctl.json
        // ==========================================================================
        if (agentName && repoMetadata.name !== agentName) {
          logger.debug("Name mismatch between agent.yaml and herdctl.json", {
            agentYaml: agentName,
            herdctlJson: repoMetadata.name,
          });
          warnings.push({
            code: NAME_MISMATCH,
            message:
              `Name mismatch: agent.yaml has name "${agentName}" but herdctl.json has name "${repoMetadata.name}". ` +
              `The name from agent.yaml will be used for installation.`,
            path: "herdctl.json",
          });
        }
      }
    }
  }

  // ==========================================================================
  // 5. Check for optional recommended files
  // ==========================================================================
  const claudeMdPath = join(dirPath, "CLAUDE.md");
  const claudeMdExists = await fileExists(claudeMdPath);

  if (!claudeMdExists) {
    logger.debug("CLAUDE.md not found (optional)", { path: claudeMdPath });
    warnings.push({
      code: MISSING_CLAUDE_MD,
      message:
        "No CLAUDE.md found. This file is optional but recommended for defining agent identity and behavior.",
      path: "CLAUDE.md",
    });
  }

  const readmePath = join(dirPath, "README.md");
  const readmeExists = await fileExists(readmePath);

  if (!readmeExists) {
    logger.debug("README.md not found (optional)", { path: readmePath });
    warnings.push({
      code: MISSING_README,
      message: "No README.md found. This file is optional but recommended for documentation.",
      path: "README.md",
    });
  }

  // ==========================================================================
  // Build and return result
  // ==========================================================================
  const valid = errors.length === 0;

  logger.info("Repository validation complete", {
    path: dirPath,
    valid,
    errorCount: errors.length,
    warningCount: warnings.length,
    agentName,
  });

  return {
    valid,
    agentName,
    agentConfig,
    repoMetadata,
    errors,
    warnings,
  };
}
