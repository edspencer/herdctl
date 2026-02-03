/**
 * Working directory helper utilities
 *
 * Provides utilities for resolving the working directory from agent configuration.
 */

import type { ResolvedAgent } from "../config/index.js";

/**
 * Resolve the agent's working directory to an absolute path string
 *
 * The working_directory field can be:
 * - undefined (no working directory configured)
 * - a string (direct path)
 * - an object with a root property (structured config)
 *
 * This function normalizes all cases to either undefined or an absolute path string.
 *
 * @param agent - The resolved agent configuration
 * @returns Absolute path to working directory, or undefined if not configured
 *
 * @example
 * ```typescript
 * const workingDir = resolveWorkingDirectory(agent);
 * if (workingDir) {
 *   console.log(`Agent working directory: ${workingDir}`);
 * }
 * ```
 */
export function resolveWorkingDirectory(agent: ResolvedAgent): string | undefined {
  if (!agent.working_directory) {
    return undefined;
  }

  if (typeof agent.working_directory === "string") {
    return agent.working_directory;
  }

  return agent.working_directory.root;
}
