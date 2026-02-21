/**
 * CLI session path utilities - locate Claude CLI session files
 *
 * The Claude CLI stores session files in ~/.claude/projects/ with workspace paths
 * encoded by replacing slashes with hyphens. These utilities help locate CLI session
 * directories and specific session files.
 */

import { readdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Encode a workspace path for CLI session storage
 *
 * The CLI encodes workspace paths by replacing all path separators with hyphens.
 * Works on both Unix (/) and Windows (\) paths.
 *
 * @example
 * ```typescript
 * encodePathForCli('/Users/ed/Code/myproject')
 * // => '-Users-ed-Code-myproject'
 *
 * encodePathForCli('C:\\Users\\ed\\Code\\myproject')
 * // => 'C:-Users-ed-Code-myproject'
 * ```
 *
 * @param absolutePath - Absolute path to workspace directory
 * @returns Encoded path with slashes replaced by hyphens
 */
export function encodePathForCli(absolutePath: string): string {
  // Replace both forward slashes (Unix) and backslashes (Windows)
  return absolutePath.replace(/[/\\]/g, "-");
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
 */
export function getCliSessionFile(workspacePath: string, sessionId: string): string {
  const sessionDir = getCliSessionDir(workspacePath);
  return path.join(sessionDir, `${sessionId}.jsonl`);
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
