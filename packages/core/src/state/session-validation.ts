/**
 * Session validation utilities
 *
 * Provides timeout parsing and session expiration validation to prevent
 * unexpected logouts when resuming expired sessions.
 */

import { access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getCliSessionFile } from "../runner/runtime/cli-session-path.js";
import type { SessionInfo } from "./schemas/session-info.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of session validation
 */
export interface SessionValidationResult {
  /** Whether the session is valid (not expired) */
  valid: boolean;
  /** If invalid, the reason why */
  reason?: "expired" | "missing" | "invalid_timeout" | "file_not_found" | "runtime_mismatch";
  /** Human-readable message */
  message?: string;
  /** Age of the session in milliseconds */
  ageMs?: number;
  /** Configured timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Options for session validation with file check
 */
export interface SessionFileCheckOptions {
  /**
   * Path to the sessions directory (.herdctl/sessions)
   * Required for Docker session file lookups
   */
  sessionsDir?: string;
}

// =============================================================================
// Timeout Parsing
// =============================================================================

/**
 * Parse a timeout string into milliseconds
 *
 * Supports formats:
 * - "30s" - 30 seconds
 * - "5m" - 5 minutes
 * - "1h" - 1 hour
 * - "1d" - 1 day
 * - "1w" - 1 week
 *
 * @param timeout - Timeout string (e.g., "30m", "1h")
 * @returns Timeout in milliseconds, or null if invalid format
 *
 * @example
 * ```typescript
 * parseTimeout("30m"); // 1800000 (30 minutes in ms)
 * parseTimeout("1h");  // 3600000 (1 hour in ms)
 * parseTimeout("24h"); // 86400000 (24 hours in ms)
 * parseTimeout("invalid"); // null
 * ```
 */
export function parseTimeout(timeout: string): number | null {
  const match = timeout.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w)$/);
  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    case "w":
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Default session timeout if not configured (24 hours)
 * This is a reasonable default that prevents stale sessions from being resumed
 * while still allowing long-running work sessions.
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// Session Validation
// =============================================================================

/**
 * Check if a CLI session file exists on disk (native CLI, not Docker)
 *
 * @param workingDirectory - Working directory for the session
 * @param sessionId - Session ID to check
 * @returns true if the session file exists
 */
