/**
 * Session Discovery Service
 *
 * Orchestrates session enumeration by tying together JSONL parsing,
 * session attribution, and CLI session path utilities. Provides cached
 * discovery of Claude Code sessions from the filesystem.
 */

import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodePathForCli, getCliSessionFile } from "../runner/runtime/cli-session-path.js";
import { createLogger } from "../utils/logger.js";
import {
  type ChatMessage,
  extractLastSummary,
  extractSessionMetadata,
  extractSessionUsage,
  isSidechainSession,
  parseSessionMessages,
  type SessionMetadata,
  type SessionUsage,
} from "./jsonl-parser.js";
import {
  type AttributionIndex,
  buildAttributionIndex,
  type SessionOrigin,
} from "./session-attribution.js";
import { SessionMetadataStore } from "./session-metadata.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A discovered session with attribution and metadata
 */
export interface DiscoveredSession {
  sessionId: string;
  workingDirectory: string;
  mtime: string; // ISO 8601 for JSON serialization
  origin: SessionOrigin;
  agentName: string | undefined;
  resumable: boolean;
  customName: string | undefined;
  /** Auto-generated session name (extracted from JSONL summary field) */
  autoName: string | undefined;
  preview: string | undefined; // only populated if metadata was loaded
}

/**
 * A group of sessions by working directory
 */
export interface DirectoryGroup {
  workingDirectory: string;
  encodedPath: string;
  agentName: string | undefined;
  sessionCount: number;
  sessions: DiscoveredSession[];
}

/**
 * Options for creating a SessionDiscoveryService
 */
export interface SessionDiscoveryOptions {
  /** Path to ~/.claude directory. Default: path.join(os.homedir(), ".claude") */
  claudeHomePath?: string;
  /** Path to the .herdctl/ state directory */
  stateDir: string;
  /** Cache TTL in milliseconds. Default: 30_000 (30 seconds) */
  cacheTtlMs?: number;
}

// =============================================================================
// Internal types
// =============================================================================

interface DirectoryCacheEntry {
  sessions: Array<{ sessionId: string; mtime: Date }>;
  fetchedAt: number;
}

// =============================================================================
// Logger
// =============================================================================

const logger = createLogger("SessionDiscoveryService");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Decode an encoded path back to a display path.
 *
 * The encoded path (e.g., "-Users-ed-Code-herdctl") is decoded by:
 * - Replacing leading "-" with "/" (Unix)
 * - Replacing remaining "-" with "/"
 *
 * This is lossy but good enough for display purposes.
 */
function decodePathForDisplay(encodedPath: string): string {
  // Handle Unix paths: leading "-" becomes "/"
  if (encodedPath.startsWith("-")) {
    return "/" + encodedPath.slice(1).replace(/-/g, "/");
  }

  // Handle Windows paths: "C:-Users-..." becomes "C:/Users/..."
  // Check for drive letter pattern
  if (/^[A-Za-z]:-/.test(encodedPath)) {
    return encodedPath[0] + ":" + encodedPath.slice(2).replace(/-/g, "/");
  }

  // Fallback: just replace all hyphens
  return encodedPath.replace(/-/g, "/");
}

/**
 * Check if a path is a temp directory that should be filtered out
 */
