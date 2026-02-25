/**
 * Session Metadata Store
 *
 * Manages user-customizable metadata for Claude Code sessions.
 * Metadata is stored sparsely in .herdctl/session-metadata/{agent-qualified-name}.json
 * Files are only created when the first custom name is set for an agent.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { atomicWriteJson } from "./utils/atomic.js";
import { safeReadJson } from "./utils/reads.js";

const logger = createLogger("SessionMetadataStore");

// =============================================================================
// Schemas
// =============================================================================

/**
 * Schema for a single session's metadata entry
 */
export const SessionMetadataEntrySchema = z.object({
  customName: z.string().optional(),
  /** Auto-generated session name (extracted from JSONL summary) */
  autoName: z.string().optional(),
  /** ISO 8601 timestamp of when autoName was extracted (for cache invalidation) */
  autoNameMtime: z.string().optional(),
  // Future: pinned, archived, tags
});

/**
 * Schema for the entire metadata file for an agent
 */
export const SessionMetadataFileSchema = z.object({
  version: z.literal(1),
  agentName: z.string(),
  sessions: z.record(z.string(), SessionMetadataEntrySchema),
});

export type SessionMetadataEntry = z.infer<typeof SessionMetadataEntrySchema>;
export type SessionMetadataFile = z.infer<typeof SessionMetadataFileSchema>;

// =============================================================================
// SessionMetadataStore
// =============================================================================

/**
 * Store for managing user-customizable session metadata.
 *
 * Provides operations for getting/setting custom names for sessions.
 * Data is sparse - files are only created when metadata is first set.
 *
 * @example
 * ```typescript
 * const store = new SessionMetadataStore('/path/to/.herdctl');
 *
 * // Set a custom name for a session
 * await store.setCustomName('my-agent', 'session-123', 'Feature Work');
 *
 * // Get the custom name
 * const name = await store.getCustomName('my-agent', 'session-123');
 * // Returns: 'Feature Work'
 *
 * // Remove custom name
 * await store.removeCustomName('my-agent', 'session-123');
 * ```
 */
export class SessionMetadataStore {
  private readonly metadataDir: string;
  private readonly cache: Map<string, SessionMetadataFile>;

  /**
   * Create a new SessionMetadataStore
   *
   * @param stateDir - Path to the .herdctl state directory
   */
  constructor(stateDir: string) {
    this.metadataDir = join(stateDir, "session-metadata");
    this.cache = new Map();
  }

  /**
   * Get the file path for an agent's metadata
   */
  private getFilePath(agentName: string): string {
    return join(this.metadataDir, `${agentName}.json`);
  }

  /**
   * Load metadata for an agent from disk (or cache)
   */
  private async loadMetadata(agentName: string): Promise<SessionMetadataFile | null> {
    // Check cache first
    const cached = this.cache.get(agentName);
    if (cached !== undefined) {
      return cached;
    }

    const filePath = this.getFilePath(agentName);
    const result = await safeReadJson<unknown>(filePath);

    if (!result.success) {
      // File not found is expected for sparse storage
      if (result.error.code === "ENOENT") {
        return null;
      }

      logger.warn(`Failed to read metadata file for ${agentName}: ${result.error.message}`);
      return null;
    }

    // Validate the file structure
    const parseResult = SessionMetadataFileSchema.safeParse(result.data);
    if (!parseResult.success) {
      logger.warn(
        `Corrupted metadata file for ${agentName}: ${parseResult.error.message}. Returning null.`,
      );
      return null;
    }

    // Cache and return
    this.cache.set(agentName, parseResult.data);
    return parseResult.data;
  }

  /**
   * Save metadata for an agent to disk
   */
  private async saveMetadata(agentName: string, metadata: SessionMetadataFile): Promise<void> {
    // Ensure directory exists
    await mkdir(this.metadataDir, { recursive: true });

    const filePath = this.getFilePath(agentName);
    await atomicWriteJson(filePath, metadata);

    // Update cache
    this.cache.set(agentName, metadata);

    logger.debug(`Saved metadata for agent ${agentName}`, {
      sessionCount: Object.keys(metadata.sessions).length,
    });
  }

  /**
   * Create a new empty metadata file structure
   */
  private createEmptyMetadata(agentName: string): SessionMetadataFile {
    return {
      version: 1,
      agentName,
      sessions: {},
    };
  }

  /**
   * Get custom name for a session
   *
   * @param agentName - The agent's qualified name
   * @param sessionId - The session ID
   * @returns The custom name if set, undefined otherwise
   */
  async getCustomName(agentName: string, sessionId: string): Promise<string | undefined> {
    const metadata = await this.loadMetadata(agentName);
    if (!metadata) {
      return undefined;
    }

    return metadata.sessions[sessionId]?.customName;
  }

