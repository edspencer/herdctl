/**
 * Session state persistence operations
 *
 * Provides CRUD operations for session info files stored at
 * .herdctl/sessions/<agent-name>.json
 */

import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson } from "./utils/atomic.js";
import { safeReadJson } from "./utils/reads.js";
import {
  SessionInfoSchema,
  createSessionInfo,
  type SessionInfo,
  type SessionMode,
  type CreateSessionOptions,
} from "./schemas/session-info.js";
import { StateFileError } from "./errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for session operations
 */
export interface SessionOptions {
  /** Logger for warnings */
  logger?: SessionLogger;
}

/**
 * Logger interface for session operations
 */
export interface SessionLogger {
  warn: (message: string) => void;
}

/**
 * Partial updates for session info
 */
export type SessionInfoUpdates = Partial<
  Omit<SessionInfo, "agent_name" | "created_at">
>;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the file path for an agent's session
 */
function getSessionFilePath(sessionsDir: string, agentName: string): string {
  return join(sessionsDir, `${agentName}.json`);
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Get session info for an agent
 *
 * Returns null if no session exists (handles missing file gracefully).
 *
 * @param sessionsDir - Path to the sessions directory
 * @param agentName - Name of the agent
 * @param options - Optional operation options
 * @returns The session info, or null if not found
 *
 * @example
 * ```typescript
 * const session = await getSessionInfo('/path/to/.herdctl/sessions', 'my-agent');
 * if (session) {
 *   console.log(`Session ${session.session_id} has ${session.job_count} jobs`);
 * } else {
 *   console.log('No existing session');
 * }
 * ```
 */
export async function getSessionInfo(
  sessionsDir: string,
  agentName: string,
  options: SessionOptions = {}
): Promise<SessionInfo | null> {
  const { logger = console } = options;
  const filePath = getSessionFilePath(sessionsDir, agentName);

  const result = await safeReadJson<unknown>(filePath);

  if (!result.success) {
    // File not found is not an error - return null
    if (result.error.code === "ENOENT") {
      return null;
    }

    // Log other errors but don't throw - treat as missing
    logger.warn(
      `Failed to read session file for ${agentName}: ${result.error.message}`
    );
    return null;
  }

  // Parse and validate
  const parseResult = SessionInfoSchema.safeParse(result.data);
  if (!parseResult.success) {
    logger.warn(
      `Corrupted session file for ${agentName}: ${parseResult.error.message}. Returning null.`
    );
    return null;
  }

  return parseResult.data;
}

/**
 * Update session info for an agent
 *
 * If no session exists, creates a new one with the provided updates.
 * Automatically updates last_used_at timestamp.
 *
 * @param sessionsDir - Path to the sessions directory
 * @param agentName - Name of the agent
 * @param updates - Updates to apply to the session
 * @returns The updated session info
 * @throws StateFileError if the file cannot be written
 *
 * @example
 * ```typescript
 * // Update existing session
 * const session = await updateSessionInfo('/path/to/.herdctl/sessions', 'my-agent', {
 *   job_count: 5,
 *   mode: 'interactive',
 * });
 *
 * // Create new session
 * const newSession = await updateSessionInfo('/path/to/.herdctl/sessions', 'new-agent', {
 *   session_id: 'claude-session-abc123',
 *   mode: 'autonomous',
 * });
 * ```
 */
export async function updateSessionInfo(
  sessionsDir: string,
  agentName: string,
  updates: SessionInfoUpdates
): Promise<SessionInfo> {
  const filePath = getSessionFilePath(sessionsDir, agentName);

  // Try to read existing session
  const existingResult = await safeReadJson<unknown>(filePath);
  let existingSession: SessionInfo | null = null;

  if (existingResult.success) {
    const parseResult = SessionInfoSchema.safeParse(existingResult.data);
    if (parseResult.success) {
      existingSession = parseResult.data;
    }
  }

  const now = new Date().toISOString();

  let updatedSession: SessionInfo;

  if (existingSession) {
    // Update existing session
    updatedSession = {
      ...existingSession,
      ...updates,
      last_used_at: now, // Always update last_used_at
    };
  } else {
    // Create new session - session_id is required for new sessions
    if (!updates.session_id) {
      throw new StateFileError(
        "session_id is required when creating a new session",
        filePath,
        "write"
      );
    }

    const newSession = createSessionInfo({
      agent_name: agentName,
      session_id: updates.session_id,
      mode: updates.mode,
    });

    updatedSession = {
      ...newSession,
      ...updates,
      agent_name: agentName, // Ensure agent_name is not overwritten
      created_at: newSession.created_at, // Preserve created_at
      last_used_at: now,
    };
  }

  // Validate the updated session
  const validated = SessionInfoSchema.parse(updatedSession);

  // Write atomically
  try {
    await atomicWriteJson(filePath, validated);
  } catch (error) {
    throw new StateFileError(
      `Failed to update session file for ${agentName}: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error
    );
  }

  return validated;
}

/**
 * Clear session info for an agent (delete the session file)
 *
 * @param sessionsDir - Path to the sessions directory
 * @param agentName - Name of the agent
 * @returns true if the session was deleted, false if it didn't exist
 *
 * @example
 * ```typescript
 * const cleared = await clearSession('/path/to/.herdctl/sessions', 'my-agent');
 * if (cleared) {
 *   console.log('Session cleared');
 * } else {
 *   console.log('No session to clear');
 * }
 * ```
 */
export async function clearSession(
  sessionsDir: string,
  agentName: string
): Promise<boolean> {
  const filePath = getSessionFilePath(sessionsDir, agentName);

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new StateFileError(
      `Failed to delete session file for ${agentName}: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error
    );
  }
}
