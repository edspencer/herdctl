/**
 * Source Specifier Parser
 *
 * Parses source strings into structured specifier objects for agent distribution.
 *
 * Supported formats:
 * - `github:user/repo` → GitHub source (explicit prefix)
 * - `github:user/repo@v1.0.0` → GitHub source with tag/branch/commit ref
 * - `user/repo` → GitHub source (shorthand, equivalent to `github:user/repo`)
 * - `user/repo@v1.0.0` → GitHub source shorthand with ref
 * - `./local/path` or `../path` or `/absolute/path` → Local source
 *
 * @example
 * ```typescript
 * const specifier = parseSourceSpecifier("github:user/repo@v1.0.0");
 * // { type: 'github', owner: 'user', repo: 'repo', ref: 'v1.0.0' }
 *
 * const shorthand = parseSourceSpecifier("user/repo");
 * // { type: 'github', owner: 'user', repo: 'repo' }
 *
 * const local = parseSourceSpecifier("./my-agents/custom");
 * // { type: 'local', path: '/resolved/absolute/path/my-agents/custom' }
 * ```
 */

import * as path from "path";

import { FleetManagerError } from "../fleet-manager/errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * GitHub source specifier.
 * Points to a GitHub repository, optionally at a specific ref (tag, branch, or commit).
 */
export interface GitHubSource {
  type: "github";
  /** GitHub username or organization */
  owner: string;
  /** Repository name */
  repo: string;
  /** Optional ref: tag, branch name, or commit SHA */
  ref?: string;
}

/**
 * Local source specifier.
 * Points to a local directory path (resolved to absolute).
 */
export interface LocalSource {
  type: "local";
  /** Absolute path to the local directory */
  path: string;
}

/**
 * Union type for all source specifier variants.
 */
export type SourceSpecifier = GitHubSource | LocalSource;

// =============================================================================
// Error Class
// =============================================================================

/**
 * Error thrown when a source specifier cannot be parsed.
 */
