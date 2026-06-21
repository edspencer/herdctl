/**
 * CLI session path utilities - locate Claude CLI session files
 *
 * The Claude CLI stores session files in ~/.claude/projects/ with workspace paths
 * encoded by replacing every non-alphanumeric character with a hyphen. These
 * utilities help locate CLI session directories and specific session files.
 */

import { readdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

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
 * Find the newest session file in a CLI session directory
 *
 * Scans the session directory for .jsonl files and returns the path to the
 * most recently modified one. This is useful when spawning a new CLI session
 * without knowing the session ID upfront - the newest file is typically the
 * one just created.
 *
 * @example
 * ```typescript
 * const sessionDir = getCliSessionDir('/Users/ed/Code/myproject');
 * const newestFile = await findNewestSessionFile(sessionDir);
 * // => '/Users/ed/.claude/projects/-Users-ed-Code-myproject/abc123.jsonl'
 * ```
 *
 * @param sessionDir - Absolute path to CLI session directory
 * @returns Promise resolving to path of newest .jsonl file
 * @throws {Error} If directory doesn't exist or contains no .jsonl files
 */
async function findNewestSessionFile(sessionDir: string): Promise<string> {
  try {
    const files = await readdir(sessionDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) {
      throw new Error(`No session files found in ${sessionDir}`);
    }

    // Get stats for all .jsonl files
    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(sessionDir, file);
        const stats = await stat(filePath);
        return { path: filePath, mtime: stats.mtime };
      }),
    );

    // Sort by modification time (newest first)
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    return fileStats[0].path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Session directory does not exist: ${sessionDir}`);
    }
    throw error;
  }
}

/**
 * Wait for a new session file to be created after a given timestamp
 *
 * Polls the session directory until a new .jsonl file appears that was
 * created after the specified start time. This prevents picking up old
 * session files when spawning a new CLI session.
 *
 * @example
 * ```typescript
 * const startTime = Date.now();
 * // ... spawn claude CLI ...
 * const sessionFile = await waitForNewSessionFile(sessionDir, startTime);
 * // => '/Users/ed/.claude/projects/-Users-ed-Code-myproject/new-session.jsonl'
 * ```
 *
 * @param sessionDir - Absolute path to CLI session directory
 * @param startTime - Timestamp (ms) before which files should be ignored
 * @param options - Optional configuration
 * @returns Promise resolving to path of newly created session file
 * @throws {Error} If timeout exceeded or directory doesn't exist
 */
export async function waitForNewSessionFile(
  sessionDir: string,
  startTime: number,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const { timeoutMs = 5000, pollIntervalMs = 100 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const files = await readdir(sessionDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      // Find files created after startTime
      const newFiles: Array<{ path: string; mtime: Date }> = [];
      for (const file of jsonlFiles) {
        const filePath = path.join(sessionDir, file);
        const stats = await stat(filePath);

        // Check if file was modified after startTime
        if (stats.mtime.getTime() > startTime) {
          newFiles.push({ path: filePath, mtime: stats.mtime });
        }
      }

      // Return the newest file created after startTime
      if (newFiles.length > 0) {
        newFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        return newFiles[0].path;
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

  throw new Error(`Timeout waiting for new session file in ${sessionDir} (waited ${timeoutMs}ms)`);
}