  /**
   * Set custom name for a session
   *
   * Creates the metadata file if it doesn't exist.
   *
   * @param agentName - The agent's qualified name
   * @param sessionId - The session ID
   * @param name - The custom name to set
   */
  async setCustomName(agentName: string, sessionId: string, name: string): Promise<void> {
    let metadata = await this.loadMetadata(agentName);

    if (!metadata) {
      metadata = this.createEmptyMetadata(agentName);
    }

    // Get or create the session entry
    const sessionEntry = metadata.sessions[sessionId] ?? {};

    // Update the custom name
    metadata.sessions[sessionId] = {
      ...sessionEntry,
      customName: name,
    };

    await this.saveMetadata(agentName, metadata);

    logger.debug(`Set custom name for session ${sessionId}`, {
      agentName,
      customName: name,
    });
  }

  /**
   * Remove custom name for a session
   *
   * If this was the only metadata for the session, the session entry is removed.
   * If this was the only session with metadata, the file is kept but empty
   * (to avoid repeatedly creating/deleting files).
   *
   * @param agentName - The agent's qualified name
   * @param sessionId - The session ID
   */
  async removeCustomName(agentName: string, sessionId: string): Promise<void> {
    const metadata = await this.loadMetadata(agentName);

    if (!metadata) {
      // No metadata file exists, nothing to remove
      return;
    }

    const sessionEntry = metadata.sessions[sessionId];
    if (!sessionEntry) {
      // No entry for this session, nothing to remove
      return;
    }

    // Remove the customName
    delete sessionEntry.customName;

    // If the session entry is now empty, remove it entirely
    if (Object.keys(sessionEntry).length === 0) {
      delete metadata.sessions[sessionId];
    } else {
      metadata.sessions[sessionId] = sessionEntry;
    }

    await this.saveMetadata(agentName, metadata);

    logger.debug(`Removed custom name for session ${sessionId}`, { agentName });
  }

  /**
   * Get all metadata for an agent's sessions
   *
   * Useful for batch operations or displaying metadata for all sessions.
   *
   * @param agentName - The agent's qualified name
   * @returns The full metadata file, or null if no metadata exists
   */
  async getAgentMetadata(agentName: string): Promise<SessionMetadataFile | null> {
    return this.loadMetadata(agentName);
  }

  /**
   * Get auto-generated name and its mtime for a session
   *
   * @param agentName - The agent's qualified name (use "adhoc" for unattributed sessions)
   * @param sessionId - The session ID
   * @returns Object with autoName and autoNameMtime, or undefined if not cached
   */
  async getAutoName(
    agentName: string,
    sessionId: string,
  ): Promise<{ autoName?: string; autoNameMtime?: string } | undefined> {
    const metadata = await this.loadMetadata(agentName);
    if (!metadata) {
      return undefined;
    }

    const entry = metadata.sessions[sessionId];
    if (!entry) {
      return undefined;
    }

    return {
      autoName: entry.autoName,
      autoNameMtime: entry.autoNameMtime,
    };
  }

  /**
   * Set auto-generated name for a session
   *
   * @param agentName - The agent's qualified name (use "adhoc" for unattributed sessions)
   * @param sessionId - The session ID
   * @param autoName - The auto-generated name to set
   * @param mtime - ISO 8601 timestamp of the session file when the name was extracted
   */
  async setAutoName(
    agentName: string,
    sessionId: string,
    autoName: string,
    mtime: string,
  ): Promise<void> {
    let metadata = await this.loadMetadata(agentName);

    if (!metadata) {
      metadata = this.createEmptyMetadata(agentName);
    }

    // Get or create the session entry
    const sessionEntry = metadata.sessions[sessionId] ?? {};

    // Update the auto name fields
    metadata.sessions[sessionId] = {
      ...sessionEntry,
      autoName,
      autoNameMtime: mtime,
    };

    await this.saveMetadata(agentName, metadata);

    logger.debug(`Set auto name for session ${sessionId}`, {
      agentName,
      autoName,
    });
  }

  /**
   * Batch set auto-generated names for multiple sessions
   *
   * More efficient than calling setAutoName repeatedly since it performs
   * a single file write for all updates.
   *
   * @param agentName - The agent's qualified name (use "adhoc" for unattributed sessions)
   * @param entries - Array of { sessionId, autoName, mtime } objects
   */
  async batchSetAutoNames(
    agentName: string,
    entries: Array<{ sessionId: string; autoName: string; mtime: string }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    let metadata = await this.loadMetadata(agentName);

    if (!metadata) {
      metadata = this.createEmptyMetadata(agentName);
    }

    // Apply all updates
    for (const { sessionId, autoName, mtime } of entries) {
      const sessionEntry = metadata.sessions[sessionId] ?? {};
      metadata.sessions[sessionId] = {
        ...sessionEntry,
        autoName,
        autoNameMtime: mtime,
      };
    }

    await this.saveMetadata(agentName, metadata);

    logger.debug(`Batch set auto names for ${entries.length} sessions`, {
      agentName,
    });
  }
}
