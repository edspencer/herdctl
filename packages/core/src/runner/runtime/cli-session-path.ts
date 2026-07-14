/**
 * CLI session path utilities - locate Claude CLI session files
 *
 * The Claude CLI stores session files in ~/.claude/projects/ with workspace paths
 * encoded by replacing every non-alphanumeric character with a hyphen. These
 * utilities help locate CLI session directories and specific session files.
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("CLISessionPath");

/**
 * Maximum length of an encoded path before Claude Code truncates it.
 *
 * Determined empirically from Claude Code's bundled encoder (the `Aj` function):
 * when the hyphen-encoded path exceeds this length it is sliced to this length
 * and a stable hash of the *original* path is appended (`<slice>-<hash>`).
 */
const MAX_ENCODED_LENGTH = 200;

/**
 * Stable hash matching Claude Code's path-shortening hash.
 *
 * This is the djb2-style accumulator Claude Code uses (its `_wH` helper):
 * `h = (h << 5) - h + charCode | 0`, taken as `Math.abs(h).toString(36)`.
 * It is only used when the encoded path exceeds {@link MAX_ENCODED_LENGTH},
 * to keep our output byte-for-byte identical to Claude Code's directory names.
 */
function hashPathForCli(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Encode a workspace path for CLI session storage
 *
 * Matches Claude Code's exact cwd → transcript-directory encoding: every
 * character that is **not** `[A-Za-z0-9]` is replaced with a hyphen. This
 * covers path separators (`/`, `\`), dots (`.`), underscores (`_`), `@`, `+`,
 * spaces, and every other non-alphanumeric character. If the resulting string
 * exceeds {@link MAX_ENCODED_LENGTH} characters, it is truncated to that length
 * and a stable hash of the original path is appended, exactly as Claude Code does.
 *
 * Previously this only replaced path separators, so a cwd containing a `.` (or
 * `_`, etc.) resolved to the wrong `~/.claude/projects/<encoded>` directory and
 * session discovery silently returned nothing. This aligns herdctl with Claude
 * Code's actual behavior.
 *
 * ## Collision warning (issue #148)
 *
 * This encoding is intentionally **lossy and non-invertible**, and is shared
 * with Claude Code on purpose — herdctl must resolve to the *exact same*
 * `~/.claude/projects/<dir>` that Claude Code wrote, so we cannot switch to a
 * reversible scheme (e.g. `encodeURIComponent` / base64url) without pointing at
 * a directory that does not exist.
 *
 * Because every non-alphanumeric character (including `/` and `-`) collapses to
 * `-`, multiple *different* working directories can encode to the **same**
 * transcript directory. For example:
 *
 * ```text
 * /a/b-c   -> -a-b-c
 * /a-b/c   -> -a-b-c
 * /a/b/c   -> -a-b-c
 * ```
 *
 * This is not a herdctl-specific defect: Claude Code itself stores the
 * transcripts for all three of those directories in the single `-a-b-c`
 * directory (verified empirically against `~/.claude/projects/` with Claude Code
 * 2.1.x). There is therefore no disambiguation scheme to "match" at the
 * directory-name level.
 *
 * The transcript JSONL files are nonetheless self-identifying: every Claude Code
 * session records the real `cwd` it ran in. Callers that must attribute a
 * session to a *specific* working directory (rather than just to the shared
 * encoded directory) should disambiguate by reading that field — see
 * {@link readSessionCwd} and {@link sessionBelongsToWorkingDirectory}.
 *
 * @example
 * ```typescript
 * encodePathForCli('/Users/ed/Code/myproject')
 * // => '-Users-ed-Code-myproject'
 *
 * encodePathForCli('/Users/ed/Code/my.project')
 * // => '-Users-ed-Code-my-project'   (dot becomes a hyphen)
 *
 * encodePathForCli('C:\\Users\\ed\\Code\\myproject')
 * // => 'C--Users-ed-Code-myproject'  (colon and backslashes become hyphens)
 * ```
 *
 * @param absolutePath - Absolute path to workspace directory
 * @returns Encoded path with all non-alphanumeric characters replaced by hyphens
 */
export function encodePathForCli(absolutePath: string): string {
  // Replace every non-alphanumeric character with a hyphen, matching Claude Code.
  const encoded = absolutePath.replace(/[^A-Za-z0-9]/g, "-");
  if (encoded.length <= MAX_ENCODED_LENGTH) {
    return encoded;
  }
  // Truncate and append a stable hash of the original path, as Claude Code does.
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${hashPathForCli(absolutePath)}`;
}

/**
 * Get the CLI session directory for a workspace
 *
 * Returns the directory where Claude CLI stores sessions for the given workspace.
 * Format: ~/.claude/projects/{encoded-workspace-path}/
 *
 * @example
 * ```typescript
 * getCliSessionDir('/Users/ed/Code/myproject')
 * // => '/Users/ed/.claude/projects/-Users-ed-Code-myproject'
 * ```
 *
 * @param workspacePath - Absolute path to workspace directory
 * @returns Absolute path to CLI session storage directory
 */
export function getCliSessionDir(workspacePath: string): string {
  const encoded = encodePathForCli(workspacePath);
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

/**
 * Get the path to a specific CLI session file
 *
 * Returns the full path to a session's JSONL file in the CLI session directory.
 * Format: ~/.claude/projects/{encoded-workspace-path}/{session-id}.jsonl
 *
 * @example
 * ```typescript
 * getCliSessionFile(
 *   '/Users/ed/Code/myproject',
 *   'dda6da5b-8788-4990-a582-d5a2c63fbfba'
 * )
 * // => '/Users/ed/.claude/projects/-Users-ed-Code-myproject/dda6da5b-8788-4990-a582-d5a2c63fbfba.jsonl'
 * ```
 *
 * @param workspacePath - Absolute path to workspace directory
 * @param sessionId - CLI session ID (UUID format)
 * @returns Absolute path to session JSONL file
 * @throws {Error} If sessionId contains invalid characters
 */
export function getCliSessionFile(workspacePath: string, sessionId: string): string {
  // Validate sessionId to prevent path traversal
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  const sessionDir = getCliSessionDir(workspacePath);
  return path.join(sessionDir, `${sessionId}.jsonl`);
}

/**
 * Read the real working directory (`cwd`) recorded inside a CLI transcript file.
 *
 * Because {@link encodePathForCli} is lossy, two different working directories
 * can share one `~/.claude/projects/<dir>` transcript directory (see the
 * collision warning on {@link encodePathForCli}, issue #148). The encoded
 * directory name therefore cannot tell you which working directory a given
 * session belongs to.
 *
 * Claude Code records the authoritative `cwd` on its `user`/`assistant` (and
 * related) JSONL entries, so this function streams the transcript and returns
 * the first `cwd` string it finds. This is the non-lossy source of truth used to
 * disambiguate colliding directories.
 *
 * The file is read line-by-line and parsing stops at the first entry that
 * carries a `cwd`, so this stays cheap even for large transcripts.
 *
 * @param sessionFilePath - Absolute path to a `.jsonl` transcript file
 * @returns The recorded `cwd`, or `null` if the file is missing/unreadable or no
 *   entry records a `cwd`
 */
export async function readSessionCwd(sessionFilePath: string): Promise<string | null> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  let rl: readline.Interface | undefined;
  try {
    stream = createReadStream(sessionFilePath, { encoding: "utf8" });
    // Surface stream errors (e.g. ENOENT) as a rejected promise rather than an
    // unhandled error event.
    const streamErrored = new Promise<never>((_resolve, reject) => {
      stream?.once("error", reject);
    });
    rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const readLoop = (async () => {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof parsed.cwd === "string" && parsed.cwd.length > 0) {
          return parsed.cwd;
        }
      }
      return null;
    })();

    return await Promise.race([readLoop, streamErrored]);
  } catch {
    return null;
  } finally {
    rl?.close();
    stream?.destroy();
  }
}

