/**
 * CLI session path utilities - locate Claude CLI session files
 *
 * The Claude CLI stores session files in ~/.claude/projects/ with workspace paths
 * encoded by replacing slashes with hyphens. These utilities help locate CLI session
 * directories and specific session files.
 */

import * as path from "node:path";
import * as os from "node:os";

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
export function getCliSessionFile(
  workspacePath: string,
  sessionId: string,
): string {
  const sessionDir = getCliSessionDir(workspacePath);
  return path.join(sessionDir, `${sessionId}.jsonl`);
}