export class SourceParseError extends FleetManagerError {
  constructor(
    message: string,
    public readonly source: string,
  ) {
    super(message, { code: "SOURCE_PARSE_ERROR" });
    this.name = "SourceParseError";
  }
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Pattern for validating GitHub owner/repo names.
 * GitHub allows: alphanumeric, hyphens, underscores, and dots.
 * Cannot start with a dot or end with .git.
 * Maximum 100 characters for owner, 100 for repo.
 *
 * @see https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
 */
const GITHUB_NAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$|^[a-zA-Z0-9]$/;

/**
 * Maximum length for GitHub owner/repo names.
 */
const MAX_GITHUB_NAME_LENGTH = 100;

// =============================================================================
// Parser Implementation
// =============================================================================

/**
 * Validates a GitHub owner or repository name.
 *
 * @param name - The name to validate
 * @param field - Field name for error messages ("owner" or "repository")
 * @param source - Original source string for error context
 * @throws SourceParseError if the name is invalid
 */
function validateGitHubName(name: string, field: string, source: string): void {
  if (!name) {
    throw new SourceParseError(`GitHub ${field} cannot be empty`, source);
  }

  if (name.length > MAX_GITHUB_NAME_LENGTH) {
    throw new SourceParseError(
      `GitHub ${field} "${name}" exceeds maximum length of ${MAX_GITHUB_NAME_LENGTH} characters`,
      source,
    );
  }

  if (!GITHUB_NAME_PATTERN.test(name)) {
    throw new SourceParseError(
      `Invalid GitHub ${field} "${name}". ${field === "owner" ? "Owner" : "Repository"} names may only contain alphanumeric characters, hyphens, underscores, and dots, and cannot start with a dot.`,
      source,
    );
  }

  // Additional check: cannot end with .git (GitHub convention)
  if (name.endsWith(".git")) {
    throw new SourceParseError(`GitHub ${field} "${name}" cannot end with ".git"`, source);
  }
}

/**
 * Parses a GitHub source specifier.
 *
 * @param value - The value after "github:" prefix (e.g., "user/repo" or "user/repo@v1.0.0")
 * @param source - Original source string for error context
 * @returns Parsed GitHubSource
 * @throws SourceParseError if the format is invalid
 */
function parseGitHubSource(value: string, source: string): GitHubSource {
  if (!value) {
    throw new SourceParseError(
      'GitHub source requires owner/repo format (e.g., "github:user/repo")',
      source,
    );
  }

  // Split ref if present: user/repo@ref
  let repoPath = value;
  let ref: string | undefined;

  const atIndex = value.indexOf("@");
  if (atIndex !== -1) {
    repoPath = value.slice(0, atIndex);
    ref = value.slice(atIndex + 1);

    if (!ref) {
      throw new SourceParseError(
        'GitHub ref cannot be empty after "@" (e.g., "github:user/repo@v1.0.0")',
        source,
      );
    }
  }

  // Split owner/repo
  const slashIndex = repoPath.indexOf("/");
  if (slashIndex === -1) {
    throw new SourceParseError(
      `Invalid GitHub source format "${source}". Expected "github:owner/repo" format.`,
      source,
    );
  }

  const owner = repoPath.slice(0, slashIndex);
  const repo = repoPath.slice(slashIndex + 1);

  // Check for extra slashes (nested paths not supported)
  if (repo.includes("/")) {
    throw new SourceParseError(
      `Invalid GitHub source format "${source}". Nested paths are not supported; use "github:owner/repo" format.`,
      source,
    );
  }

  // Validate owner and repo
  validateGitHubName(owner, "owner", source);
  validateGitHubName(repo, "repository", source);

  const result: GitHubSource = { type: "github", owner, repo };
  if (ref) {
    result.ref = ref;
  }

  return result;
}

/**
 * Parses a local path source specifier.
 *
 * @param pathStr - The path string (relative or absolute)
 * @returns Parsed LocalSource with absolute path
 */
function parseLocalSource(pathStr: string): LocalSource {
  // Resolve to absolute path
  const absolutePath = path.resolve(pathStr);

  return {
    type: "local",
    path: absolutePath,
  };
}

/**
 * Determines if a source string represents a local path.
 *
 * @param source - The source string to check
 * @returns true if the source is a local path
 */
function isLocalPath(source: string): boolean {
  return (
    source.startsWith("./") ||
    source.startsWith("../") ||
    source.startsWith("/") ||
    // Windows absolute paths (e.g., C:\)
    /^[a-zA-Z]:[/\\]/.test(source)
  );
}

/**
 * Parses a source specifier string into a structured SourceSpecifier object.
 *
 * @param source - The source string to parse
 * @returns Parsed SourceSpecifier
 * @throws SourceParseError if the source format is invalid
 *
 * @example
 * ```typescript
 * // GitHub sources
 * parseSourceSpecifier("github:user/repo")
 * // { type: 'github', owner: 'user', repo: 'repo' }
 *
 * parseSourceSpecifier("github:user/repo@v1.0.0")
 * // { type: 'github', owner: 'user', repo: 'repo', ref: 'v1.0.0' }
 *
 * // Local sources
 * parseSourceSpecifier("./local/path")
 * // { type: 'local', path: '/resolved/absolute/path' }
 *
 * // GitHub shorthand
 * parseSourceSpecifier("user/repo")
 * // { type: 'github', owner: 'user', repo: 'repo' }
 * ```
 */
export function parseSourceSpecifier(source: string): SourceSpecifier {
  // Validate input
  if (!source || typeof source !== "string") {
    throw new SourceParseError("Source specifier cannot be empty", source || "");
  }

  const trimmed = source.trim();
  if (!trimmed) {
    throw new SourceParseError("Source specifier cannot be empty or whitespace only", source);
  }

  // Check for GitHub prefix
  if (trimmed.startsWith("github:")) {
    const value = trimmed.slice(7); // Remove "github:" prefix
    return parseGitHubSource(value, source);
  }

  // Check for local path
  if (isLocalPath(trimmed)) {
    return parseLocalSource(trimmed);
  }

  // Check for GitHub shorthand (owner/repo or owner/repo@ref)
  // A bare string containing "/" that isn't a local path is treated as GitHub shorthand
  const slashCount = (trimmed.match(/\//g) || []).length;
  if (slashCount === 1) {
    return parseGitHubSource(trimmed, source);
  }

  throw new SourceParseError(
    `Unrecognized source format "${source}". Use "owner/repo", "github:owner/repo", or a local path (./path, ../path, /path).`,
    source,
  );
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for GitHubSource.
 */
export function isGitHubSource(specifier: SourceSpecifier): specifier is GitHubSource {
  return specifier.type === "github";
}

/**
 * Type guard for LocalSource.
 */
export function isLocalSource(specifier: SourceSpecifier): specifier is LocalSource {
  return specifier.type === "local";
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Converts a SourceSpecifier back to its string representation.
 *
 * @param specifier - The specifier to stringify
 * @returns String representation of the specifier
 *
 * @example
 * ```typescript
 * stringifySourceSpecifier({ type: 'github', owner: 'user', repo: 'repo', ref: 'v1.0.0' })
 * // "github:user/repo@v1.0.0"
 * ```
 */
export function stringifySourceSpecifier(specifier: SourceSpecifier): string {
  switch (specifier.type) {
    case "github": {
      let str = `github:${specifier.owner}/${specifier.repo}`;
      if (specifier.ref) {
        str += `@${specifier.ref}`;
      }
      return str;
    }
    case "local":
      return specifier.path;
  }
}
