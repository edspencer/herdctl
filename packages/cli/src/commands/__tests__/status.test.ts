import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { statusCommand } from "../status.js";

// Store mock FleetManager for access in tests
let mockFleetManagerInstance: {
  initialize: Mock;
  getFleetStatus: Mock;
  getAgentInfo: Mock;
  getAgentInfoByName: Mock;
};

// Mock FleetStatus data
const mockFleetStatus = {
  state: "running",
  uptimeSeconds: 3661, // 1h 1m 1s
  initializedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  stoppedAt: null,
  counts: {
    totalAgents: 2,
    idleAgents: 1,
    runningAgents: 1,
    errorAgents: 0,
    totalSchedules: 3,
    runningSchedules: 1,
    runningJobs: 1,
  },
  scheduler: {
    status: "running",
    checkCount: 100,
    triggerCount: 5,
    lastCheckAt: new Date().toISOString(),
    checkIntervalMs: 1000,
  },
  lastError: null,
};

// Current agent info to return (can be overridden per test)
let currentAgentInfo: typeof mockAgentInfo;

// Mock AgentInfo data
const mockAgentInfo = [
  {
    name: "code-reviewer",
    qualifiedName: "code-reviewer",
    fleetPath: [] as string[],
    description: "Reviews pull requests",
    status: "running",
    currentJobId: "job-2024-01-15-abc123",
    lastJobId: "job-2024-01-14-xyz789",
    maxConcurrent: 1,
    runningCount: 1,
    errorMessage: null,
    scheduleCount: 2,
    schedules: [
      {
        name: "hourly",
        agentName: "code-reviewer",
        type: "interval",
        interval: "1h",
        status: "running",
        lastRunAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30m ago
        nextRunAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // in 30m
        lastError: null,
      },
      {
        name: "daily",
        agentName: "code-reviewer",
        type: "cron",
        cron: "0 9 * * *",
        status: "idle",
        lastRunAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12h ago
        nextRunAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // in 12h
        lastError: null,
      },
    ],
    model: "claude-sonnet-4-20250514",
    working_directory: "/projects/my-app",
  },
  {
    name: "issue-triage",
    qualifiedName: "issue-triage",
    fleetPath: [] as string[],
    description: "Triages GitHub issues",
    status: "idle",
    currentJobId: null,
    lastJobId: "job-2024-01-13-def456",
    maxConcurrent: 2,
    runningCount: 0,
    errorMessage: null,
    scheduleCount: 1,
    schedules: [
      {
        name: "every-15m",
        agentName: "issue-triage",
        type: "interval",
        interval: "15m",
        status: "idle",
        lastRunAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10m ago
        nextRunAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // in 5m
        lastError: null,
      },
    ],
    model: undefined,
    working_directory: undefined,
  },
];

// Mock the FleetManager from @herdctl/core
vi.mock("@herdctl/core", async () => {
  const actual = await vi.importActual("@herdctl/core");

  // Create a mock class that vitest can use as a constructor
  class MockFleetManager {
    initialize: Mock;
    getFleetStatus: Mock;
    getAgentInfo: Mock;
    getAgentInfoByName: Mock;

    constructor() {
      this.initialize = vi.fn().mockResolvedValue(undefined);
      this.getFleetStatus = vi.fn().mockResolvedValue(mockFleetStatus);
      this.getAgentInfo = vi.fn().mockImplementation(() => Promise.resolve(currentAgentInfo));
      this.getAgentInfoByName = vi.fn().mockImplementation((name: string) => {
        const agent = currentAgentInfo.find((a) => a.name === name || a.qualifiedName === name);
        if (!agent) {
          const error = new (
            actual as { AgentNotFoundError: new (message: string) => Error }
          ).AgentNotFoundError(`Agent '${name}' not found`);
          return Promise.reject(error);
        }
        return Promise.resolve(agent);
      });

      // Store reference for test access
      mockFleetManagerInstance = this;
    }
  }

  return {
    ...actual,
    FleetManager: MockFleetManager,
  };
});

// Helper to create a temp directory
function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-cli-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

