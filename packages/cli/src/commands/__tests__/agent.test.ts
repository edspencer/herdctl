import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @herdctl/core entirely
vi.mock("@herdctl/core", () => ({
  // Logger - mock that routes to console so tests can capture it
  createLogger: () => ({
    debug: (...args: unknown[]) => console.debug(...args),
    info: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  }),

  // Source parsing
  parseSourceSpecifier: vi.fn(),
  stringifySourceSpecifier: vi.fn(),
  SourceParseError: class SourceParseError extends Error {
    source: string;
    constructor(message: string, source: string) {
      super(message);
      this.name = "SourceParseError";
      this.source = source;
    }
  },
  isGitHubSource: vi.fn(),
  isLocalSource: vi.fn(),
  // Repository fetching
  fetchRepository: vi.fn(),
  RepositoryFetchError: class RepositoryFetchError extends Error {
    source: unknown;
    cause?: Error;
    constructor(message: string, source: unknown, cause?: Error) {
      super(message);
      this.name = "RepositoryFetchError";
      this.source = source;
      this.cause = cause;
    }
  },
  GitHubCloneAuthError: class GitHubCloneAuthError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Auth failed");
      this.name = "GitHubCloneAuthError";
      this.source = source;
    }
  },
  GitHubRepoNotFoundError: class GitHubRepoNotFoundError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Repo not found");
      this.name = "GitHubRepoNotFoundError";
      this.source = source;
    }
  },
  NetworkError: class NetworkError extends Error {
    source: unknown;
    constructor(source: unknown, cause?: Error) {
      super("Network error");
      this.name = "NetworkError";
      this.source = source;
    }
  },
  LocalPathError: class LocalPathError extends Error {
    source: unknown;
    constructor(source: unknown, reason: string, cause?: Error) {
      super(reason);
      this.name = "LocalPathError";
      this.source = source;
    }
  },
  // Repository validation
  validateRepository: vi.fn(),

  // File installation
  installAgentFiles: vi.fn(),
  AgentInstallError: class AgentInstallError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "AgentInstallError";
      this.code = code;
    }
  },
  AGENT_ALREADY_EXISTS: "AGENT_ALREADY_EXISTS",

  // Fleet config update
  addAgentToFleetConfig: vi.fn(),
  FleetConfigError: class FleetConfigError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "FleetConfigError";
      this.code = code;
    }
  },

  // Environment variable scanning
  scanEnvVariables: vi.fn(),

  // Agent discovery
  discoverAgents: vi.fn(),
  AgentDiscoveryError: class AgentDiscoveryError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "AgentDiscoveryError";
      this.code = code;
    }
  },

  // Agent info
  getAgentInfo: vi.fn(),

  // Agent removal
  removeAgent: vi.fn(),
  AgentRemoveError: class AgentRemoveError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "AgentRemoveError";
      this.code = code;
    }
  },
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",

  // Config loader (for fleet-of-fleets support)
  loadConfig: vi.fn(),
  ConfigError: class ConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigError";
    }
  },
  ConfigNotFoundError: class ConfigNotFoundError extends Error {
    searchedPaths: string[];
    startDirectory: string;
    constructor(startDirectory: string, searchedPaths: string[] = []) {
      super(`No herdctl configuration file found from '${startDirectory}'`);
      this.name = "ConfigNotFoundError";
      this.startDirectory = startDirectory;
      this.searchedPaths = searchedPaths;
    }
  },
}));

import {
  AGENT_ALREADY_EXISTS,
  AGENT_NOT_FOUND,
  AgentDiscoveryError,
  AgentInstallError,
  AgentRemoveError,
  addAgentToFleetConfig,
  ConfigError,
  ConfigNotFoundError,
  discoverAgents,
  FleetConfigError,
  fetchRepository,
  GitHubCloneAuthError,
  GitHubRepoNotFoundError,
  getAgentInfo,
  installAgentFiles,
  isGitHubSource,
  isLocalSource,
  LocalPathError,
  loadConfig,
  NetworkError,
  parseSourceSpecifier,
  RepositoryFetchError,
  removeAgent,
  SourceParseError,
  scanEnvVariables,
  stringifySourceSpecifier,
  validateRepository,
} from "@herdctl/core";

import {
  agentAddCommand,
  agentInfoCommand,
  agentListCommand,
  agentRemoveCommand,
  buildFleetTree,
  renderFleetTree,
  TREE_AGENT_THRESHOLD,
} from "../agent.js";

const mockedParseSourceSpecifier = vi.mocked(parseSourceSpecifier);
const mockedStringifySourceSpecifier = vi.mocked(stringifySourceSpecifier);
const mockedIsGitHubSource = vi.mocked(isGitHubSource);
const mockedIsLocalSource = vi.mocked(isLocalSource);
const mockedFetchRepository = vi.mocked(fetchRepository);
const mockedValidateRepository = vi.mocked(validateRepository);
const mockedInstallAgentFiles = vi.mocked(installAgentFiles);
const mockedAddAgentToFleetConfig = vi.mocked(addAgentToFleetConfig);
const mockedScanEnvVariables = vi.mocked(scanEnvVariables);
const mockedRemoveAgent = vi.mocked(removeAgent);
const mockedDiscoverAgents = vi.mocked(discoverAgents);
const mockedGetAgentInfo = vi.mocked(getAgentInfo);
const mockedLoadConfig = vi.mocked(loadConfig);

function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Create a minimal agent repository structure in a temp directory */
function createMockAgentRepo(dir: string, agentName: string = "test-agent"): void {
  fs.writeFileSync(
    path.join(dir, "agent.yaml"),
    `name: ${agentName}
permission_mode: default
runtime: sdk
`,
    "utf-8",
  );
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Agent Instructions\n", "utf-8");
}

