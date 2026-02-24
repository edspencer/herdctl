/**
 * Environment Variable Scanner
 *
 * Scans agent.yaml content (as raw text) and extracts all ${VAR} and ${VAR:-default}
 * references. Used to inform users which environment variables they need to set
 * after installing an agent.
 *
 * @example
 * ```typescript
 * const yamlContent = `
 * name: my-agent
 * env:
 *   webhook: \${DISCORD_WEBHOOK_URL}
 *   token: \${API_TOKEN:-default-token}
 * `;
 *
 * const result = scanEnvVariables(yamlContent);
 * // result = {
 * //   variables: [
 * //     { name: "API_TOKEN", defaultValue: "default-token" },
 * //     { name: "DISCORD_WEBHOOK_URL" }
 * //   ],
 * //   required: [{ name: "DISCORD_WEBHOOK_URL" }],
 * //   optional: [{ name: "API_TOKEN", defaultValue: "default-token" }]
 * // }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Represents an environment variable reference found in the YAML content.
 */
export interface EnvVariable {
  /** The variable name (e.g., "DISCORD_WEBHOOK_URL") */
  name: string;
  /** The default value if specified with :- syntax, or undefined */
  defaultValue?: string;
}

/**
 * Result of scanning YAML content for environment variable references.
 */
export interface EnvScanResult {
  /** All unique environment variables found, sorted alphabetically */
  variables: EnvVariable[];
  /** Variables that have no default value (user MUST set these) */
  required: EnvVariable[];
  /** Variables that have a default value (optional to set) */
  optional: EnvVariable[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Regular expression to match ${VAR} and ${VAR:-default} patterns.
 * This is the same pattern used in packages/core/src/config/interpolate.ts.
 *
 * Captures:
 * - Group 1: Variable name (letters, numbers, underscores, starting with letter or underscore)
 * - Group 2: Default value (everything after :- if present)
 */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Variables to exclude from scan results.
 * These are herdctl-internal variables, not agent-specific configuration.
 */
const EXCLUDED_PREFIXES = ["HERDCTL_"];

// =============================================================================
// Implementation
// =============================================================================

/**
 * Checks if a variable name should be excluded from results.
 *
 * @param name - The variable name to check
 * @returns true if the variable should be excluded
 */
function shouldExclude(name: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Scans YAML content for environment variable references.
 *
 * This function scans raw text (not parsed YAML) to extract all ${VAR} and
 * ${VAR:-default} patterns. It:
 * - Deduplicates variables (same name only listed once)
 * - Prefers entries with defaults when a variable appears both with and without
 * - Sorts alphabetically by variable name
 * - Partitions into required (no default) and optional (has default) lists
 * - Excludes HERDCTL_* prefixed variables (internal to herdctl)
 *
 * @param yamlContent - The raw YAML file content to scan
 * @returns EnvScanResult with variables, required, and optional arrays
 *
 * @example
 * ```typescript
 * const result = scanEnvVariables(`
 *   webhook: \${WEBHOOK_URL}
 *   api_key: \${API_KEY:-sk-default}
 *   # Comment with \${COMMENT_VAR}
 * `);
 *
 * // result.variables = [
 * //   { name: "API_KEY", defaultValue: "sk-default" },
 * //   { name: "COMMENT_VAR" },
 * //   { name: "WEBHOOK_URL" }
 * // ]
 * ```
 */
export function scanEnvVariables(yamlContent: string): EnvScanResult {
  // Handle empty or non-string input
  if (!yamlContent || typeof yamlContent !== "string") {
    return {
      variables: [],
      required: [],
      optional: [],
    };
  }

  // Map to track unique variables, preferring entries with defaults
  const variableMap = new Map<string, EnvVariable>();

  // Reset regex state (global regexes are stateful)
  ENV_VAR_PATTERN.lastIndex = 0;

  // Find all matches
  let match: RegExpExecArray | null = null;
  while ((match = ENV_VAR_PATTERN.exec(yamlContent)) !== null) {
    const name = match[1];
    const defaultValue = match[2];

    // Skip excluded variables
    if (shouldExclude(name)) {
      continue;
    }

    const existing = variableMap.get(name);

    // If variable already exists, prefer the entry with a default value
    if (existing) {
      if (defaultValue !== undefined && existing.defaultValue === undefined) {
        variableMap.set(name, { name, defaultValue });
      }
      // Otherwise keep existing (either already has default, or neither has default)
    } else {
      // First occurrence of this variable
      const variable: EnvVariable = { name };
      if (defaultValue !== undefined) {
        variable.defaultValue = defaultValue;
      }
      variableMap.set(name, variable);
    }
  }

  // Convert to array and sort alphabetically by name
  const variables = Array.from(variableMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  // Partition into required and optional
  const required: EnvVariable[] = [];
  const optional: EnvVariable[] = [];

  for (const variable of variables) {
    if (variable.defaultValue !== undefined) {
      optional.push(variable);
    } else {
      required.push(variable);
    }
  }

  return {
    variables,
    required,
    optional,
  };
}