// Helper to clean up temp directory
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("statusCommand", () => {
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

    // Reset agent info to default for each test
    currentAgentInfo = mockAgentInfo;

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
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
    vi.clearAllMocks();
  });

  describe("fleet overview (herdctl status)", () => {
    it("calls FleetManager methods correctly", async () => {
      await statusCommand(undefined, {});

      expect(mockFleetManagerInstance.initialize).toHaveBeenCalled();
      expect(mockFleetManagerInstance.getFleetStatus).toHaveBeenCalled();
      expect(mockFleetManagerInstance.getAgentInfo).toHaveBeenCalled();
    });

    it("displays fleet status header", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("Fleet Status"))).toBe(true);
    });

    it("displays fleet state", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("State:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("running"))).toBe(true);
    });

    it("displays uptime", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("Uptime:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("1h 1m 1s"))).toBe(true);
    });

    it("displays agent counts", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("Agents:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("2 total"))).toBe(true);
    });

    it("displays scheduler info", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("Scheduler"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Checks:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("100"))).toBe(true);
    });

    it("displays agents table", async () => {
      await statusCommand(undefined, {});

      expect(consoleLogs.some((log) => log.includes("Agents"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("NAME"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("code-reviewer"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("issue-triage"))).toBe(true);
    });

    it("uses flat table for single-fleet configs (no sub-fleets)", async () => {
      await statusCommand(undefined, {});

      // Should show flat table with NAME header
      expect(consoleLogs.some((log) => log.includes("NAME"))).toBe(true);
      // Should NOT show fleet grouping arrows
      expect(consoleLogs.some((log) => log.includes("▼"))).toBe(false);
    });

    it("shows hierarchical display when sub-fleets are present", async () => {
      currentAgentInfo = [
        {
          name: "security-auditor",
          qualifiedName: "herdctl.security-auditor",
          fleetPath: ["herdctl"],
          description: "Audits security",
          status: "running",
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 1,
          schedules: [],
        },
        {
          name: "engineer",
          qualifiedName: "herdctl.engineer",
          fleetPath: ["herdctl"],
          description: "Writes code",
          status: "idle",
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
        {
          name: "monitor",
          qualifiedName: "monitor",
          fleetPath: [],
          description: "Monitors everything",
          status: "idle",
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
        },
      ] as unknown as typeof mockAgentInfo;

      await statusCommand(undefined, {});

      // Should show fleet grouping with arrows
      expect(consoleLogs.some((log) => log.includes("herdctl"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("security-auditor"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("engineer"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("monitor"))).toBe(true);
    });
  });

  describe("agent detail view (herdctl status <agent>)", () => {
    it("calls getAgentInfoByName with agent name", async () => {
      await statusCommand("code-reviewer", {});

      expect(mockFleetManagerInstance.getAgentInfoByName).toHaveBeenCalledWith("code-reviewer");
    });

    it("displays agent name in header", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Agent: code-reviewer"))).toBe(true);
    });

    it("displays agent description", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Description:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Reviews pull requests"))).toBe(true);
    });

    it("displays agent status", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Status:"))).toBe(true);
    });

    it("displays configuration section", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Configuration"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Model:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Working Directory:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Concurrency:"))).toBe(true);
    });

    it("displays jobs section", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Jobs"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Running:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Current:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Last:"))).toBe(true);
    });

    it("displays schedules section", async () => {
      await statusCommand("code-reviewer", {});

      expect(consoleLogs.some((log) => log.includes("Schedules"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("hourly"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("daily"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Interval:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Cron:"))).toBe(true);
    });

    it("shows qualified name in header for sub-fleet agents", async () => {
      currentAgentInfo = [
        {
          name: "security-auditor",
          qualifiedName: "herdctl.security-auditor",
          fleetPath: ["herdctl"],
          description: "Audits security",
          status: "running",
          currentJobId: null,
          lastJobId: null,
          maxConcurrent: 1,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 0,
          schedules: [],
          model: undefined,
          working_directory: undefined,
        },
      ] as unknown as typeof mockAgentInfo;

      await statusCommand("herdctl.security-auditor", {});

      expect(consoleLogs.some((log) => log.includes("Agent: herdctl.security-auditor"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Fleet:"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("herdctl"))).toBe(true);
    });

    it("handles agent not found", async () => {
      try {
        await statusCommand("nonexistent-agent", {});
      } catch {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(consoleErrors.some((err) => err.includes("Agent 'nonexistent-agent' not found"))).toBe(
        true,
      );
    });
  });

  describe("JSON output (--json)", () => {
    it("outputs valid JSON for fleet status", async () => {
      await statusCommand(undefined, { json: true });

      expect(consoleLogs.length).toBe(1);
      const output = JSON.parse(consoleLogs[0]);
      expect(output).toHaveProperty("fleet");
      expect(output).toHaveProperty("agents");
      expect(output.fleet.state).toBe("running");
      expect(output.agents).toHaveLength(2);
    });

    it("outputs valid JSON for agent status", async () => {
      await statusCommand("code-reviewer", { json: true });

      expect(consoleLogs.length).toBe(1);
      const output = JSON.parse(consoleLogs[0]);
      expect(output).toHaveProperty("agent");
      expect(output.agent.name).toBe("code-reviewer");
    });

    it("outputs JSON error for agent not found", async () => {
      try {
        await statusCommand("nonexistent-agent", { json: true });
      } catch {
        // Expected to throw due to process.exit mock
      }

      expect(exitCode).toBe(1);
      expect(consoleLogs.length).toBe(1);
      const output = JSON.parse(consoleLogs[0]);
      expect(output).toHaveProperty("error");
      expect(output.error.code).toBe("AGENT_NOT_FOUND");
    });
  });

  describe("relative time formatting", () => {
    it("formats future times correctly", async () => {
      await statusCommand(undefined, {});

      // Check that relative time is displayed
      expect(consoleLogs.some((log) => log.includes("in "))).toBe(true);
    });

    it("formats past times correctly", async () => {
      await statusCommand("code-reviewer", {});

      // Check that relative time is displayed
      expect(consoleLogs.some((log) => log.includes("ago"))).toBe(true);
    });
  });

  describe("NO_COLOR support", () => {
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalNoColor = process.env.NO_COLOR;
    });

    afterEach(() => {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    });

    it("does not include ANSI codes when NO_COLOR is set", async () => {
      process.env.NO_COLOR = "1";

      await statusCommand(undefined, {});

      // Check that no ANSI escape codes are present
      const hasAnsiCodes = consoleLogs.some((log) => log.includes("\x1b["));
      expect(hasAnsiCodes).toBe(false);
    });
  });

  describe("custom paths", () => {
    it("respects custom state directory", async () => {
      const customState = path.join(tempDir, "custom-state");

      await statusCommand(undefined, { state: customState });

      // FleetManager should be called - we're just verifying it doesn't crash
      expect(mockFleetManagerInstance.initialize).toHaveBeenCalled();
    });

    it("respects custom config path", async () => {
      const customConfig = path.join(tempDir, "custom-config.yaml");

      await statusCommand(undefined, { config: customConfig });

      // FleetManager should be called - we're just verifying it doesn't crash
      expect(mockFleetManagerInstance.initialize).toHaveBeenCalled();
    });
  });
});
