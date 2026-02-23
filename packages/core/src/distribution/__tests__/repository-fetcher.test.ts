/**
 * Tests for repository fetcher
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// =============================================================================
// Mocks - Must be defined BEFORE imports that use them
// =============================================================================

// We need to use vi.hoisted to create the mock function before vi.mock runs
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

// Mock node:util to control promisify behavior
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

// Mock child_process
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  cp: vi.fn(),
}));

// Mock os
vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

// =============================================================================
// Import after mocks are set up
// =============================================================================

// Import mocked modules for assertions
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import {
  fetchRepository,
  GitHubCloneAuthError,
  type GitHubFetchSource,
  GitHubRepoNotFoundError,
  type LocalFetchSource,
  LocalPathError,
  NetworkError,
  type RegistryFetchSource,
  RegistryNotImplementedError,
  RepositoryFetchError,
  type RepositoryFetchResult,
} from "../repository-fetcher.js";

// =============================================================================
// Helper Functions
// =============================================================================

function mockExecFileSuccess(stdout = "", stderr = "") {
  mockExecFileAsync.mockResolvedValue({ stdout, stderr });
}

function mockExecFileError(error: Error & { code?: number | string; stderr?: string }) {
  mockExecFileAsync.mockRejectedValue(error);
}

// =============================================================================
// Test Setup
// =============================================================================

describe("fetchRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    (mkdtemp as Mock).mockResolvedValue("/tmp/herdctl-github-abc123");
    (rm as Mock).mockResolvedValue(undefined);
    (stat as Mock).mockResolvedValue({ isDirectory: () => true });
    (cp as Mock).mockResolvedValue(undefined);
  });

  // ===========================================================================
  // GitHub Source Tests
  // ===========================================================================

  describe("GitHub source", () => {
    const source: GitHubFetchSource = {
      type: "github",
      owner: "herdctl",
      repo: "example-agent",
    };

    describe("successful clone", () => {
      it("clones a GitHub repository to a temp directory", async () => {
        mockExecFileSuccess();

        const result = await fetchRepository(source);

        expect(result.path).toBe("/tmp/herdctl-github-abc123");
        expect(typeof result.cleanup).toBe("function");
        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "git",
          [
            "clone",
            "--depth",
            "1",
            "https://github.com/herdctl/example-agent.git",
            "/tmp/herdctl-github-abc123",
          ],
          expect.objectContaining({
            env: expect.objectContaining({
              GIT_TERMINAL_PROMPT: "0",
            }),
          }),
        );
      });

      it("clones with ref when specified", async () => {
        mockExecFileSuccess();
        const sourceWithRef: GitHubFetchSource = {
          ...source,
          ref: "v1.0.0",
        };

        await fetchRepository(sourceWithRef);

        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "git",
          [
            "clone",
            "--depth",
            "1",
            "--branch",
            "v1.0.0",
            "https://github.com/herdctl/example-agent.git",
            "/tmp/herdctl-github-abc123",
          ],
          expect.any(Object),
        );
      });

      it("clones with branch name as ref", async () => {
        mockExecFileSuccess();
        const sourceWithBranch: GitHubFetchSource = {
          ...source,
          ref: "main",
        };

        await fetchRepository(sourceWithBranch);

        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "git",
          [
            "clone",
            "--depth",
            "1",
            "--branch",
            "main",
            "https://github.com/herdctl/example-agent.git",
            "/tmp/herdctl-github-abc123",
          ],
          expect.any(Object),
        );
      });

      it("sets GIT_TERMINAL_PROMPT=0 to prevent interactive prompts", async () => {
        mockExecFileSuccess();

        await fetchRepository(source);

        expect(mockExecFileAsync).toHaveBeenCalledWith(
          "git",
          expect.any(Array),
          expect.objectContaining({
            env: expect.objectContaining({
              GIT_TERMINAL_PROMPT: "0",
            }),
          }),
        );
      });
    });

    describe("cleanup function", () => {
      it("removes the temp directory when cleanup is called", async () => {
        mockExecFileSuccess();

        const result = await fetchRepository(source);
        await result.cleanup();

        expect(rm).toHaveBeenCalledWith("/tmp/herdctl-github-abc123", {
          recursive: true,
          force: true,
        });
      });
    });

    describe("error handling", () => {
      it("throws GitHubCloneAuthError on authentication failure (exit code 128)", async () => {
        const error = new Error("fatal: could not read Username") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.code = 128;
        error.stderr =
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(GitHubCloneAuthError);
        await expect(fetchRepository(source)).rejects.toThrow(/Authentication failed/);
        await expect(fetchRepository(source)).rejects.toThrow(/credentials/);
      });

      it("throws GitHubCloneAuthError when stderr contains authentication", async () => {
        const error = new Error("authentication failed") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "authentication required";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(GitHubCloneAuthError);
      });

      it("throws GitHubRepoNotFoundError when repo doesn't exist", async () => {
        const error = new Error("fatal: repository not found") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "fatal: repository 'https://github.com/nonexistent/repo.git/' not found";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(GitHubRepoNotFoundError);
        await expect(fetchRepository(source)).rejects.toThrow(/Repository not found/);
        await expect(fetchRepository(source)).rejects.toThrow(/herdctl\/example-agent/);
      });

      it("throws GitHubRepoNotFoundError when stderr contains does not exist", async () => {
        const error = new Error("remote does not exist") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "error: remote does not exist";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(GitHubRepoNotFoundError);
      });

      it("throws GitHubRepoNotFoundError (not auth error) when exit code 128 with repo not found message", async () => {
        // Git exit code 128 is used for multiple failure modes.
        // When the stderr contains "not found", it should be classified as repo not found,
        // not as an auth error, even though exit code 128 is often associated with auth failures.
        const error = new Error("fatal: repository not found") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.code = 128;
        error.stderr = "fatal: repository 'https://github.com/nonexistent/repo.git/' not found";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(GitHubRepoNotFoundError);
        // Verify it's NOT throwing GitHubCloneAuthError
        await expect(fetchRepository(source)).rejects.not.toThrow(GitHubCloneAuthError);
      });

      it("throws NetworkError on network failure", async () => {
        const error = new Error("network error") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "fatal: could not resolve host: github.com";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(NetworkError);
        await expect(fetchRepository(source)).rejects.toThrow(/Network error/);
        await expect(fetchRepository(source)).rejects.toThrow(/internet connection/);
      });

      it("throws NetworkError when stderr contains connection issues", async () => {
        const error = new Error("connection failed") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "fatal: unable to access: connection refused";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(NetworkError);
      });

      it("throws RepositoryFetchError for generic git errors", async () => {
        const error = new Error("some other git error") as Error & {
          code?: number | string;
          stderr?: string;
        };
        error.stderr = "fatal: something went wrong";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow(RepositoryFetchError);
        await expect(fetchRepository(source)).rejects.toThrow(/Failed to clone/);
      });

      it("cleans up temp directory on failure", async () => {
        const error = new Error("clone failed") as Error & { stderr?: string };
        error.stderr = "generic error";
        mockExecFileError(error);

        await expect(fetchRepository(source)).rejects.toThrow();

        // Should have attempted to clean up
        expect(rm).toHaveBeenCalledWith("/tmp/herdctl-github-abc123", {
          recursive: true,
          force: true,
        });
      });
    });
  });

  // ===========================================================================
  // Local Source Tests
  // ===========================================================================

  describe("Local source", () => {
    const source: LocalFetchSource = {
      type: "local",
      path: "/home/user/my-agent",
    };

    describe("successful copy", () => {
      it("copies a local directory to a temp directory", async () => {
        (mkdtemp as Mock).mockResolvedValue("/tmp/herdctl-local-xyz789");
        (stat as Mock).mockResolvedValue({ isDirectory: () => true });
        (cp as Mock).mockResolvedValue(undefined);

        const result = await fetchRepository(source);

        expect(result.path).toBe("/tmp/herdctl-local-xyz789");
        expect(typeof result.cleanup).toBe("function");
        expect(stat).toHaveBeenCalledWith("/home/user/my-agent");
        expect(cp).toHaveBeenCalledWith("/home/user/my-agent", "/tmp/herdctl-local-xyz789", {
          recursive: true,
        });
      });

      it("validates the path exists before copying", async () => {
        (stat as Mock).mockResolvedValue({ isDirectory: () => true });

        await fetchRepository(source);

        expect(stat).toHaveBeenCalledWith("/home/user/my-agent");
      });
    });

    describe("cleanup function", () => {
      it("removes the temp directory when cleanup is called", async () => {
        (mkdtemp as Mock).mockResolvedValue("/tmp/herdctl-local-cleanup");
        (stat as Mock).mockResolvedValue({ isDirectory: () => true });

        const result = await fetchRepository(source);
        await result.cleanup();

        expect(rm).toHaveBeenCalledWith("/tmp/herdctl-local-cleanup", {
          recursive: true,
          force: true,
        });
      });
    });

    describe("error handling", () => {
      it("throws LocalPathError when path does not exist", async () => {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        (stat as Mock).mockRejectedValue(error);

        await expect(fetchRepository(source)).rejects.toThrow(LocalPathError);
        await expect(fetchRepository(source)).rejects.toThrow(/does not exist/);
      });

      it("throws LocalPathError when path is a file, not a directory", async () => {
        (stat as Mock).mockResolvedValue({ isDirectory: () => false });

        await expect(fetchRepository(source)).rejects.toThrow(LocalPathError);
        await expect(fetchRepository(source)).rejects.toThrow(/not a directory/);
      });

      it("throws LocalPathError when stat fails for other reasons", async () => {
        const error = new Error("Permission denied") as Error & { code?: string };
        error.code = "EACCES";
        (stat as Mock).mockRejectedValue(error);

        await expect(fetchRepository(source)).rejects.toThrow(LocalPathError);
        await expect(fetchRepository(source)).rejects.toThrow(/Cannot access path/);
      });

      it("throws LocalPathError when copy fails", async () => {
        (stat as Mock).mockResolvedValue({ isDirectory: () => true });
        (cp as Mock).mockRejectedValue(new Error("Copy failed: disk full"));

        await expect(fetchRepository(source)).rejects.toThrow(LocalPathError);
        await expect(fetchRepository(source)).rejects.toThrow(/Failed to copy directory/);
      });

      it("cleans up temp directory on copy failure", async () => {
        (mkdtemp as Mock).mockResolvedValue("/tmp/herdctl-local-fail");
        (stat as Mock).mockResolvedValue({ isDirectory: () => true });
        (cp as Mock).mockRejectedValue(new Error("Copy failed"));

        await expect(fetchRepository(source)).rejects.toThrow();

        expect(rm).toHaveBeenCalledWith("/tmp/herdctl-local-fail", {
          recursive: true,
          force: true,
        });
      });

      it("includes source path in error message", async () => {
        const error = new Error("ENOENT") as Error & { code?: string };
        error.code = "ENOENT";
        (stat as Mock).mockRejectedValue(error);

        await expect(fetchRepository(source)).rejects.toThrow(/\/home\/user\/my-agent/);
      });
    });
  });

  // ===========================================================================
  // Registry Source Tests
  // ===========================================================================

  describe("Registry source", () => {
    const source: RegistryFetchSource = {
      type: "registry",
      name: "competitive-analysis",
    };

    it("throws RegistryNotImplementedError", async () => {
      await expect(fetchRepository(source)).rejects.toThrow(RegistryNotImplementedError);
      await expect(fetchRepository(source)).rejects.toThrow(/not yet implemented/);
      await expect(fetchRepository(source)).rejects.toThrow(/competitive-analysis/);
    });

    it("suggests using GitHub or local source", async () => {
      await expect(fetchRepository(source)).rejects.toThrow(/GitHub source/);
      await expect(fetchRepository(source)).rejects.toThrow(/local path/);
    });
  });

  // ===========================================================================
  // RepositoryFetchResult Type Tests
  // ===========================================================================

  describe("RepositoryFetchResult", () => {
    it("returns correct shape for GitHub source", async () => {
      mockExecFileSuccess();

      const result: RepositoryFetchResult = await fetchRepository({
        type: "github",
        owner: "test",
        repo: "repo",
      });

      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("cleanup");
      expect(typeof result.path).toBe("string");
      expect(typeof result.cleanup).toBe("function");
    });

    it("returns correct shape for local source", async () => {
      (stat as Mock).mockResolvedValue({ isDirectory: () => true });

      const result: RepositoryFetchResult = await fetchRepository({
        type: "local",
        path: "/some/path",
      });

      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("cleanup");
      expect(typeof result.path).toBe("string");
      expect(typeof result.cleanup).toBe("function");
    });

    it("cleanup is idempotent (can be called multiple times)", async () => {
      mockExecFileSuccess();
      (rm as Mock).mockResolvedValue(undefined);

      const result = await fetchRepository({
        type: "github",
        owner: "test",
        repo: "repo",
      });

      // Should not throw even when called multiple times
      await result.cleanup();
      await result.cleanup();
      await result.cleanup();

      expect(rm).toHaveBeenCalledTimes(3);
    });
  });

  // ===========================================================================
  // Error Class Tests
  // ===========================================================================

  describe("Error classes", () => {
    it("RepositoryFetchError has correct properties", () => {
      const source: GitHubFetchSource = { type: "github", owner: "a", repo: "b" };
      const cause = new Error("root cause");
      const error = new RepositoryFetchError("Test error", source, cause);

      expect(error.name).toBe("RepositoryFetchError");
      expect(error.message).toBe("Test error");
      expect(error.source).toBe(source);
      expect(error.cause).toBe(cause);
    });

    it("GitHubCloneAuthError extends RepositoryFetchError", () => {
      const source: GitHubFetchSource = { type: "github", owner: "test", repo: "repo" };
      const error = new GitHubCloneAuthError(source);

      expect(error).toBeInstanceOf(RepositoryFetchError);
      expect(error.name).toBe("GitHubCloneAuthError");
      expect(error.source).toBe(source);
    });

    it("GitHubRepoNotFoundError extends RepositoryFetchError", () => {
      const source: GitHubFetchSource = { type: "github", owner: "test", repo: "missing" };
      const error = new GitHubRepoNotFoundError(source);

      expect(error).toBeInstanceOf(RepositoryFetchError);
      expect(error.name).toBe("GitHubRepoNotFoundError");
    });

    it("NetworkError extends RepositoryFetchError", () => {
      const source: GitHubFetchSource = { type: "github", owner: "test", repo: "repo" };
      const error = new NetworkError(source);

      expect(error).toBeInstanceOf(RepositoryFetchError);
      expect(error.name).toBe("NetworkError");
    });

    it("LocalPathError extends RepositoryFetchError", () => {
      const source: LocalFetchSource = { type: "local", path: "/test" };
      const error = new LocalPathError(source, "reason");

      expect(error).toBeInstanceOf(RepositoryFetchError);
      expect(error.name).toBe("LocalPathError");
    });

    it("RegistryNotImplementedError extends RepositoryFetchError", () => {
      const source: RegistryFetchSource = { type: "registry", name: "test" };
      const error = new RegistryNotImplementedError(source);

      expect(error).toBeInstanceOf(RepositoryFetchError);
      expect(error.name).toBe("RegistryNotImplementedError");
    });
  });
});
