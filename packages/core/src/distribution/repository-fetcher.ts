/**
 * Repository fetching for agent distribution
 *
 * Fetches agent repositories from various sources (GitHub, local paths) and
 * provides them in a temporary directory for validation and installation.
 */

import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FleetManagerError } from "../fleet-manager/errors.js";
import { createLogger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);
const logger = createLogger("distribution");

// =============================================================================
// Types
// =============================================================================

/**
 * GitHub source specifier
 */
export interface GitHubFetchSource {
  type: "github";
  owner: string;
  repo: string;
  ref?: string;
}

/**
 * Local filesystem source specifier
 */
export interface LocalFetchSource {
  type: "local";
  path: string;
}

/**
 * Union of all fetch source types
 */
export type FetchSource = GitHubFetchSource | LocalFetchSource;

/**
 * Result of fetching a repository
 *
 * Note: Named RepositoryFetchResult to avoid collision with work-sources FetchResult
 */
export interface RepositoryFetchResult {
  /** Path to the fetched repository contents */
  path: string;
  /** Cleanup function to remove the temporary directory */
  cleanup: () => Promise<void>;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error for repository fetching failures
 */
export class RepositoryFetchError extends FleetManagerError {
  constructor(
    message: string,
    public readonly source: FetchSource,
    cause?: Error,
  ) {
    super(message, { cause, code: "REPOSITORY_FETCH_ERROR" });
    this.name = "RepositoryFetchError";
  }
}

/**
 * Error when GitHub authentication fails during clone
 *
 * Note: Named GitHubCloneAuthError to avoid collision with work-sources GitHubAuthError
 */
export class GitHubCloneAuthError extends RepositoryFetchError {
  constructor(source: GitHubFetchSource, cause?: Error) {
    super(
      `Authentication failed for github:${source.owner}/${source.repo}. ` +
        `Make sure your Git credentials are configured correctly. ` +
        `For private repos, set up a GitHub personal access token or SSH key.`,
      source,
      cause,
    );
    this.name = "GitHubCloneAuthError";
  }
}

/**
 * Error when a GitHub repository is not found
 */
export class GitHubRepoNotFoundError extends RepositoryFetchError {
  constructor(source: GitHubFetchSource, cause?: Error) {
    super(
      `Repository not found: github:${source.owner}/${source.repo}. ` +
        `Check that the owner and repository name are correct, and that you have access to the repo.`,
      source,
      cause,
    );
    this.name = "GitHubRepoNotFoundError";
  }
}

/**
 * Error when a network operation fails
 */
export class NetworkError extends RepositoryFetchError {
  constructor(source: FetchSource, cause?: Error) {
    const sourceStr =
      source.type === "github" ? `github:${source.owner}/${source.repo}` : source.type;
    super(
      `Network error while fetching ${sourceStr}. ` +
        `Check your internet connection and try again.`,
      source,
      cause,
    );
    this.name = "NetworkError";
  }
}

/**
 * Error when a local path doesn't exist or isn't a directory
 */
export class LocalPathError extends RepositoryFetchError {
  constructor(source: LocalFetchSource, reason: string, cause?: Error) {
    super(`Local source error for "${source.path}": ${reason}`, source, cause);
    this.name = "LocalPathError";
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a temporary directory for fetching
 */
async function createTempDir(prefix: string): Promise<string> {
  const base = join(tmpdir(), `herdctl-${prefix}-`);
  return mkdtemp(base);
}

/**
 * Fetch a repository from GitHub via shallow clone
 */
async function fetchFromGitHub(source: GitHubFetchSource): Promise<RepositoryFetchResult> {
  const url = `https://github.com/${source.owner}/${source.repo}.git`;
  const tempDir = await createTempDir("github");

  logger.debug("Cloning GitHub repository", {
    owner: source.owner,
    repo: source.repo,
    ref: source.ref,
    tempDir,
  });

  const args = ["clone", "--depth", "1"];
  if (source.ref) {
    args.push("--branch", source.ref);
  }
  args.push(url, tempDir);

  try {
    await execFileAsync("git", args, {
      env: {
        ...process.env,
        // Prevent interactive auth prompts from hanging
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 120000, // 2 minute timeout
    });

    logger.info("Successfully cloned repository", {
      source: `github:${source.owner}/${source.repo}`,
      ref: source.ref,
    });

    return {
      path: tempDir,
      cleanup: async () => {
        logger.debug("Cleaning up temporary directory", { path: tempDir });
        await rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* ignore cleanup errors */
    });

    const error = err as Error & { code?: number | string; stderr?: string };
    const stderr = error.stderr?.toLowerCase() ?? "";
    // Node.js execFile returns exit code as number, but handle string for safety
    const exitCode = typeof error.code === "number" ? error.code : parseInt(String(error.code), 10);

    // Check specific error patterns FIRST before falling back to generic exit code checks.
    // Git exit code 128 is used for multiple failure modes (auth, not found, etc.),
    // so we must check message content to distinguish between them.

    // Check for repository not found errors (specific patterns first)
    if (
      stderr.includes("repository not found") ||
      stderr.includes("does not exist") ||
      stderr.includes("not found")
    ) {
      throw new GitHubRepoNotFoundError(source, error);
    }

    // Check for network errors
    if (
      stderr.includes("could not resolve host") ||
      stderr.includes("network") ||
      stderr.includes("connection")
    ) {
      throw new NetworkError(source, error);
    }

    // Check for authentication errors - either explicit auth messages or
    // exit code 128 with credential-related messages
    if (
      stderr.includes("authentication") ||
      stderr.includes("could not read") ||
      exitCode === 128
    ) {
      throw new GitHubCloneAuthError(source, error);
    }

    // Generic error
    throw new RepositoryFetchError(
      `Failed to clone github:${source.owner}/${source.repo}: ${error.message}`,
      source,
      error,
    );
  }
}

/**
 * Fetch from a local filesystem path by copying to a temp directory
 */
async function fetchFromLocal(source: LocalFetchSource): Promise<RepositoryFetchResult> {
  logger.debug("Copying local directory", { path: source.path });

  // Validate the source path exists
  let stats;
  try {
    stats = await stat(source.path);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === "ENOENT") {
      throw new LocalPathError(source, "Path does not exist");
    }
    throw new LocalPathError(source, `Cannot access path: ${error.message}`, error);
  }

  // Validate it's a directory
  if (!stats.isDirectory()) {
    throw new LocalPathError(source, "Path is not a directory");
  }

  // Copy to temp directory
  const tempDir = await createTempDir("local");

  try {
    await cp(source.path, tempDir, { recursive: true });

    logger.info("Successfully copied local directory", {
      source: source.path,
      dest: tempDir,
    });

    return {
      path: tempDir,
      cleanup: async () => {
        logger.debug("Cleaning up temporary directory", { path: tempDir });
        await rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* ignore cleanup errors */
    });

    const error = err as Error;
    throw new LocalPathError(source, `Failed to copy directory: ${error.message}`, error);
  }
}

/**
 * Fetch a repository from a source specifier
 *
 * Clones or copies the repository to a temporary directory and returns
 * the path along with a cleanup function.
 *
 * @param source - The source specifier (GitHub or local)
 * @returns The path to the fetched repository and a cleanup function
 * @throws {GitHubCloneAuthError} When GitHub authentication fails
 * @throws {GitHubRepoNotFoundError} When the GitHub repository doesn't exist
 * @throws {NetworkError} When a network operation fails
 * @throws {LocalPathError} When the local path is invalid
 *
 * @example
 * ```typescript
 * const result = await fetchRepository({
 *   type: 'github',
 *   owner: 'herdctl',
 *   repo: 'example-agent',
 *   ref: 'v1.0.0'
 * });
 *
 * try {
 *   // Use result.path to access the repository files
 *   const agentYaml = await readFile(join(result.path, 'agent.yaml'));
 * } finally {
 *   // Always clean up when done
 *   await result.cleanup();
 * }
 * ```
 */
export async function fetchRepository(source: FetchSource): Promise<RepositoryFetchResult> {
  switch (source.type) {
    case "github":
      return fetchFromGitHub(source);

    case "local":
      return fetchFromLocal(source);

    default: {
      // Exhaustive check
      const _exhaustive: never = source;
      throw new Error(`Unknown source type: ${(_exhaustive as FetchSource).type}`);
    }
  }
}
