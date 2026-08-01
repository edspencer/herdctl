/**
 * Adopted session persistence operations
 *
 * Provides CRUD operations for adoption records stored at
 * `.herdctl/adopted-sessions/<session-id>.yaml`.
 *
 * An adoption record claims a pre-existing Claude Code transcript for an agent.
 * It is intentionally a store of its own rather than a synthetic job record —
 * job records mean "a run happened", and overloading them to buy attribution is
 * fragile. The attribution index reads this store as a third source (after jobs
 * and platform records) and reports `origin: "adopted"`.
 *
 * The directory is created lazily on first write, like the sparse
 * `<platform>-sessions` stores; a missing directory simply means "no adoptions".
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../utils/logger.js";
import { StateFileError } from "./errors.js";
import {
  ADOPTED_SESSION_VERSION,
  type AdoptedSession,
  AdoptedSessionSchema,
} from "./schemas/adopted-session.js";
import { atomicWriteYaml } from "./utils/atomic.js";
import { buildSafeFilePath } from "./utils/path-safety.js";
import { safeReadYaml } from "./utils/reads.js";

// =============================================================================
// Logger
// =============================================================================

const logger = createLogger("AdoptedSessions");

// =============================================================================
// Types
// =============================================================================

/**
 * Options for recording an adoption
 */
export interface RecordAdoptionOptions {
  /** Qualified name of the agent adopting the session */
  agentName: string;
  /** Working directory the transcript was originally recorded under, if known */
  sourceCwd?: string;
  /**
   * Override the adoption timestamp (ISO string). Defaults to now.
   * Mainly useful for tests and for backfilling.
   */
  adoptedAt?: string;
}

// =============================================================================
// Paths
// =============================================================================

/** Name of the adoption store subdirectory within the state directory. */
export const ADOPTED_SESSIONS_DIR_NAME = "adopted-sessions";

/**
 * Get the adoption store directory for a state directory.
 *
 * @param stateDir - Path to the .herdctl state directory
 */
export function getAdoptedSessionsDir(stateDir: string): string {
  return path.join(stateDir, ADOPTED_SESSIONS_DIR_NAME);
}

/**
 * Get the file path for a session's adoption record.
 *
 * Uses {@link buildSafeFilePath} for defense-in-depth: session IDs arrive from
 * user input (CLI args, HTTP bodies), so a hostile id such as `../../etc/passwd`
 * must never produce a path outside the store.
 *
 * @throws PathTraversalError if the session ID is not a safe identifier
 */
function getAdoptionFilePath(stateDir: string, sessionId: string): string {
  return buildSafeFilePath(getAdoptedSessionsDir(stateDir), sessionId, ".yaml");
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Record (or re-record) the adoption of a session by an agent.
 *
 * Idempotent: adopting an already-adopted session overwrites the existing record
 * cleanly rather than throwing. The write is atomic, and the store directory is
 * created on demand.
 *
 * @param stateDir - Path to the .herdctl state directory
 * @param sessionId - The Claude Code session ID being adopted
 * @param options - Adoption details
 * @returns The persisted adoption record
 * @throws PathTraversalError if the session ID is not a safe identifier
 * @throws StateFileError if the record cannot be written
 *
 * @example
 * ```typescript
 * await recordAdoption('/path/to/.herdctl', 'a1b2c3d4-...', {
 *   agentName: 'fleet/keeper',
 *   sourceCwd: '/home/user/project',
 * });
 * ```
 */
export async function recordAdoption(
  stateDir: string,
  sessionId: string,
  options: RecordAdoptionOptions,
): Promise<AdoptedSession> {
  const filePath = getAdoptionFilePath(stateDir, sessionId);

  const record = AdoptedSessionSchema.parse({
    version: ADOPTED_SESSION_VERSION,
    sessionId,
    agentName: options.agentName,
    adoptedAt: options.adoptedAt ?? new Date().toISOString(),
    sourceCwd: options.sourceCwd,
  });

  try {
    await fs.mkdir(getAdoptedSessionsDir(stateDir), { recursive: true });
    await atomicWriteYaml(filePath, record);
  } catch (error) {
    throw new StateFileError(
      `Failed to write adoption record: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error,
    );
  }

  logger.debug(`Recorded adoption of session ${sessionId} by ${record.agentName}`);

  return record;
}

/**
 * Get the adoption record for a session.
 *
 * A missing record, a missing store directory, and a corrupted record all read
 * as "not adopted" (`null`) — adoption is advisory metadata and must never break
 * session listing.
 *
 * @param stateDir - Path to the .herdctl state directory
 * @param sessionId - The session ID to look up
 * @returns The adoption record, or null if the session is not adopted
 * @throws PathTraversalError if the session ID is not a safe identifier
 */
export async function getAdoption(
  stateDir: string,
  sessionId: string,
): Promise<AdoptedSession | null> {
  const filePath = getAdoptionFilePath(stateDir, sessionId);

  const result = await safeReadYaml<unknown>(filePath);

  if (!result.success) {
    if (result.error.code === "ENOENT") {
      return null;
    }
    logger.warn(`Failed to read adoption record ${filePath}: ${result.error.message}`);
    return null;
  }

  return parseAdoptionRecord(result.data, filePath);
}

/**
 * List every adoption record in the store.
 *
 * Records are few and cheap to read, so this always re-reads the directory in
 * full. A missing directory yields an empty list; malformed records are logged
 * and skipped.
 *
 * @param stateDir - Path to the .herdctl state directory
 * @returns All valid adoption records
 */
export async function listAdoptions(stateDir: string): Promise<AdoptedSession[]> {
  const dir = getAdoptedSessionsDir(stateDir);

  let fileNames: string[];
  try {
    fileNames = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      logger.debug(`Adoption store does not exist: ${dir}`);
      return [];
    }
    throw new StateFileError(
      `Failed to read adoption store: ${(error as Error).message}`,
      dir,
      "read",
      error as Error,
    );
  }

  const yamlFiles = fileNames.filter((name) => name.endsWith(".yaml") && !name.startsWith("."));

  const records = await Promise.all(
    yamlFiles.map(async (fileName) => {
      const filePath = path.join(dir, fileName);
      const result = await safeReadYaml<unknown>(filePath);
      if (!result.success) {
        logger.warn(`Failed to read adoption record ${filePath}: ${result.error.message}`);
        return null;
      }
      return parseAdoptionRecord(result.data, filePath);
    }),
  );

  return records.filter((record): record is AdoptedSession => record !== null);
}

/**
 * Remove a session's adoption record.
 *
 * @param stateDir - Path to the .herdctl state directory
 * @param sessionId - The session ID to un-adopt
 * @returns true if a record was removed, false if there was none
 * @throws PathTraversalError if the session ID is not a safe identifier
 * @throws StateFileError if the record exists but cannot be removed
 */
export async function removeAdoption(stateDir: string, sessionId: string): Promise<boolean> {
  const filePath = getAdoptionFilePath(stateDir, sessionId);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new StateFileError(
      `Failed to remove adoption record: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error,
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Validate a parsed YAML document as an adoption record.
 *
 * Returns null (and warns) for anything that doesn't validate, so one hand-edited
 * or half-written file can't take down a listing.
 */
function parseAdoptionRecord(data: unknown, filePath: string): AdoptedSession | null {
  const parsed = AdoptedSessionSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(`Corrupted adoption record ${filePath}: ${parsed.error.message}`);
    return null;
  }
  return parsed.data;
}
