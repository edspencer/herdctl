/**
 * Path safety utilities for state file operations
 *
 * Provides defense-in-depth protection against path traversal attacks
 * when constructing file paths from user-controlled identifiers.
 */

import { resolve, join } from "node:path";

/**
 * Error thrown when a path traversal attempt is detected
 */
export class PathTraversalError extends Error {
  public readonly baseDir: string;
  public readonly identifier: string;
  public readonly resultPath: string;

  constructor(baseDir: string, identifier: string, resultPath: string) {
    super(
      `Path traversal detected: identifier "${identifier}" would resolve to "${resultPath}" which is outside base directory "${baseDir}"`,
    );
    this.name = "PathTraversalError";
    this.baseDir = baseDir;
    this.identifier = identifier;
    this.resultPath = resultPath;
  }
}

/**
 * Pattern for valid identifiers (agent names, qualified names, etc.)
 * Must start with alphanumeric, can contain alphanumeric, underscore, hyphen, dot.
 * Dots are allowed for qualified names (e.g., "herdctl.security-auditor").
 * Must not start or end with a dot, and must not contain consecutive dots.
 */
export const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/;

/**
 * Validate that an identifier is safe for use in file paths
 *
 * @param identifier - The identifier to validate (agent name, etc.)
 * @returns true if valid, false if not
 */
export function isValidIdentifier(identifier: string): boolean {
  return SAFE_IDENTIFIER_PATTERN.test(identifier);
}

/**
 * Build a safe file path within a base directory
 *
 * This function provides defense-in-depth by:
 * 1. Checking the identifier against a safe pattern
 * 2. Resolving the final path and verifying it stays within the base directory
 *
 * @param baseDir - The base directory that the file must stay within
 * @param identifier - The user-provided identifier (agent name, etc.)
 * @param extension - File extension including the dot (e.g., ".json", ".yaml")
 * @returns The safe, resolved file path
 * @throws PathTraversalError if the path would escape the base directory
 *
 * @example
 * ```typescript
 * const filePath = buildSafeFilePath("/home/user/.herdctl/sessions", "my-agent", ".json");
 * // Returns: "/home/user/.herdctl/sessions/my-agent.json"
 *
 * // This would throw PathTraversalError:
 * buildSafeFilePath("/home/user/.herdctl/sessions", "../../../etc/passwd", ".json");
 * ```
 */
export function buildSafeFilePath(baseDir: string, identifier: string, extension: string): string {
  // First line of defense: validate identifier format
  if (!isValidIdentifier(identifier)) {
    throw new PathTraversalError(
      baseDir,
      identifier,
      `(invalid identifier: must match ${SAFE_IDENTIFIER_PATTERN})`,
    );
  }

  // Construct the file path
  const fileName = `${identifier}${extension}`;
  const filePath = join(baseDir, fileName);

  // Second line of defense: verify the resolved path stays within baseDir
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(filePath);

  if (!resolvedPath.startsWith(resolvedBase + "/") && resolvedPath !== resolvedBase) {
    throw new PathTraversalError(baseDir, identifier, resolvedPath);
  }

  return filePath;
}
