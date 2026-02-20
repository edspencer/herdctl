import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
}));

// Mock child_process for docker detection
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { confirm, input, select } from "@inquirer/prompts";
import { initAgentCommand } from "../init-agent.js";

const mockedInput = vi.mocked(input);
const mockedConfirm = vi.mocked(confirm);
const mockedSelect = vi.mocked(select);
const mockedExecSync = vi.mocked(execSync);

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

/** Create a minimal herdctl.yaml for agent init tests */
function createFleetConfig(dir: string, content?: string): void {
  fs.writeFileSync(
    path.join(dir, "herdctl.yaml"),
    content ||
      `version: 1

fleet:
  name: test-fleet

agents: []
`,
    "utf-8",
  );
}

/** Set up interactive mocks for a default agent creation flow */
function setupInteractiveMocks(overrides?: {
  name?: string;
  description?: string;
  permissionMode?: string;
  docker?: boolean;
  runtime?: string;
  discord?: boolean;
  slack?: boolean;
}): void {
  const opts = {
    name: "test-agent",
    description: "",
    permissionMode: "default",
    docker: false,
    runtime: "sdk",
    discord: false,
    slack: false,
    ...overrides,
  };

  // If name is provided, the first input call is for description
  // If name is not provided via arg, the first input call is for name
  mockedInput.mockResolvedValueOnce(opts.description); // description
  mockedSelect.mockResolvedValueOnce(opts.permissionMode); // permission mode
  mockedConfirm.mockResolvedValueOnce(opts.docker); // docker
  mockedSelect.mockResolvedValueOnce(opts.runtime); // runtime
  mockedConfirm.mockResolvedValueOnce(opts.discord); // discord
  mockedConfirm.mockResolvedValueOnce(opts.slack); // slack
}

