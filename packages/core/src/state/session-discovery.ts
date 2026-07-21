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
import {
  encodePathForCli,
  getCliSessionFile,
  getDockerSessionDir,
  getDockerSessionFile,
  sessionBelongsToWorkingDirectory,
} from "../runner/runtime/cli-session-path.js";
import { createLogger } from "../utils/logger.js";
import {
  type ChatMessage,
  extractFirstMessagePreview,
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
  AttributionIndexBuilder,
  type SessionOrigin,
} from "./session-attribution.js";
import { SessionMetadataStore } from "./session-metadata.js";
import { mapWithConcurrency } from "./utils/concurrency.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Max concurrent per-session enrichments in {@link SessionDiscoveryService.getAgentSessions}.
 * The work is I/O-bound (transcript-head reads), so overlapping it hides most of
 * the latency; the cap keeps a project with hundreds of sessions from opening a
 * file descriptor per session all at once.
 */
const SESSION_ENRICHMENT_CONCURRENCY = 16;

/**
 * Max number of parsed-transcript entries retained by the message cache in
 * {@link SessionDiscoveryService.getSessionMessages}. Parsed message arrays for
 * large chats are multiple MB each, so the cache is kept small (LRU-evicted) to
 * bound memory on the constrained host while still covering the common
 * open/refresh-the-same-few-chats pattern.
 */
const MESSAGE_CACHE_MAX_ENTRIES = 8;

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
  /**
   * Optional shared {@link SessionMetadataStore}. When provided, the service
   * reads custom names / auto-names / previews through this store instead of
   * creating its own. Sharing one instance keeps the in-memory cache consistent
   * with callers that *write* metadata (e.g. `FleetManager.setSessionName`), so
   * a subsequent `getAgentSessions` reflects the change immediately. When
   * omitted, a private store is created for backward compatibility.
   */
  sessionMetadataStore?: SessionMetadataStore;
}

// =============================================================================
// Internal types
// =============================================================================

interface DirectoryCacheEntry {
  sessions: Array<{ sessionId: string; mtime: Date }>;
  fetchedAt: number;
  /**
   * The transcript directory's own mtime (epoch ms) captured when this entry
   * was built, or `null` if it couldn't be stat'd. Adding or removing a session
   * file bumps the directory's mtime, so comparing the *current* directory mtime
   * to this value lets us cheaply detect a stale listing and auto-rebuild it
   * before the TTL would otherwise expire. (Appends to an existing transcript do
   * NOT bump the directory mtime — those are covered by the TTL.)
   */
  dirMtimeMs: number | null;
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
  /**
   * Incremental builder for the attribution index. Held for the service's
   * lifetime so its per-job-file cache survives across rebuilds — a post-TTL
   * refresh then re-parses only new/changed job files instead of all of them.
   */
  private readonly attributionBuilder = new AttributionIndexBuilder();

