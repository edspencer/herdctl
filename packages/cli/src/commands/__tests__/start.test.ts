import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { startCommand } from "../start.js";

// Store mock FleetManager for access in tests
let mockFleetManagerInstance: {
  initialize: Mock;
  start: Mock;
  stop: Mock;
  getFleetStatus: Mock;
  getAgentInfo: Mock;
  streamLogs: Mock;
};

// Mock the FleetManager from @herdctl/core
vi.mock("@herdctl/core", async () => {
  const actual = await vi.importActual("@herdctl/core");

  // Create a mock class that vitest can use as a constructor
  class MockFleetManager {
    initialize: Mock;
    start: Mock;
    stop: Mock;
    getFleetStatus: Mock;
    getAgentInfo: Mock;
    streamLogs: Mock;

    constructor() {
      this.initialize = vi.fn().mockResolvedValue(undefined);
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.getFleetStatus = vi.fn().mockResolvedValue({
        state: "running",
        uptimeSeconds: 0,
        initializedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        counts: {
          totalAgents: 2,
          idleAgents: 2,
          runningAgents: 0,
          errorAgents: 0,
          totalSchedules: 3,
          runningSchedules: 0,
          runningJobs: 0,
        },
        scheduler: {
          status: "running",
          checkCount: 0,
          triggerCount: 0,
          lastCheckAt: null,
          checkIntervalMs: 1000,
        },
        lastError: null,
      });
      this.getAgentInfo = vi.fn().mockResolvedValue([
        {
          name: "agent-a",
          qualifiedName: "agent-a",
          fleetPath: [],
          status: "idle",
          scheduleCount: 2,
          schedules: [],
        },
        {
          name: "agent-b",
          qualifiedName: "agent-b",
          fleetPath: [],
          status: "idle",
          scheduleCount: 1,
          schedules: [],
        },
      ]);
      this.streamLogs = vi.fn().mockImplementation(async function* () {
        // Immediately return to complete the generator
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

import { ConfigNotFoundError } from "@herdctl/core";

// Helper to create a temp directory
function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-cli-start-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

// Helper to clean up temp directory
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("startCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;

  // Store original signal handlers
  const originalSignalHandlers: Map<string, NodeJS.SignalsListener[]> = new Map();

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

    // Store and clear signal handlers
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      originalSignalHandlers.set(signal, process.listeners(signal) as NodeJS.SignalsListener[]);
      process.removeAllListeners(signal);
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tempDir);
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;

    // Restore original signal handlers
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.removeAllListeners(signal);
      const handlers = originalSignalHandlers.get(signal) ?? [];
      for (const handler of handlers) {
        process.on(signal, handler);
      }
    }
    originalSignalHandlers.clear();
  });

  describe("initialization", () => {
    it("creates FleetManager with correct options", async () => {
      await startCommand({});

      // FleetManager is instantiated
      expect(mockFleetManagerInstance).toBeDefined();
      expect(mockFleetManagerInstance.initialize).toHaveBeenCalled();
      expect(mockFleetManagerInstance.start).toHaveBeenCalled();
    });
  });

  describe("PID file", () => {
    it("writes PID file to state directory", async () => {
      await startCommand({});

      const pidFile = path.join(tempDir, ".herdctl", "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(true);

      const pidContent = fs.readFileSync(pidFile, "utf-8");
      expect(pidContent).toBe(process.pid.toString());
    });

    it("writes PID file to custom state directory", async () => {
      const customState = path.join(tempDir, "custom-state");

      await startCommand({ state: customState });

      const pidFile = path.join(customState, "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(true);
    });

    it("outputs PID file location", async () => {
      await startCommand({});

      expect(consoleLogs.some((log) => log.includes("PID file written"))).toBe(true);
    });
  });

  describe("startup output", () => {
    it("displays starting message", async () => {
      await startCommand({});

      expect(consoleLogs.some((log) => log.includes("Starting fleet"))).toBe(true);
    });

    it("displays fleet status after start", async () => {
      await startCommand({});

      expect(consoleLogs.some((log) => log.includes("Fleet Status"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Agents: 2"))).toBe(true);
      expect(consoleLogs.some((log) => log.includes("Schedules: 3"))).toBe(true);
    });

    it("displays Ctrl+C message", async () => {
      await startCommand({});

      expect(consoleLogs.some((log) => log.includes("Ctrl+C"))).toBe(true);
    });
  });

  describe("log streaming", () => {
    it("calls streamLogs with correct options", async () => {
      await startCommand({});

      expect(mockFleetManagerInstance.streamLogs).toHaveBeenCalledWith({
        level: "info",
        includeHistory: false,
      });
    });
  });

  describe("signal handlers", () => {
    it("registers SIGINT handler", async () => {
      await startCommand({});

      const listeners = process.listeners("SIGINT");
      expect(listeners.length).toBeGreaterThan(0);
    });

    it("registers SIGTERM handler", async () => {
      await startCommand({});

      const listeners = process.listeners("SIGTERM");
      expect(listeners.length).toBeGreaterThan(0);
    });
  });
});