/**
 * Determine whether a transcript file actually belongs to a given working
 * directory, disambiguating directories that collide under
 * {@link encodePathForCli} (issue #148).
 *
 * Uses the authoritative `cwd` recorded in the transcript (via
 * {@link readSessionCwd}) rather than the lossy encoded directory name.
 *
 * Behaviour when the transcript does not record a `cwd` (e.g. an empty or
 * malformed file) is controlled by `defaultWhenUnknown`. The default is `true`
 * — we keep the prior, collision-unaware behaviour of treating an unidentifiable
 * session as belonging to the directory it was filed under, so this helper only
 * ever *narrows* attribution when it has positive evidence of a mismatch.
 *
 * @param sessionFilePath - Absolute path to a `.jsonl` transcript file
 * @param workingDirectory - The working directory to test membership against
 * @param options.defaultWhenUnknown - Result when the transcript records no
 *   `cwd`. Defaults to `true`.
 * @returns `true` if the session belongs to `workingDirectory` (or its `cwd` is
 *   unknown and `defaultWhenUnknown` is `true`), `false` otherwise
 */
export async function sessionBelongsToWorkingDirectory(
  sessionFilePath: string,
  workingDirectory: string,
  options: { defaultWhenUnknown?: boolean } = {},
): Promise<boolean> {
  const { defaultWhenUnknown = true } = options;
  const cwd = await readSessionCwd(sessionFilePath);
  if (cwd === null) {
    return defaultWhenUnknown;
  }
  return path.resolve(cwd) === path.resolve(workingDirectory);
}

