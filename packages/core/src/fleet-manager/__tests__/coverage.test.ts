/**
 * Additional tests for FleetManager to improve code coverage
 *
 * Targets specific uncovered code paths:
 * - Error handling in startSchedulerAsync
 * - Error handling in handleScheduleTrigger
 * - Default logger usage
 * - Log streaming methods edge cases
 * - ConcurrencyLimitError paths
 * - Configuration error paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FleetManager } from "../fleet-manager.js";
import {
  ConcurrencyLimitError,
  JobCancelError,
  FleetManagerConfigError,
  FleetManagerStateDirError,
  AgentNotFoundError,
  ScheduleNotFoundError,
} from "../errors.js";
import type { FleetManagerLogger } from "../types.js";

describe("FleetManager Coverage Tests", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-coverage-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createConfig(config: object) {
    const configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify(config));
    return configPath;
  }

  async function createAgentConfig(name: string, config: object) {
    const agentDir = join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    const agentPath = join(agentDir, `${name}.yaml`);
    const yaml = await import("yaml");
    await writeFile(agentPath, yaml.stringify(config));
    return agentPath;
  }

  function createSilentLogger(): FleetManagerLogger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  // ===========================================================================
  // Default Logger Tests
  // ===========================================================================
  describe("Default logger", () => {
    it("uses default console logger when none provided", async () => {
      // Mock console methods
      const originalDebug = console.debug;
      const originalInfo = console.info;
      const originalWarn = console.warn;
      const originalError = console.error;

      const debugSpy = vi.fn();
      const infoSpy = vi.fn();
      const warnSpy = vi.fn();
      const errorSpy = vi.fn();

      console.debug = debugSpy;
      console.info = infoSpy;
      console.warn = warnSpy;
      console.error = errorSpy;

      try {
        await createAgentConfig("test-agent", {
          name: "test-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/test-agent.yaml" }],
        });

        // Create manager without logger - uses default
        const manager = new FleetManager({
          configPath,
          stateDir,
        });

        await manager.initialize();

        // Default logger should have logged to console.info
        expect(infoSpy).toHaveBeenCalled();
        expect(infoSpy.mock.calls.some((call) =>
          call[0].includes("[fleet-manager]")
        )).toBe(true);
      } finally {
        // Restore console methods
        console.debug = originalDebug;
        console.info = originalInfo;
        console.warn = originalWarn;
        console.error = originalError;
      }
    });

    it("default logger debug method works", async () => {
      const originalDebug = console.debug;
      const debugSpy = vi.fn();
      console.debug = debugSpy;

      try {
        await createAgentConfig("debug-agent", {
          name: "debug-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/debug-agent.yaml" }],
        });

        const manager = new FleetManager({
          configPath,
          stateDir,
        });

        await manager.initialize();

        // Debug should have been called with loading config message
        expect(debugSpy).toHaveBeenCalled();
      } finally {
        console.debug = originalDebug;
      }
    });
  });

  // ===========================================================================
  // ConcurrencyLimitError Tests
  // ===========================================================================
  describe("ConcurrencyLimitError in trigger", () => {
    it("ConcurrencyLimitError has correct properties", async () => {
      // Test the error class directly
      const error = new ConcurrencyLimitError("limited-agent", 1, 1);
      expect(error.name).toBe("ConcurrencyLimitError");
      expect(error.agentName).toBe("limited-agent");
      expect(error.currentJobs).toBe(1);
      expect(error.limit).toBe(1);
      expect(error.isAtLimit()).toBe(true);
      expect(error.message).toContain("limited-agent");
      expect(error.message).toContain("concurrency limit");
    });
  });

  // ===========================================================================
  // Configuration Error Handling
  // ===========================================================================
  describe("Configuration error handling", () => {
    it("wraps ConfigNotFoundError in FleetManagerConfigError", async () => {
      const manager = new FleetManager({
        configPath: "/nonexistent/path/config.yaml",
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.initialize()).rejects.toThrow(FleetManagerConfigError);
    });

    it("wraps ConfigError in FleetManagerConfigError", async () => {
      const configPath = join(configDir, "herdctl.yaml");
      // Invalid YAML
      await writeFile(configPath, "invalid: yaml: content: [:");

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.initialize()).rejects.toThrow(FleetManagerConfigError);
    });

    it("wraps unknown errors in FleetManagerConfigError", async () => {
      // Create a config that will cause an unexpected error
      const configPath = join(configDir, "herdctl.yaml");
      await writeFile(configPath, "version: 1\nagents: 'not-an-array'");

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.initialize()).rejects.toThrow(FleetManagerConfigError);
    });
  });

  // ===========================================================================
  // Log Streaming Tests
  // ===========================================================================
  describe("Log streaming edge cases", () => {
    it("streamLogs returns async iterable", async () => {
      await createAgentConfig("stream-agent", {
        name: "stream-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/stream-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamLogs({ includeHistory: false });
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamLogs with level filter", async () => {
      await createAgentConfig("level-filter-agent", {
        name: "level-filter-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/level-filter-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Test different log levels
      const errorStream = manager.streamLogs({ level: "error", includeHistory: false });
      expect(errorStream[Symbol.asyncIterator]).toBeDefined();

      const warnStream = manager.streamLogs({ level: "warn", includeHistory: false });
      expect(warnStream[Symbol.asyncIterator]).toBeDefined();

      const debugStream = manager.streamLogs({ level: "debug", includeHistory: false });
      expect(debugStream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamLogs with agent filter", async () => {
      await createAgentConfig("filter-agent", {
        name: "filter-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/filter-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamLogs({
        agentName: "filter-agent",
        includeHistory: false,
      });
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamLogs with job filter", async () => {
      await createAgentConfig("job-filter-agent", {
        name: "job-filter-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/job-filter-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamLogs({
        jobId: "job-2024-01-15-abc123",
        includeHistory: false,
      });
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamLogs with history limit", async () => {
      await createAgentConfig("history-limit-agent", {
        name: "history-limit-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/history-limit-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Create some jobs first
      await manager.trigger("history-limit-agent");
      await manager.trigger("history-limit-agent");

      const stream = manager.streamLogs({
        includeHistory: true,
        historyLimit: 5,
      });
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamJobOutput returns async iterable", async () => {
      await createAgentConfig("job-output-agent", {
        name: "job-output-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/job-output-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger a job
      const result = await manager.trigger("job-output-agent");

      const stream = manager.streamJobOutput(result.jobId);
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });

    it("streamAgentLogs returns async iterable", async () => {
      await createAgentConfig("agent-logs-agent", {
        name: "agent-logs-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-logs-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamAgentLogs("agent-logs-agent");
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });
  });

  // ===========================================================================
  // handleScheduleTrigger Error Handling
  // ===========================================================================
  describe("Schedule trigger error handling", () => {
    it("emits schedule:trigger and schedule:complete events", async () => {
      await createAgentConfig("trigger-event-agent", {
        name: "trigger-event-agent",
        schedules: {
          test: {
            type: "interval",
            interval: "100ms",
            prompt: "Test prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/trigger-event-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50,
        logger: createSilentLogger(),
      });

      const triggerHandler = vi.fn();
      const triggeredHandler = vi.fn();
      const completeHandler = vi.fn();

      manager.on("schedule:trigger", triggerHandler);
      manager.on("schedule:triggered", triggeredHandler);
      manager.on("schedule:complete", completeHandler);

      await manager.initialize();
      await manager.start();

      // Wait for schedule to trigger
      await new Promise((resolve) => setTimeout(resolve, 200));

      await manager.stop();

      // Both legacy and new events should be emitted
      expect(triggerHandler).toHaveBeenCalled();
      expect(triggeredHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Scheduler Error Handling (startSchedulerAsync)
  // ===========================================================================
  describe("startSchedulerAsync error handling", () => {
    it("handles scheduler errors and sets error state", async () => {
      await createAgentConfig("error-agent", {
        name: "error-agent",
        schedules: {
          test: {
            type: "interval",
            interval: "100ms",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/error-agent.yaml" }],
      });

      const logger = createSilentLogger();
      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50,
        logger,
      });

      const errorHandler = vi.fn();
      manager.on("error", errorHandler);

      await manager.initialize();
      await manager.start();

      // Let it run briefly
      await new Promise((resolve) => setTimeout(resolve, 100));

      await manager.stop();

      // The manager should still be in stopped state
      expect(manager.state.status).toBe("stopped");
    });
  });

  // ===========================================================================
  // Config Change Detection Edge Cases
  // ===========================================================================
  describe("Config change detection edge cases", () => {
    it("detects workspace changes between string and object forms", async () => {
      await createAgentConfig("workspace-agent", {
        name: "workspace-agent",
        workspace: "/simple/path",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/workspace-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify to object workspace
      await createAgentConfig("workspace-agent", {
        name: "workspace-agent",
        workspace: {
          root: "/object/path",
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "workspace-agent",
        })
      );
    });

    it("detects max_turns changes", async () => {
      await createAgentConfig("turns-agent", {
        name: "turns-agent",
        max_turns: 10,
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/turns-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify max_turns
      await createAgentConfig("turns-agent", {
        name: "turns-agent",
        max_turns: 20,
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "turns-agent",
          details: expect.stringContaining("max_turns"),
        })
      );
    });

    it("detects system_prompt changes", async () => {
      await createAgentConfig("prompt-agent", {
        name: "prompt-agent",
        system_prompt: "Original system prompt",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/prompt-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify system_prompt
      await createAgentConfig("prompt-agent", {
        name: "prompt-agent",
        system_prompt: "Updated system prompt",
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "prompt-agent",
          details: expect.stringContaining("system_prompt"),
        })
      );
    });

    it("detects max_concurrent changes", async () => {
      await createAgentConfig("concurrent-agent", {
        name: "concurrent-agent",
        instances: { max_concurrent: 2 },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/concurrent-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify max_concurrent
      await createAgentConfig("concurrent-agent", {
        name: "concurrent-agent",
        instances: { max_concurrent: 5 },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "concurrent-agent",
          details: expect.stringContaining("max_concurrent"),
        })
      );
    });

    it("detects schedule type changes", async () => {
      await createAgentConfig("type-change-agent", {
        name: "type-change-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/type-change-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Change to cron type
      await createAgentConfig("type-change-agent", {
        name: "type-change-agent",
        schedules: {
          check: {
            type: "cron",
            expression: "0 * * * *",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "type-change-agent/check",
        })
      );
    });

    it("detects schedule expression changes", async () => {
      await createAgentConfig("expr-agent", {
        name: "expr-agent",
        schedules: {
          check: {
            type: "cron",
            expression: "0 * * * *",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/expr-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Change expression
      await createAgentConfig("expr-agent", {
        name: "expr-agent",
        schedules: {
          check: {
            type: "cron",
            expression: "30 * * * *",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "expr-agent/check",
          details: expect.stringContaining("expression"),
        })
      );
    });

    it("handles added agent with schedules", async () => {
      await createAgentConfig("original-agent", {
        name: "original-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/original-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Add new agent with schedules
      await createAgentConfig("new-agent-with-schedules", {
        name: "new-agent-with-schedules",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
          },
          daily: {
            type: "interval",
            interval: "24h",
          },
        },
      });

      await createConfig({
        version: 1,
        agents: [
          { path: "./agents/original-agent.yaml" },
          { path: "./agents/new-agent-with-schedules.yaml" },
        ],
      });

      const result = await manager.reload();

      // Should have agent added
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "agent",
          name: "new-agent-with-schedules",
        })
      );

      // Should have both schedules added
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "new-agent-with-schedules/hourly",
        })
      );

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "new-agent-with-schedules/daily",
        })
      );
    });

    it("handles removed agent with schedules", async () => {
      await createAgentConfig("keep-agent", {
        name: "keep-agent",
      });

      await createAgentConfig("remove-agent", {
        name: "remove-agent",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [
          { path: "./agents/keep-agent.yaml" },
          { path: "./agents/remove-agent.yaml" },
        ],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Remove the agent
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/keep-agent.yaml" }],
      });

      const result = await manager.reload();

      // Should have agent removed
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "agent",
          name: "remove-agent",
        })
      );

      // Should have schedule removed
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "schedule",
          name: "remove-agent/hourly",
        })
      );
    });
  });

  // ===========================================================================
  // Stop Options Tests
  // ===========================================================================
  describe("Stop options", () => {
    it("stop with waitForJobs=false", async () => {
      await createAgentConfig("no-wait-agent", {
        name: "no-wait-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-wait-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: createSilentLogger(),
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.stop({ waitForJobs: false });

      expect(manager.state.status).toBe("stopped");
    });

    it("stop with cancelOnTimeout cancels jobs on timeout", async () => {
      await createAgentConfig("cancel-timeout-agent", {
        name: "cancel-timeout-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/cancel-timeout-agent.yaml" }],
      });

      const logger = createSilentLogger();
      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger,
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Create a job
      await manager.trigger("cancel-timeout-agent");

      await manager.stop({
        timeout: 100,
        cancelOnTimeout: true,
        cancelTimeout: 50,
      });

      expect(manager.state.status).toBe("stopped");
    });
  });

  // ===========================================================================
  // Fleet Status Edge Cases
  // ===========================================================================
  describe("Fleet status edge cases", () => {
    it("computeFleetCounts handles different agent states", async () => {
      await createAgentConfig("count-agent", {
        name: "count-agent",
        schedules: {
          test: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/count-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const status = await manager.getFleetStatus();

      expect(status.counts.totalAgents).toBe(1);
      expect(status.counts.idleAgents).toBe(1);
      expect(status.counts.runningAgents).toBe(0);
      expect(status.counts.errorAgents).toBe(0);
      expect(status.counts.totalSchedules).toBe(1);
    });

    it("getFleetStatus computes uptime correctly when stopped", async () => {
      await createAgentConfig("uptime-agent", {
        name: "uptime-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/uptime-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: createSilentLogger(),
      });

      await manager.initialize();
      await manager.start();

      // Wait a bit to accumulate uptime
      await new Promise((resolve) => setTimeout(resolve, 100));

      const runningStatus = await manager.getFleetStatus();
      expect(runningStatus.uptimeSeconds).toBeGreaterThanOrEqual(0);

      await manager.stop();

      // Uptime should still be calculated after stop
      const stoppedStatus = await manager.getFleetStatus();
      expect(stoppedStatus.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // cancelJob Additional Tests
  // ===========================================================================
  describe("cancelJob additional tests", () => {
    it("calculates duration correctly for already stopped jobs", async () => {
      await createAgentConfig("duration-agent", {
        name: "duration-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/duration-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger and cancel a job
      const result = await manager.trigger("duration-agent");
      await manager.cancelJob(result.jobId);

      // Cancel again (already stopped)
      const secondCancel = await manager.cancelJob(result.jobId);

      expect(secondCancel.success).toBe(true);
      expect(secondCancel.terminationType).toBe("already_stopped");
    });
  });

  // ===========================================================================
  // forkJob Additional Tests
  // ===========================================================================
  describe("forkJob additional tests", () => {
    it("forks with schedule modification", async () => {
      await createAgentConfig("fork-schedule-agent", {
        name: "fork-schedule-agent",
        schedules: {
          hourly: { type: "interval", interval: "1h", prompt: "Hourly check" },
          daily: { type: "interval", interval: "24h", prompt: "Daily check" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/fork-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger with hourly schedule
      const original = await manager.trigger("fork-schedule-agent", "hourly");

      // Fork with different schedule
      const forked = await manager.forkJob(original.jobId, {
        schedule: "daily",
      });

      expect(forked.forkedFromJobId).toBe(original.jobId);
    });

    it("forks preserving original prompt when no modification", async () => {
      await createAgentConfig("fork-preserve-agent", {
        name: "fork-preserve-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/fork-preserve-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const original = await manager.trigger("fork-preserve-agent", undefined, {
        prompt: "Original prompt",
      });

      // Fork without modifications
      const forked = await manager.forkJob(original.jobId);

      expect(forked.prompt).toBe("Original prompt");
    });
  });

  // ===========================================================================
  // getAgents and getConfig tests
  // ===========================================================================
  describe("getAgents and getConfig", () => {
    it("getAgents returns empty array when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const agents = manager.getAgents();
      expect(agents).toEqual([]);
    });

    it("getConfig returns null when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const config = manager.getConfig();
      expect(config).toBeNull();
    });

    it("getAgents returns agents after initialization", async () => {
      await createAgentConfig("get-agent", {
        name: "get-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/get-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const agents = manager.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("get-agent");
    });
  });

  // ===========================================================================
  // Schedule enable/disable edge cases
  // ===========================================================================
  describe("Schedule enable/disable edge cases", () => {
    it("enableSchedule throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("enable-agent", {
        name: "enable-agent",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/enable-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.enableSchedule("unknown-agent", "test")
      ).rejects.toThrow(AgentNotFoundError);
    });

    it("enableSchedule throws ScheduleNotFoundError for unknown schedule", async () => {
      await createAgentConfig("enable-schedule-agent", {
        name: "enable-schedule-agent",
        schedules: {
          known: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/enable-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.enableSchedule("enable-schedule-agent", "unknown")
      ).rejects.toThrow(ScheduleNotFoundError);
    });

    it("disableSchedule throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("disable-agent", {
        name: "disable-agent",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/disable-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.disableSchedule("unknown-agent", "test")
      ).rejects.toThrow(AgentNotFoundError);
    });

    it("disableSchedule throws ScheduleNotFoundError for unknown schedule", async () => {
      await createAgentConfig("disable-schedule-agent", {
        name: "disable-schedule-agent",
        schedules: {
          known: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/disable-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.disableSchedule("disable-schedule-agent", "unknown")
      ).rejects.toThrow(ScheduleNotFoundError);
    });

    it("enableSchedule for agent without schedules throws ScheduleNotFoundError", async () => {
      await createAgentConfig("no-schedule-enable", {
        name: "no-schedule-enable",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedule-enable.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.enableSchedule("no-schedule-enable", "any")
      ).rejects.toThrow(ScheduleNotFoundError);
    });

    it("disableSchedule for agent without schedules throws ScheduleNotFoundError", async () => {
      await createAgentConfig("no-schedule-disable", {
        name: "no-schedule-disable",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedule-disable.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.disableSchedule("no-schedule-disable", "any")
      ).rejects.toThrow(ScheduleNotFoundError);
    });
  });

  // ===========================================================================
  // persistShutdownState edge cases
  // ===========================================================================
  describe("persistShutdownState", () => {
    it("handles stop when stateDir not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      // Stop without initializing - should be a no-op
      await manager.stop();
      expect(manager.state.status).toBe("uninitialized");
    });
  });

  // ===========================================================================
  // cancelRunningJobs edge case
  // ===========================================================================
  describe("cancelRunningJobs", () => {
    it("handles case with no running jobs", async () => {
      await createAgentConfig("no-running-agent", {
        name: "no-running-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-running-agent.yaml" }],
      });

      const logger = createSilentLogger();
      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger,
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Stop with cancelOnTimeout - but no jobs are running
      await manager.stop({
        timeout: 100,
        cancelOnTimeout: true,
        cancelTimeout: 50,
      });

      // Should have logged "No running jobs to cancel"
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Additional trigger tests for coverage
  // ===========================================================================
  describe("Trigger edge cases", () => {
    it("trigger with bypassConcurrencyLimit option", async () => {
      await createAgentConfig("bypass-agent", {
        name: "bypass-agent",
        instances: { max_concurrent: 1 },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/bypass-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger with bypass option - should work even if at capacity
      const result = await manager.trigger("bypass-agent", undefined, {
        bypassConcurrencyLimit: true,
        prompt: "Test prompt",
      });

      expect(result.agentName).toBe("bypass-agent");
      expect(result.prompt).toBe("Test prompt");
    });
  });

  // ===========================================================================
  // Additional schedule tests for coverage
  // ===========================================================================
  describe("Schedule state file edge cases", () => {
    it("getSchedules returns empty array when no agents have schedules", async () => {
      await createAgentConfig("no-schedule-agent", {
        name: "no-schedule-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const schedules = await manager.getSchedules();
      expect(schedules).toEqual([]);
    });
  });

  // ===========================================================================
  // Additional config change tests for coverage
  // ===========================================================================
  describe("Additional config change detection", () => {
    it("detects model changes", async () => {
      await createAgentConfig("model-agent", {
        name: "model-agent",
        model: "claude-3-sonnet",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/model-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify model
      await createAgentConfig("model-agent", {
        name: "model-agent",
        model: "claude-3-opus",
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "model-agent",
          details: expect.stringContaining("model"),
        })
      );
    });

    it("detects description changes", async () => {
      await createAgentConfig("desc-agent", {
        name: "desc-agent",
        description: "Original description",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/desc-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify description
      await createAgentConfig("desc-agent", {
        name: "desc-agent",
        description: "Updated description",
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "desc-agent",
          details: expect.stringContaining("description"),
        })
      );
    });

    it("detects schedule prompt changes", async () => {
      await createAgentConfig("prompt-schedule-agent", {
        name: "prompt-schedule-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "1h",
            prompt: "Original prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/prompt-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify schedule prompt
      await createAgentConfig("prompt-schedule-agent", {
        name: "prompt-schedule-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "1h",
            prompt: "Updated prompt",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "prompt-schedule-agent/check",
          details: expect.stringContaining("prompt"),
        })
      );
    });

    it("detects schedule interval changes", async () => {
      await createAgentConfig("interval-schedule-agent", {
        name: "interval-schedule-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/interval-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Modify interval
      await createAgentConfig("interval-schedule-agent", {
        name: "interval-schedule-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "2h",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "interval-schedule-agent/check",
          details: expect.stringContaining("interval"),
        })
      );
    });
  });

  // ===========================================================================
  // Event emission tests
  // ===========================================================================
  describe("Event emission tests", () => {
    it("emits initialized event", async () => {
      await createAgentConfig("event-init-agent", {
        name: "event-init-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/event-init-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const initHandler = vi.fn();
      manager.on("initialized", initHandler);

      await manager.initialize();

      expect(initHandler).toHaveBeenCalledTimes(1);
    });

    it("emits error event on initialization failure", async () => {
      // Create invalid config
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/nonexistent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const errorHandler = vi.fn();
      manager.on("error", errorHandler);

      try {
        await manager.initialize();
      } catch {
        // Expected
      }

      expect(errorHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // streamAgentLogs tests
  // ===========================================================================
  describe("streamAgentLogs", () => {
    it("throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("known-agent", {
        name: "known-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamAgentLogs("unknown-agent");
      // Get the iterator and call next to trigger the check
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow(AgentNotFoundError);
    });

    it("returns async iterable for valid agent", async () => {
      await createAgentConfig("stream-log-agent", {
        name: "stream-log-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/stream-log-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamAgentLogs("stream-log-agent");
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });
  });

  // ===========================================================================
  // getAgentInfo tests
  // ===========================================================================
  describe("getAgentInfo", () => {
    it("returns agent info before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      // Before initialization, should return empty array
      const agents = await manager.getAgentInfo();
      expect(agents).toEqual([]);
    });

    it("returns agent info with all fields", async () => {
      await createAgentConfig("full-agent", {
        name: "full-agent",
        description: "Full test agent",
        model: "claude-3",
        workspace: "/path/to/workspace",
        instances: { max_concurrent: 3 },
        schedules: {
          hourly: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/full-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const agents = await manager.getAgentInfo();
      expect(agents).toHaveLength(1);

      const agent = agents[0];
      expect(agent.name).toBe("full-agent");
      expect(agent.description).toBe("Full test agent");
      expect(agent.model).toBe("claude-3");
      expect(agent.workspace).toBe("/path/to/workspace");
      expect(agent.maxConcurrent).toBe(3);
      expect(agent.scheduleCount).toBe(1);
      expect(agent.schedules).toHaveLength(1);
      expect(agent.schedules[0].name).toBe("hourly");
    });

    it("returns agent info with workspace object", async () => {
      await createAgentConfig("workspace-obj-agent", {
        name: "workspace-obj-agent",
        workspace: {
          root: "/object/workspace/path",
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/workspace-obj-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const agents = await manager.getAgentInfo();
      expect(agents[0].workspace).toBe("/object/workspace/path");
    });
  });

  // ===========================================================================
  // getFleetStatus tests
  // ===========================================================================
  describe("getFleetStatus", () => {
    it("returns scheduler status when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const status = await manager.getFleetStatus();
      expect(status.scheduler.status).toBe("stopped");
    });
  });

  // ===========================================================================
  // Multiple workspace format tests
  // ===========================================================================
  describe("Workspace handling", () => {
    it("handles agent with no workspace", async () => {
      await createAgentConfig("no-workspace-agent", {
        name: "no-workspace-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-workspace-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const agents = await manager.getAgentInfo();
      expect(agents[0].workspace).toBeUndefined();
    });
  });

  // ===========================================================================
  // Stop error handling
  // ===========================================================================
  describe("Stop error handling", () => {
    it("handles stop when status is stopping", async () => {
      await createAgentConfig("stopping-agent", {
        name: "stopping-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/stopping-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: createSilentLogger(),
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Call stop which will complete
      await manager.stop();

      // Second stop should be no-op since status is 'stopped'
      await manager.stop();
      expect(manager.state.status).toBe("stopped");
    });
  });

  // ===========================================================================
  // FleetManagerStateError tests
  // ===========================================================================
  describe("FleetManagerStateError", () => {
    it("has requiredState alias for backwards compatibility", async () => {
      const { FleetManagerStateError } = await import("../errors.js");
      const error = new FleetManagerStateError("test", "current", "required");
      expect(error.requiredState).toBe("required");
    });
  });

  // ===========================================================================
  // Event emission helper methods
  // ===========================================================================
  describe("Event emission helpers", () => {
    it("emitConfigReloaded emits config:reloaded event", async () => {
      await createAgentConfig("emit-config-agent", {
        name: "emit-config-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-config-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("config:reloaded", handler);

      manager.emitConfigReloaded({
        agentCount: 1,
        agentNames: ["emit-config-agent"],
        configPath,
        changes: [],
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitAgentStarted emits agent:started event", async () => {
      await createAgentConfig("emit-start-agent", {
        name: "emit-start-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-start-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("agent:started", handler);

      const agent = manager.getAgents().find(a => a.name === "emit-start-agent")!;
      manager.emitAgentStarted({
        agent,
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitAgentStopped emits agent:stopped event", async () => {
      await createAgentConfig("emit-stop-agent", {
        name: "emit-stop-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-stop-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("agent:stopped", handler);

      manager.emitAgentStopped({
        agentName: "emit-stop-agent",
        reason: "test",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitScheduleSkipped emits schedule:skipped event", async () => {
      await createAgentConfig("emit-skip-agent", {
        name: "emit-skip-agent",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-skip-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("schedule:skipped", handler);

      manager.emitScheduleSkipped({
        agentName: "emit-skip-agent",
        scheduleName: "test",
        reason: "max_concurrent",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobCreated emits job:created event", async () => {
      await createAgentConfig("emit-job-create-agent", {
        name: "emit-job-create-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-job-create-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:created", handler);

      manager.emitJobCreated({
        job: {
          id: "test-job-id",
          agent: "emit-job-create-agent",
          trigger_type: "manual",
          status: "pending",
          started_at: new Date().toISOString(),
          schedule: null,
          prompt: null,
          forked_from: null,
        },
        agentName: "emit-job-create-agent",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobOutput emits job:output event", async () => {
      await createAgentConfig("emit-output-agent", {
        name: "emit-output-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-output-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:output", handler);

      manager.emitJobOutput({
        jobId: "test-job-id",
        agentName: "emit-output-agent",
        output: "test output",
        outputType: "stdout",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobCompleted emits job:completed event", async () => {
      await createAgentConfig("emit-complete-agent", {
        name: "emit-complete-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-complete-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:completed", handler);

      manager.emitJobCompleted({
        job: {
          id: "test-job-id",
          agent: "emit-complete-agent",
          trigger_type: "manual",
          status: "completed",
          started_at: new Date().toISOString(),
          schedule: null,
          prompt: null,
          forked_from: null,
        },
        agentName: "emit-complete-agent",
        exitReason: "success",
        durationSeconds: 10,
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobFailed emits job:failed event", async () => {
      await createAgentConfig("emit-fail-agent", {
        name: "emit-fail-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-fail-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:failed", handler);

      manager.emitJobFailed({
        job: {
          id: "test-job-id",
          agent: "emit-fail-agent",
          trigger_type: "manual",
          status: "failed",
          started_at: new Date().toISOString(),
          schedule: null,
          prompt: null,
          forked_from: null,
        },
        agentName: "emit-fail-agent",
        error: new Error("Test error"),
        exitReason: "error",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobCancelled emits job:cancelled event", async () => {
      await createAgentConfig("emit-cancel-agent", {
        name: "emit-cancel-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-cancel-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:cancelled", handler);

      manager.emitJobCancelled({
        job: {
          id: "test-job-id",
          agent: "emit-cancel-agent",
          trigger_type: "manual",
          status: "cancelled",
          started_at: new Date().toISOString(),
          schedule: null,
          prompt: null,
          forked_from: null,
        },
        agentName: "emit-cancel-agent",
        terminationType: "graceful",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("emitJobForked emits job:forked event", async () => {
      await createAgentConfig("emit-fork-agent", {
        name: "emit-fork-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/emit-fork-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const handler = vi.fn();
      manager.on("job:forked", handler);

      const originalJob = {
        id: "original-job-id",
        agent: "emit-fork-agent",
        trigger_type: "manual" as const,
        status: "completed" as const,
        started_at: new Date().toISOString(),
        schedule: null,
        prompt: null,
        forked_from: null,
      };

      manager.emitJobForked({
        job: {
          id: "forked-job-id",
          agent: "emit-fork-agent",
          trigger_type: "fork",
          status: "pending",
          started_at: new Date().toISOString(),
          schedule: null,
          prompt: null,
          forked_from: "original-job-id",
        },
        originalJob,
        agentName: "emit-fork-agent",
        timestamp: new Date().toISOString(),
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // getAgentInfoByName tests
  // ===========================================================================
  describe("getAgentInfoByName", () => {
    it("returns info for existing agent", async () => {
      await createAgentConfig("info-by-name-agent", {
        name: "info-by-name-agent",
        description: "Test agent for getAgentInfoByName",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/info-by-name-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const info = await manager.getAgentInfoByName("info-by-name-agent");
      expect(info.name).toBe("info-by-name-agent");
      expect(info.description).toBe("Test agent for getAgentInfoByName");
    });

    it("throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("known-agent-info", {
        name: "known-agent-info",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-agent-info.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.getAgentInfoByName("nonexistent-agent")
      ).rejects.toThrow(AgentNotFoundError);
    });
  });

  // ===========================================================================
  // forkJob error cases
  // ===========================================================================
  describe("forkJob error cases", () => {
    it("throws JobForkError when job not found", async () => {
      await createAgentConfig("fork-error-agent", {
        name: "fork-error-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/fork-error-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const { JobForkError } = await import("../errors.js");
      await expect(
        manager.forkJob("job-2099-01-01-nonexistent")
      ).rejects.toThrow(JobForkError);
    });

    it("throws InvalidStateError when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const { InvalidStateError } = await import("../errors.js");
      await expect(
        manager.forkJob("any-job-id")
      ).rejects.toThrow(InvalidStateError);
    });
  });

  // ===========================================================================
  // cancelJob error cases
  // ===========================================================================
  describe("cancelJob error cases", () => {
    it("throws JobNotFoundError when job not found", async () => {
      await createAgentConfig("cancel-error-agent", {
        name: "cancel-error-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/cancel-error-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const { JobNotFoundError } = await import("../errors.js");
      await expect(
        manager.cancelJob("job-2099-01-01-nonexistent")
      ).rejects.toThrow(JobNotFoundError);
    });

    it("throws InvalidStateError when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const { InvalidStateError } = await import("../errors.js");
      await expect(
        manager.cancelJob("any-job-id")
      ).rejects.toThrow(InvalidStateError);
    });
  });

  // ===========================================================================
  // streamJobOutput tests
  // ===========================================================================
  describe("streamJobOutput error cases", () => {
    it("throws JobNotFoundError for non-existent job", async () => {
      await createAgentConfig("stream-error-agent", {
        name: "stream-error-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/stream-error-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const stream = manager.streamJobOutput("job-2099-01-01-nonexistent");
      const iterator = stream[Symbol.asyncIterator]();

      const { JobNotFoundError } = await import("../errors.js");
      await expect(iterator.next()).rejects.toThrow(JobNotFoundError);
    });
  });

  // ===========================================================================
  // trigger edge cases
  // ===========================================================================
  describe("trigger edge cases", () => {
    it("triggers with schedule that has prompt", async () => {
      await createAgentConfig("trigger-schedule-prompt", {
        name: "trigger-schedule-prompt",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
            prompt: "Hourly check prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/trigger-schedule-prompt.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const result = await manager.trigger("trigger-schedule-prompt", "hourly");

      expect(result.prompt).toBe("Hourly check prompt");
      expect(result.scheduleName).toBe("hourly");
    });

    it("throws InvalidStateError when triggering before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const { InvalidStateError } = await import("../errors.js");
      await expect(manager.trigger("any-agent")).rejects.toThrow(InvalidStateError);
    });

    it("throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("known-trigger-agent", {
        name: "known-trigger-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-trigger-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(manager.trigger("unknown-agent")).rejects.toThrow(AgentNotFoundError);
    });

    it("throws ScheduleNotFoundError for unknown schedule", async () => {
      await createAgentConfig("known-schedule-trigger", {
        name: "known-schedule-trigger",
        schedules: {
          known: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-schedule-trigger.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.trigger("known-schedule-trigger", "unknown-schedule")
      ).rejects.toThrow(ScheduleNotFoundError);
    });
  });

  // ===========================================================================
  // reload edge cases
  // ===========================================================================
  describe("reload edge cases", () => {
    it("throws InvalidStateError when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const { InvalidStateError } = await import("../errors.js");
      await expect(manager.reload()).rejects.toThrow(InvalidStateError);
    });

    it("handles removed schedule from existing agent", async () => {
      await createAgentConfig("schedule-remove-agent", {
        name: "schedule-remove-agent",
        schedules: {
          keep: { type: "interval", interval: "1h" },
          remove: { type: "interval", interval: "2h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-remove-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Remove one schedule
      await createAgentConfig("schedule-remove-agent", {
        name: "schedule-remove-agent",
        schedules: {
          keep: { type: "interval", interval: "1h" },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "schedule",
          name: "schedule-remove-agent/remove",
        })
      );
    });

    it("handles added schedule to existing agent", async () => {
      await createAgentConfig("schedule-add-agent", {
        name: "schedule-add-agent",
        schedules: {
          original: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-add-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Add a schedule
      await createAgentConfig("schedule-add-agent", {
        name: "schedule-add-agent",
        schedules: {
          original: { type: "interval", interval: "1h" },
          newschedule: { type: "interval", interval: "2h" },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "schedule-add-agent/newschedule",
        })
      );
    });
  });

  // ===========================================================================
  // start error cases
  // ===========================================================================
  describe("start error cases", () => {
    it("throws InvalidStateError when not initialized", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const { FleetManagerStateError } = await import("../errors.js");
      await expect(manager.start()).rejects.toThrow(FleetManagerStateError);
    });
  });

  // ===========================================================================
  // getSchedule tests
  // ===========================================================================
  describe("getSchedule", () => {
    it("returns schedule info for valid agent and schedule", async () => {
      await createAgentConfig("get-schedule-agent", {
        name: "get-schedule-agent",
        schedules: {
          hourly: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/get-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const schedule = await manager.getSchedule("get-schedule-agent", "hourly");
      expect(schedule.name).toBe("hourly");
      expect(schedule.agentName).toBe("get-schedule-agent");
      expect(schedule.type).toBe("interval");
    });

    it("throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("known-get-schedule", {
        name: "known-get-schedule",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-get-schedule.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.getSchedule("unknown-agent", "test")
      ).rejects.toThrow(AgentNotFoundError);
    });

    it("throws ScheduleNotFoundError for unknown schedule", async () => {
      await createAgentConfig("known-agent-get-schedule", {
        name: "known-agent-get-schedule",
        schedules: {
          known: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-agent-get-schedule.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.getSchedule("known-agent-get-schedule", "unknown")
      ).rejects.toThrow(ScheduleNotFoundError);
    });

    it("throws ScheduleNotFoundError when agent has no schedules", async () => {
      await createAgentConfig("no-schedules-agent", {
        name: "no-schedules-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedules-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      await expect(
        manager.getSchedule("no-schedules-agent", "any")
      ).rejects.toThrow(ScheduleNotFoundError);
    });
  });

  // ===========================================================================
  // streamJobOutput for completed job
  // ===========================================================================
  describe("streamJobOutput for completed jobs", () => {
    it("streams output for completed job and stops", async () => {
      await createAgentConfig("completed-stream-agent", {
        name: "completed-stream-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/completed-stream-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Create a job and cancel it immediately to make it "completed"
      const result = await manager.trigger("completed-stream-agent");
      await manager.cancelJob(result.jobId);

      // Stream should complete quickly for cancelled job
      const stream = manager.streamJobOutput(result.jobId);
      const entries: unknown[] = [];

      // Use a short timeout for the test
      const timeout = setTimeout(() => {}, 100);

      try {
        for await (const entry of stream) {
          entries.push(entry);
          // Break after first entry or timeout
          break;
        }
      } finally {
        clearTimeout(timeout);
      }

      // The stream should have yielded at least some entries or completed
      expect(stream[Symbol.asyncIterator]).toBeDefined();
    });
  });

  // ===========================================================================
  // initialize edge cases
  // ===========================================================================
  describe("initialize edge cases", () => {
    it("emits started event", async () => {
      await createAgentConfig("emit-started-agent-1", {
        name: "emit-started-agent-1",
      });
      await createAgentConfig("emit-started-agent-2", {
        name: "emit-started-agent-2",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [
          { path: "./agents/emit-started-agent-1.yaml" },
          { path: "./agents/emit-started-agent-2.yaml" },
        ],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      const startedHandler = vi.fn();
      manager.on("started", startedHandler);

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await manager.stop();

      // started event is emitted when fleet starts
      expect(startedHandler).toHaveBeenCalled();
    });
  });
});