/** Create a minimal herdctl.yaml for tests */
function createFleetConfig(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "herdctl.yaml"),
    `version: 1

fleet:
  name: test-fleet

agents: []
`,
    "utf-8",
  );
}

describe("agentAddCommand", () => {
  let tempDir: string;
  let fetchedRepoDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;
  let cleanupCalled: boolean;

  beforeEach(() => {
    tempDir = createTempDir();
    fetchedRepoDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    process.exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    cleanupCalled = false;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    cleanupTempDir(fetchedRepoDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  /** Set up default mocks for a successful GitHub installation */
  function setupSuccessfulGitHubMocks(agentName: string = "test-agent"): void {
    createFleetConfig(tempDir);
    createMockAgentRepo(fetchedRepoDir, agentName);

    mockedParseSourceSpecifier.mockReturnValue({
      type: "github",
      owner: "user",
      repo: "repo",
      ref: "v1.0.0",
    });
    mockedStringifySourceSpecifier.mockReturnValue("github:user/repo@v1.0.0");
    mockedIsGitHubSource.mockReturnValue(true);
    mockedIsLocalSource.mockReturnValue(false);

    mockedFetchRepository.mockResolvedValue({
      path: fetchedRepoDir,
      cleanup: async () => {
        cleanupCalled = true;
      },
    });

    mockedValidateRepository.mockResolvedValue({
      valid: true,
      agentName,
      agentConfig: { name: agentName, permission_mode: "default", runtime: "sdk", self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" } },
      repoMetadata: null,
      errors: [],
      warnings: [],
    });

    const installPath = path.join(tempDir, "agents", agentName);
    mockedInstallAgentFiles.mockResolvedValue({
      agentName,
      installPath,
      copiedFiles: ["agent.yaml", "CLAUDE.md"],
    });

    // Create the installed files so scanEnvVariables can read them
    fs.mkdirSync(path.join(tempDir, "agents", agentName), { recursive: true });
    fs.copyFileSync(
      path.join(fetchedRepoDir, "agent.yaml"),
      path.join(tempDir, "agents", agentName, "agent.yaml"),
    );

    mockedAddAgentToFleetConfig.mockResolvedValue({
      modified: true,
      agentPath: `./agents/${agentName}/agent.yaml`,
      alreadyExists: false,
    });

    mockedScanEnvVariables.mockReturnValue({
      variables: [],
      required: [],
      optional: [],
    });
  }

  /** Set up default mocks for a successful local installation */
  function setupSuccessfulLocalMocks(agentName: string = "local-agent"): void {
    createFleetConfig(tempDir);
    createMockAgentRepo(fetchedRepoDir, agentName);

    mockedParseSourceSpecifier.mockReturnValue({
      type: "local",
      path: fetchedRepoDir,
    });
    mockedStringifySourceSpecifier.mockReturnValue(fetchedRepoDir);
    mockedIsGitHubSource.mockReturnValue(false);
    mockedIsLocalSource.mockReturnValue(true);

    mockedFetchRepository.mockResolvedValue({
      path: fetchedRepoDir,
      cleanup: async () => {
        cleanupCalled = true;
      },
    });

    mockedValidateRepository.mockResolvedValue({
      valid: true,
      agentName,
      agentConfig: { name: agentName, permission_mode: "default", runtime: "sdk", self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" } },
      repoMetadata: null,
      errors: [],
      warnings: [],
    });

    const installPath = path.join(tempDir, "agents", agentName);
    mockedInstallAgentFiles.mockResolvedValue({
      agentName,
      installPath,
      copiedFiles: ["agent.yaml", "CLAUDE.md"],
    });

    // Create the installed files so scanEnvVariables can read them
    fs.mkdirSync(path.join(tempDir, "agents", agentName), { recursive: true });
    fs.copyFileSync(
      path.join(fetchedRepoDir, "agent.yaml"),
      path.join(tempDir, "agents", agentName, "agent.yaml"),
    );

    mockedAddAgentToFleetConfig.mockResolvedValue({
      modified: true,
      agentPath: `./agents/${agentName}/agent.yaml`,
      alreadyExists: false,
    });

    mockedScanEnvVariables.mockReturnValue({
      variables: [],
      required: [],
      optional: [],
    });
  }

  describe("successful installation from GitHub", () => {
    it("installs an agent from GitHub source", async () => {
      setupSuccessfulGitHubMocks("my-agent");

      await agentAddCommand("github:user/repo@v1.0.0", {});

      expect(mockedParseSourceSpecifier).toHaveBeenCalledWith("github:user/repo@v1.0.0");
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalledWith(fetchedRepoDir);
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });

    it("calls cleanup even after successful installation", async () => {
      setupSuccessfulGitHubMocks();

      await agentAddCommand("github:user/repo", {});

      expect(cleanupCalled).toBe(true);
    });
  });

  describe("successful installation from local path", () => {
    it("installs an agent from local path", async () => {
      setupSuccessfulLocalMocks("local-agent");

      await agentAddCommand("./local/path", {});

      expect(mockedParseSourceSpecifier).toHaveBeenCalledWith("./local/path");
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalled();
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });
  });

  describe("dry run mode", () => {
    it("does not modify files in dry run mode", async () => {
      setupSuccessfulGitHubMocks("dry-run-agent");

      await agentAddCommand("github:user/repo", { dryRun: true });

      // Should parse and fetch
      expect(mockedParseSourceSpecifier).toHaveBeenCalled();
      expect(mockedFetchRepository).toHaveBeenCalled();
      expect(mockedValidateRepository).toHaveBeenCalled();

      // Should NOT install or update config
      expect(mockedInstallAgentFiles).not.toHaveBeenCalled();
      expect(mockedAddAgentToFleetConfig).not.toHaveBeenCalled();

      // Should print dry run message
      expect(consoleLogs.some((log) => log.includes("Dry run mode"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Would install"))).toBe(true);
    });

    it("still calls cleanup in dry run mode", async () => {
      setupSuccessfulGitHubMocks();

      await agentAddCommand("github:user/repo", { dryRun: true });

      expect(cleanupCalled).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles SourceParseError gracefully", async () => {
      mockedParseSourceSpecifier.mockImplementation(() => {
        throw new SourceParseError("Invalid source format", "bad-source");
      });

      await expect(agentAddCommand("bad-source", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Invalid source"))).toBe(true);
    });

    it("handles RepositoryFetchError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new RepositoryFetchError("Clone failed", { type: "github", owner: "user", repo: "repo" }),
      );

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Failed to fetch"))).toBe(true);
    });

    it("handles GitHubCloneAuthError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "private-repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/private-repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new GitHubCloneAuthError({ type: "github", owner: "user", repo: "private-repo" }),
      );

      await expect(agentAddCommand("github:user/private-repo", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Authentication failed"))).toBe(true);
    });

    it("handles GitHubRepoNotFoundError gracefully", async () => {
      createFleetConfig(tempDir);
      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "nonexistent",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/nonexistent");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockRejectedValue(
        new GitHubRepoNotFoundError({ type: "github", owner: "user", repo: "nonexistent" }),
      );

      await expect(agentAddCommand("github:user/nonexistent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Repository not found"))).toBe(true);
    });

    it("handles AgentInstallError (already exists)", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "existing-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockResolvedValue({
        valid: true,
        agentName: "existing-agent",
        agentConfig: { name: "existing-agent", permission_mode: "default", runtime: "sdk", self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" } },
        repoMetadata: null,
        errors: [],
        warnings: [],
      });

      mockedInstallAgentFiles.mockRejectedValue(
        new AgentInstallError("Agent already exists", AGENT_ALREADY_EXISTS),
      );

      await agentAddCommand("github:user/repo", {});

      expect(process.exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Installation failed"))).toBe(true);
      expect(consoleErrors.some((e) => e.includes("--force"))).toBe(true);
      expect(cleanupCalled).toBe(true);
    });

    it("handles validation errors (stops installation)", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "invalid-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockResolvedValue({
        valid: false,
        agentName: null,
        agentConfig: null,
        repoMetadata: null,
        errors: [
          { code: "MISSING_AGENT_YAML", message: "agent.yaml not found", path: "agent.yaml" },
        ],
        warnings: [],
      });

      await agentAddCommand("github:user/repo", {});

      expect(process.exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Validation failed"))).toBe(true);
      expect(mockedInstallAgentFiles).not.toHaveBeenCalled();
      expect(cleanupCalled).toBe(true);
    });

    it("handles validation warnings (continues installation)", async () => {
      setupSuccessfulGitHubMocks("warning-agent");

      mockedValidateRepository.mockResolvedValue({
        valid: true,
        agentName: "warning-agent",
        agentConfig: { name: "warning-agent", permission_mode: "default", runtime: "sdk", self_scheduling: { enabled: true, max_schedules: 10, min_interval: "5m" } },
        repoMetadata: null,
        errors: [],
        warnings: [
          { code: "MISSING_README", message: "No README.md found", path: "README.md" },
          { code: "MISSING_CLAUDE_MD", message: "No CLAUDE.md found", path: "CLAUDE.md" },
        ],
      });

      await agentAddCommand("github:user/repo", {});

      // Should print warnings
      expect(consoleLogs.some((log) => log.includes("Warnings"))).toBe(true);

      // But should still install
      expect(mockedInstallAgentFiles).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("installed successfully"))).toBe(true);
    });

    it("calls cleanup even on errors", async () => {
      createFleetConfig(tempDir);
      createMockAgentRepo(fetchedRepoDir, "error-agent");

      mockedParseSourceSpecifier.mockReturnValue({
        type: "github",
        owner: "user",
        repo: "repo",
      });
      mockedStringifySourceSpecifier.mockReturnValue("github:user/repo");
      mockedIsGitHubSource.mockReturnValue(true);
      mockedIsLocalSource.mockReturnValue(false);

      mockedFetchRepository.mockResolvedValue({
        path: fetchedRepoDir,
        cleanup: async () => {
          cleanupCalled = true;
        },
      });

      mockedValidateRepository.mockRejectedValue(new Error("Unexpected error"));

      await expect(agentAddCommand("github:user/repo", {})).rejects.toThrow("Unexpected error");

      expect(cleanupCalled).toBe(true);
    });

    it("handles FleetConfigError gracefully", async () => {
      setupSuccessfulGitHubMocks("config-error-agent");

      mockedAddAgentToFleetConfig.mockRejectedValue(
        new FleetConfigError("Config not found", "CONFIG_NOT_FOUND"),
      );

      await agentAddCommand("github:user/repo", {});

      expect(process.exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Config update failed"))).toBe(true);
      expect(cleanupCalled).toBe(true);
    });
  });

  describe("environment variables display", () => {
    it("displays required env vars correctly", async () => {
      setupSuccessfulGitHubMocks("env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
        required: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
        optional: [],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Environment variables to configure"))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes("Required (no defaults)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("DISCORD_WEBHOOK_URL"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("WEBSITES"))).toBe(true);
    });

    it("displays optional env vars with defaults", async () => {
      setupSuccessfulGitHubMocks("env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
        required: [],
        optional: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Optional (have defaults)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("CRON_SCHEDULE"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("*/5 * * * *"))).toBe(true);
    });

    it("does not display env section when no variables found", async () => {
      setupSuccessfulGitHubMocks("no-env-agent");

      mockedScanEnvVariables.mockReturnValue({
        variables: [],
        required: [],
        optional: [],
      });

      await agentAddCommand("github:user/repo", {});

      expect(consoleLogs.some((log) => log.includes("Environment variables to configure"))).toBe(
        false,
      );
    });
  });

  describe("force mode", () => {
    it("passes force option to installAgentFiles", async () => {
      setupSuccessfulGitHubMocks("force-agent");

      await agentAddCommand("github:user/repo", { force: true });

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          force: true,
        }),
      );
    });

    it("does not pass force when not specified", async () => {
      setupSuccessfulGitHubMocks("no-force-agent");

      await agentAddCommand("github:user/repo", {});

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          force: undefined,
        }),
      );
    });
  });

  describe("custom path option", () => {
    it("passes custom path to installAgentFiles", async () => {
      setupSuccessfulGitHubMocks("custom-path-agent");

      const customPath = path.join(tempDir, "custom", "location");

      await agentAddCommand("github:user/repo", { path: customPath });

      expect(mockedInstallAgentFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPath: customPath,
        }),
      );
    });
  });
});

