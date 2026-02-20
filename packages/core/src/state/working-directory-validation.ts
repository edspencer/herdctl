/**
 * Working directory validation utilities
 *
 * Provides validation to detect when a session's working directory has changed,
 * which would cause Claude Code to look for the session file in the wrong
 * project directory and fail to resume.
 */

import type { SessionInfo } from "./schemas/session-info.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of working directory validation
 */
export interface WorkingDirectoryValidation {
  /** Whether the working directory is valid (unchanged) */
  valid: boolean;
  /** If invalid, the reason why */
  reason?: "changed" | "missing";
  /** Human-readable message */
  message?: string;
  /** Old working directory path from session */
  oldPath?: string;
  /** New working directory path from current config */
  newPath?: string;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that a session's working directory matches the current working directory
 *
 * Claude Code stores session files in project directories based on the cwd.
 * If the working directory changes between sessions, Claude Code will look for
 * the session file in a different directory and fail with ENOENT.
 *
 * This function compares the stored working_directory from the session with the
 * current working_directory to detect this condition so we can clear the stale
 * session and start fresh.
 *
 * @param session - The session info to validate (null if no session exists)
 * @param currentWorkingDirectory - The current working directory from agent config
 * @returns Validation result with change details
 *
 * @example
 * ```typescript
 * const session = await getSessionInfo(sessionsDir, agentName);
 * const currentWd = resolveWorkingDirectory(agent);
 * const validation = validateWorkingDirectory(session, currentWd);
 *
 * if (!validation.valid) {
 *   logger.warn(`Working directory changed: ${validation.message}`);
 *   await clearSession(sessionsDir, agentName);
 * }
 * ```
 */
export function validateWorkingDirectory(
  session: SessionInfo | null,
  currentWorkingDirectory: string | undefined,
): WorkingDirectoryValidation {
  // No session to validate
  if (!session) {
    return { valid: true };
  }

  const oldPath = session.working_directory;
  const newPath = currentWorkingDirectory;

  // Both undefined - OK (backward compat: old sessions without working_directory)
  if (!oldPath && !newPath) {
    return { valid: true };
  }

  // One is undefined, other is defined - Changed
  if (!oldPath && newPath) {
    return {
      valid: false,
      reason: "changed",
      message: `Working directory changed from undefined to ${newPath}`,
      oldPath: undefined,
      newPath,
    };
  }

  if (oldPath && !newPath) {
    return {
      valid: false,
      reason: "changed",
      message: `Working directory changed from ${oldPath} to undefined`,
      oldPath,
      newPath: undefined,
    };
  }

  // Both defined but different - Changed
  if (oldPath !== newPath) {
    return {
      valid: false,
      reason: "changed",
      message: `Working directory changed from ${oldPath} to ${newPath}`,
      oldPath,
      newPath,
    };
  }

  // Same working directory - Valid
  return { valid: true };
}
