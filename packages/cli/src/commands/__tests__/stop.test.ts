import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { stopCommand } from "../stop.js";
import { spawn, type ChildProcess } from "node:child_process";

// Helper to create a temp directory
function createTempDir(): string {
  const baseDir = path.join(
    tmpdir(),
    `herdctl-cli-stop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(baseDir, { recursive: true });
  return fs.realpathSync(baseDir);
}

// Helper to clean up temp directory
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Helper to create state directory with PID file
function createStateWithPid(stateDir: string, pid: number): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "herdctl.pid"), pid.toString());
}

// Spawn a simple long-running process for testing
function spawnTestProcess(): ChildProcess {
  // Use node to run a simple sleep loop
  const child = spawn("node", ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

describe("stopCommand", () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogs: string[];
  let consoleErrors: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalProcessExit: typeof process.exit;
  let exitCode: number | undefined;
  let testProcesses: ChildProcess[];

  beforeEach(() => {
    tempDir = createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    testProcesses = [];

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

    // Clean up any test processes
    for (const proc of testProcesses) {
      try {
        if (proc.pid) {
          process.kill(proc.pid, "SIGKILL");
        }
      } catch {
        // Process might already be dead
      }
    }
  });

  describe("no PID file", () => {
    it("errors when no PID file exists", async () => {
      await expect(stopCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("No PID file found"))).toBe(true);
    });

    it("shows path to expected PID file", async () => {
      await expect(stopCommand({})).rejects.toThrow("process.exit(1)");
      expect(consoleErrors.some((e) => e.includes(".herdctl/herdctl.pid"))).toBe(true);
    });

    it("uses custom state directory when specified", async () => {
      const customState = path.join(tempDir, "custom-state");

      await expect(stopCommand({ state: customState })).rejects.toThrow("process.exit(1)");
      expect(consoleErrors.some((e) => e.includes("custom-state/herdctl.pid"))).toBe(true);
    });
  });

  describe("stale PID file", () => {
    it("errors and cleans up when process is not running", async () => {
      const stateDir = path.join(tempDir, ".herdctl");
      // Use a PID that definitely doesn't exist (high number)
      createStateWithPid(stateDir, 999999999);

      await expect(stopCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("not running"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Cleaning up stale PID file"))).toBe(true);

      // PID file should be removed
      const pidFile = path.join(stateDir, "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe("graceful stop", () => {
    it("sends SIGTERM and waits for process exit", async () => {
      const stateDir = path.join(tempDir, ".herdctl");
      const proc = spawnTestProcess();
      testProcesses.push(proc);

      if (!proc.pid) {
        throw new Error("Failed to spawn test process");
      }

      createStateWithPid(stateDir, proc.pid);

      // Use a short timeout
      await stopCommand({ timeout: 1 });

      // Process should have been killed (either by SIGTERM or SIGKILL after timeout)
      expect(consoleLogs.some((l) => l.includes("Stopping fleet"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Fleet stopped"))).toBe(true);

      // PID file should be removed
      const pidFile = path.join(stateDir, "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(false);
    });

    it("uses default timeout of 30 seconds", async () => {
      const stateDir = path.join(tempDir, ".herdctl");

      // Create a process that ignores SIGTERM temporarily
      const proc = spawn(
        "node",
        [
          "-e",
          "process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 100) }); setInterval(() => {}, 1000)",
        ],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      proc.unref();
      testProcesses.push(proc);

      if (!proc.pid) {
        throw new Error("Failed to spawn test process");
      }

      createStateWithPid(stateDir, proc.pid);

      await stopCommand({});

      expect(consoleLogs.some((l) => l.includes("30 seconds"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Fleet stopped"))).toBe(true);
    });

    it("uses custom timeout", async () => {
      const stateDir = path.join(tempDir, ".herdctl");

      // Create a process that ignores SIGTERM temporarily
      const proc = spawn(
        "node",
        [
          "-e",
          "process.on('SIGTERM', () => { setTimeout(() => process.exit(0), 100) }); setInterval(() => {}, 1000)",
        ],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      proc.unref();
      testProcesses.push(proc);

      if (!proc.pid) {
        throw new Error("Failed to spawn test process");
      }

      createStateWithPid(stateDir, proc.pid);

      await stopCommand({ timeout: 5 });

      expect(consoleLogs.some((l) => l.includes("5 seconds"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Fleet stopped"))).toBe(true);
    });
  });

  describe("force stop", () => {
    it("sends SIGKILL immediately with --force", async () => {
      const stateDir = path.join(tempDir, ".herdctl");
      const proc = spawnTestProcess();
      testProcesses.push(proc);

      if (!proc.pid) {
        throw new Error("Failed to spawn test process");
      }

      createStateWithPid(stateDir, proc.pid);

      await stopCommand({ force: true });

      expect(consoleLogs.some((l) => l.includes("Force stopping"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Fleet stopped"))).toBe(true);

      // PID file should be removed
      const pidFile = path.join(stateDir, "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe("timeout behavior", () => {
    it("force kills after timeout when process doesn't exit", async () => {
      const stateDir = path.join(tempDir, ".herdctl");

      // Create a script file that ignores SIGTERM (Node.js default behavior for SIGTERM is to exit)
      // We need to use a shell process with trap to truly ignore SIGTERM
      const scriptFile = path.join(tempDir, "ignore-sigterm.sh");
      fs.writeFileSync(
        scriptFile,
        `#!/bin/bash
trap '' SIGTERM
while true; do sleep 0.1; done
`,
        { mode: 0o755 },
      );

      const proc = spawn("bash", [scriptFile], {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();
      testProcesses.push(proc);

      if (!proc.pid) {
        throw new Error("Failed to spawn test process");
      }

      // Give the process time to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      createStateWithPid(stateDir, proc.pid);

      // Very short timeout to make test fast - process will definitely not exit in time
      await stopCommand({ timeout: 1 });

      expect(consoleLogs.some((l) => l.includes("Timeout reached"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Force killing"))).toBe(true);
      expect(consoleLogs.some((l) => l.includes("Fleet stopped"))).toBe(true);

      // PID file should be removed
      const pidFile = path.join(stateDir, "herdctl.pid");
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe("invalid PID file", () => {
    it("errors when PID file contains invalid content", async () => {
      const stateDir = path.join(tempDir, ".herdctl");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "herdctl.pid"), "not-a-number");

      await expect(stopCommand({})).rejects.toThrow("process.exit(1)");
      expect(exitCode).toBe(1);
      expect(consoleErrors.some((e) => e.includes("No PID file found"))).toBe(true);
    });
  });
});