describe("agentListCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("successful listing", () => {
    it("lists agents in a table format", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "agent-alpha",
            installed: true,
            path: "/path/to/agents/agent-alpha",
            configPath: "./agents/agent-alpha/agent.yaml",
            version: "1.0.0",
            metadata: {
              source: {
                type: "github",
                url: "https://github.com/user/agent-alpha",
                ref: "v1.0.0",
                version: "1.0.0",
              },
              installed_at: "2024-01-15T10:30:00Z",
              installed_by: "herdctl@0.5.0",
            },
          },
          {
            name: "agent-beta",
            installed: false,
            path: "/path/to/agents/agent-beta",
            configPath: "./agents/agent-beta/agent.yaml",
          },
        ],
      });

      await agentListCommand({});

      expect(mockedDiscoverAgents).toHaveBeenCalled();
      expect(consoleLogs.some((log) => log.includes("Agents in fleet"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("agent-alpha"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("agent-beta"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("installed"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("manual"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Total: 2 agents"))).toBe(true);
    });

    it("outputs JSON when --json flag is provided", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "json-agent",
            installed: true,
            path: "/path/to/agents/json-agent",
            configPath: "./agents/json-agent/agent.yaml",
            version: "2.0.0",
            metadata: {
              source: { type: "github", url: "https://github.com/user/json-agent" },
              installed_at: "2024-02-20T15:00:00Z",
              installed_by: "herdctl@1.0.0",
            },
          },
        ],
      });

      await agentListCommand({ json: true });

      // Parse the output as JSON
      const output = consoleLogs.join("\n");
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("json-agent");
    });

    it("shows helpful message when no agents found", async () => {
      mockedDiscoverAgents.mockResolvedValue({ agents: [] });

      await agentListCommand({});

      expect(consoleLogs.some((log) => log.includes("No agents found"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("herdctl agent add"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("herdctl init agent"))).toBe(true);
    });

    it("shows version from metadata", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "versioned-agent",
            installed: true,
            path: "/path/to/agents/versioned-agent",
            configPath: "./agents/versioned-agent/agent.yaml",
            version: "3.2.1",
            metadata: {
              source: { type: "github", version: "3.2.1" },
              installed_at: "2024-03-01T12:00:00Z",
            },
          },
        ],
      });

      await agentListCommand({});

      expect(consoleLogs.some((log) => log.includes("3.2.1"))).toBe(true);
    });

    it("shows dash for missing version", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "no-version-agent",
            installed: false,
            path: "/path/to/agents/no-version-agent",
            configPath: "./agents/no-version-agent/agent.yaml",
          },
        ],
      });

      await agentListCommand({});

      // The table should show "-" for missing version
      expect(consoleLogs.some((log) => log.includes("no-version-agent"))).toBe(true);
    });

    it("formats GitHub source correctly", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "github-agent",
            installed: true,
            path: "/path/to/agents/github-agent",
            configPath: "./agents/github-agent/agent.yaml",
            metadata: {
              source: {
                type: "github",
                url: "https://github.com/myorg/myrepo",
                ref: "v2.0.0",
              },
              installed_at: "2024-01-01T00:00:00Z",
            },
          },
        ],
      });

      await agentListCommand({});

      expect(consoleLogs.some((log) => log.includes("myorg/myrepo@v2.0.0"))).toBe(true);
    });

    it("shows local source type", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "local-agent",
            installed: true,
            path: "/path/to/agents/local-agent",
            configPath: "./agents/local-agent/agent.yaml",
            metadata: {
              source: {
                type: "local",
                url: "/path/to/source",
              },
              installed_at: "2024-01-01T00:00:00Z",
            },
          },
        ],
      });

      await agentListCommand({});

      expect(consoleLogs.some((log) => log.includes("/path/to/source"))).toBe(true);
    });

    it("shows singular 'agent' for one agent", async () => {
      mockedDiscoverAgents.mockResolvedValue({
        agents: [
          {
            name: "single-agent",
            installed: false,
            path: "/path/to/agents/single-agent",
            configPath: "./agents/single-agent/agent.yaml",
          },
        ],
      });

      await agentListCommand({});

      expect(consoleLogs.some((log) => log.includes("Total: 1 agent"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Total: 1 agents"))).toBe(false);
    });
  });

  describe("error handling", () => {
    it("handles AgentDiscoveryError gracefully", async () => {
      mockedDiscoverAgents.mockRejectedValue(
        new AgentDiscoveryError("Fleet config not found", "DISCOVERY_CONFIG_NOT_FOUND"),
      );

      await expect(agentListCommand({})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Discovery failed"))).toBe(true);
      expect(consoleErrors.some((e) => e.includes("Fleet config not found"))).toBe(true);
    });

    it("re-throws unknown errors", async () => {
      mockedDiscoverAgents.mockRejectedValue(new Error("Unknown error"));

      await expect(agentListCommand({})).rejects.toThrow("Unknown error");
    });
  });
});