function isTempDirectory(decodedPath: string): boolean {
  const tmpDir = os.tmpdir();
  const tempPatterns = ["/tmp/", "/private/tmp/", "/var/folders/", tmpDir];

  for (const pattern of tempPatterns) {
    if (decodedPath.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

// =============================================================================
// SessionDiscoveryService
// =============================================================================

/**
 * Service for discovering and enumerating Claude Code sessions.
 *
 * Provides cached access to session files, with attribution from job metadata
 * and platform session files, plus custom names from the session metadata store.
 *
 * @example
 * ```typescript
 * const discovery = new SessionDiscoveryService({
 *   stateDir: '/path/to/.herdctl',
 * });
 *
 * // Get sessions for a specific agent
 * const sessions = await discovery.getAgentSessions('my-agent', '/path/to/workspace', false);
 *
 * // Get all sessions grouped by directory
 * const groups = await discovery.getAllSessions([
 *   { name: 'agent-1', workingDirectory: '/path/to/project', dockerEnabled: false }
 * ]);
 * ```
 */
export class SessionDiscoveryService {
  private readonly claudeHomePath: string;
  private readonly stateDir: string;
  private readonly cacheTtlMs: number;

  private attributionIndex: AttributionIndex | null = null;
  private attributionFetchedAt: number = 0;

  private directoryCache: Map<string, DirectoryCacheEntry> = new Map();
  private metadataCache: Map<string, SessionMetadata> = new Map();

  private readonly sessionMetadataStore: SessionMetadataStore;

  /**
   * Create a new SessionDiscoveryService
   *
   * @param options - Configuration options
   */
  constructor(options: SessionDiscoveryOptions) {
    this.claudeHomePath = options.claudeHomePath ?? path.join(os.homedir(), ".claude");
    this.stateDir = options.stateDir;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.sessionMetadataStore = new SessionMetadataStore(options.stateDir);
  }

  /**
   * Check if the attribution index cache is valid
   */
  private isAttributionCacheValid(): boolean {
    return (
      this.attributionIndex !== null && Date.now() - this.attributionFetchedAt < this.cacheTtlMs
    );
  }

  /**
   * Check if a directory cache entry is valid
   */
  private isDirectoryCacheValid(
    entry: DirectoryCacheEntry | undefined,
  ): entry is DirectoryCacheEntry {
    return entry !== undefined && Date.now() - entry.fetchedAt < this.cacheTtlMs;
  }

  /**
   * Get or refresh the attribution index
   */
  private async getAttributionIndex(): Promise<AttributionIndex> {
    if (this.isAttributionCacheValid()) {
      return this.attributionIndex!;
    }

    logger.debug("Building attribution index");
    this.attributionIndex = await buildAttributionIndex(this.stateDir);
    this.attributionFetchedAt = Date.now();
    logger.debug(`Attribution index built with ${this.attributionIndex.size} entries`);

    return this.attributionIndex;
  }

  /**
   * List session files in a directory with their modification times
   */
  private async listSessionFiles(
    sessionDir: string,
  ): Promise<Array<{ sessionId: string; mtime: Date }>> {
    // Check cache first
    const cached = this.directoryCache.get(sessionDir);
    if (this.isDirectoryCacheValid(cached)) {
      return cached.sessions;
    }

    // Read directory
    let fileNames: string[];
    try {
      fileNames = await readdir(sessionDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Session directory does not exist: ${sessionDir}`);
        return [];
      }
      logger.warn(`Failed to read session directory: ${sessionDir}: ${(error as Error).message}`);
      return [];
    }

    // Filter to .jsonl files and get stats
    const jsonlFiles = fileNames.filter((name) => name.endsWith(".jsonl"));

    const sessions: Array<{ sessionId: string; mtime: Date }> = [];
    for (const fileName of jsonlFiles) {
      const filePath = path.join(sessionDir, fileName);
      try {
        const stats = await stat(filePath);
        sessions.push({
          sessionId: fileName.replace(/\.jsonl$/, ""),
          mtime: stats.mtime,
        });
      } catch (error) {
        // File may have been deleted between readdir and stat
        logger.debug(`Failed to stat session file: ${filePath}: ${(error as Error).message}`);
      }
    }

    // Sort by mtime descending (newest first)
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Cache the result
    this.directoryCache.set(sessionDir, {
      sessions,
      fetchedAt: Date.now(),
    });

    return sessions;
  }

  /**
   * Resolve the auto-generated name for a session.
   *
   * Checks if the cached autoName is still valid (based on file mtime).
   * If not, extracts a new name from the JSONL summary field.
   *
   * @param agentName - The agent's qualified name (use "adhoc" for unattributed sessions)
   * @param sessionId - The session ID
   * @param fileMtime - ISO 8601 timestamp of the session file's modification time
   * @param workingDirectory - The session's working directory
   * @returns Object with autoName and whether an update is needed
   */
  private async resolveAutoName(
    agentName: string,
    sessionId: string,
    fileMtime: string,
    workingDirectory: string,
  ): Promise<{ autoName: string | undefined; needsUpdate: boolean }> {
    // Check cache
    const cached = await this.sessionMetadataStore.getAutoName(agentName, sessionId);

    if (cached?.autoNameMtime && cached.autoNameMtime >= fileMtime) {
      // Cache is valid
      return { autoName: cached.autoName, needsUpdate: false };
    }

    // Need to extract from JSONL
    const filePath = getCliSessionFile(workingDirectory, sessionId);
    const summary = await extractLastSummary(filePath);

    if (summary) {
      return { autoName: summary, needsUpdate: true };
    }

    return { autoName: undefined, needsUpdate: false };
  }

  /**
   * Get sessions for a specific agent.
   *
   * Returns sessions from the agent's working directory, attributed and
   * enriched with custom names from the metadata store.
   *
   * @param agentName - The agent's qualified name
   * @param workingDirectory - The agent's working directory
   * @param dockerEnabled - Whether Docker is enabled for the agent (affects resumability)
   * @param options - Optional settings (limit for top-N optimization)
   * @returns Array of discovered sessions sorted by mtime descending
   */
  async getAgentSessions(
    agentName: string,
    workingDirectory: string,
    dockerEnabled: boolean,
    options?: { limit?: number },
  ): Promise<DiscoveredSession[]> {
    const limit = options?.limit;
    const encodedPath = encodePathForCli(workingDirectory);
    const sessionDir = path.join(this.claudeHomePath, "projects", encodedPath);

    logger.debug(`Getting sessions for agent ${agentName}`, { sessionDir });

    // Get session files (already sorted by mtime descending)
    const sessionFiles = await this.listSessionFiles(sessionDir);
    if (sessionFiles.length === 0) {
      return [];
    }

    // Only enrich the top N sessions when limit is set
    const filesToEnrich = limit !== undefined ? sessionFiles.slice(0, limit) : sessionFiles;

    // Get attribution index
    const attributionIndex = await this.getAttributionIndex();

    // Build discovered sessions and collect autoName updates
    const sessions: DiscoveredSession[] = [];
    const autoNameUpdates: Array<{ sessionId: string; autoName: string; mtime: string }> = [];

    for (const { sessionId, mtime } of filesToEnrich) {
      // Filter out sidechain (sub-agent) sessions. Claude Code marks sessions
      // as sidechain when they're Task tool sub-agents or when --resume is used.
      // These are mostly prompt-cache warmup sessions ("Warmup" + single response)
      // that clutter the UI with no useful content. We check only the first JSONL
      // line so this is O(1) per file.
      const filePath = getCliSessionFile(workingDirectory, sessionId);
      if (await isSidechainSession(filePath)) {
        continue;
      }

      const attribution = attributionIndex.getAttribute(sessionId);

      // Only show sessions that are attributed to this specific agent.
      // When multiple agents share a working directory, this prevents the same
      // native CLI sessions from appearing under every agent. Unattributed sessions
      // are still visible in the global recent sessions list and All Chats view.
      if (attribution.agentName !== agentName) {
        continue;
      }

      const customName = await this.sessionMetadataStore.getCustomName(agentName, sessionId);
      const mtimeStr = mtime.toISOString();

      // Resolve autoName with caching
      const { autoName, needsUpdate } = await this.resolveAutoName(
        agentName,
        sessionId,
        mtimeStr,
        workingDirectory,
      );

      if (needsUpdate && autoName) {
        autoNameUpdates.push({ sessionId, autoName, mtime: mtimeStr });
      }

      sessions.push({
        sessionId,
        workingDirectory,
        mtime: mtimeStr,
        origin: attribution.origin,
        agentName: attribution.agentName ?? agentName,
        resumable: !dockerEnabled,
        customName,
        autoName,
        preview: undefined, // Lazy - loaded via getSessionMetadata
      });
    }

    // Batch write any autoName updates
    if (autoNameUpdates.length > 0) {
      await this.sessionMetadataStore.batchSetAutoNames(agentName, autoNameUpdates);
    }

    return sessions;
  }

  /**
   * Get all sessions grouped by working directory.
   *
   * Scans the Claude projects directory and groups sessions by their
   * working directories. Filters out temp directories and enriches
   * sessions with attribution and custom names.
   *
   * When a limit is provided, only the most recent `limit` sessions
   * (by mtime) are enriched with names, avoiding expensive JSONL parsing
   * for sessions that won't be returned.
   *
   * @param agents - Array of known agents for matching sessions
   * @param options - Optional settings (limit for top-N optimization)
   * @returns Array of directory groups sorted by most recent session
   */
  async getAllSessions(
    agents: Array<{ name: string; workingDirectory: string; dockerEnabled: boolean }>,
    options?: { limit?: number },
  ): Promise<DirectoryGroup[]> {
    const limit = options?.limit;

    // Build agent lookup by encoded path
    const agentLookup = new Map<string, { agentName: string; dockerEnabled: boolean }>();
    for (const agent of agents) {
      const encodedPath = encodePathForCli(agent.workingDirectory);
      agentLookup.set(encodedPath, {
        agentName: agent.name,
        dockerEnabled: agent.dockerEnabled,
      });
    }

    // Scan projects directory
    const projectsDir = path.join(this.claudeHomePath, "projects");

    let encodedPaths: string[];
    try {
      encodedPaths = await readdir(projectsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Projects directory does not exist: ${projectsDir}`);
        return [];
      }
      logger.warn(`Failed to read projects directory: ${projectsDir}: ${(error as Error).message}`);
      return [];
    }

    // Get attribution index
    const attributionIndex = await this.getAttributionIndex();

    // Phase 1: Collect lightweight session entries from all directories
    interface DirectoryInfo {
      encodedPath: string;
      decodedPath: string;
      agentName: string | undefined;
      metadataKey: string;
      dockerEnabled: boolean;
      sessionFiles: Array<{ sessionId: string; mtime: Date }>;
    }

    const directories: DirectoryInfo[] = [];

    for (const encodedPath of encodedPaths) {
      const sessionDir = path.join(projectsDir, encodedPath);

      // Check if it's a directory
      try {
        const stats = await stat(sessionDir);
        if (!stats.isDirectory()) {
          continue;
        }
      } catch (error) {
        logger.debug(`Failed to stat: ${sessionDir}: ${(error as Error).message}`);
        continue;
      }

      // Decode path for display and filtering
      const decodedPath = decodePathForDisplay(encodedPath);

      // Filter out temp directories
      if (isTempDirectory(decodedPath)) {
        logger.debug(`Skipping temp directory: ${decodedPath}`);
        continue;
      }

      // Get session files (already sorted by mtime descending)
      const sessionFiles = await this.listSessionFiles(sessionDir);
      if (sessionFiles.length === 0) {
        continue;
      }

      // Check if this matches a known agent
      const agentMatch = agentLookup.get(encodedPath);
      const agentName = agentMatch?.agentName;
      const dockerEnabled = agentMatch?.dockerEnabled ?? false;
      const metadataKey = agentName ?? "adhoc";

      directories.push({
        encodedPath,
        decodedPath,
        agentName,
        metadataKey,
        dockerEnabled,
        sessionFiles,
      });
    }

    // Phase 2: If limit is set, find the top N sessions by mtime across all directories
    // Each directory's sessionFiles are already sorted by mtime descending,
    // so we merge-select the top N using pointers into each sorted list.
    let selectedSessionIds: Set<string> | undefined;

    if (limit !== undefined) {
      // Merge pointers: index into each directory's sorted sessionFiles
      const pointers = directories.map(() => 0);
      selectedSessionIds = new Set<string>();

      for (let picked = 0; picked < limit; picked++) {
        let bestDir = -1;
        let bestMtime: Date | null = null;

        for (let d = 0; d < directories.length; d++) {
          const dir = directories[d];
          if (pointers[d] >= dir.sessionFiles.length) continue;
          const candidate = dir.sessionFiles[pointers[d]];
          if (bestMtime === null || candidate.mtime > bestMtime) {
            bestMtime = candidate.mtime;
            bestDir = d;
          }
        }

        if (bestDir === -1) break; // No more sessions
        selectedSessionIds.add(directories[bestDir].sessionFiles[pointers[bestDir]].sessionId);
        pointers[bestDir]++;
      }
    }

    // Phase 3: Enrich sessions (only selected ones when limit is set)
    const groups: DirectoryGroup[] = [];

    for (const dir of directories) {
      const sessions: DiscoveredSession[] = [];
      const autoNameUpdates: Array<{ sessionId: string; autoName: string; mtime: string }> = [];

      for (const { sessionId, mtime } of dir.sessionFiles) {
        // Skip sessions not in the selected set when limit is active
        if (selectedSessionIds && !selectedSessionIds.has(sessionId)) {
          continue;
        }

        // Filter out sidechain (sub-agent) sessions — see comment in getAgentSessions()
        const filePath = getCliSessionFile(dir.decodedPath, sessionId);
        if (await isSidechainSession(filePath)) {
          continue;
        }

        const attribution = attributionIndex.getAttribute(sessionId);
        const mtimeStr = mtime.toISOString();

        // Get custom name (works for both attributed and unattributed sessions)
        const customName = await this.sessionMetadataStore.getCustomName(
          dir.metadataKey,
          sessionId,
        );

        // Resolve autoName with caching
        const { autoName, needsUpdate } = await this.resolveAutoName(
          dir.metadataKey,
          sessionId,
          mtimeStr,
          dir.decodedPath,
        );

        if (needsUpdate && autoName) {
          autoNameUpdates.push({ sessionId, autoName, mtime: mtimeStr });
        }

        sessions.push({
          sessionId,
          workingDirectory: dir.decodedPath,
          mtime: mtimeStr,
          origin: attribution.origin,
          agentName: attribution.agentName ?? dir.agentName,
          resumable: !dir.dockerEnabled,
          customName,
          autoName,
          preview: undefined,
        });
      }

      // Batch write any autoName updates for this directory
      if (autoNameUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetAutoNames(dir.metadataKey, autoNameUpdates);
      }

      if (sessions.length > 0) {
        groups.push({
          workingDirectory: dir.decodedPath,
          encodedPath: dir.encodedPath,
          agentName: dir.agentName,
          sessionCount: dir.sessionFiles.length,
          sessions,
        });
      }
    }

    // Sort groups by most recent session mtime descending
    groups.sort((a, b) => {
      const aLatest = a.sessions[0]?.mtime ?? "";
      const bLatest = b.sessions[0]?.mtime ?? "";
      return bLatest.localeCompare(aLatest);
    });

    return groups;
  }

  /**
   * Get parsed chat messages from a session.
   *
   * Delegates to the JSONL parser.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @returns Array of chat messages
   */
  async getSessionMessages(workingDirectory: string, sessionId: string): Promise<ChatMessage[]> {
    const filePath = getCliSessionFile(workingDirectory, sessionId);
    return parseSessionMessages(filePath);
  }

  /**
   * Get metadata for a session.
   *
   * Caches the result for efficiency when called repeatedly.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @returns Session metadata
   */
  async getSessionMetadata(workingDirectory: string, sessionId: string): Promise<SessionMetadata> {
    const filePath = getCliSessionFile(workingDirectory, sessionId);

    // Check cache
    const cached = this.metadataCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    // Extract metadata
    const metadata = await extractSessionMetadata(filePath);

    // Cache and return
    this.metadataCache.set(filePath, metadata);
    return metadata;
  }

  /**
   * Get usage data for a session.
   *
   * Delegates to the JSONL parser.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @returns Session usage data
   */
  async getSessionUsage(workingDirectory: string, sessionId: string): Promise<SessionUsage> {
    const filePath = getCliSessionFile(workingDirectory, sessionId);
    return extractSessionUsage(filePath);
  }

  /**
   * Invalidate cached data.
   *
   * If a working directory is provided, only that directory's cache entry
   * is cleared. Otherwise, all caches are cleared.
   *
   * @param workingDirectory - Optional working directory to clear cache for
   */
  invalidateCache(workingDirectory?: string): void {
    if (workingDirectory !== undefined) {
      const encodedPath = encodePathForCli(workingDirectory);
      const sessionDir = path.join(this.claudeHomePath, "projects", encodedPath);
      this.directoryCache.delete(sessionDir);
      logger.debug(`Invalidated cache for directory: ${sessionDir}`);
    } else {
      this.directoryCache.clear();
      this.attributionIndex = null;
      this.attributionFetchedAt = 0;
      this.metadataCache.clear();
      logger.debug("Invalidated all caches");
    }
  }
}