export async function cliSessionFileExists(
  workingDirectory: string,
  sessionId: string
): Promise<boolean> {
  try {
    const sessionFile = getCliSessionFile(workingDirectory, sessionId);
    await access(sessionFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Docker session file exists on disk
 *
 * Docker sessions are stored in .herdctl/docker-sessions/{session-id}.jsonl
 * instead of the native ~/.claude/projects/ location.
 *
 * @param sessionsDir - Path to the sessions directory (.herdctl/sessions)
 * @param sessionId - Session ID to check
 * @returns true if the Docker session file exists
 */
export async function dockerSessionFileExists(
  sessionsDir: string,
  sessionId: string
): Promise<boolean> {
  try {
    // Docker sessions are in .herdctl/docker-sessions/, sibling to .herdctl/sessions/
    const stateDir = dirname(sessionsDir);
    const dockerSessionsDir = join(stateDir, "docker-sessions");
    const sessionFile = join(dockerSessionsDir, `${sessionId}.jsonl`);
    await access(sessionFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a session has expired based on its last_used_at timestamp
 *
 * @param session - The session info to validate
 * @param timeout - Timeout string (e.g., "30m", "1h") or undefined for default
 * @returns Validation result with expiration details
 *
 * @example
 * ```typescript
 * const session = await getSessionInfo(sessionsDir, agentName);
 * if (session) {
 *   const validation = isSessionExpired(session, "1h");
 *   if (!validation.valid) {
 *     console.log(`Session expired: ${validation.message}`);
 *     // Clear the session and start fresh
 *   }
 * }
 * ```
 */
export function validateSession(
  session: SessionInfo | null,
  timeout?: string
): SessionValidationResult {
  // Handle missing session
  if (!session) {
    return {
      valid: false,
      reason: "missing",
      message: "No session found",
    };
  }

  // Parse timeout or use default
  let timeoutMs: number;
  if (timeout) {
    const parsed = parseTimeout(timeout);
    if (parsed === null) {
      return {
        valid: false,
        reason: "invalid_timeout",
        message: `Invalid timeout format: "${timeout}". Expected format like "30m", "1h", "24h"`,
      };
    }
    timeoutMs = parsed;
  } else {
    timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;
  }

  // Calculate session age from last_used_at
  const lastUsedAt = new Date(session.last_used_at).getTime();
  const now = Date.now();
  const ageMs = now - lastUsedAt;

  // Handle invalid date parsing (NaN) - treat as expired to force a fresh session
  // This prevents unexpected behavior from corrupted session files
  if (Number.isNaN(ageMs)) {
    return {
      valid: false,
      reason: "expired",
      message: `Session has invalid last_used_at timestamp: "${session.last_used_at}"`,
      timeoutMs,
    };
  }

  // Handle future timestamps (negative age) - could indicate clock skew or timezone issues
  // Treat as valid but log the unusual state; the session will be refreshed on next use
  if (ageMs < 0) {
    return {
      valid: true,
      ageMs: 0, // Report as just used
      timeoutMs,
    };
  }

  // Check if expired
  if (ageMs > timeoutMs) {
    const ageMinutes = Math.round(ageMs / (60 * 1000));
    const timeoutMinutes = Math.round(timeoutMs / (60 * 1000));

    return {
      valid: false,
      reason: "expired",
      message: `Session expired: last used ${formatDuration(ageMs)} ago, timeout is ${formatDuration(timeoutMs)}`,
      ageMs,
      timeoutMs,
    };
  }

  return {
    valid: true,
    ageMs,
    timeoutMs,
  };
}

/**
 * Validate a session including CLI session file existence check
 *
 * This async version of validateSession also checks if the CLI session file
 * exists on disk (for CLI runtime sessions). Use this when validating sessions
 * that will be resumed via CLI runtime.
 *
 * For Docker sessions (session.docker_enabled === true), checks the docker-sessions
 * directory instead of the native ~/.claude/projects/ location.
 *
 * @param session - The session info to validate
 * @param timeout - Timeout string (e.g., "30m", "1h") or undefined for default
 * @param options - Optional configuration including sessionsDir for Docker lookups
 * @returns Promise resolving to validation result
 *
 * @example
 * ```typescript
 * const session = await getSessionInfo(sessionsDir, agentName);
 * if (session) {
 *   const validation = await validateSessionWithFileCheck(session, "1h", { sessionsDir });
 *   if (!validation.valid) {
 *     console.log(`Session invalid: ${validation.message}`);
 *     // Clear the session and start fresh
 *   }
 * }
 * ```
 */
export async function validateSessionWithFileCheck(
  session: SessionInfo | null,
  timeout?: string,
  options?: SessionFileCheckOptions
): Promise<SessionValidationResult> {
  // First do basic validation (expiration, etc.)
  const basicValidation = validateSession(session, timeout);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  // If session exists and isn't expired, check if session file exists
  if (session) {
    let fileExists = false;

    if (session.docker_enabled && options?.sessionsDir) {
      // Docker sessions are stored in .herdctl/docker-sessions/
      fileExists = await dockerSessionFileExists(
        options.sessionsDir,
        session.session_id
      );
    } else if (session.working_directory) {
      // Native CLI sessions are stored in ~/.claude/projects/
      fileExists = await cliSessionFileExists(
        session.working_directory,
        session.session_id
      );
    } else {
      // No working directory and not Docker - skip file check
      return basicValidation;
    }

    if (!fileExists) {
      const location = session.docker_enabled ? "Docker" : "CLI";
      return {
        valid: false,
        reason: "file_not_found",
        message: `${location} session file not found for session ${session.session_id}`,
        ageMs: basicValidation.ageMs,
        timeoutMs: basicValidation.timeoutMs,
      };
    }
  }

  return basicValidation;
}

/**
 * Validate that a session's runtime context matches the current agent configuration
 *
 * Sessions are tied to a specific runtime configuration (SDK vs CLI, Docker vs native).
 * If the runtime context changes, the session must be invalidated because:
 * - CLI sessions use different session file locations than SDK sessions
 * - Docker sessions are isolated from native sessions (different filesystems)
 * - Session IDs are not portable across runtime contexts
 *
 * @param session - The session info to validate
 * @param currentRuntimeType - Current runtime type from agent config ("sdk" or "cli")
 * @param currentDockerEnabled - Current Docker enabled state from agent config
 * @returns Validation result indicating if runtime context matches
 *
 * @example
 * ```typescript
 * const session = await getSessionInfo(sessionsDir, agentName);
 * if (session) {
 *   const validation = validateRuntimeContext(
 *     session,
 *     agent.runtime ?? "sdk",
 *     agent.docker?.enabled ?? false
 *   );
 *   if (!validation.valid) {
 *     console.log(`Runtime context mismatch: ${validation.message}`);
 *     await clearSession(sessionsDir, agentName);
 *   }
 * }
 * ```
 */
export function validateRuntimeContext(
  session: SessionInfo | null,
  currentRuntimeType: "sdk" | "cli",
  currentDockerEnabled: boolean
): SessionValidationResult {
  // Handle missing session
  if (!session) {
    return {
      valid: false,
      reason: "missing",
      message: "No session found",
    };
  }

  // Check runtime type mismatch
  if (session.runtime_type !== currentRuntimeType) {
    return {
      valid: false,
      reason: "runtime_mismatch",
      message: `Runtime type changed from "${session.runtime_type}" to "${currentRuntimeType}". Session must be recreated for the new runtime.`,
    };
  }

  // Check Docker enabled mismatch
  if (session.docker_enabled !== currentDockerEnabled) {
    const oldContext = session.docker_enabled ? "Docker" : "native";
    const newContext = currentDockerEnabled ? "Docker" : "native";
    return {
      valid: false,
      reason: "runtime_mismatch",
      message: `Docker context changed from ${oldContext} to ${newContext}. Session must be recreated for the new context.`,
    };
  }

  return {
    valid: true,
  };
}

/**
 * Format a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Check if an error from the SDK indicates an expired or invalid session
 *
 * The SDK may return errors when trying to resume an expired session.
 * This function helps identify such errors for proper handling.
 *
 * Common error patterns from Claude CLI/SDK:
 * - "session expired" / "session_expired" - explicit expiration
 * - "session not found" / "invalid session" - session doesn't exist on server
 * - "resume failed" - generic resume failure
 * - "conversation not found" / "no conversation" - conversation ID invalid
 * - "cannot resume" / "unable to resume" - resume operation failed
 * - "stale session" - session is too old
 *
 * Also checks error codes for structured error responses.
 *
 * @param error - The error to check
 * @returns true if this appears to be a session expiration error
 */
export function isSessionExpiredError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check error codes for structured errors (e.g., from SDK responses)
  const errorCode = (error as NodeJS.ErrnoException).code?.toLowerCase() ?? "";
  if (
    errorCode === "session_expired" ||
    errorCode === "invalid_session" ||
    errorCode === "session_not_found" ||
    errorCode === "conversation_expired" ||
    errorCode === "conversation_not_found"
  ) {
    return true;
  }

  return (
    // Explicit session expiration
    message.includes("session expired") ||
    message.includes("session_expired") ||
    message.includes("has expired") ||
    message.includes("stale session") ||
    // Session not found on server
    message.includes("session not found") ||
    message.includes("invalid session") ||
    message.includes("session does not exist") ||
    message.includes("session id") && message.includes("not found") ||
    // Conversation/context issues (Claude CLI uses these)
    message.includes("conversation not found") ||
    message.includes("no conversation") ||
    message.includes("conversation does not exist") ||
    message.includes("invalid conversation") ||
    // Resume operation failures
    message.includes("resume failed") ||
    message.includes("cannot resume") ||
    message.includes("unable to resume") ||
    message.includes("failed to resume") ||
    message.includes("could not resume")
  );
}

/**
 * Check if an error indicates an expired or invalid OAuth token
 *
 * When the Claude OAuth access token expires mid-session, the SDK/CLI
 * returns authentication errors. Detecting these allows the job executor
 * to retry with a fresh token (refreshed by buildContainerEnv on next spawn).
 */
export function isTokenExpiredError(error: Error): boolean {
  const message = error.message.toLowerCase();

  const errorCode = (error as NodeJS.ErrnoException).code?.toLowerCase() ?? "";
  if (
    errorCode === "unauthorized" ||
    errorCode === "token_expired" ||
    errorCode === "invalid_token" ||
    errorCode === "auth_error"
  ) {
    return true;
  }

  return (
    // OAuth token expiry
    message.includes("token expired") ||
    message.includes("token has expired") ||
    message.includes("invalid token") ||
    message.includes("token is invalid") ||
    message.includes("expired token") ||
    // HTTP 401/403 auth errors
    message.includes("unauthorized") ||
    message.includes("401") ||
    message.includes("authentication failed") ||
    message.includes("authentication required") ||
    message.includes("not authenticated") ||
    // Claude-specific auth messages
    message.includes("oauth") && message.includes("expired") ||
    message.includes("login required") ||
    message.includes("please log in") ||
    message.includes("re-authenticate") ||
    message.includes("reauthenticate")
  );
}

/**
 * Result of cleaning up expired sessions
 */
export interface CleanupResult {
  /** Number of sessions that were expired and removed */
  removed: number;
  /** Number of valid sessions that were kept */
  kept: number;
  /** Names of agents whose sessions were removed */
  removedAgents: string[];
}

/**
 * Clean up expired sessions from the sessions directory
 *
 * This function checks all sessions and removes those that have expired
 * based on the provided timeout. Useful for periodic cleanup or startup.
 *
 * @param sessionsDir - Path to the sessions directory
 * @param timeout - Timeout string (e.g., "24h") or undefined for default
 * @param options - Additional options
 * @returns Result containing counts and removed agent names
 *
 * @example
 * ```typescript
 * import { cleanupExpiredSessions } from "./state";
 *
 * // Clean up sessions older than 24 hours (default)
 * const result = await cleanupExpiredSessions(sessionsDir);
 * console.log(`Removed ${result.removed} expired sessions`);
 *
 * // Clean up sessions older than 1 hour
 * const result = await cleanupExpiredSessions(sessionsDir, "1h");
 * ```
 */
export async function cleanupExpiredSessions(
  sessionsDir: string,
  timeout?: string,
  options: {
    logger?: { info?: (msg: string) => void; warn: (msg: string) => void };
    dryRun?: boolean;
  } = {}
): Promise<CleanupResult> {
  const { logger = console, dryRun = false } = options;

  // Import dynamically to avoid circular dependencies
  const { listSessions, clearSession } = await import("./session.js");

  const result: CleanupResult = {
    removed: 0,
    kept: 0,
    removedAgents: [],
  };

  // List all sessions
  const sessions = await listSessions(sessionsDir, { logger });

  for (const session of sessions) {
    const validation = validateSession(session, timeout);

    if (!validation.valid && validation.reason === "expired") {
      if (!dryRun) {
        try {
          await clearSession(sessionsDir, session.agent_name);
          result.removed++;
          result.removedAgents.push(session.agent_name);
          logger.info?.(`Cleaned up expired session for ${session.agent_name}`);
        } catch (error) {
          logger.warn(
            `Failed to clean up session for ${session.agent_name}: ${(error as Error).message}`
          );
        }
      } else {
        // Dry run - just count
        result.removed++;
        result.removedAgents.push(session.agent_name);
        logger.info?.(
          `[DRY RUN] Would clean up expired session for ${session.agent_name}`
        );
      }
    } else {
      result.kept++;
    }
  }

  return result;
}
