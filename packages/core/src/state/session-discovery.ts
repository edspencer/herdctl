/**
 * Session Discovery Service
 *
 * Orchestrates session enumeration by tying together JSONL parsing,
 * session attribution, and CLI session path utilities. Provides cached
 * discovery of Claude Code sessions from the filesystem.
 */

import { constants as fsConstants } from "node:fs";
import { copyFile, link, mkdir, readdir, stat, symlink, unlink, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
  getDockerSessionDir,
  getDockerSessionFile,
  sessionBelongsToWorkingDirectory,
} from "../runner/runtime/cli-session-path.js";
import { createLogger } from "../utils/logger.js";
import { listAdoptions, recordAdoption, removeAdoption } from "./adopted-sessions.js";
import {
  type ChatMessage,
  extractFirstMessagePreview,
  extractSessionMetadata,
  extractSessionTitle,
  extractSessionUsage,
  isSidechainSession,
  parseSessionMessages,
  type SessionMetadata,
  type SessionUsage,
} from "./jsonl-parser.js";
import type { AdoptedSession } from "./schemas/adopted-session.js";
import {
  type AttributionIndex,
  AttributionIndexBuilder,
  type SessionOrigin,
} from "./session-attribution.js";
import {
  AUTO_NAME_EXTRACTOR_VERSION,
  isSessionMetadataUnreadableError,
  SessionMetadataStore,
} from "./session-metadata.js";
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
 * A native CLI session that could be adopted by an agent.
 *
 * Deliberately NOT a {@link DiscoveredSession}: half of that shape is meaningless
 * for a session that hasn't been adopted yet. Its `origin` is by definition
 * `"native"`, its `agentName` is by definition undefined (that's *why* it is
 * invisible), `resumable` is a property of the adopting agent rather than of the
 * candidate, and `customName` is keyed per agent so an unattributed session
 * never has one. What a picker actually needs is: which session, what does it
 * look like, when was it last touched, and where did it come from.
 *
 * There is no message count: obtaining one means streaming the whole transcript
 * (`extractSessionMetadata`), which is exactly the per-session cost the listing
 * caches exist to avoid. `mtime` + `preview` + `sizeBytes` are all available
 * without a full parse.
 */
export interface AdoptableSession {
  sessionId: string;
  /**
   * The working directory whose transcript folder this session was found in —
   * i.e. the `sourceCwd` that adoption will record for provenance.
   */
  sourceCwd: string;
  /** ISO 8601 last-modified time of the transcript (drives sort order). */
  mtime: string;
  /** Best available title (`custom-title` → `ai-title` → `summary` → preview). */
  autoName: string | undefined;
  /** First user message, truncated — shown under the title in a picker. */
  preview: string | undefined;
  /** Transcript size in bytes; a cheap proxy for "how much is in here". */
  sizeBytes: number;
}

/**
 * How {@link SessionDiscoveryService.adoptSessionsFrom} places a transcript into
 * the agent's own folder when it is adopting from a *different* working
 * directory.
 *
 * - `copy` (**default**) — duplicate the file, preserving its mtime. The user's
 *   original `~/.claude` transcript is left untouched; the agent appends to its
 *   own copy on resume.
 * - `move` — relocate the file. The original disappears from the user's
 *   terminal history.
 * - `link` — hard-link (symlink across devices). One inode, so a resume appends
 *   to the user's original transcript too.
 */
export type AdoptionPlacementMode = "copy" | "move" | "link";

/** Why a candidate session was not adopted. */
export type AdoptSkipReason =
  /** Transcript is a Task sub-agent / warmup sidechain, never user-facing. */
  | "sidechain"
  /** An adoption record already exists (possibly for a different agent). */
  | "already-adopted"
  /** A transcript with this id is already in the destination folder. */
  | "destination-exists"
  /** A job or platform record already attributes it to a real run. */
  | "attributed-to-run"
  /** The transcript could not be inspected (corrupt, vanished, not a file). */
  | "unreadable"
  /** The transcript could not be copied/moved/linked. */
  | "placement-failed"
  /** The transcript was placed but the adoption record could not be written. */
  | "record-failed";

/** One skipped session, with a reason a UI can show verbatim. */
export interface AdoptSkippedSession {
  sessionId: string;
  reason: AdoptSkipReason;
  /** Extra context (e.g. the underlying errno message, the owning agent). */
  detail?: string;
}

/** Result of a batch adoption. */
export interface AdoptSessionsResult {
  /** Session ids adopted (or, under `dryRun`, that would have been adopted). */
  adopted: string[];
  /** Every candidate that was NOT adopted, with why. */
  skipped: AdoptSkippedSession[];
}