  private directoryCache: Map<string, DirectoryCacheEntry> = new Map();
  private metadataCache: Map<string, SessionMetadata> = new Map();
  /**
   * mtime-keyed cache of fully-parsed transcript messages, keyed on the
   * transcript file path. A transcript is immutable except when a new turn
   * appends (which bumps its mtime), so an entry is served only when the
   * recorded mtime still matches the file's current mtime. This kills the
   * repeat-open cost — parsing an ~8MB / 500K-token transcript is ~114ms of
   * synchronous JSON.parse-per-line that otherwise ran on *every* open and
   * stalled the event loop on the constrained host.
   *
   * Bounded to {@link MESSAGE_CACHE_MAX_ENTRIES} entries (each parsed array can
   * be multiple MB) with simple LRU eviction — Map preserves insertion order, so
   * the oldest key is evicted first and a hit re-inserts to mark it most-recent.
   */
  private messageCache: Map<string, { mtime: string; messages: ChatMessage[] }> = new Map();

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
    this.sessionMetadataStore =
      options.sessionMetadataStore ?? new SessionMetadataStore(options.stateDir);
  }

  /**
   * The {@link SessionMetadataStore} this service reads metadata through.
   *
   * Exposed so callers that share a discovery service can write metadata (e.g.
   * custom names) through the *same* store instance and have the change
   * reflected by subsequent discovery calls without a stale in-memory cache.
   */
  getSessionMetadataStore(): SessionMetadataStore {
    return this.sessionMetadataStore;
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
    // Incremental: re-parses only new/changed job files since the last build.
    this.attributionIndex = await this.attributionBuilder.build(this.stateDir);
    this.attributionFetchedAt = Date.now();
    logger.debug(`Attribution index built with ${this.attributionIndex.size} entries`);

    return this.attributionIndex;
  }

  /**
   * Stat a directory and return its mtime in epoch milliseconds, or `null` if it
   * can't be stat'd (missing or unreadable). Used to detect when a session file
   * has been added/removed (which bumps the directory mtime) so a cached listing
   * can be auto-rebuilt before the TTL expires.
   */
  private async getDirMtimeMs(sessionDir: string): Promise<number | null> {
    try {
      const stats = await stat(sessionDir);
      return stats.mtimeMs;
    } catch {
      return null;
    }
  }

  /**
   * List session files in a directory with their modification times
   */
  private async listSessionFiles(
    sessionDir: string,
  ): Promise<Array<{ sessionId: string; mtime: Date }>> {
    // Check cache first. A cached entry is served only when it's both within the
    // TTL window AND the directory hasn't changed since the entry was built: a
    // new (or removed) session file bumps the directory's mtime, so an mtime
    // mismatch forces an immediate rebuild instead of serving a stale listing.
    const cached = this.directoryCache.get(sessionDir);
    if (this.isDirectoryCacheValid(cached)) {
      // Cheap stat to detect a newly added/removed session file. If we can't
      // stat the directory now (transiently unreadable) we fall back to the TTL
      // bound by serving the cached entry rather than rebuilding from nothing.
      const currentDirMtimeMs = await this.getDirMtimeMs(sessionDir);
      if (
        currentDirMtimeMs === null ||
        cached.dirMtimeMs === null ||
        currentDirMtimeMs === cached.dirMtimeMs
      ) {
        return cached.sessions;
      }
      // Directory changed since the entry was built — fall through to rebuild.
    }

    // Capture the directory mtime BEFORE listing so we never cache a listing as
    // newer than the mtime it reflects (avoids a race where a file is added
    // between readdir and the mtime read, which would let a stale entry stick).
    const dirMtimeMs = await this.getDirMtimeMs(sessionDir);

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

    // Cache the result, recording the directory mtime captured above so a later
    // call can detect an added/removed session file and rebuild eagerly.
    this.directoryCache.set(sessionDir, {
      sessions,
      fetchedAt: Date.now(),
      dirMtimeMs,
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
    dockerEnabled?: boolean,
  ): Promise<{ autoName: string | undefined; needsUpdate: boolean }> {
    // Check cache
    const cached = await this.sessionMetadataStore.getAutoName(agentName, sessionId);

    if (cached?.autoNameMtime && cached.autoNameMtime >= fileMtime) {
      // Cache is valid
      return { autoName: cached.autoName, needsUpdate: false };
    }

    // Need to extract from JSONL
    const filePath = dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId);
    const summary = await extractLastSummary(filePath);

    // Always signal an update so the (possibly empty) result is negative-cached:
    // record `autoNameMtime` even when no summary was found. CLI keeper sessions
    // essentially never produce a `type:"summary"` entry, so without this the
    // cache would be 0%-effective and `extractLastSummary` would re-stream the
    // whole transcript on every listing. Mirrors `resolveSidechain`, which
    // already records the mtime for negative results.
    return { autoName: summary || undefined, needsUpdate: true };
  }

  /**
   * Resolve the preview (first user message text) for a session, using cache when valid.
   *
   * @param agentName - The agent's qualified name (or "adhoc" for unattributed)
   * @param sessionId - The session ID
   * @param fileMtime - ISO 8601 timestamp of the session file's modification time
   * @param workingDirectory - The session's working directory
   * @returns Object with preview and whether an update is needed
   */
  private async resolvePreview(
    agentName: string,
    sessionId: string,
    fileMtime: string,
    workingDirectory: string,
    dockerEnabled?: boolean,
  ): Promise<{ preview: string | undefined; needsUpdate: boolean }> {
    // Check cache
    const cached = await this.sessionMetadataStore.getPreview(agentName, sessionId);

    if (cached?.previewMtime && cached.previewMtime >= fileMtime) {
      // Cache is valid
      return { preview: cached.preview, needsUpdate: false };
    }

    // Need to extract from JSONL
    const filePath = dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId);
    const preview = await extractFirstMessagePreview(filePath);

    // Always signal an update so the (possibly empty) result is negative-cached:
    // record `previewMtime` even when no preview was found. A transcript with no
    // plain-text user line otherwise streams end-to-end on every listing looking
    // for one. Mirrors `resolveSidechain`/`resolveAutoName`.
    return { preview: preview || undefined, needsUpdate: true };
  }

  /**
   * Resolve whether a session is a sidechain (Task sub-agent / --resume warmup),
   * using the cache when valid. The flag is derived from the transcript's first
   * JSONL line, so caching it (keyed on file mtime) lets a listing skip re-opening
   * every transcript — the check runs once per session per content change instead
   * of on every listing.
   *
   * @param agentName - The agent's qualified name (or "adhoc" for unattributed)
   * @param sessionId - The session ID
   * @param fileMtime - ISO 8601 timestamp of the session file's modification time
   * @param workingDirectory - The session's working directory
   * @returns Object with isSidechain and whether the cache needs an update
   */
  private async resolveSidechain(
    agentName: string,
    sessionId: string,
    fileMtime: string,
    workingDirectory: string,
    dockerEnabled?: boolean,
  ): Promise<{ isSidechain: boolean; needsUpdate: boolean }> {
    // Check cache
    const cached = await this.sessionMetadataStore.getSidechain(agentName, sessionId);

    if (
      cached?.isSidechain !== undefined &&
      cached.isSidechainMtime &&
      cached.isSidechainMtime >= fileMtime
    ) {
      // Cache is valid
      return { isSidechain: cached.isSidechain, needsUpdate: false };
    }

    // Need to read the transcript's first line
    const filePath = dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId);
    const isSidechain = await isSidechainSession(filePath);

    return { isSidechain, needsUpdate: true };
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

    // Docker agents store session files in .herdctl/docker-sessions/ on the host
    // (the container's ~/.claude/projects/ is ephemeral and gone after exit).
    // Non-Docker agents store sessions in ~/.claude/projects/{encoded-path}/.
    const sessionDir = dockerEnabled
      ? getDockerSessionDir(this.stateDir)
      : path.join(this.claudeHomePath, "projects", encodePathForCli(workingDirectory));

    logger.debug(`Getting sessions for agent ${agentName}`, { sessionDir, dockerEnabled });

    // Get session files (already sorted by mtime descending)
    const sessionFiles = await this.listSessionFiles(sessionDir);
    if (sessionFiles.length === 0) {
      return [];
    }

    // Only enrich the top N sessions when limit is set
    const filesToEnrich = limit !== undefined ? sessionFiles.slice(0, limit) : sessionFiles;

    // Get attribution index
    const attributionIndex = await this.getAttributionIndex();

    // Enrich each session. The per-session work is independent and I/O-bound
    // (reading transcript heads for the sidechain check + any uncached name /
    // preview), so run it with bounded concurrency instead of one-at-a-time —
    // the sequential loop's latency grew linearly with the session count.
    // Results come back in input order, so the mtime-descending sort is kept.
    const enriched = await mapWithConcurrency(
      filesToEnrich,
      SESSION_ENRICHMENT_CONCURRENCY,
      async ({ sessionId, mtime }) => {
        const mtimeStr = mtime.toISOString();

        // Filter out sidechain (sub-agent) sessions. Claude Code marks sessions
        // as sidechain when they're Task tool sub-agents or when --resume is used.
        // These are mostly prompt-cache warmup sessions ("Warmup" + single response)
        // that clutter the UI with no useful content. The flag comes from the first
        // JSONL line and is cached (keyed on mtime) so we don't re-open every
        // transcript on each listing. Record the (possibly refreshed) flag even for
        // excluded sessions so the next listing can skip re-reading them.
        const { isSidechain, needsUpdate: sidechainNeedsUpdate } = await this.resolveSidechain(
          agentName,
          sessionId,
          mtimeStr,
          workingDirectory,
          dockerEnabled,
        );
        const sidechainUpdate = sidechainNeedsUpdate
          ? { sessionId, isSidechain, mtime: mtimeStr }
          : undefined;
        if (isSidechain) {
          return { session: null, sidechainUpdate };
        }

        const attribution = attributionIndex.getAttribute(sessionId);

        // Only show sessions that are attributed to this specific agent.
        // When multiple agents share a working directory, this prevents the same
        // native CLI sessions from appearing under every agent. Unattributed sessions
        // are still visible in the global recent sessions list and All Chats view.
        if (attribution.agentName !== agentName) {
          return { session: null, sidechainUpdate };
        }

        const customName = await this.sessionMetadataStore.getCustomName(agentName, sessionId);

        // Resolve autoName with caching — pass docker flag so it reads the right file
        const { autoName, needsUpdate } = await this.resolveAutoName(
          agentName,
          sessionId,
          mtimeStr,
          workingDirectory,
          dockerEnabled,
        );

        // Resolve preview with caching — pass docker flag so it reads the right file
        const { preview, needsUpdate: previewNeedsUpdate } = await this.resolvePreview(
          agentName,
          sessionId,
          mtimeStr,
          workingDirectory,
          dockerEnabled,
        );

        const session: DiscoveredSession = {
          sessionId,
          workingDirectory,
          mtime: mtimeStr,
          origin: attribution.origin,
          agentName: attribution.agentName ?? agentName,
          resumable: !dockerEnabled,
          customName,
          autoName,
          preview,
        };
        return {
          session,
          sidechainUpdate,
          // Record the update even when the value is empty so the negative result
          // (no summary / no preview) is cached against this mtime — see
          // resolveAutoName/resolvePreview.
          autoNameUpdate: needsUpdate ? { sessionId, autoName, mtime: mtimeStr } : undefined,
          previewUpdate: previewNeedsUpdate ? { sessionId, preview, mtime: mtimeStr } : undefined,
        };
      },
    );

    // Reduce the (order-preserving) results into the session list + cache updates.
    const sessions: DiscoveredSession[] = [];
    const autoNameUpdates: Array<{ sessionId: string; autoName?: string; mtime: string }> = [];
    const previewUpdates: Array<{ sessionId: string; preview?: string; mtime: string }> = [];
    const sidechainUpdates: Array<{ sessionId: string; isSidechain: boolean; mtime: string }> = [];
    for (const result of enriched) {
      // A refreshed sidechain flag is recorded even for excluded sessions.
      if (result.sidechainUpdate) {
        sidechainUpdates.push(result.sidechainUpdate);
      }
      if (!result.session) {
        continue;
      }
      sessions.push(result.session);
      if (result.autoNameUpdate) {
        autoNameUpdates.push(result.autoNameUpdate);
      }
      if (result.previewUpdate) {
        previewUpdates.push(result.previewUpdate);
      }
    }

    // Batch write any cache updates
    if (autoNameUpdates.length > 0) {
      await this.sessionMetadataStore.batchSetAutoNames(agentName, autoNameUpdates);
    }
    if (previewUpdates.length > 0) {
      await this.sessionMetadataStore.batchSetPreviews(agentName, previewUpdates);
    }
    if (sidechainUpdates.length > 0) {
      await this.sessionMetadataStore.batchSetSidechains(agentName, sidechainUpdates);
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

    // Build agent lookup by encoded path. Because encodePathForCli is lossy
    // (issue #148), several distinct working directories can map to the same
    // encoded path. We therefore record EVERY agent that resolves to a given
    // encoded path so we can later disambiguate colliding sessions by their
    // recorded cwd.
    const agentLookup = new Map<
      string,
      { agentName: string; dockerEnabled: boolean; workingDirectory: string }
    >();
    const collidingWorkingDirs = new Map<string, Set<string>>();
    for (const agent of agents) {
      const encodedPath = encodePathForCli(agent.workingDirectory);
      // First writer wins for the primary attribution (preserves prior behaviour),
      // but track all real working directories sharing this encoded path.
      if (!agentLookup.has(encodedPath)) {
        agentLookup.set(encodedPath, {
          agentName: agent.name,
          dockerEnabled: agent.dockerEnabled,
          workingDirectory: agent.workingDirectory,
        });
      }
      let dirs = collidingWorkingDirs.get(encodedPath);
      if (!dirs) {
        dirs = new Set<string>();
        collidingWorkingDirs.set(encodedPath, dirs);
      }
      dirs.add(path.resolve(agent.workingDirectory));
    }

    // Scan projects directory
    const projectsDir = path.join(this.claudeHomePath, "projects");

    let encodedPaths: string[];
    try {
      encodedPaths = await readdir(projectsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Projects directory does not exist: ${projectsDir}`);
        encodedPaths = [];
      } else {
        logger.warn(
          `Failed to read projects directory: ${projectsDir}: ${(error as Error).message}`,
        );
        return [];
      }
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
      /**
       * The directory actually scanned under {@link claudeHomePath}/projects.
       * Used to read transcript files for collision disambiguation so the read
       * honours `claudeHomePath` instead of re-deriving from the lossy decoded
       * path (issue #148). `undefined` for docker (flat) directories.
       */
      sessionDirPath?: string;
      /**
       * When this encoded directory is shared by more than one real working
       * directory (issue #148 collision), this is the working directory this
       * group represents. Sessions whose recorded cwd belongs to a *different*
       * colliding directory are filtered out during enrichment. `undefined`
       * when there is no collision (the common case — no extra work done).
       */
      disambiguateWorkingDir?: string;
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

      // Issue #148: if more than one real working directory collides on this
      // encoded directory name, attribute sessions to a specific agent only when
      // their recorded cwd matches that agent's working directory. Done only on
      // collision, so the common (unique) case pays no extra cost.
      const collidingDirs = collidingWorkingDirs.get(encodedPath);
      const disambiguateWorkingDir =
        agentMatch && collidingDirs && collidingDirs.size > 1
          ? agentMatch.workingDirectory
          : undefined;

      directories.push({
        encodedPath,
        decodedPath,
        agentName,
        metadataKey,
        dockerEnabled,
        sessionFiles,
        sessionDirPath: sessionDir,
        disambiguateWorkingDir,
      });
    }

    // Phase 1b: Also scan docker-sessions directory for Docker-enabled agents.
    // Docker sessions are stored flat in .herdctl/docker-sessions/ — they don't
    // appear under ~/.claude/projects/ because the container filesystem is ephemeral.
    const dockerSessionDir = getDockerSessionDir(this.stateDir);
    const dockerSessionFiles = await this.listSessionFiles(dockerSessionDir);

    if (dockerSessionFiles.length > 0) {
      // Get the set of docker-enabled agent names for attribution matching
      const dockerAgents = agents.filter((a) => a.dockerEnabled);

      if (dockerAgents.length > 0) {
        // Docker sessions are flat (all agents share one directory), so we need
        // attribution to separate them. We'll add one DirectoryInfo per docker agent
        // with all docker session files, and let the enrichment phase filter by attribution.
        for (const agent of dockerAgents) {
          // Skip if this agent already has a directory from the projects scan
          // (shouldn't happen for Docker agents, but be defensive)
          const encodedPath = encodePathForCli(agent.workingDirectory);
          if (
            directories.some((d) => d.encodedPath === encodedPath && d.agentName === agent.name)
          ) {
            continue;
          }

          directories.push({
            encodedPath: `docker:${agent.name}`,
            decodedPath: agent.workingDirectory,
            agentName: agent.name,
            metadataKey: agent.name,
            dockerEnabled: true,
            sessionFiles: dockerSessionFiles,
          });
        }
      }
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

    // Accumulate the sessionIds that physically exist on disk for each metadata
    // key, so stale metadata entries can be reconciled away afterwards (#168).
    // Multiple directories can share a key — every unattributed directory uses
    // "adhoc" — so we must union across directories before pruning, otherwise
    // one adhoc directory would delete another's live entries. Only populated on
    // a full (unlimited) scan; a limited scan does NOT enumerate every session,
    // so pruning off it would wrongly delete live entries.
    const validSessionIdsByKey: Map<string, Set<string>> | undefined =
      limit === undefined ? new Map<string, Set<string>>() : undefined;

    for (const dir of directories) {
      if (validSessionIdsByKey) {
        let validIds = validSessionIdsByKey.get(dir.metadataKey);
        if (!validIds) {
          validIds = new Set<string>();
          validSessionIdsByKey.set(dir.metadataKey, validIds);
        }
        // Every transcript present in this directory is a live session for this
        // key — include sidechains and non-enriched sessions, all of which carry
        // legitimately-cached metadata keyed by sessionId.
        for (const { sessionId } of dir.sessionFiles) {
          validIds.add(sessionId);
        }
      }

      const sessions: DiscoveredSession[] = [];
      const autoNameUpdates: Array<{ sessionId: string; autoName?: string; mtime: string }> = [];
      const previewUpdates: Array<{ sessionId: string; preview?: string; mtime: string }> = [];
      const sidechainUpdates: Array<{ sessionId: string; isSidechain: boolean; mtime: string }> =
        [];
      let visibleSessionCount = 0;

      for (const { sessionId, mtime } of dir.sessionFiles) {
        const mtimeStr = mtime.toISOString();

        // Filter out sidechain (sub-agent) sessions — see comment in getAgentSessions().
        // Cached (keyed on mtime) so we don't re-open every transcript per listing.
        const { isSidechain, needsUpdate: sidechainNeedsUpdate } = await this.resolveSidechain(
          dir.metadataKey,
          sessionId,
          mtimeStr,
          dir.decodedPath,
          dir.dockerEnabled,
        );
        if (sidechainNeedsUpdate) {
          sidechainUpdates.push({ sessionId, isSidechain, mtime: mtimeStr });
        }
        if (isSidechain) {
          continue;
        }

        // Issue #148: when several real working directories collide on this
        // encoded transcript directory, drop sessions whose recorded cwd belongs
        // to a *different* colliding directory so they aren't cross-attributed.
        // Only runs when a collision was detected (dir.disambiguateWorkingDir set).
        // Reads from the actually-scanned directory so it honours claudeHomePath.
        if (dir.disambiguateWorkingDir !== undefined && dir.sessionDirPath !== undefined) {
          const transcriptPath = path.join(dir.sessionDirPath, `${sessionId}.jsonl`);
          const belongs = await sessionBelongsToWorkingDirectory(
            transcriptPath,
            dir.disambiguateWorkingDir,
          );
          if (!belongs) {
            continue;
          }
        }

        const attribution = attributionIndex.getAttribute(sessionId);

        // For docker directories, only include sessions attributed to this specific agent
        // (since all docker agents share the same docker-sessions directory)
        if (dir.dockerEnabled && attribution.agentName !== dir.agentName) {
          continue;
        }

        // Count visible sessions BEFORE pagination filtering — sessionCount should reflect
        // total visible sessions for this agent, not just the paginated subset
        visibleSessionCount++;

        // Skip sessions not in the selected set when limit is active (pagination)
        if (selectedSessionIds && !selectedSessionIds.has(sessionId)) {
          continue;
        }

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
          dir.dockerEnabled,
        );

        // Record even an empty result so the negative case is cached (see
        // resolveAutoName). autoName may be undefined here.
        if (needsUpdate) {
          autoNameUpdates.push({ sessionId, autoName, mtime: mtimeStr });
        }

        // Resolve preview with caching
        const { preview, needsUpdate: previewNeedsUpdate } = await this.resolvePreview(
          dir.metadataKey,
          sessionId,
          mtimeStr,
          dir.decodedPath,
          dir.dockerEnabled,
        );

        if (previewNeedsUpdate) {
          previewUpdates.push({ sessionId, preview, mtime: mtimeStr });
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
          preview,
        });
      }

      // Batch write any cache updates for this directory
      if (autoNameUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetAutoNames(dir.metadataKey, autoNameUpdates);
      }
      if (previewUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetPreviews(dir.metadataKey, previewUpdates);
      }
      if (sidechainUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetSidechains(dir.metadataKey, sidechainUpdates);
      }

      if (sessions.length > 0) {
        groups.push({
          workingDirectory: dir.decodedPath,
          encodedPath: dir.encodedPath,
          agentName: dir.agentName,
          sessionCount: visibleSessionCount,
          sessions,
        });
      }
    }

    // Reconcile metadata against the sessions that still exist on disk (#168).
    // Runs only on a full scan (validSessionIdsByKey is undefined when a limit
    // was applied). Pruning writes only when it actually removes an entry, so a
    // steady-state listing with no dead sessions performs no extra writes.
    if (validSessionIdsByKey) {
      for (const [metadataKey, validIds] of validSessionIdsByKey) {
        await this.sessionMetadataStore.prune(metadataKey, validIds);
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
   * Resolve the file path for a session JSONL file.
   *
   * Docker sessions are stored in .herdctl/docker-sessions/{sessionId}.jsonl.
   * Native CLI sessions are in ~/.claude/projects/{encoded-path}/{sessionId}.jsonl.
   */
  private resolveSessionFilePath(
    workingDirectory: string,
    sessionId: string,
    dockerEnabled?: boolean,
  ): string {
    return dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId);
  }

  /**
   * Get parsed chat messages from a session.
   *
   * Delegates to the JSONL parser.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @param options - Optional settings (dockerEnabled for Docker agent sessions)
   * @returns Array of chat messages
   */
  async getSessionMessages(
    workingDirectory: string,
    sessionId: string,
    options?: { dockerEnabled?: boolean },
  ): Promise<ChatMessage[]> {
    const filePath = this.resolveSessionFilePath(
      workingDirectory,
      sessionId,
      options?.dockerEnabled,
    );

    // Key the cache on the transcript's current mtime. A transcript only changes
    // when a new turn appends (bumping mtime), so an exact mtime match means the
    // parsed messages are still current and we can skip the full re-parse. If the
    // file can't be stat'd (e.g. gone), fall back to a direct parse rather than
    // caching against a bogus key.
    let mtimeStr: string | undefined;
    try {
      mtimeStr = (await stat(filePath)).mtime.toISOString();
    } catch {
      return parseSessionMessages(filePath);
    }

    const cached = this.messageCache.get(filePath);
    if (cached && cached.mtime === mtimeStr) {
      // LRU touch: re-insert so this key is marked most-recently-used.
      this.messageCache.delete(filePath);
      this.messageCache.set(filePath, cached);
      return cached.messages;
    }

    const messages = await parseSessionMessages(filePath);

    this.messageCache.set(filePath, { mtime: mtimeStr, messages });
    // Evict least-recently-used entries beyond the cap (oldest insertion first).
    while (this.messageCache.size > MESSAGE_CACHE_MAX_ENTRIES) {
      const oldest = this.messageCache.keys().next().value;
      if (oldest === undefined) break;
      this.messageCache.delete(oldest);
    }

    return messages;
  }

  /**
   * Get metadata for a session.
   *
   * Caches the result for efficiency when called repeatedly.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @param options - Optional settings (dockerEnabled for Docker agent sessions)
   * @returns Session metadata
   */
  async getSessionMetadata(
    workingDirectory: string,
    sessionId: string,
    options?: { dockerEnabled?: boolean },
  ): Promise<SessionMetadata> {
    const filePath = this.resolveSessionFilePath(
      workingDirectory,
      sessionId,
      options?.dockerEnabled,
    );

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
   * Delegates to the JSONL parser. When `agentName` is supplied, the result is
   * memoized in the persistent SessionMetadataStore keyed on the transcript's
   * mtime, so repeated reads (and reads after a restart) skip re-streaming the
   * whole transcript unless a new turn has changed it.
   *
   * @param workingDirectory - The session's working directory
   * @param sessionId - The session ID
   * @param options - Optional settings (dockerEnabled for Docker agent sessions;
   *   agentName to enable the persistent usage cache; mtime to key that cache
   *   without a stat when the caller already knows the transcript's mtime)
   * @returns Session usage data
   */
  async getSessionUsage(
    workingDirectory: string,
    sessionId: string,
    options?: { dockerEnabled?: boolean; agentName?: string; mtime?: string },
  ): Promise<SessionUsage> {
    const filePath = this.resolveSessionFilePath(
      workingDirectory,
      sessionId,
      options?.dockerEnabled,
    );

    const agentName = options?.agentName;
    if (!agentName) {
      return extractSessionUsage(filePath);
    }

    // Key the cache on the transcript's mtime. Prefer a caller-supplied mtime
    // (session listings already have it); otherwise a cheap stat. If neither is
    // available (file gone), fall back to a direct parse rather than caching a
    // bogus entry.
    let mtimeStr = options?.mtime;
    if (!mtimeStr) {
      try {
        mtimeStr = (await stat(filePath)).mtime.toISOString();
      } catch {
        return extractSessionUsage(filePath);
      }
    }

    const cached = await this.sessionMetadataStore.getUsage(agentName, sessionId);
    if (cached?.usage && cached.usageMtime && cached.usageMtime >= mtimeStr) {
      return cached.usage;
    }

    const usage = await extractSessionUsage(filePath);
    await this.sessionMetadataStore.setUsage(agentName, sessionId, usage, mtimeStr);
    return usage;
  }

  /**
   * Invalidate cached data.
   *
   * If a working directory is provided, only that directory's cache entry
   * is cleared. Otherwise, all caches are cleared.
   *
   * @param workingDirectory - Optional working directory to clear cache for
   * @param options - Optional settings (dockerEnabled to also clear docker-sessions cache)
   */
  invalidateCache(workingDirectory?: string, options?: { dockerEnabled?: boolean }): void {
    if (workingDirectory !== undefined) {
      const encodedPath = encodePathForCli(workingDirectory);
      const sessionDir = path.join(this.claudeHomePath, "projects", encodedPath);
      this.directoryCache.delete(sessionDir);
      logger.debug(`Invalidated cache for directory: ${sessionDir}`);

      // Also invalidate docker-sessions cache when the agent is docker-enabled
      if (options?.dockerEnabled) {
        const dockerDir = getDockerSessionDir(this.stateDir);
        this.directoryCache.delete(dockerDir);
        logger.debug(`Also invalidated docker-sessions cache: ${dockerDir}`);
      }
    } else {
      this.directoryCache.clear();
      this.attributionIndex = null;
      this.attributionFetchedAt = 0;
      this.metadataCache.clear();
      this.messageCache.clear();
      logger.debug("Invalidated all caches");
    }
  }

  /**
   * Invalidate the cached file listing for a single working directory.
   *
   * Unlike {@link invalidateCache} (whose no-arg form clears *everything*), this
   * always targets one directory and never clears unrelated caches, making it a
   * safe "force a fresh listing for this agent on the next call" primitive — the
   * intent behind {@link import("../fleet-manager/fleet-manager.js").FleetManager.invalidateSessions}.
   *
   * It also drops the shared attribution index so a session created this turn
   * (whose job record was just written) is re-attributed and surfaces in the
   * next {@link getAgentSessions} call. The mtime-aware listing cache already
   * auto-rebuilds when a new transcript file appears, but calling this removes
   * any dependence on filesystem mtime granularity.
   *
   * @param workingDirectory - The working directory whose listing cache to clear
   * @param options - Optional settings (dockerEnabled to also clear docker-sessions cache)
   */
  invalidateWorkingDirectory(
    workingDirectory: string,
    options?: { dockerEnabled?: boolean },
  ): void {
    const encodedPath = encodePathForCli(workingDirectory);
    const sessionDir = path.join(this.claudeHomePath, "projects", encodedPath);
    this.directoryCache.delete(sessionDir);

    if (options?.dockerEnabled) {
      const dockerDir = getDockerSessionDir(this.stateDir);
      this.directoryCache.delete(dockerDir);
    }

    // Drop the attribution index too so a session created this turn is picked up.
    this.attributionIndex = null;
    this.attributionFetchedAt = 0;

    logger.debug(`Invalidated working-directory cache for: ${sessionDir}`);
  }

  /**
   * Invalidate the attribution index cache.
   *
   * Call this after writing new session attribution (e.g., after a web chat
   * message creates or updates a session) so the next session list request
   * rebuilds the index and includes the newly attributed session.
   *
   * Optionally also invalidates a specific directory's file listing cache,
   * which is needed when a new session creates a new JSONL file.
   *
   * @param workingDirectory - Optional working directory whose file listing cache should also be cleared
   * @param options - Optional settings (dockerEnabled to also clear docker-sessions cache)
   */
  invalidateAttributionCache(
    workingDirectory?: string,
    options?: { dockerEnabled?: boolean },
  ): void {
    this.attributionIndex = null;
    this.attributionFetchedAt = 0;
    logger.debug("Invalidated attribution cache");

    if (workingDirectory !== undefined) {
      const encodedPath = encodePathForCli(workingDirectory);
      const sessionDir = path.join(this.claudeHomePath, "projects", encodedPath);
      this.directoryCache.delete(sessionDir);
      logger.debug(`Also invalidated directory cache for: ${sessionDir}`);

      // Also invalidate docker-sessions cache when the agent is docker-enabled
      if (options?.dockerEnabled) {
        const dockerDir = getDockerSessionDir(this.stateDir);
        this.directoryCache.delete(dockerDir);
        logger.debug(`Also invalidated docker-sessions cache: ${dockerDir}`);
      }
    }
  }
}