describe("agentInfoCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("agent found", () => {
    it("prints formatted info for a complete agent", async () => {
      mockedGetAgentInfo.mockResolvedValue({
        name: "my-agent",
        description: "A helpful agent",
        installed: true,
        metadata: {
          source: {
            type: "github",
            url: "https://github.com/user/repo",
            ref: "v1.0.0",
            version: "1.0.0",
          },
          installed_at: "2024-01-15T10:30:00Z",
          installed_by: "herdctl@0.5.0",
        },
        path: "/path/to/agents/my-agent",
        configPath: "./agents/my-agent/agent.yaml",
        version: "1.0.0",
        repoMetadata: {
          name: "my-agent",
          version: "1.0.0",
          description: "A helpful agent",
          author: "test-author",
        },
        envVariables: {
          variables: [
            { name: "DISCORD_WEBHOOK_URL" },
            { name: "WEBSITES" },
            { name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" },
          ],
          required: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
          optional: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
        },
        schedules: {
          "check-websites": { type: "cron", cron: "*/5 * * * *" },
        },
        hasWorkspace: true,
        files: ["agent.yaml", "CLAUDE.md", "knowledge/guide.md"],
      });

      await agentInfoCommand("my-agent", {});

      expect(mockedGetAgentInfo).toHaveBeenCalledWith({
        name: "my-agent",
        configPath: expect.stringContaining("herdctl.yaml"),
      });
      expect(consoleLogs.some((log) => log.includes("Agent: my-agent"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Description: A helpful agent"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Installed (via GitHub)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Source: https://github.com/user/repo"))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes("Version: 1.0.0"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Installed: 2024-01-15T10:30:00Z"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Schedules:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("check-websites:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Environment Variables:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("DISCORD_WEBHOOK_URL"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("WEBSITES"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("CRON_SCHEDULE"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Files:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("agent.yaml"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("CLAUDE.md"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Workspace:"))).toBe(true);
    });

    it("prints info for manual agent without metadata", async () => {
      mockedGetAgentInfo.mockResolvedValue({
        name: "manual-agent",
        description: "A manual agent",
        installed: false,
        path: "/path/to/agents/manual-agent",
        configPath: "./agents/manual-agent/agent.yaml",
        hasWorkspace: false,
        files: ["agent.yaml"],
      });

      await agentInfoCommand("manual-agent", {});

      expect(consoleLogs.some((log) => log.includes("Agent: manual-agent"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Manual (not installed via herdctl)"))).toBe(
        true,
      );
      expect(consoleLogs.some((log) => log.includes("Workspace: (not created)"))).toBe(true);
    });

    it("outputs JSON when --json flag is provided", async () => {
      const agentInfo = {
        name: "json-agent",
        description: "A JSON agent",
        installed: true,
        metadata: {
          source: { type: "github" as const, url: "https://github.com/user/json-agent" },
          installed_at: "2024-02-20T15:00:00Z",
          installed_by: "herdctl@1.0.0",
        },
        path: "/path/to/agents/json-agent",
        configPath: "./agents/json-agent/agent.yaml",
        version: "2.0.0",
        hasWorkspace: true,
        files: ["agent.yaml"],
      };
      mockedGetAgentInfo.mockResolvedValue(agentInfo);

      await agentInfoCommand("json-agent", { json: true });

      // Parse the output as JSON
      const output = consoleLogs.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.name).toBe("json-agent");
      expect(parsed.installed).toBe(true);
      expect(parsed.version).toBe("2.0.0");
      expect(parsed.hasWorkspace).toBe(true);
    });

    it("prints info for agent without optional fields", async () => {
      mockedGetAgentInfo.mockResolvedValue({
        name: "minimal-agent",
        installed: false,
        path: "/path/to/agents/minimal-agent",
        configPath: "./agents/minimal-agent/agent.yaml",
        hasWorkspace: false,
        files: ["agent.yaml"],
      });

      await agentInfoCommand("minimal-agent", {});

      expect(consoleLogs.some((log) => log.includes("Agent: minimal-agent"))).toBe(true);
      // Should not include these sections
      expect(consoleLogs.some((log) => log.includes("Schedules:"))).toBe(false);
      expect(consoleLogs.some((log) => log.includes("Environment Variables:"))).toBe(false);
      expect(consoleLogs.some((log) => log.includes("Description:"))).toBe(false);
    });

    it("handles local source type correctly", async () => {
      mockedGetAgentInfo.mockResolvedValue({
        name: "local-agent",
        installed: true,
        metadata: {
          source: {
            type: "local",
            url: "/path/to/source",
          },
          installed_at: "2024-01-01T00:00:00Z",
        },
        path: "/path/to/agents/local-agent",
        configPath: "./agents/local-agent/agent.yaml",
        hasWorkspace: false,
        files: ["agent.yaml"],
      });

      await agentInfoCommand("local-agent", {});

      expect(consoleLogs.some((log) => log.includes("Installed (via local path)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Source: /path/to/source"))).toBe(true);
    });
  });

  describe("agent not found", () => {
    it("prints error and exits when agent is not found", async () => {
      mockedGetAgentInfo.mockResolvedValue(null);

      await expect(agentInfoCommand("nonexistent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Agent 'nonexistent' not found"))).toBe(true);
      expect(consoleErrors.some((e) => e.includes("herdctl agent list"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles AgentDiscoveryError gracefully", async () => {
      mockedGetAgentInfo.mockRejectedValue(
        new AgentDiscoveryError("Fleet config not found", "DISCOVERY_CONFIG_NOT_FOUND"),
      );

      await expect(agentInfoCommand("any-agent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Discovery failed"))).toBe(true);
    });

    it("re-throws unknown errors", async () => {
      mockedGetAgentInfo.mockRejectedValue(new Error("Unknown error"));

      await expect(agentInfoCommand("any-agent", {})).rejects.toThrow("Unknown error");
    });
  });
});

describe("agentRemoveCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("successful removal", () => {
    it("removes agent and prints summary", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "my-agent",
        removedPath: path.join(tempDir, "agents", "my-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: false,
      });

      await agentRemoveCommand("my-agent", {});

      expect(mockedRemoveAgent).toHaveBeenCalledWith({
        name: "my-agent",
        configPath: expect.stringContaining("herdctl.yaml"),
        keepWorkspace: false,
      });
      expect(consoleLogs.some((log) => log.includes("Removing agent 'my-agent'"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Deleted"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Updated herdctl.yaml"))).toBe(true);
    });

    it("prints env variable summary when agent has env vars", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "env-agent",
        removedPath: path.join(tempDir, "agents", "env-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: false,
        envVariables: {
          variables: [
            { name: "DISCORD_WEBHOOK_URL" },
            { name: "WEBSITES" },
            { name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" },
          ],
          required: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
          optional: [{ name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" }],
        },
      });

      await agentRemoveCommand("env-agent", {});

      expect(consoleLogs.some((log) => log.includes("environment variables"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Required:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("DISCORD_WEBHOOK_URL"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("WEBSITES"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Optional:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("CRON_SCHEDULE"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("*/5 * * * *"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("remove these from your .env file"))).toBe(
        true,
      );
    });

    it("does not print env section when no env variables", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "no-env-agent",
        removedPath: path.join(tempDir, "agents", "no-env-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: false,
        envVariables: {
          variables: [],
          required: [],
          optional: [],
        },
      });

      await agentRemoveCommand("no-env-agent", {});

      expect(consoleLogs.some((log) => log.includes("environment variables"))).toBe(false);
    });

    it("shows workspace preserved message when keepWorkspace is true", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "workspace-agent",
        removedPath: path.join(tempDir, "agents", "workspace-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: true,
      });

      await agentRemoveCommand("workspace-agent", { keepWorkspace: true });

      expect(mockedRemoveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          keepWorkspace: true,
        }),
      );
      expect(consoleLogs.some((log) => log.includes("workspace preserved"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("handles AgentRemoveError (agent not found) gracefully", async () => {
      mockedRemoveAgent.mockRejectedValue(
        new AgentRemoveError("Agent 'nonexistent' not found", AGENT_NOT_FOUND),
      );

      await expect(agentRemoveCommand("nonexistent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Agent 'nonexistent' not found"))).toBe(true);
      expect(consoleErrors.some((e) => e.includes("herdctl agent list"))).toBe(true);
    });

    it("handles AgentRemoveError (other errors) gracefully", async () => {
      mockedRemoveAgent.mockRejectedValue(
        new AgentRemoveError("Some other error", "AGENT_REMOVE_ERROR"),
      );

      await expect(agentRemoveCommand("some-agent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Removal failed"))).toBe(true);
    });

    it("handles AgentDiscoveryError gracefully", async () => {
      mockedRemoveAgent.mockRejectedValue(
        new AgentDiscoveryError("Fleet config not found", "DISCOVERY_CONFIG_NOT_FOUND"),
      );

      await expect(agentRemoveCommand("any-agent", {})).rejects.toThrow("process.exit");

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Discovery failed"))).toBe(true);
    });

    it("re-throws unknown errors", async () => {
      mockedRemoveAgent.mockRejectedValue(new Error("Unknown error"));

      await expect(agentRemoveCommand("any-agent", {})).rejects.toThrow("Unknown error");
    });
  });

  describe("options handling", () => {
    it("passes keepWorkspace option to removeAgent", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "test-agent",
        removedPath: path.join(tempDir, "agents", "test-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: true,
      });

      await agentRemoveCommand("test-agent", { keepWorkspace: true });

      expect(mockedRemoveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          keepWorkspace: true,
        }),
      );
    });

    it("defaults keepWorkspace to false", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "test-agent",
        removedPath: path.join(tempDir, "agents", "test-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: false,
      });

      await agentRemoveCommand("test-agent", {});

      expect(mockedRemoveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          keepWorkspace: false,
        }),
      );
    });

    it("accepts force option (no-op for now)", async () => {
      mockedRemoveAgent.mockResolvedValue({
        agentName: "force-agent",
        removedPath: path.join(tempDir, "agents", "force-agent"),
        filesRemoved: true,
        configUpdated: true,
        workspacePreserved: false,
      });

      // force option is accepted but doesn't change behavior
      await agentRemoveCommand("force-agent", { force: true });

      expect(mockedRemoveAgent).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Fleet Tree View Tests
// =============================================================================

describe("buildFleetTree", () => {
  it("groups root-level agents under root node", () => {
    const agents = [
      { name: "agent-a", fleetPath: [], qualifiedName: "agent-a" },
      { name: "agent-b", fleetPath: [], qualifiedName: "agent-b" },
    ] as unknown as import("@herdctl/core").ResolvedAgent[];

    const tree = buildFleetTree(agents, "my-fleet", "My Fleet");

    expect(tree.name).toBe("my-fleet");
    expect(tree.description).toBe("My Fleet");
    expect(tree.agents).toEqual(["agent-a", "agent-b"]);
    expect(tree.children).toHaveLength(0);
  });

  it("creates child nodes for sub-fleet agents", () => {
    const agents = [
      { name: "engineer", fleetPath: ["herdctl"], qualifiedName: "herdctl.engineer" },
      { name: "tester", fleetPath: ["herdctl"], qualifiedName: "herdctl.tester" },
      { name: "agent-one", fleetPath: ["personal"], qualifiedName: "personal.agent-one" },
    ] as unknown as import("@herdctl/core").ResolvedAgent[];

    const tree = buildFleetTree(agents, "global");

    expect(tree.agents).toHaveLength(0);
    expect(tree.children).toHaveLength(2);

    const herdctl = tree.children.find((c) => c.name === "herdctl");
    expect(herdctl).toBeDefined();
    expect(herdctl!.agents).toEqual(["engineer", "tester"]);

    const personal = tree.children.find((c) => c.name === "personal");
    expect(personal).toBeDefined();
    expect(personal!.agents).toEqual(["agent-one"]);
  });

  it("handles nested fleet paths (multi-level)", () => {
    const agents = [
      {
        name: "deep-agent",
        fleetPath: ["level1", "level2"],
        qualifiedName: "level1.level2.deep-agent",
      },
    ] as unknown as import("@herdctl/core").ResolvedAgent[];

    const tree = buildFleetTree(agents, "root");

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe("level1");
    expect(tree.children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].name).toBe("level2");
    expect(tree.children[0].children[0].agents).toEqual(["deep-agent"]);
  });

  it("handles mix of root and sub-fleet agents", () => {
    const agents = [
      { name: "root-agent", fleetPath: [], qualifiedName: "root-agent" },
      { name: "sub-agent", fleetPath: ["sub"], qualifiedName: "sub.sub-agent" },
    ] as unknown as import("@herdctl/core").ResolvedAgent[];

    const tree = buildFleetTree(agents, "root");

    expect(tree.agents).toEqual(["root-agent"]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe("sub");
    expect(tree.children[0].agents).toEqual(["sub-agent"]);
  });
});

describe("renderFleetTree", () => {
  it("renders a simple tree with box-drawing characters", () => {
    const tree = buildFleetTree(
      [
        { name: "agent-one", fleetPath: ["personal"], qualifiedName: "personal.agent-one" },
        { name: "agent-two", fleetPath: ["personal"], qualifiedName: "personal.agent-two" },
        { name: "engineer", fleetPath: ["herdctl"], qualifiedName: "herdctl.engineer" },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      "global",
      "Fleet of Fleets",
    );

    const lines = renderFleetTree(tree);

    // Root line
    expect(lines[0]).toBe("global (Fleet of Fleets)");
    // Should contain sub-fleet names
    expect(lines.some((l) => l.includes("personal"))).toBe(true);
    expect(lines.some((l) => l.includes("herdctl"))).toBe(true);
    // Should contain agent names
    expect(lines.some((l) => l.includes("agent-one"))).toBe(true);
    expect(lines.some((l) => l.includes("agent-two"))).toBe(true);
    expect(lines.some((l) => l.includes("engineer"))).toBe(true);
    // Should use box-drawing characters
    expect(
      lines.some((l) => l.includes("\u251C\u2500\u2500") || l.includes("\u2514\u2500\u2500")),
    ).toBe(true);
  });

  it("uses end connector for last items", () => {
    const tree = buildFleetTree(
      [
        { name: "only-agent", fleetPath: ["sub"], qualifiedName: "sub.only-agent" },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      "root",
    );

    const lines = renderFleetTree(tree);

    // The sub-fleet should use end connector since it's the last child
    expect(lines[1]).toContain("\u2514\u2500\u2500 sub");
    // The only agent should also use end connector
    expect(lines[2]).toContain("\u2514\u2500\u2500 only-agent");
  });

  it("shows agent counts in summary mode", () => {
    const tree = buildFleetTree(
      [
        { name: "a1", fleetPath: ["sub"], qualifiedName: "sub.a1" },
        { name: "a2", fleetPath: ["sub"], qualifiedName: "sub.a2" },
        { name: "a3", fleetPath: ["sub"], qualifiedName: "sub.a3" },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      "root",
    );

    const lines = renderFleetTree(tree, "", true, true, true);

    // Should show count instead of individual names
    expect(lines.some((l) => l.includes("(3 agents)"))).toBe(true);
    // Should NOT show individual agent names
    expect(lines.some((l) => l.includes("a1"))).toBe(false);
    expect(lines.some((l) => l.includes("a2"))).toBe(false);
  });

  it("renders root-level agents", () => {
    const tree = buildFleetTree(
      [
        { name: "root-agent", fleetPath: [], qualifiedName: "root-agent" },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      "fleet",
    );

    const lines = renderFleetTree(tree);

    expect(lines[0]).toBe("fleet");
    expect(lines[1]).toContain("root-agent");
  });
});

describe("agentListCommand with sub-fleets (tree view)", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);

    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    exitCode = undefined;
    originalProcessExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    }) as never;

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  /** Create a fleet config with sub-fleets */
  function createFleetConfigWithSubFleets(dir: string): void {
    fs.writeFileSync(
      path.join(dir, "herdctl.yaml"),
      `version: 1

fleet:
  name: global
  description: Fleet of Fleets

fleets:
  - path: ./sub/herdctl.yaml
`,
      "utf-8",
    );
  }

  it("renders tree view when sub-fleets exist", async () => {
    createFleetConfigWithSubFleets(tempDir);

    mockedLoadConfig.mockResolvedValue({
      fleet: {
        version: 1,
        fleet: { name: "global", description: "Fleet of Fleets" },
        fleets: [{ path: "./sub/herdctl.yaml" }],
        agents: [],
      },
      agents: [
        {
          name: "engineer",
          fleetPath: ["herdctl"],
          qualifiedName: "herdctl.engineer",
          configPath: "/path/to/herdctl/agents/engineer/agent.yaml",
        },
        {
          name: "tester",
          fleetPath: ["herdctl"],
          qualifiedName: "herdctl.tester",
          configPath: "/path/to/herdctl/agents/tester/agent.yaml",
        },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      configPath: path.join(tempDir, "herdctl.yaml"),
      configDir: tempDir,
    });

    await agentListCommand({});

    expect(mockedLoadConfig).toHaveBeenCalled();
    // Should show tree with fleet name
    expect(consoleLogs.some((log) => log.includes("global"))).toBe(true);
    expect(consoleLogs.some((log) => log.includes("Fleet of Fleets"))).toBe(true);
    // Should show sub-fleet and agents
    expect(consoleLogs.some((log) => log.includes("herdctl"))).toBe(true);
    expect(consoleLogs.some((log) => log.includes("engineer"))).toBe(true);
    expect(consoleLogs.some((log) => log.includes("tester"))).toBe(true);
    // Should show total
    expect(consoleLogs.some((log) => log.includes("Total: 2 agents across fleet hierarchy"))).toBe(
      true,
    );
  });

  it("outputs JSON with fleet hierarchy info when --json is used", async () => {
    createFleetConfigWithSubFleets(tempDir);

    mockedLoadConfig.mockResolvedValue({
      fleet: {
        version: 1,
        fleet: { name: "global" },
        fleets: [{ path: "./sub/herdctl.yaml" }],
        agents: [],
      },
      agents: [
        {
          name: "engineer",
          fleetPath: ["herdctl"],
          qualifiedName: "herdctl.engineer",
          configPath: "/path/to/engineer/agent.yaml",
          description: "Engineering agent",
        },
      ] as unknown as import("@herdctl/core").ResolvedAgent[],
      configPath: path.join(tempDir, "herdctl.yaml"),
      configDir: tempDir,
    });

    await agentListCommand({ json: true });

    const output = consoleLogs.join("\n");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("engineer");
    expect(parsed[0].qualifiedName).toBe("herdctl.engineer");
    expect(parsed[0].fleetPath).toEqual(["herdctl"]);
  });

  it("shows helpful message when no agents across hierarchy", async () => {
    createFleetConfigWithSubFleets(tempDir);

    mockedLoadConfig.mockResolvedValue({
      fleet: {
        version: 1,
        fleet: { name: "global" },
        fleets: [{ path: "./sub/herdctl.yaml" }],
        agents: [],
      },
      agents: [],
      configPath: path.join(tempDir, "herdctl.yaml"),
      configDir: tempDir,
    });

    await agentListCommand({});

    expect(consoleLogs.some((log) => log.includes("No agents found across fleet hierarchy"))).toBe(
      true,
    );
    expect(consoleLogs.some((log) => log.includes("herdctl agent add"))).toBe(true);
  });

  it("handles ConfigError gracefully", async () => {
    createFleetConfigWithSubFleets(tempDir);

    mockedLoadConfig.mockRejectedValue(new ConfigError("Bad config"));

    await expect(agentListCommand({})).rejects.toThrow("process.exit");

    expect(exitCode).toBe(1);
    expect(consoleErrors.some((e) => e.includes("Config error"))).toBe(true);
  });

  it("handles ConfigNotFoundError gracefully", async () => {
    createFleetConfigWithSubFleets(tempDir);

    mockedLoadConfig.mockRejectedValue(new ConfigNotFoundError("/some/path", []));

    await expect(agentListCommand({})).rejects.toThrow("process.exit");

    expect(exitCode).toBe(1);
    expect(consoleErrors.some((e) => e.includes("Config error"))).toBe(true);
  });

  it("falls back to flat table when no sub-fleets in config", async () => {
    // Create a config WITHOUT fleets
    fs.writeFileSync(
      path.join(tempDir, "herdctl.yaml"),
      `version: 1

fleet:
  name: simple-fleet

agents: []
`,
      "utf-8",
    );

    mockedDiscoverAgents.mockResolvedValue({
      agents: [
        {
          name: "simple-agent",
          installed: false,
          path: "/path/to/agents/simple-agent",
          configPath: "./agents/simple-agent/agent.yaml",
        },
      ],
    });

    await agentListCommand({});

    // Should use discoverAgents, NOT loadConfig
    expect(mockedDiscoverAgents).toHaveBeenCalled();
    expect(mockedLoadConfig).not.toHaveBeenCalled();
    // Should show flat table
    expect(consoleLogs.some((log) => log.includes("Agents in fleet:"))).toBe(true);
    expect(consoleLogs.some((log) => log.includes("simple-agent"))).toBe(true);
  });
});
