/**
 * Deep merge utilities for herdctl configuration
 *
 * Provides functions to merge fleet-level defaults with agent-specific overrides.
 * - Nested objects merge recursively
 * - Arrays are replaced, not merged (agent's array replaces defaults)
 * - Agent-specific values override fleet defaults
 */

import type {
  AgentConfig,
  Defaults,
  WorkSource,
  Session,
  Docker,
  PermissionMode,
  BashPermissions,
  AgentWorkingDirectory,
} from "./schema.js";

// =============================================================================
// Input Types (for merging - fields are optional before Zod applies defaults)
// =============================================================================

/**
 * Permissions input type - all fields optional before Zod applies defaults
 */
export interface PermissionsInput {
  mode?: PermissionMode;
  allowed_tools?: string[];
  denied_tools?: string[];
  bash?: BashPermissions;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a plain object (not an array, null, or other type)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

// =============================================================================
// Deep Merge
// =============================================================================

/**
 * Deep merge two objects. The override object's values take precedence.
 * Arrays are replaced entirely (not merged).
 * Objects are merged recursively.
 *
 * @param base - The base object (defaults)
 * @param override - The override object (agent-specific)
 * @returns A new merged object
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T | undefined,
  override: T | undefined
): T | undefined {
  // If base is undefined, return override
  if (base === undefined) {
    return override;
  }

  // If override is undefined, return base
  if (override === undefined) {
    return base;
  }

  // Create a new object to hold the result
  const result = { ...base } as Record<string, unknown>;

  // Iterate over the override object
  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    // If the override value is undefined, skip it (keep base value)
    if (overrideValue === undefined) {
      continue;
    }

    // If the override value is an array, replace entirely
    if (Array.isArray(overrideValue)) {
      result[key] = overrideValue;
      continue;
    }

    // If both values are plain objects, merge recursively
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    // Otherwise, override value takes precedence
    result[key] = overrideValue;
  }

  return result as T;
}

// =============================================================================
// Agent Config Merge Types
// =============================================================================

/**
 * The fields from fleet defaults that can be merged into agent config
 */
export interface MergeableDefaults {
  permissions?: PermissionsInput;
  work_source?: WorkSource;
  session?: Session;
  docker?: Docker;
  model?: string;
  max_turns?: number;
  permission_mode?: PermissionMode;
}

/**
 * Extended defaults schema that includes all mergeable fields.
 * Uses input types (with optional fields) since these are pre-validation values.
 */
export interface ExtendedDefaults {
  docker?: Docker;
  permissions?: PermissionsInput;
  work_source?: WorkSource;
  instances?: { max_concurrent?: number };
  session?: Session;
  working_directory?: AgentWorkingDirectory;
  model?: string;
  max_turns?: number;
  permission_mode?: PermissionMode;
}

// =============================================================================
// Agent Config Merge
// =============================================================================

/**
 * Merge fleet defaults into an agent configuration.
 *
 * The merge applies to the following fields:
 * - permissions: Deep merged (agent overrides fleet defaults)
 * - work_source: Deep merged
 * - session: Deep merged
 * - docker: Deep merged
 * - instances: Deep merged
 * - working_directory: Agent value takes precedence, or uses fleet default if agent has none
 * - model: Agent value overrides default
 * - max_turns: Agent value overrides default
 * - permission_mode: Agent value overrides default
 *
 * Arrays within these objects (e.g., allowed_tools) are replaced, not merged.
 *
 * @param defaults - The fleet-level defaults
 * @param agent - The agent-specific configuration
 * @returns A new agent configuration with defaults merged in
 */
export function mergeAgentConfig(
  defaults: ExtendedDefaults | undefined,
  agent: AgentConfig
): AgentConfig {
  // If no defaults, return agent as-is
  if (!defaults) {
    return agent;
  }

  // Start with the agent config
  const result: AgentConfig = { ...agent };

  // Merge permissions (deep merge)
  if (defaults.permissions || agent.permissions) {
    result.permissions = deepMerge(
      defaults.permissions as Record<string, unknown> | undefined,
      agent.permissions as Record<string, unknown> | undefined
    ) as AgentConfig["permissions"];
  }

  // Merge work_source (deep merge)
  if (defaults.work_source || agent.work_source) {
    result.work_source = deepMerge(
      defaults.work_source as Record<string, unknown> | undefined,
      agent.work_source as Record<string, unknown> | undefined
    ) as AgentConfig["work_source"];
  }

  // Merge session (deep merge)
  if (defaults.session || agent.session) {
    result.session = deepMerge(
      defaults.session as Record<string, unknown> | undefined,
      agent.session as Record<string, unknown> | undefined
    ) as AgentConfig["session"];
  }

  // Merge docker (deep merge)
  if (defaults.docker || agent.docker) {
    result.docker = deepMerge(
      defaults.docker as Record<string, unknown> | undefined,
      agent.docker as Record<string, unknown> | undefined
    ) as AgentConfig["docker"];
  }

  // Merge instances (deep merge)
  if (defaults.instances || agent.instances) {
    result.instances = deepMerge(
      defaults.instances as Record<string, unknown> | undefined,
      agent.instances as Record<string, unknown> | undefined
    ) as AgentConfig["instances"];
  }

  // Merge working_directory
  // If agent has no working_directory, use fleet default
  // If both are objects, deep merge them
  // If either is a string, agent takes precedence
  if (
    agent.working_directory === undefined &&
    defaults.working_directory !== undefined
  ) {
    result.working_directory = defaults.working_directory;
  } else if (
    agent.working_directory &&
    defaults.working_directory &&
    typeof agent.working_directory === "object" &&
    typeof defaults.working_directory === "object"
  ) {
    result.working_directory = deepMerge(
      defaults.working_directory as Record<string, unknown>,
      agent.working_directory as Record<string, unknown>
    ) as AgentConfig["working_directory"];
  }

  // Merge scalar values (agent takes precedence if defined)
  if (defaults.model !== undefined && result.model === undefined) {
    result.model = defaults.model;
  }

  if (defaults.max_turns !== undefined && result.max_turns === undefined) {
    result.max_turns = defaults.max_turns;
  }

  if (
    defaults.permission_mode !== undefined &&
    result.permission_mode === undefined
  ) {
    result.permission_mode = defaults.permission_mode;
  }

  return result;
}

/**
 * Merge fleet defaults into multiple agent configurations.
 *
 * @param defaults - The fleet-level defaults
 * @param agents - Array of agent configurations
 * @returns Array of merged agent configurations
 */
export function mergeAllAgentConfigs(
  defaults: ExtendedDefaults | undefined,
  agents: AgentConfig[]
): AgentConfig[] {
  return agents.map((agent) => mergeAgentConfig(defaults, agent));
}