describe("initAgentCommand", () => {
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

    // Default: docker not available
    mockedExecSync.mockImplementation(() => {
      throw new Error("docker not found");
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
  });

  describe("prerequisites", () => {
    it("errors if herdctl.yaml does not exist", async () => {
      await expect(initAgentCommand("my-agent", { yes: true })).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("No herdctl.yaml found"))).toBe(true);
    });

    it("errors if agent file already exists without --force", async () => {
      createFleetConfig(tempDir);
      fs.mkdirSync(path.join(tempDir, "agents"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "name: my-agent");

      await expect(initAgentCommand("my-agent", { yes: true })).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("already exists"))).toBe(true);
    });

    it("overwrites agent file with --force", async () => {
      createFleetConfig(tempDir);
      fs.mkdirSync(path.join(tempDir, "agents"), { recursive: true });
      fs.writeFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "name: old-agent");

      await initAgentCommand("my-agent", { yes: true, force: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("name: my-agent");
    });
  });

  describe("non-interactive mode (--yes)", () => {
    it("requires name arg with --yes", async () => {
      createFleetConfig(tempDir);

      await expect(initAgentCommand(undefined, { yes: true })).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Agent name is required"))).toBe(true);
    });

    it("creates agent with defaults", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const agentPath = path.join(tempDir, "agents", "my-agent.yaml");
      expect(fs.existsSync(agentPath)).toBe(true);

      const content = fs.readFileSync(agentPath, "utf-8");
      expect(content).toContain("name: my-agent");
      expect(content).toContain("permission_mode: default");
      expect(content).toContain("runtime: sdk");
    });

    it("respects --description flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, description: "A test agent" });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("description: A test agent");
    });

    it("respects --permission-mode flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, permissionMode: "acceptEdits" });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("permission_mode: acceptEdits");
    });

    it("respects --docker flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, docker: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("docker:");
      expect(content).toContain("enabled: true");
    });

    it("respects --runtime flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, runtime: "cli" });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("runtime: cli");
    });

    it("respects --discord flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, discord: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("chat:");
      expect(content).toContain("discord:");
      expect(content).toContain("bot_token_env: DISCORD_BOT_TOKEN");
    });

    it("respects --slack flag", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, slack: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("chat:");
      expect(content).toContain("slack:");
      expect(content).toContain("bot_token_env: SLACK_BOT_TOKEN");
    });

    it("validates invalid permission mode", async () => {
      createFleetConfig(tempDir);

      await expect(
        initAgentCommand("my-agent", { yes: true, permissionMode: "invalid" }),
      ).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Invalid permission mode"))).toBe(true);
    });

    it("validates invalid runtime", async () => {
      createFleetConfig(tempDir);

      await expect(initAgentCommand("my-agent", { yes: true, runtime: "invalid" })).rejects.toThrow(
        "process.exit",
      );
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Invalid runtime"))).toBe(true);
    });

    it("validates invalid agent name", async () => {
      createFleetConfig(tempDir);

      await expect(initAgentCommand("--bad-name", { yes: true })).rejects.toThrow("process.exit");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Agent name must start"))).toBe(true);
    });
  });

  describe("interactive prompts", () => {
    it("prompts for name when not provided as arg", async () => {
      createFleetConfig(tempDir);
      mockedInput.mockResolvedValueOnce("prompted-agent"); // name
      setupInteractiveMocks();

      await initAgentCommand(undefined, {});

      expect(mockedInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Agent name:",
        }),
      );
    });

    it("uses name from arg without prompting for it", async () => {
      createFleetConfig(tempDir);
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      // First input call should be for description, not name
      expect(mockedInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Description (optional):",
        }),
      );
    });

    it("prompts for permission mode with correct choices", async () => {
      createFleetConfig(tempDir);
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      expect(mockedSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Permission mode:",
        }),
      );
    });

    it("prompts for Docker with correct default when available", async () => {
      createFleetConfig(tempDir);
      mockedExecSync.mockReturnValueOnce(Buffer.from("Docker version 24.0.0"));
      setupInteractiveMocks({ docker: true });

      await initAgentCommand("my-agent", {});

      expect(mockedConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Enable Docker isolation?",
          default: true,
        }),
      );
    });

    it("prompts for Docker with default=false when unavailable", async () => {
      createFleetConfig(tempDir);
      mockedExecSync.mockImplementation(() => {
        throw new Error("not found");
      });
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      expect(mockedConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Enable Docker isolation?",
          default: false,
        }),
      );
    });

    it("prompts for runtime", async () => {
      createFleetConfig(tempDir);
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      expect(mockedSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Runtime:",
        }),
      );
    });

    it("prompts for Discord", async () => {
      createFleetConfig(tempDir);
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      expect(mockedConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Connect to Discord?",
          default: false,
        }),
      );
    });

    it("prompts for Slack", async () => {
      createFleetConfig(tempDir);
      setupInteractiveMocks();

      await initAgentCommand("my-agent", {});

      expect(mockedConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Connect to Slack?",
          default: false,
        }),
      );
    });
  });

  describe("agent YAML generation", () => {
    it("includes commented-out schedule section", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("# schedules:");
      expect(content).toContain("#     type: interval");
      expect(content).toContain("#     type: cron");
    });

    it("includes commented-out system prompt", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("# system_prompt:");
    });

    it("includes both Discord and Slack under chat when both selected", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, discord: true, slack: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).toContain("chat:");
      expect(content).toContain("  discord:");
      expect(content).toContain("  slack:");
      // chat: should only appear once
      const chatCount = (content.match(/^chat:$/m) || []).length;
      expect(chatCount).toBe(1);
    });

    it("does not include docker block when docker is disabled", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, docker: false });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).not.toContain("docker:");
      expect(content).not.toContain("enabled: true");
    });

    it("does not include chat block when neither discord nor slack selected", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "agents", "my-agent.yaml"), "utf-8");
      expect(content).not.toContain("chat:");
    });
  });

  describe("herdctl.yaml modification", () => {
    it("appends agent path to agents array", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("path: ./agents/my-agent.yaml");
    });

    it("preserves existing agents in the array", async () => {
      createFleetConfig(
        tempDir,
        `version: 1

fleet:
  name: test-fleet

agents:
  - path: ./agents/existing-agent.yaml
`,
      );

      await initAgentCommand("new-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("path: ./agents/existing-agent.yaml");
      expect(content).toContain("path: ./agents/new-agent.yaml");
    });

    it("handles empty agents: [] array", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      const content = fs.readFileSync(path.join(tempDir, "herdctl.yaml"), "utf-8");
      expect(content).toContain("path: ./agents/my-agent.yaml");
      // Should no longer have the empty [] form
      expect(content).not.toContain("agents: []");
    });
  });

  describe("output", () => {
    it("prints created file paths", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true });

      expect(consoleLogs.some((log) => log.includes("agents/my-agent.yaml"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Added agent"))).toBe(true);
    });

    it("prints Discord env var reminder when Discord is selected", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, discord: true });

      expect(consoleLogs.some((log) => log.includes("DISCORD_BOT_TOKEN"))).toBe(true);
    });

    it("prints Slack env var reminder when Slack is selected", async () => {
      createFleetConfig(tempDir);

      await initAgentCommand("my-agent", { yes: true, slack: true });

      expect(consoleLogs.some((log) => log.includes("SLACK_BOT_TOKEN"))).toBe(true);
    });
  });
});