/**
 * Get the docker-sessions directory path
 *
 * Docker sessions are stored in .herdctl/docker-sessions/ on the host.
 * The container runner mounts the Claude session directory from the container
 * to this host path so session files survive container exit.
 *
 * @param stateDir - Path to the .herdctl state directory
 * @returns Absolute path to the docker-sessions directory
 */
export function getDockerSessionDir(stateDir: string): string {
  return path.join(stateDir, "docker-sessions");
}

/**
 * Get the path to a specific Docker session file
 *
 * Docker sessions are stored flat in .herdctl/docker-sessions/{session-id}.jsonl
 * (not nested by workspace path like CLI sessions).
 *
 * @param stateDir - Path to the .herdctl state directory
 * @param sessionId - Session ID (UUID format)
 * @returns Absolute path to the Docker session JSONL file
 * @throws {Error} If sessionId contains invalid characters
 */
export function getDockerSessionFile(stateDir: string, sessionId: string): string {
  // Validate sessionId to prevent path traversal
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  return path.join(getDockerSessionDir(stateDir), `${sessionId}.jsonl`);
}

/**
 * Snapshot the set of `.jsonl` session filenames currently present in a session
 * directory.
 *
 * Callers take this snapshot *immediately before* spawning a CLI subprocess that
 * will create a new session file, then pass it to {@link waitForNewSessionFile}
 * as `knownFiles`. The freshly-created session is then identified by **set
 * difference** (a filename not in the snapshot) rather than by an mtime
 * heuristic — see the issue-#357 note on {@link waitForNewSessionFile}.
 *
 * Filenames (basenames, e.g. `abc123.jsonl`), not full paths, are returned so
 * the set can be compared directly against a later `readdir`.
 *
 * @param sessionDir - Absolute path to CLI session directory
 * @returns Set of `.jsonl` filenames present now; empty if the directory does
 *   not exist yet or cannot be read
 */
export async function snapshotSessionFiles(sessionDir: string): Promise<Set<string>> {
  try {
    const files = await readdir(sessionDir);
    return new Set(files.filter((f) => f.endsWith(".jsonl")));
  } catch (error) {
    // Directory may not exist yet (first-ever session for this cwd) — treat as
    // an empty snapshot. Any other error is also non-fatal here; the caller
    // still polls for the new file.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.debug(`Could not snapshot session dir ${sessionDir}: ${error}`);
    }
    return new Set();
  }
}

/**
 * Given a list of `.jsonl` filenames in a session directory, return the absolute
 * path of the one with the newest mtime (or `null` if the list is empty or none
 * could be stat'd).
 */
async function newestSessionFileByMtime(
  sessionDir: string,
  fileNames: string[],
): Promise<string | null> {
  const stats: Array<{ path: string; mtime: Date }> = [];
  for (const file of fileNames) {
    const filePath = path.join(sessionDir, file);
    try {
      const s = await stat(filePath);
      stats.push({ path: filePath, mtime: s.mtime });
    } catch {
      // File vanished between readdir and stat — skip it.
    }
  }
  if (stats.length === 0) return null;
  stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return stats[0].path;
}

