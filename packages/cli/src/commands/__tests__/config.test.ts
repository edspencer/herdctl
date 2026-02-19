import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { configValidateCommand, configShowCommand } from "../config.js";

// Helper to create a temp directory
function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-cli-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

// Helper to clean up temp directory
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Helper to create a valid fleet config
function createFleetConfig(dir: string, overrides: Record<string, unknown> = {}): void {
  const config = {
    version: 1,
    fleet: { name: "test-fleet", description: "A test fleet" },
    agents: [{ path: "./agents/test-agent.yaml" }],
    ...overrides,
  };

  // Convert to YAML manually for simplicity
  let yaml = `version: ${config.version}\n`;
  yaml += `fleet:\n  name: ${(config.fleet as { name: string }).name}\n`;
  if ((config.fleet as { description?: string }).description) {
    yaml += `  description: ${(config.fleet as { description: string }).description}\n`;
  }
  yaml += `agents:\n`;
  for (const agent of config.agents as { path: string }[]) {
    yaml += `  - path: ${agent.path}\n`;
  }

  fs.writeFileSync(path.join(dir, "herdctl.yaml"), yaml, "utf-8");
}

// Helper to create a valid agent config
function createAgentConfig(dir: string, filename: string, name: string): void {
  const agentsDir = path.join(dir, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });

  const yaml = `name: ${name}
description: A test agent
schedules:
  heartbeat:
    type: interval
    interval: 5m
    prompt: Hello
`;
  fs.writeFileSync(path.join(agentsDir, filename), yaml, "utf-8");
}

describe("configValidateCommand", () => {
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

    // Capture console output
    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    // Mock process.exit
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

  describe("valid configuration", () => {
    it("validates a valid configuration", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configValidateCommand({})).rejects.toThrow("process.exit(0)");
      expect(exitCode).toBe(0);
      expect(consoleLogs.some((log) => log.includes("Configuration is valid"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("test-fleet"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("test-agent"))).toBe(true);
    });

    it("shows agent count", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configValidateCommand({})).rejects.toThrow("process.exit(0)");
      expect(consoleLogs.some((log) => log.includes("Agents: 1"))).toBe(true);
    });

    it("accepts --config option to specify path", async () => {
      const subdir = path.join(tempDir, "subproject");
      fs.mkdirSync(subdir, { recursive: true });
      createFleetConfig(subdir);
      createAgentConfig(subdir, "test-agent.yaml", "test-agent");

      await expect(
        configValidateCommand({ config: path.join(subdir, "herdctl.yaml") }),
      ).rejects.toThrow("process.exit(0)");
      expect(exitCode).toBe(0);
    });
  });

  describe("missing configuration", () => {
    it("reports error when no config file found", async () => {
      await expect(configValidateCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("No configuration file found"))).toBe(true);
    });

    it("suggests fix when no config file found with --fix", async () => {
      await expect(configValidateCommand({ fix: true })).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("herdctl init"))).toBe(true);
    });
  });

  describe("YAML syntax errors", () => {
    it("reports YAML syntax errors", async () => {
      // Use genuinely invalid YAML with unclosed quote
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        'version: 1\nagents:\n  - path: "./unclosed\n',
        "utf-8",
      );

      await expect(configValidateCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      // The loader may wrap it differently, check for any syntax-related error
      expect(
        consoleErrors.some(
          (e) =>
            e.includes("YAML syntax error") ||
            e.includes("Invalid YAML syntax") ||
            e.includes("Unexpected end"),
        ),
      ).toBe(true);
    });

    it("shows fix suggestions for YAML errors with --fix", async () => {
      // Use genuinely invalid YAML with unclosed quote
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        'version: 1\nagents:\n  - path: "./unclosed\n',
        "utf-8",
      );

      await expect(configValidateCommand({ fix: true })).rejects.toThrow("process.exit(1)");
      // Check for fix suggestions (indentation or other common issues)
      expect(
        consoleErrors.some(
          (e) => e.includes("indentation") || e.includes("YAML syntax") || e.includes("Fix:"),
        ),
      ).toBe(true);
    });
  });

  describe("schema validation errors", () => {
    it("reports all schema validation errors", async () => {
      // Missing required 'name' field on agent
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        "version: 1\nagents:\n  - path: ./agents/invalid.yaml\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tempDir, "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "agents", "invalid.yaml"),
        "description: Missing name field",
        "utf-8",
      );

      await expect(configValidateCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Failed to load agent"))).toBe(true);
    });

    it("shows fix suggestions for schema errors with --fix", async () => {
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        "version: 1\nagents:\n  - path: ./agents/invalid.yaml\n",
        "utf-8",
      );
      fs.mkdirSync(path.join(tempDir, "agents"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "agents", "invalid.yaml"),
        "description: Missing name field",
        "utf-8",
      );

      await expect(configValidateCommand({ fix: true })).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
    });
  });

  describe("agent load errors", () => {
    it("reports missing agent file", async () => {
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        "version: 1\nagents:\n  - path: ./agents/nonexistent.yaml\n",
        "utf-8",
      );

      await expect(configValidateCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Failed to load agent"))).toBe(true);
    });

    it("suggests fix for missing agent with --fix", async () => {
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        "version: 1\nagents:\n  - path: ./agents/nonexistent.yaml\n",
        "utf-8",
      );

      await expect(configValidateCommand({ fix: true })).rejects.toThrow("process.exit(1)");
      expect(consoleErrors.some((e) => e.includes("file exists"))).toBe(true);
    });
  });
});

