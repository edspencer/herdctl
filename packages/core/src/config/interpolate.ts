/**
 * Environment variable interpolation for herdctl configuration
 *
 * Supports:
 * - ${VAR_NAME} - interpolate from environment variables
 * - ${VAR_NAME:-default} - provide default value if not set
 * - Preserves non-string values (numbers, booleans, objects)
 * - Works at any nesting depth
 */

import { ConfigError } from "./parser.js";

/**
 * Error thrown when an undefined environment variable is referenced without a default
 */
export class UndefinedVariableError extends ConfigError {
  public readonly variableName: string;
  public readonly path: string;

  constructor(variableName: string, path: string) {
    super(
      `Undefined environment variable '${variableName}' at '${path}' (no default provided)`
    );
    this.name = "UndefinedVariableError";
    this.variableName = variableName;
    this.path = path;
  }
}

/**
 * Regular expression to match ${VAR} and ${VAR:-default} patterns
 * Captures:
 * - Group 1: Variable name (letters, numbers, underscores)
 * - Group 2: Default value (everything after :- if present)
 */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Options for interpolation
 */
export interface InterpolateOptions {
  /**
   * Custom environment object to use instead of process.env
   * Useful for testing
   */
  env?: Record<string, string | undefined>;
}

/**
 * Interpolate a single string value, replacing ${VAR} and ${VAR:-default} patterns
 *
 * @param value - The string value to interpolate
 * @param path - The config path for error messages
 * @param env - Environment variables object
 * @returns The interpolated string
 * @throws {UndefinedVariableError} If a variable is undefined and has no default
 */
export function interpolateString(
  value: string,
  path: string,
  env: Record<string, string | undefined> = process.env
): string {
  // Reset regex state
  ENV_VAR_PATTERN.lastIndex = 0;

  // Collect all matches first to check for undefined variables
  const matches: Array<{
    fullMatch: string;
    varName: string;
    defaultValue: string | undefined;
    index: number;
  }> = [];

  let match;
  while ((match = ENV_VAR_PATTERN.exec(value)) !== null) {
    matches.push({
      fullMatch: match[0],
      varName: match[1],
      defaultValue: match[2],
      index: match.index,
    });
  }

  // If no matches, return original string
  if (matches.length === 0) {
    return value;
  }

  // Replace all matches
  let result = value;
  // Process matches in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, varName, defaultValue, index } = matches[i];
    const envValue = env[varName];

    let replacement: string;
    if (envValue !== undefined) {
      replacement = envValue;
    } else if (defaultValue !== undefined) {
      replacement = defaultValue;
    } else {
      throw new UndefinedVariableError(varName, path);
    }

    result =
      result.slice(0, index) + replacement + result.slice(index + fullMatch.length);
  }

  return result;
}

/**
 * Recursively interpolate all string values in an object or array
 *
 * @param value - The value to interpolate (can be any type)
 * @param path - The current config path for error messages
 * @param env - Environment variables object
 * @returns The interpolated value (same type as input for non-strings)
 * @throws {UndefinedVariableError} If a variable is undefined and has no default
 */
export function interpolateValue(
  value: unknown,
  path: string = "",
  env: Record<string, string | undefined> = process.env
): unknown {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings - perform interpolation
  if (typeof value === "string") {
    return interpolateString(value, path, env);
  }

  // Preserve non-string primitives (numbers, booleans)
  if (typeof value !== "object") {
    return value;
  }

  // Handle arrays - recursively interpolate each element
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      interpolateValue(item, path ? `${path}[${index}]` : `[${index}]`, env)
    );
  }

  // Handle objects - recursively interpolate each property
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const newPath = path ? `${path}.${key}` : key;
    result[key] = interpolateValue(val, newPath, env);
  }
  return result;
}

/**
 * Interpolate environment variables in a configuration object
 *
 * This is the main entry point for configuration interpolation.
 * It recursively processes all string values in the config, replacing
 * ${VAR} patterns with environment variable values.
 *
 * @param config - The configuration object to interpolate
 * @param options - Interpolation options
 * @returns A new object with all string values interpolated
 * @throws {UndefinedVariableError} If a variable is undefined and has no default
 *
 * @example
 * ```typescript
 * const config = {
 *   database: {
 *     host: "${DB_HOST:-localhost}",
 *     password: "${DB_PASSWORD}"
 *   }
 * };
 *
 * // With DB_HOST unset and DB_PASSWORD=secret
 * const result = interpolateConfig(config);
 * // result = { database: { host: "localhost", password: "secret" } }
 * ```
 */
export function interpolateConfig<T>(
  config: T,
  options: InterpolateOptions = {}
): T {
  const env = options.env ?? process.env;
  return interpolateValue(config, "", env) as T;
}