/** Options for {@link SessionDiscoveryService.adoptSessionsFrom}. */
export interface AdoptSessionsFromOptions {
  /** Source working directory. Defaults to the agent's own working directory. */
  fromWorkingDir?: string;
  /** Placement mode. Defaults to `"copy"` — never mutate the user's originals. */
  mode?: AdoptionPlacementMode;
  /** When true, perform NO writes and report what would have happened. */
  dryRun?: boolean;
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
  sessions: Array<{ sessionId: string; mtime: Date; size: number }>;
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
   * The resolved Claude home directory this service reads transcripts from
   * (the `claudeHomePath` option, or `~/.claude` when omitted).
   *
   * Exposed so callers that need to *place* or *inspect* transcripts (e.g.
   * session adoption) resolve them against the same home this service lists
   * and reads from, rather than re-deriving `os.homedir()/.claude` — which is
   * exactly the divergence that made non-default homes list sessions that then
   * opened empty (herdctl#423).
   */
  getClaudeHomePath(): string {
    return this.claudeHomePath;
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
  ): Promise<Array<{ sessionId: string; mtime: Date; size: number }>> {
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

    const sessions: Array<{ sessionId: string; mtime: Date; size: number }> = [];
    for (const fileName of jsonlFiles) {
      const filePath = path.join(sessionDir, fileName);
      try {
        const stats = await stat(filePath);
        sessions.push({
          sessionId: fileName.replace(/\.jsonl$/, ""),
          mtime: stats.mtime,
          // Free here (we already stat'd) and the only cheap size signal an
          // adoption picker can show without parsing the transcript.
          size: stats.size,
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
   * Checks if the cached autoName is still valid (based on file mtime **and**
   * the extractor version that produced it). If not, extracts a fresh name from
   * the transcript: the best available title (`custom-title` → `ai-title` →
   * `summary`, see {@link extractSessionTitle}) and, when the transcript carries
   * no title at all, the first user message as a preview so a session shows
   * something more useful than its raw id.
   *
   * ## Why the version check matters
   *
   * The cache is authoritative on the presence of `autoNameMtime`, not of
   * `autoName` — a transcript with no name is negative-cached so it is never
   * re-streamed. That means changing the extraction logic alone would appear to
   * do NOTHING on existing data: every already-listed session still holds a
   * current-mtime entry produced by the old extractor. Requiring
   * {@link AUTO_NAME_EXTRACTOR_VERSION} to match makes each legacy entry miss
   * exactly once; it is then re-extracted and rewritten stamped, while the
   * entry's `customName` / `preview` / `usage` / `isSidechain` caches survive
   * (herdctl#423, gotcha 5).
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

    if (
      cached?.autoNameMtime &&
      cached.autoNameMtime >= fileMtime &&
      cached.autoNameVersion === AUTO_NAME_EXTRACTOR_VERSION
    ) {
      // Cache is valid AND was produced by the current extractor
      return { autoName: cached.autoName, needsUpdate: false };
    }

    // Need to extract from JSONL
    const filePath = dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId, this.claudeHomePath);
    // Titles first (a CLI transcript essentially never emits a `type:"summary"`
    // entry, but Claude Code does write `custom-title`/`ai-title` entries), then
    // fall back to the first user message.
    const title = await extractSessionTitle(filePath);
    const autoName = title || (await extractFirstMessagePreview(filePath));

    // Always signal an update so the (possibly empty) result is negative-cached:
    // record `autoNameMtime` even when nothing was found, so a nameless
    // transcript isn't re-streamed on every listing. Mirrors `resolveSidechain`,
    // which already records the mtime for negative results.
    return { autoName: autoName || undefined, needsUpdate: true };
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
      : getCliSessionFile(workingDirectory, sessionId, this.claudeHomePath);
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
      : getCliSessionFile(workingDirectory, sessionId, this.claudeHomePath);
    const isSidechain = await isSidechainSession(filePath);

    return { isSidechain, needsUpdate: true };
  }

  /**
   * Collect the transcript buckets to scan for a non-Docker agent.
   *
   * Always includes the agent's own `~/.claude/projects/{encoded-workingDir}`
   * bucket, then unions in every other `~/.claude/projects/*` bucket whose
   * **decoded** path is a strict descendant of `workingDirectory`.
   *
   * This is what makes discovery worktree-aware: Claude Code's native
   * git-worktree support relocates a session's transcript to the worktree's cwd
   * bucket when the agent enters a worktree (worktrees live at
   * `<workingDir>/.claude/worktrees/<name>`, and any subdir the agent `cd`s into
   * is likewise a descendant). Those buckets encode to different directory names,
   * so a single-bucket scan silently drops the session. Unioning descendant
   * buckets keeps it discoverable.
   *
   * Safety: the caller still gates every session through the attribution index
   * (keyed on session id), so an over-included bucket — e.g. a lossy-encoding
   * false positive from {@link encodePathForCli} (issue #148) — contributes no
   * spuriously-attributed sessions. The per-bucket listing goes through the
   * mtime-cache-backed {@link listSessionFiles}, bounding the extra readdir cost.
   *
   * Each returned bucket carries the working directory to use for that bucket's
   * transcript reads and to report as the session's `workingDirectory`. For a
   * descendant bucket this is the bucket's decoded path, which re-encodes back to
   * the same directory name (the encode/decode round-trips for any name composed
   * only of `[A-Za-z0-9-]`, as bucket names are).
   *
   * @param workingDirectory - The agent's registered working directory
   * @returns The primary bucket plus any descendant (worktree/subdir) buckets
   */
  private async collectWorktreeAwareBuckets(
    workingDirectory: string,
  ): Promise<Array<{ sessionDir: string; workingDirectory: string }>> {
    const projectsDir = path.join(this.claudeHomePath, "projects");
    const primaryEncoded = encodePathForCli(workingDirectory);

    // The primary bucket is always scanned, even if it doesn't exist yet
    // (listSessionFiles handles ENOENT).
    const buckets: Array<{ sessionDir: string; workingDirectory: string }> = [
      { sessionDir: path.join(projectsDir, primaryEncoded), workingDirectory },
    ];

    let encodedPaths: string[];
    try {
      encodedPaths = await readdir(projectsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn(
          `Failed to read projects directory for worktree discovery: ${projectsDir}: ${(error as Error).message}`,
        );
      }
      return buckets;
    }

    const resolvedWorkingDir = path.resolve(workingDirectory);
    const descendantPrefix = resolvedWorkingDir + path.sep;

    for (const encodedPath of encodedPaths) {
      // The primary bucket is already included.
      if (encodedPath === primaryEncoded) {
        continue;
      }

      // Decode the bucket name back to a path and keep it only if it's a strict
      // descendant of the working directory. `path.resolve` normalises the
      // decoded path (collapsing e.g. the `//` that `.claude` decodes to).
      const resolvedDecoded = path.resolve(decodePathForDisplay(encodedPath));
      if (!resolvedDecoded.startsWith(descendantPrefix)) {
        continue;
      }

      buckets.push({
        sessionDir: path.join(projectsDir, encodedPath),
        workingDirectory: decodePathForDisplay(encodedPath),
      });
    }

    return buckets;
  }

  /**
   * Get sessions for a specific agent.
   *
   * Returns sessions from the agent's working directory (plus any native
   * git-worktree / subdirectory buckets nested under it), attributed and
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

    // Resolve the transcript bucket(s) to scan.
    //
    // Docker agents store session files in .herdctl/docker-sessions/ on the host
    // (the container's ~/.claude/projects/ is ephemeral and gone after exit), so
    // there is a single flat bucket.
    //
    // Non-Docker agents store sessions in ~/.claude/projects/{encoded-path}/. A
    // single bucket is NOT enough: Claude Code's native git-worktree support
    // relocates a session's transcript to the worktree's cwd bucket when the
    // agent enters a worktree (worktrees live at
    // `<workingDir>/.claude/worktrees/<name>`), which encodes to a *different*
    // bucket. So union the agent's own bucket with every descendant bucket — see
    // {@link collectWorktreeAwareBuckets}. Each bucket carries the working
    // directory the transcripts in it recorded, used both to read the right file
    // during enrichment and to report the session's `workingDirectory`.
    const buckets = dockerEnabled
      ? [{ sessionDir: getDockerSessionDir(this.stateDir), workingDirectory }]
      : await this.collectWorktreeAwareBuckets(workingDirectory);

    logger.debug(`Getting sessions for agent ${agentName}`, {
      buckets: buckets.map((b) => b.sessionDir),
      dockerEnabled,
    });

    // Gather session files across all buckets, tagging each with the working
    // directory of the bucket it came from. Each bucket's listing is already
    // mtime-descending (and mtime-cache-backed), but the union must be re-sorted.
    const merged: Array<{ sessionId: string; mtime: Date; workingDirectory: string }> = [];
    for (const bucket of buckets) {
      const files = await this.listSessionFiles(bucket.sessionDir);
      for (const file of files) {
        merged.push({ ...file, workingDirectory: bucket.workingDirectory });
      }
    }
    if (merged.length === 0) {
      return [];
    }

    // Dedupe by session id. A relocated transcript should live in exactly one
    // bucket, but guard against a lingering copy (e.g. an enter/exit round-trip)
    // so a session is never double-listed. Keep the entry with the newest mtime.
    const byId = new Map<string, { sessionId: string; mtime: Date; workingDirectory: string }>();
    for (const entry of merged) {
      const existing = byId.get(entry.sessionId);
      if (!existing || entry.mtime.getTime() > existing.mtime.getTime()) {
        byId.set(entry.sessionId, entry);
      }
    }

    // Sort by mtime descending (newest first) across the unioned set so the
    // top-N `limit` enrichment picks the globally-newest sessions.
    const sessionFiles = Array.from(byId.values()).sort(
      (a, b) => b.mtime.getTime() - a.mtime.getTime(),
    );

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
      async ({ sessionId, mtime, workingDirectory: sessionWorkingDir }) => {
        try {
          return await this.enrichAgentSession(
            agentName,
            sessionId,
            mtime,
            sessionWorkingDir,
            dockerEnabled,
            attributionIndex,
          );
        } catch (error) {
          // Enrichment of ONE session must never take down the whole listing.
          // A per-entry read failure — most notably an entry that stat()s as a
          // valid `.jsonl` but is actually a directory, so open(2) succeeds and
          // read(2) throws EISDIR (issue #424) — is treated as "skip this entry"
          // rather than allowed to reject `mapWithConcurrency` (which rejects
          // like Promise.all). Logged at warn so a corrupt transcript folder is
          // diagnosable instead of just quietly smaller. Returning a null session
          // with no cache updates drops the entry from the listing.
          logger.warn(
            `Skipping unreadable session entry ${sessionId} for agent ${agentName}: ${(error as Error).message}`,
          );
          return { session: null };
        }
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
    await this.persistCacheUpdates(async () => {
      if (autoNameUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetAutoNames(agentName, autoNameUpdates);
      }
      if (previewUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetPreviews(agentName, previewUpdates);
      }
      if (sidechainUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetSidechains(agentName, sidechainUpdates);
      }
    });

    return sessions;
  }

  /**
   * Persist enrichment cache updates, tolerating a refusal to overwrite an
   * unreadable/corrupt metadata file (issue #419).
   *
   * These writes only warm derived caches (autoName / preview / sidechain /
   * usage) — never user data. A poisoned metadata file for one agent must not
   * abort a whole listing, so a {@link SessionMetadataUnreadableError} is logged
   * and swallowed: the cache simply stays cold and the next listing re-extracts.
   * The store leaves the damaged file untouched, so nothing is lost. Any other
   * error (e.g. a genuine write failure) still propagates unchanged.
   *
   * Composition with #424's per-entry guard: this wraps the batch writes that
   * run AFTER the per-entry enrichment loop, so it sits downstream of the
   * `try/catch` around {@link enrichAgentSession} (and the equivalent per-entry
   * catch in `getAllSessions`). Those guards only wrap *reads*; the writes that
   * throw `SessionMetadataUnreadableError` live out here, so the refusal reaches
   * this handler instead of being mislabelled as a skipped read entry.
   */
  private async persistCacheUpdates(writes: () => Promise<void>): Promise<void> {
    try {
      await writes();
    } catch (error) {
      if (isSessionMetadataUnreadableError(error)) {
        logger.warn(
          `Skipping session-metadata cache update for "${error.agentName}": ${error.message}`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Enrich a single agent session: resolve its sidechain flag, attribution,
   * custom/auto name, and preview into a {@link DiscoveredSession} (or a null
   * session when the entry is a sidechain / attributed to a different agent).
   *
   * Extracted from {@link getAgentSessions} so its call site can wrap it in a
   * per-entry try/catch: any read failure here (e.g. EISDIR from an entry that
   * is actually a directory, issue #424) skips just this entry instead of
   * rejecting the whole concurrent enrichment.
   */
  private async enrichAgentSession(
    agentName: string,
    sessionId: string,
    mtime: Date,
    sessionWorkingDir: string,
    dockerEnabled: boolean,
    attributionIndex: AttributionIndex,
  ): Promise<{
    session: DiscoveredSession | null;
    sidechainUpdate?: { sessionId: string; isSidechain: boolean; mtime: string };
    autoNameUpdate?: { sessionId: string; autoName?: string; mtime: string };
    previewUpdate?: { sessionId: string; preview?: string; mtime: string };
  }> {
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
      sessionWorkingDir,
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
      sessionWorkingDir,
      dockerEnabled,
    );

    // Resolve preview with caching — pass docker flag so it reads the right file
    const { preview, needsUpdate: previewNeedsUpdate } = await this.resolvePreview(
      agentName,
      sessionId,
      mtimeStr,
      sessionWorkingDir,
      dockerEnabled,
    );

    const session: DiscoveredSession = {
      sessionId,
      workingDirectory: sessionWorkingDir,
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

    for (const dir of directories) {
      const sessions: DiscoveredSession[] = [];
      const autoNameUpdates: Array<{ sessionId: string; autoName?: string; mtime: string }> = [];
      const previewUpdates: Array<{ sessionId: string; preview?: string; mtime: string }> = [];
      const sidechainUpdates: Array<{ sessionId: string; isSidechain: boolean; mtime: string }> =
        [];
      let visibleSessionCount = 0;

      for (const { sessionId, mtime } of dir.sessionFiles) {
        const mtimeStr = mtime.toISOString();
        // Tracks whether this entry was already counted as visible, so a later
        // enrichment failure (which lands in the catch below and skips the entry)
        // can back the count out — keeping `sessionCount` in sync with the
        // sessions actually returned.
        let countedAsVisible = false;

        try {
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
          countedAsVisible = true;

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
        } catch (error) {
          // Enrichment of ONE session must never take down the whole listing.
          // A per-entry read failure — most notably an entry that stat()s as a
          // valid `.jsonl` but is actually a directory, so open(2) succeeds and
          // read(2) throws EISDIR (issue #424) — is skipped rather than allowed
          // to abort this directory's loop (and, because this loop is nested in
          // the loop over directories, every *other* directory's enrichment too).
          // Logged at warn so a corrupt transcript folder is diagnosable instead
          // of just quietly smaller.
          //
          // If the entry was already counted as visible (the sidechain check
          // reads only the first line, so a transcript can pass it yet fail a
          // later whole-file read for auto-name/preview), back that count out so
          // `sessionCount` still matches the sessions actually returned.
          if (countedAsVisible) {
            visibleSessionCount--;
          }
          logger.warn(
            `Skipping unreadable session entry ${sessionId} in ${dir.decodedPath}: ${(error as Error).message}`,
          );
        }
      }

      // Batch write any cache updates for this directory
      await this.persistCacheUpdates(async () => {
        if (autoNameUpdates.length > 0) {
          await this.sessionMetadataStore.batchSetAutoNames(dir.metadataKey, autoNameUpdates);
        }
        if (previewUpdates.length > 0) {
          await this.sessionMetadataStore.batchSetPreviews(dir.metadataKey, previewUpdates);
        }
        if (sidechainUpdates.length > 0) {
          await this.sessionMetadataStore.batchSetSidechains(dir.metadataKey, sidechainUpdates);
        }
      });

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

    // Sort groups by most recent session mtime descending
    groups.sort((a, b) => {
      const aLatest = a.sessions[0]?.mtime ?? "";
      const bLatest = b.sessions[0]?.mtime ?? "";
      return bLatest.localeCompare(aLatest);
    });

    return groups;
  }

  // ===========================================================================
  // Session adoption (herdctl#423)
  // ===========================================================================

  /**
   * The transcript folder discovery scans for a working directory, resolved
   * against **this service's** Claude home.
   *
   * Adoption placement MUST go through this rather than `os.homedir()/.claude`:
   * discovery lists `<claudeHome>/projects/<encodePathForCli(cwd)>/`, so a
   * transcript placed anywhere else is adopted-but-invisible — the same
   * list/read divergence that motivated threading the home in the first place.
   */
  private transcriptDirFor(workingDirectory: string): string {
    return getCliSessionDir(workingDirectory, this.claudeHomePath);
  }

  /**
   * Scan a working directory's transcript folder and split its sessions into
   * adoption candidates and pre-classified skips.
   *
   * Shared by {@link listAdoptableSessions} (which only wants the candidates)
   * and {@link adoptSessionsFrom} (which reports the skips), so the two can
   * never disagree about what "adoptable" means.
   *
   * @param options.persistSidechainCache - Write freshly-computed sidechain
   *   flags back to the metadata cache. Defaults to `true`. A dry run passes
   *   `false`: `adoptSessionsFrom({ dryRun: true })` promises to write nothing
   *   at all, and a cache file is still a file appearing on disk.
   */
  private async scanAdoptionCandidates(
    agentName: string,
    fromWorkingDir: string,
    options?: { persistSidechainCache?: boolean },
  ): Promise<{
    sourceDir: string;
    candidates: Array<{ sessionId: string; mtime: string; size: number }>;
    skipped: AdoptSkippedSession[];
  }> {
    const sourceDir = this.transcriptDirFor(fromWorkingDir);
    const files = await this.listSessionFiles(sourceDir);

    // ONE read of the adoption store for the whole scan — a per-session
    // getAdoption() would be a file open per candidate. Keyed by session id;
    // the record (not just the id) is kept so a skip can name the owning agent.
    const adoptions = new Map<string, AdoptedSession>();
    for (const record of await listAdoptions(this.stateDir)) {
      adoptions.set(record.sessionId, record);
    }

    const attributionIndex = await this.getAttributionIndex();

    const candidates: Array<{ sessionId: string; mtime: string; size: number }> = [];
    const skipped: AdoptSkippedSession[] = [];
    const sidechainUpdates: Array<{ sessionId: string; isSidechain: boolean; mtime: string }> = [];

    for (const { sessionId, mtime, size } of files) {
      // Per-entry guard, matching the mechanism the two listing paths use
      // (issue #424): classification of ONE candidate must never take down the
      // whole scan. Notably an entry that stat()s as a valid `.jsonl` but is
      // actually a directory makes read(2) throw EISDIR. This is the adoption
      // path's single skip site — the `unreadable` reason is produced here
      // rather than by a narrower try/catch of its own, so adoption and the
      // listings agree on what "unreadable" means.
      try {
        const existing = adoptions.get(sessionId);
        if (existing) {
          skipped.push({
            sessionId,
            reason: "already-adopted",
            detail: `adopted by ${existing.agentName} at ${existing.adoptedAt}`,
          });
          continue;
        }

        // Anything the attribution index already resolves is not a *native*
        // session: a job record or a live platform binding means a real run owns
        // it, and adoption must not compete with that.
        const attribution = attributionIndex.getAttribute(sessionId);
        if (attribution.origin !== "native") {
          skipped.push({
            sessionId,
            reason: "attributed-to-run",
            detail: attribution.agentName
              ? `origin "${attribution.origin}" (agent ${attribution.agentName})`
              : `origin "${attribution.origin}"`,
          });
          continue;
        }

        const mtimeStr = mtime.toISOString();

        // Reuse the mtime-keyed sidechain cache rather than re-reading transcript
        // heads: a listing has almost certainly already classified these files.
        // This is the first thing that actually OPENS the transcript, so it is
        // where an unreadable entry usually surfaces.
        const { isSidechain, needsUpdate } = await this.resolveSidechain(
          agentName,
          sessionId,
          mtimeStr,
          fromWorkingDir,
        );
        if (needsUpdate) {
          sidechainUpdates.push({ sessionId, isSidechain, mtime: mtimeStr });
        }
        if (isSidechain) {
          skipped.push({ sessionId, reason: "sidechain" });
          continue;
        }

        candidates.push({ sessionId, mtime: mtimeStr, size });
      } catch (error) {
        // Surfaced to callers as a skip (they render the reason verbatim) AND
        // logged at warn, so a corrupt transcript folder is diagnosable the same
        // way it is from `getAgentSessions` / `getAllSessions`.
        logger.warn(
          `Skipping unreadable session entry ${sessionId} in ${fromWorkingDir}: ${(error as Error).message}`,
        );
        skipped.push({ sessionId, reason: "unreadable", detail: (error as Error).message });
      }
    }

    // Persist any freshly-computed sidechain flags. This is a pure cache write
    // — it only memoizes a fact already true of the transcript on disk — but a
    // dry run suppresses it anyway (`persistSidechainCache: false`), because
    // "dryRun writes nothing at all" is a contract we state in the JSDoc, the
    // docs and the changeset, and a caller previewing against a read-only or
    // pristine state dir would be entitled to hold us to it. The cost of
    // honouring it is one re-read of each candidate's first line on the next
    // real call.
    //
    // Wrapped in persistCacheUpdates so a metadata file that the store refuses
    // to overwrite (issue #419) degrades to a cold cache rather than aborting
    // the scan — and with it both `listAdoptableSessions` and
    // `adoptSessionsFrom`, which would otherwise fail to adopt anything because
    // one unrelated cache file is corrupt.
    if (sidechainUpdates.length > 0 && options?.persistSidechainCache !== false) {
      await this.persistCacheUpdates(() =>
        this.sessionMetadataStore.batchSetSidechains(agentName, sidechainUpdates),
      );
    }

    return { sourceDir, candidates, skipped };
  }

  /**
   * List the native, non-sidechain, not-yet-adopted sessions in a working
   * directory's transcript folder — i.e. what an agent could adopt.
   *
   * Everything is resolved against this service's injected Claude home, never
   * `os.homedir()`.
   *
   * @param agentName - The adopting agent's qualified name. Used as the metadata
   *   cache key, so titles/previews computed here are already warm under the
   *   right key once the session is adopted.
   * @param agentWorkingDirectory - The agent's own working directory (the
   *   default source, and the eventual adoption destination)
   * @param fromWorkingDir - Working directory to scan. Defaults to
   *   `agentWorkingDirectory`.
   * @returns Adoptable sessions, newest first
   */
  async listAdoptableSessions(
    agentName: string,
    agentWorkingDirectory: string,
    fromWorkingDir?: string,
  ): Promise<AdoptableSession[]> {
    const sourceCwd = fromWorkingDir ?? agentWorkingDirectory;
    const { candidates } = await this.scanAdoptionCandidates(agentName, sourceCwd);

    const autoNameUpdates: Array<{ sessionId: string; autoName?: string; mtime: string }> = [];
    const previewUpdates: Array<{ sessionId: string; preview?: string; mtime: string }> = [];

    const enriched = await mapWithConcurrency(
      candidates,
      SESSION_ENRICHMENT_CONCURRENCY,
      async ({ sessionId, mtime, size }): Promise<AdoptableSession | null> => {
        // Same per-entry guard as `getAgentSessions` (issue #424). The scan
        // above only reads each transcript's FIRST line (the sidechain check),
        // so a file can pass it and still fail the whole-file reads here —
        // without this, one bad entry rejects `mapWithConcurrency` (which
        // rejects like Promise.all) and blanks the entire picker.
        try {
          const { autoName, needsUpdate } = await this.resolveAutoName(
            agentName,
            sessionId,
            mtime,
            sourceCwd,
          );
          const { preview, needsUpdate: previewNeedsUpdate } = await this.resolvePreview(
            agentName,
            sessionId,
            mtime,
            sourceCwd,
          );
          if (needsUpdate) {
            autoNameUpdates.push({ sessionId, autoName, mtime });
          }
          if (previewNeedsUpdate) {
            previewUpdates.push({ sessionId, preview, mtime });
          }
          return { sessionId, sourceCwd, mtime, autoName, preview, sizeBytes: size };
        } catch (error) {
          logger.warn(
            `Skipping unreadable session entry ${sessionId} in ${sourceCwd}: ${(error as Error).message}`,
          );
          return null;
        }
      },
    );

    // Cache warming only — never adoption state. A refusal to overwrite an
    // unreadable metadata file (issue #419) must leave the picker populated
    // rather than throwing; the cache just stays cold and is re-extracted next
    // time.
    await this.persistCacheUpdates(async () => {
      if (autoNameUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetAutoNames(agentName, autoNameUpdates);
      }
      if (previewUpdates.length > 0) {
        await this.sessionMetadataStore.batchSetPreviews(agentName, previewUpdates);
      }
    });

    // listSessionFiles already sorts newest-first and mapWithConcurrency
    // preserves input order, so the result is already sorted.
    return enriched.filter((session): session is AdoptableSession => session !== null);
  }

  /**
   * Record that an agent has adopted an existing session, without moving any
   * files.
   *
   * Use this when the transcript is already in the agent's own transcript folder
   * (the "point an agent at a directory I've already used" case). When the
   * transcript lives elsewhere, use {@link adoptSessionsFrom}, which places it
   * where discovery looks first.
   *
   * Idempotent — re-adopting overwrites the record cleanly.
   *
   * @param agentName - The adopting agent's qualified name
   * @param sessionId - The session ID to adopt
   * @param options.sourceCwd - Working directory the transcript came from
   * @param options.workingDirectory - The agent's working directory, used only
   *   to invalidate the right listing cache
   */
  async adoptSession(
    agentName: string,
    sessionId: string,
    options?: { sourceCwd?: string; workingDirectory?: string },
  ): Promise<AdoptedSession> {
    const record = await recordAdoption(this.stateDir, sessionId, {
      agentName,
      sourceCwd: options?.sourceCwd,
    });

    // The adoption store is a source of the attribution index, so the index must
    // be rebuilt or the session stays invisible for up to the cache TTL.
    this.invalidateAttributionCache(options?.workingDirectory);

    return record;
  }

  /**
   * Release a previously adopted session.
   *
   * The transcript is left on disk; only the attribution claim is dropped, so
   * the session becomes an ordinary unattributed native session again (visible
   * in all-sessions views, invisible under the agent).
   *
   * @param sessionId - The session ID to release
   * @param options.workingDirectory - Working directory whose listing cache
   *   should also be dropped
   * @returns `true` if a record was removed, `false` if there was none
   */
  async unadoptSession(
    sessionId: string,
    options?: { workingDirectory?: string },
  ): Promise<boolean> {
    const removed = await removeAdoption(this.stateDir, sessionId);
    if (removed) {
      this.invalidateAttributionCache(options?.workingDirectory);
    }
    return removed;
  }

  /**
   * Place one transcript into the agent's transcript folder.
   *
   * `copy` (the default mode) preserves the source's mtime deliberately: mtime
   * is both the listing sort key AND the cache key for auto-name / preview /
   * sidechain, so a copy stamped "now" would shove a months-old chat to the top
   * of the user's list and needlessly invalidate three caches.
   *
   * **Every mode creates the destination exclusively**, so the never-clobber
   * guarantee is enforced by the syscall rather than by the caller's pre-check:
   * `copyFile` runs with `COPYFILE_EXCL`, and `link`/`symlink` fail `EEXIST` of
   * their own accord. `move` therefore does NOT use `rename`, which silently
   * replaces an existing destination on every platform — it hard-links and then
   * unlinks the source, which is the same net effect (one inode, mtime carried
   * for free) but refuses an occupied destination. The caller's `stat` pre-check
   * is an optimisation that produces a tidier skip reason; it is not the
   * guarantee, and on its own it would lose both to a racing writer and to a
   * destination `stat` cannot see (a dangling symlink left behind by an earlier
   * cross-device `link` placement reads as ENOENT).
   */
  private async placeTranscript(
    sourceFile: string,
    destFile: string,
    mode: AdoptionPlacementMode,
  ): Promise<void> {
    if (mode === "link") {
      try {
        await link(sourceFile, destFile);
      } catch (error) {
        // Hard links can't span filesystems (EXDEV) and some filesystems refuse
        // them outright (EPERM) — a symlink gives the same shared-inode
        // semantics the caller asked for.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EXDEV" && code !== "EPERM") throw error;
        await symlink(sourceFile, destFile);
      }
      return;
    }

    if (mode === "move") {
      let linked = false;
      try {
        await link(sourceFile, destFile);
        linked = true;
      } catch (error) {
        // Same-filesystem move: the link is the move. EXDEV/EPERM mean this
        // filesystem pair can't do it, so fall through to copy-then-unlink,
        // which is exclusive too.
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EXDEV" && code !== "EPERM") throw error;
      }

      if (linked) {
        try {
          await unlink(sourceFile);
        } catch (error) {
          // The second name landed but the original survives. Drop the link we
          // just made, or the destination folder keeps a transcript that no
          // adoption record owns and that every later retry reports as
          // `destination-exists`.
          await unlink(destFile).catch(() => {});
          throw error;
        }
        return;
      }
    }

    const stats = await stat(sourceFile);
    await copyFile(sourceFile, destFile, fsConstants.COPYFILE_EXCL);

    try {
      await utimes(destFile, stats.atime, stats.mtime);
    } catch (error) {
      // Cosmetic only: mtime drives sort order and the cache keys, not
      // correctness. Don't fail an otherwise-complete placement for it.
      logger.warn(
        `Adopted transcript ${destFile} kept its copy mtime: ${(error as Error).message}`,
      );
    }

    if (mode === "move") {
      try {
        await unlink(sourceFile);
      } catch (error) {
        await unlink(destFile).catch(() => {});
        throw error;
      }
    }
  }

  /**
   * Adopt every adoptable session found in a working directory: place the
   * transcript where discovery will look for it, then record attribution.
   *
   * Discovery finds an agent's sessions in
   * `<claudeHome>/projects/<encodePathForCli(agentWorkingDirectory)>/`. So:
   *
   * - If `fromWorkingDir` encodes to the **same folder** as the agent's own
   *   working directory, the transcript is already exactly where discovery
   *   looks: **no file movement happens at all**, in any mode — only the
   *   attribution record is written. (Note this is compared on the resolved
   *   folder, not the path string, because `encodePathForCli` is lossy: two
   *   different directories can legitimately share one folder.)
   * - Otherwise the transcript is copied/moved/linked into the agent's folder.
   *
   * `mode` defaults to `"copy"`: the user's original `~/.claude` transcripts are
   * never mutated unless they opt in.
   *
   * Failures are per-session, never fatal: an unreadable or vanished transcript
   * is reported in `skipped` and the batch continues.
   *
   * @param agentName - The adopting agent's qualified name
   * @param agentWorkingDirectory - The agent's own working directory (the
   *   destination, and the default source)
   * @param options - Source directory, placement mode, dry-run
   */
  async adoptSessionsFrom(
    agentName: string,
    agentWorkingDirectory: string,
    options?: AdoptSessionsFromOptions,
  ): Promise<AdoptSessionsResult> {
    const mode = options?.mode ?? "copy";
    const dryRun = options?.dryRun ?? false;
    const fromWorkingDir = options?.fromWorkingDir ?? agentWorkingDirectory;

    const { sourceDir, candidates, skipped } = await this.scanAdoptionCandidates(
      agentName,
      fromWorkingDir,
      // A dry run must not even warm the sidechain cache — see the contract
      // note on this method and on `scanAdoptionCandidates`.
      { persistSidechainCache: !dryRun },
    );

    const destDir = this.transcriptDirFor(agentWorkingDirectory);
    // Compare the resolved *folders*, not the working-directory strings: the
    // encoding is lossy, so distinct cwds can share one transcript folder — and
    // when they do, copying a file onto itself is both pointless and unsafe.
    const inPlace = path.resolve(sourceDir) === path.resolve(destDir);

    const adopted: string[] = [];

    if (!inPlace && !dryRun && candidates.length > 0) {
      await mkdir(destDir, { recursive: true });
    }

    for (const { sessionId } of candidates) {
      const sourceFile = path.join(sourceDir, `${sessionId}.jsonl`);
      const destFile = path.join(destDir, `${sessionId}.jsonl`);

      if (!inPlace) {
        // Never clobber: an existing transcript with this id in the destination
        // belongs to the agent already and may have turns the source doesn't.
        //
        // This is the cheap pre-check, NOT the guarantee: it can't see a
        // destination `stat` fails on (a dangling symlink) and it can't see a
        // writer that arrives after it. `placeTranscript` creates the
        // destination exclusively in every mode, and an EEXIST from it is
        // mapped back to the same skip reason below.
        let destExists = true;
        try {
          await stat(destFile);
        } catch {
          destExists = false;
        }
        if (destExists) {
          skipped.push({ sessionId, reason: "destination-exists", detail: destFile });
          continue;
        }

        if (!dryRun) {
          try {
            await this.placeTranscript(sourceFile, destFile, mode);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            skipped.push({
              sessionId,
              // A destination the pre-check couldn't see — a racing writer, or
              // a dangling symlink — is still a "don't clobber" outcome, not a
              // mystery failure.
              reason: code === "EEXIST" ? "destination-exists" : "placement-failed",
              detail: `${mode}: ${(error as Error).message}`,
            });
            continue;
          }
        }
      }

      if (!dryRun) {
        try {
          await recordAdoption(this.stateDir, sessionId, {
            agentName,
            // Provenance: where this transcript actually came from, which the
            // destination folder can no longer tell you after a copy.
            sourceCwd: fromWorkingDir,
          });
        } catch (error) {
          skipped.push({
            sessionId,
            reason: "record-failed",
            detail: (error as Error).message,
          });
          continue;
        }
      }

      adopted.push(sessionId);
    }

    // Newly adopted sessions are invisible until BOTH the attribution index
    // (which reads the adoption store) and the destination directory listing are
    // rebuilt — otherwise they only appear once the 30s TTL lapses.
    if (!dryRun && adopted.length > 0) {
      this.invalidateWorkingDirectory(agentWorkingDirectory);
      if (!inPlace) {
        // A move emptied part of the source folder; a copy didn't, but its
        // listing is now stale w.r.t. adoption state either way.
        this.invalidateWorkingDirectory(fromWorkingDir);
      }
    }

    logger.debug(
      `adoptSessionsFrom(${agentName}): ${dryRun ? "would adopt" : "adopted"} ${adopted.length}, skipped ${skipped.length}`,
      { fromWorkingDir, mode, inPlace },
    );

    return { adopted, skipped };
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
      : getCliSessionFile(workingDirectory, sessionId, this.claudeHomePath);
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
    await this.persistCacheUpdates(() =>
      this.sessionMetadataStore.setUsage(agentName, sessionId, usage, mtimeStr),
    );
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