describe("configShowCommand", () => {
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

    // Capture console output
    consoleLogs = [];
    consoleErrors = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => consoleLogs.push(args.join(" "));
    console.error = (...args: unknown[]) => consoleErrors.push(args.join(" "));

    // Mock process.exit
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

  describe("human-readable output", () => {
    it("shows fleet configuration", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({})).rejects.toThrow("process.exit(0)");
      expect(exitCode).toBe(0);
      expect(consoleLogs.some((log) => log.includes("Fleet Configuration"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Name: test-fleet"))).toBe(true);
    });

    it("shows agents section", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({})).rejects.toThrow("process.exit(0)");
      expect(consoleLogs.some((log) => log.includes("Agents (1)"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("[test-agent]"))).toBe(true);
    });

    it("shows schedule information", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({})).rejects.toThrow("process.exit(0)");
      expect(consoleLogs.some((log) => log.includes("Schedules:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("heartbeat"))).toBe(true);
    });

    it("shows defaults when present", async () => {
      fs.writeFileSync(
        path.join(tempDir, "herdctl.yaml"),
        `version: 1
fleet:
  name: test-fleet
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
agents:
  - path: ./agents/test-agent.yaml
`,
        "utf-8",
      );
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({})).rejects.toThrow("process.exit(0)");
      expect(consoleLogs.some((log) => log.includes("Defaults"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Model: claude-sonnet-4-20250514"))).toBe(true);
    });
  });

  describe("JSON output", () => {
    it("outputs valid JSON with --json", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({ json: true })).rejects.toThrow("process.exit(0)");
      expect(exitCode).toBe(0);

      // Combine all logs and parse as JSON
      const output = consoleLogs.join("\n");
      const parsed = JSON.parse(output);

      expect(parsed).toHaveProperty("fleet");
      expect(parsed).toHaveProperty("agents");
      expect(parsed).toHaveProperty("configPath");
      expect(parsed.fleet.fleet.name).toBe("test-fleet");
      expect(parsed.agents).toHaveLength(1);
      expect(parsed.agents[0].name).toBe("test-agent");
    });

    it("includes all agent properties in JSON output", async () => {
      createFleetConfig(tempDir);
      createAgentConfig(tempDir, "test-agent.yaml", "test-agent");

      await expect(configShowCommand({ json: true })).rejects.toThrow("process.exit(0)");

      const output = consoleLogs.join("\n");
      const parsed = JSON.parse(output);

      const agent = parsed.agents[0];
      expect(agent.name).toBe("test-agent");
      expect(agent.description).toBe("A test agent");
      expect(agent.schedules).toHaveProperty("heartbeat");
    });
  });

  describe("error handling", () => {
    it("reports error for invalid config", async () => {
      await expect(configShowCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("Error loading configuration"))).toBe(true);
    });

    it("suggests running validate for more info", async () => {
      await expect(configShowCommand({})).rejects.toThrow("process.exit(1)");
      expect(consoleErrors.some((e) => e.includes("herdctl config validate"))).toBe(true);
    });

    it("accepts --config option", async () => {
      const subdir = path.join(tempDir, "subproject");
      fs.mkdirSync(subdir, { recursive: true });
      createFleetConfig(subdir);
      createAgentConfig(subdir, "test-agent.yaml", "test-agent");

      await expect(
        configShowCommand({ config: path.join(subdir, "herdctl.yaml") }),
      ).rejects.toThrow("process.exit(0)");
      expect(exitCode).toBe(0);
    });
  });
});