/**
 * Wait for a new session file to be created after a CLI subprocess is spawned.
 *
 * Polls the session directory until the freshly-created `.jsonl` appears, then
 * returns its path so the caller can adopt its session id.
 *
 * ## Identifying the *right* new file (issue #357)
 *
 * When two agents share a working directory they also share a single
 * `~/.claude/projects/<encoded-cwd>/` session directory. If agent A is
 * *streaming* a turn (continuously appending to its own transcript) while agent
 * B spawns a fresh `resume:null` turn, agent A's file also has
 * `mtime > startTime` — and can even be *newer* than the file B just created.
 * The old mtime-after-`startTime` heuristic then mis-resolved B's turn to **A's**
 * session id, corrupting job attribution and making A's chat vanish from its
 * owner's list until a later turn re-attributed it.
 *
 * The robust fix is **set difference**: the caller snapshots the session
 * directory's `.jsonl` filenames *before* spawning (via
 * {@link snapshotSessionFiles}) and passes them as `knownFiles`. The new session
 * is then the file whose *name* is new since that snapshot — which a co-located
 * agent's pre-existing (merely-appended-to) file can never be, regardless of
 * mtime. The mtime heuristic is retained only as a fallback for when no
 * snapshot is supplied, or defensively if no new-named file ever appears.
 *
 * @example
 * ```typescript
 * const knownFiles = await snapshotSessionFiles(sessionDir);
 * const startTime = Date.now();
 * // ... spawn claude CLI ...
 * const sessionFile = await waitForNewSessionFile(sessionDir, startTime, { knownFiles });
 * // => '/Users/ed/.claude/projects/-Users-ed-Code-myproject/new-session.jsonl'
 * ```
 *
 * @param sessionDir - Absolute path to CLI session directory
 * @param startTime - Timestamp (ms) before which files should be ignored (used
 *   only by the mtime fallback path)
 * @param options - Optional configuration
 * @param options.knownFiles - Snapshot of `.jsonl` filenames present *before*
 *   spawning. When supplied, the new session is identified by set difference
 *   against this set (the collision-proof path); when omitted, the legacy
 *   mtime-after-`startTime` heuristic is used.
 * @returns Promise resolving to path of newly created session file
 * @throws {Error} If timeout exceeded or directory doesn't exist
 */
export async function waitForNewSessionFile(
  sessionDir: string,
  startTime: number,
  options: { timeoutMs?: number; pollIntervalMs?: number; knownFiles?: ReadonlySet<string> } = {},
): Promise<string> {
  const { timeoutMs = 5000, pollIntervalMs = 100, knownFiles } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const files = await readdir(sessionDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      if (knownFiles) {
        // Primary path (issue #357): the new session is a file whose NAME did
        // not exist before we spawned. This is immune to a co-located agent
        // concurrently appending to its own (older) session in a shared dir.
        const brandNew = jsonlFiles.filter((f) => !knownFiles.has(f));
        if (brandNew.length > 0) {
          // Normally exactly one; if several appeared (e.g. multiple co-located
          // spawns raced), the newest is ours.
          const newest = await newestSessionFileByMtime(sessionDir, brandNew);
          if (newest) return newest;
        }
        // No new-named file yet — keep polling. Do NOT fall through to the mtime
        // heuristic here, or we would grab a co-located agent's streaming file.
      } else {
        // Legacy path: no snapshot supplied — find files touched after startTime
        // and return the newest.
        const newFiles = jsonlFiles.map((f) => path.join(sessionDir, f));
        const stats: Array<{ path: string; mtime: Date }> = [];
        for (const filePath of newFiles) {
          const s = await stat(filePath);
          if (s.mtime.getTime() > startTime) {
            stats.push({ path: filePath, mtime: s.mtime });
          }
        }
        if (stats.length > 0) {
          stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
          return stats[0].path;
        }
      }
    } catch (error) {
      // Directory might not exist yet - keep polling
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Deadline exceeded. If we were using the set-difference path and no new-named
  // file ever appeared, fall back once to the mtime heuristic before giving up —
  // this preserves the old behaviour for genuinely degenerate cases (e.g. the
  // CLI reused a filename) at the cost of the collision risk the snapshot avoids.
  if (knownFiles) {
    try {
      const files = await readdir(sessionDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      const candidates: string[] = [];
      for (const file of jsonlFiles) {
        const s = await stat(path.join(sessionDir, file));
        if (s.mtime.getTime() > startTime) candidates.push(file);
      }
      const newest = await newestSessionFileByMtime(sessionDir, candidates);
      if (newest) {
        logger.warn(
          `No new session file appeared in ${sessionDir} within ${timeoutMs}ms; ` +
            `falling back to newest-by-mtime (${path.basename(newest)}). In a shared ` +
            `session directory this may mis-attribute a co-located agent's session (issue #357).`,
        );
        return newest;
      }
    } catch {
      // fall through to the timeout error
    }
  }

  throw new Error(`Timeout waiting for new session file in ${sessionDir} (waited ${timeoutMs}ms)`);
}
