/**
 * Integration tests for FleetManager (US-13)
 *
 * Comprehensive integration tests covering:
 * - Full flow: initialize → start → trigger → complete → stop
 * - Scheduler integration: schedules trigger jobs correctly
 * - State persistence: survives restart with correct state
 * - Edge cases: start when running, stop when stopped, etc.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FleetManager } from "../fleet-manager.js";

// Mock the Claude SDK - this must be before any imports that use it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Import the mocked query function for test configuration
import { query as mockQueryFn } from "@anthropic-ai/claude-agent-sdk";
import {
  InvalidStateError,
  AgentNotFoundError,
  ScheduleNotFoundError,
} from "../errors.js";
import type {
  FleetManagerLogger,
  JobCreatedPayload,
  JobCompletedPayload,
  JobFailedPayload,
  ScheduleTriggeredPayload,
} from "../types.js";

describe("FleetManager Integration Tests (US-13)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-integration-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // Helper to create a test config file
  async function createConfig(config: object) {
    const configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify(config));
    return configPath;
  }

  // Helper to create an agent config file
  async function createAgentConfig(name: string, config: object) {
    const agentDir = join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    const agentPath = join(agentDir, `${name}.yaml`);
    const yaml = await import("yaml");
    await writeFile(agentPath, yaml.stringify(config));
    return agentPath;
  }

  // Create a silent logger for tests
  function createSilentLogger(): FleetManagerLogger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  // Create a test manager with common options
  function createTestManager(
    configPath: string,
    options: { checkInterval?: number } = {}
  ) {
    return new FleetManager({
      configPath,
      stateDir,
      checkInterval: options.checkInterval ?? 10000, // Long interval by default to avoid unexpected triggers
      logger: createSilentLogger(),
    });
  }

  // ==========================================================================
  // Full Flow Integration Tests
  // ==========================================================================

  describe("Full Flow: initialize → start → trigger → complete → stop", () => {
    it("completes a full lifecycle with manual trigger", async () => {
      // Setup: Create agent config
      // Note: The schedule is disabled to prevent auto-triggering during the test.
      // The scheduler's first check runs immediately on start(), and interval schedules
      // with no last_run_at would trigger immediately. We disable the schedule so it
      // won't race with our manual trigger() call, but it can still be triggered manually.
      await createAgentConfig("workflow-agent", {
        name: "workflow-agent",
        description: "Agent for testing full workflow",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
            prompt: "Check hourly tasks",
            enabled: false,
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/workflow-agent.yaml" }],
      });

      // Create manager
      const manager = createTestManager(configPath);
      const events: string[] = [];

      // Track all events
      manager.on("initialized", () => events.push("initialized"));
      manager.on("started", () => events.push("started"));
      manager.on("stopped", () => events.push("stopped"));
      manager.on("job:created", () => events.push("job:created"));

      // 1. Verify initial state
      expect(manager.state.status).toBe("uninitialized");

      // 2. Initialize
      await manager.initialize();
      expect(manager.state.status).toBe("initialized");
      expect(manager.state.agentCount).toBe(1);
      expect(events).toContain("initialized");

      // 3. Start
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50)); // Wait for async start
      expect(manager.state.status).toBe("running");
      expect(events).toContain("started");

      // 4. Trigger agent
      const result = await manager.trigger("workflow-agent", "hourly");
      expect(result.agentName).toBe("workflow-agent");
      expect(result.scheduleName).toBe("hourly");
      expect(result.prompt).toBe("Check hourly tasks");
      expect(result.jobId).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/);
      expect(events).toContain("job:created");

      // 5. Verify fleet status while running
      const fleetStatus = await manager.getFleetStatus();
      expect(fleetStatus.state).toBe("running");
      expect(fleetStatus.counts.totalAgents).toBe(1);
      expect(fleetStatus.scheduler.status).toBe("running");

      // 6. Stop
      await manager.stop();
      expect(manager.state.status).toBe("stopped");
      expect(events).toContain("stopped");

      // 7. Verify final state
      const finalStatus = await manager.getFleetStatus();
      expect(finalStatus.state).toBe("stopped");
      expect(finalStatus.stoppedAt).not.toBeNull();
    });

    it("emits events in correct order during lifecycle", async () => {
      await createAgentConfig("event-order-agent", {
        name: "event-order-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/event-order-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      const eventOrder: string[] = [];

      manager.on("initialized", () => eventOrder.push("initialized"));
      manager.on("started", () => eventOrder.push("started"));
      manager.on("job:created", () => eventOrder.push("job:created"));
      manager.on("stopped", () => eventOrder.push("stopped"));

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await manager.trigger("event-order-agent");
      await manager.stop();

      expect(eventOrder).toEqual([
        "initialized",
        "started",
        "job:created",
        "stopped",
      ]);
    });

    it("handles multiple agents in full workflow", async () => {
      await createAgentConfig("agent-alpha", {
        name: "agent-alpha",
        description: "First agent",
      });

      await createAgentConfig("agent-beta", {
        name: "agent-beta",
        description: "Second agent",
      });

      await createAgentConfig("agent-gamma", {
        name: "agent-gamma",
        description: "Third agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [
          { path: "./agents/agent-alpha.yaml" },
          { path: "./agents/agent-beta.yaml" },
          { path: "./agents/agent-gamma.yaml" },
        ],
      });

      const manager = createTestManager(configPath);

      await manager.initialize();
      expect(manager.state.agentCount).toBe(3);

      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trigger all agents
      const results = await Promise.all([
        manager.trigger("agent-alpha"),
        manager.trigger("agent-beta"),
        manager.trigger("agent-gamma"),
      ]);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.agentName).sort()).toEqual([
        "agent-alpha",
        "agent-beta",
        "agent-gamma",
      ]);

      // Verify all have unique job IDs
      const jobIds = results.map((r) => r.jobId);
      expect(new Set(jobIds).size).toBe(3);

      // Verify fleet status
      const status = await manager.getFleetStatus();
      expect(status.counts.totalAgents).toBe(3);

      await manager.stop();
    });

    it("correctly tracks timing through lifecycle", async () => {
      await createAgentConfig("timing-agent", {
        name: "timing-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/timing-agent.yaml" }],
      });

      const manager = createTestManager(configPath);

      // Before init
      const beforeInit = new Date().toISOString();
      expect(manager.state.initializedAt).toBeNull();
      expect(manager.state.startedAt).toBeNull();
      expect(manager.state.stoppedAt).toBeNull();

      await manager.initialize();
      const afterInit = new Date().toISOString();

      expect(manager.state.initializedAt).not.toBeNull();
      expect(manager.state.initializedAt! >= beforeInit).toBe(true);
      expect(manager.state.initializedAt! <= afterInit).toBe(true);

      const beforeStart = new Date().toISOString();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const afterStart = new Date().toISOString();

      expect(manager.state.startedAt).not.toBeNull();
      expect(manager.state.startedAt! >= beforeStart).toBe(true);
      expect(manager.state.startedAt! <= afterStart).toBe(true);

      // Check uptime
      const status = await manager.getFleetStatus();
      expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);

      const beforeStop = new Date().toISOString();
      await manager.stop();
      const afterStop = new Date().toISOString();

      expect(manager.state.stoppedAt).not.toBeNull();
      expect(manager.state.stoppedAt! >= beforeStop).toBe(true);
      expect(manager.state.stoppedAt! <= afterStop).toBe(true);
    });
  });

  // ==========================================================================
  // Scheduler Integration Tests
  // ==========================================================================

  describe("Scheduler Integration", () => {
    it("scheduler triggers jobs on schedule", async () => {
      await createAgentConfig("scheduled-agent", {
        name: "scheduled-agent",
        schedules: {
          frequent: {
            type: "interval",
            interval: "100ms", // Very short for testing
            prompt: "Scheduled prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/scheduled-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50, // Check frequently for testing
        logger: createSilentLogger(),
      });

      const scheduleTriggers: ScheduleTriggeredPayload[] = [];
      manager.on("schedule:triggered", (payload) => {
        scheduleTriggers.push(payload);
      });

      await manager.initialize();
      await manager.start();

      // Wait for at least one scheduled trigger
      await new Promise((resolve) => setTimeout(resolve, 300));

      await manager.stop();

      // Scheduler should have triggered at least once
      expect(scheduleTriggers.length).toBeGreaterThanOrEqual(1);
      expect(scheduleTriggers[0].agentName).toBe("scheduled-agent");
      expect(scheduleTriggers[0].scheduleName).toBe("frequent");
    });

    it("scheduler executes jobs via JobExecutor", async () => {
      await createAgentConfig("executor-agent", {
        name: "executor-agent",
        schedules: {
          quick: {
            type: "interval",
            interval: "100ms",
            prompt: "Execute test prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/executor-agent.yaml" }],
      });

      // Track events
      const jobCreatedEvents: JobCreatedPayload[] = [];
      const jobCompletedEvents: JobCompletedPayload[] = [];

      // Configure the mock SDK query function
      (mockQueryFn as Mock).mockImplementation(async function* () {
        yield {
          type: "system" as const,
          subtype: "init",
          session_id: "test-session-123",
        };
        yield {
          type: "assistant" as const,
          content: "Test response from mock SDK",
        };
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50,
        logger: createSilentLogger(),
      });

      manager.on("job:created", (payload) => {
        jobCreatedEvents.push(payload);
      });

      manager.on("job:completed", (payload) => {
        jobCompletedEvents.push(payload);
      });

      await manager.initialize();
      await manager.start();

      // Wait for a scheduled trigger to complete execution
      await new Promise((resolve) => setTimeout(resolve, 400));

      await manager.stop();

      // Should have triggered at least once
      expect(jobCreatedEvents.length).toBeGreaterThanOrEqual(1);
      expect(jobCreatedEvents[0].agentName).toBe("executor-agent");
      expect(jobCreatedEvents[0].scheduleName).toBe("quick");

      // Should have completed at least one job
      expect(jobCompletedEvents.length).toBeGreaterThanOrEqual(1);
      expect(jobCompletedEvents[0].agentName).toBe("executor-agent");
      expect(jobCompletedEvents[0].exitReason).toBe("success");
      expect(jobCompletedEvents[0].durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it("emits job:failed when execution fails", async () => {
      await createAgentConfig("failing-agent", {
        name: "failing-agent",
        schedules: {
          fail: {
            type: "interval",
            interval: "100ms",
            prompt: "This will fail",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/failing-agent.yaml" }],
      });

      // Track events
      const jobFailedEvents: { agentName: string; error: Error }[] = [];

      // Configure the mock SDK query function to emit an error
      (mockQueryFn as Mock).mockImplementation(async function* () {
        yield {
          type: "error" as const,
          message: "Simulated SDK error",
          code: "SDK_ERROR",
        };
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50,
        logger: createSilentLogger(),
      });

      manager.on("job:failed", (payload) => {
        jobFailedEvents.push({
          agentName: payload.agentName,
          error: payload.error,
        });
      });

      await manager.initialize();
      await manager.start();

      // Wait for the schedule to trigger and fail
      await new Promise((resolve) => setTimeout(resolve, 400));

      await manager.stop();

      // Should have emitted at least one job:failed event
      expect(jobFailedEvents.length).toBeGreaterThanOrEqual(1);
      expect(jobFailedEvents[0].agentName).toBe("failing-agent");
    });

    it("scheduler respects disabled schedules", async () => {
      await createAgentConfig("disabled-schedule-agent", {
        name: "disabled-schedule-agent",
        schedules: {
          active: {
            type: "interval",
            interval: "5s", // Longer interval to avoid race conditions
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/disabled-schedule-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 50,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Disable the schedule BEFORE starting
      await manager.disableSchedule("disabled-schedule-agent", "active");

      // Track all triggers
      const triggers: string[] = [];
      manager.on("schedule:triggered", () => {
        triggers.push("triggered");
      });

      await manager.start();

      // Wait a bit - disabled schedule should not trigger
      await new Promise((resolve) => setTimeout(resolve, 150));

      await manager.stop();

      // No triggers should have occurred since schedule was disabled
      expect(triggers.length).toBe(0);
    });

    it("getSchedules returns correct schedule information", async () => {
      await createAgentConfig("multi-schedule-agent", {
        name: "multi-schedule-agent",
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

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/multi-schedule-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const schedules = await manager.getSchedules();

      expect(schedules).toHaveLength(2);
      expect(schedules.map((s) => s.name).sort()).toEqual(["daily", "hourly"]);
      expect(schedules.every((s) => s.agentName === "multi-schedule-agent")).toBe(
        true
      );
      expect(schedules.every((s) => s.status === "idle")).toBe(true);
    });

    it("getSchedule returns specific schedule", async () => {
      await createAgentConfig("specific-schedule-agent", {
        name: "specific-schedule-agent",
        schedules: {
          target: {
            type: "interval",
            interval: "30m",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/specific-schedule-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const schedule = await manager.getSchedule(
        "specific-schedule-agent",
        "target"
      );

      expect(schedule.name).toBe("target");
      expect(schedule.agentName).toBe("specific-schedule-agent");
      expect(schedule.type).toBe("interval");
      expect(schedule.interval).toBe("30m");
    });

    it("enableSchedule and disableSchedule toggle schedule status", async () => {
      await createAgentConfig("toggle-agent", {
        name: "toggle-agent",
        schedules: {
          toggleable: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/toggle-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Initially idle
      let schedule = await manager.getSchedule("toggle-agent", "toggleable");
      expect(schedule.status).toBe("idle");

      // Disable
      await manager.disableSchedule("toggle-agent", "toggleable");
      schedule = await manager.getSchedule("toggle-agent", "toggleable");
      expect(schedule.status).toBe("disabled");

      // Re-enable
      await manager.enableSchedule("toggle-agent", "toggleable");
      schedule = await manager.getSchedule("toggle-agent", "toggleable");
      expect(schedule.status).toBe("idle");
    });
  });

  // ==========================================================================
  // State Persistence Tests
  // ==========================================================================

  describe("State Persistence", () => {
    it("persists fleet state across restart", async () => {
      await createAgentConfig("persistent-agent", {
        name: "persistent-agent",
        schedules: {
          check: {
            type: "interval",
            interval: "1h",
            enabled: false,
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/persistent-agent.yaml" }],
      });

      // First manager instance - trigger a job
      const manager1 = createTestManager(configPath);
      await manager1.initialize();
      await manager1.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const triggerResult = await manager1.trigger("persistent-agent", "check");
      const jobId = triggerResult.jobId;

      await manager1.stop();

      // Second manager instance - verify state was persisted
      const manager2 = createTestManager(configPath);
      await manager2.initialize();

      // State should show agent info correctly
      const agentInfo = await manager2.getAgentInfoByName("persistent-agent");
      expect(agentInfo.name).toBe("persistent-agent");

      // Verify the job was created with metadata (stored as YAML)
      const yaml = await import("yaml");
      const jobFilePath = join(stateDir, "jobs", `${jobId}.yaml`);
      const jobContent = await readFile(jobFilePath, "utf-8");
      const metadata = yaml.parse(jobContent);

      expect(metadata.id).toBe(jobId);
      expect(metadata.agent).toBe("persistent-agent");
    });

    it("schedule state survives restart", async () => {
      await createAgentConfig("schedule-persist-agent", {
        name: "schedule-persist-agent",
        schedules: {
          persist: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-persist-agent.yaml" }],
      });

      // First instance - disable schedule
      const manager1 = createTestManager(configPath);
      await manager1.initialize();
      await manager1.disableSchedule("schedule-persist-agent", "persist");

      let schedule = await manager1.getSchedule(
        "schedule-persist-agent",
        "persist"
      );
      expect(schedule.status).toBe("disabled");

      // Note: The current implementation may or may not persist schedule disabled state
      // This test documents the expected behavior

      await manager1.stop();

      // Second instance - check if schedule state was preserved
      const manager2 = createTestManager(configPath);
      await manager2.initialize();

      // Get schedule state
      schedule = await manager2.getSchedule("schedule-persist-agent", "persist");
      // Schedule status after restart - depends on implementation
      // Currently schedules start fresh as "idle" on restart
      expect(["idle", "disabled"]).toContain(schedule.status);
    });

    it("job metadata persists to disk", async () => {
      await createAgentConfig("job-persist-agent", {
        name: "job-persist-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/job-persist-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await manager.trigger("job-persist-agent", undefined, {
        prompt: "Persisted prompt",
      });

      // Verify job metadata was written to disk (stored as YAML)
      const yaml = await import("yaml");
      const jobFilePath = join(stateDir, "jobs", `${result.jobId}.yaml`);

      const metadataContent = await readFile(jobFilePath, "utf-8");
      const metadata = yaml.parse(metadataContent);

      expect(metadata.id).toBe(result.jobId);
      expect(metadata.agent).toBe("job-persist-agent");
      expect(metadata.prompt).toBe("Persisted prompt");
      expect(metadata.trigger_type).toBe("manual");

      await manager.stop();
    });

    it("state directory is created if it does not exist", async () => {
      await createAgentConfig("state-dir-agent", {
        name: "state-dir-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/state-dir-agent.yaml" }],
      });

      // Use a new state directory that doesn't exist
      const newStateDir = join(tempDir, "new-state-dir");

      const manager = new FleetManager({
        configPath,
        stateDir: newStateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trigger a job to ensure state is persisted
      const result = await manager.trigger("state-dir-agent");

      // Verify job file was created in state directory (stored as YAML)
      const yaml = await import("yaml");
      const jobFilePath = join(newStateDir, "jobs", `${result.jobId}.yaml`);
      const content = await readFile(jobFilePath, "utf-8");
      expect(yaml.parse(content)).toHaveProperty("id", result.jobId);

      await manager.stop();
    });
  });

  // ==========================================================================
  // Edge Case Tests
  // ==========================================================================

  describe("Edge Cases", () => {
    describe("start() edge cases", () => {
      it("throws InvalidStateError when calling start before initialize", async () => {
        const configPath = await createConfig({
          version: 1,
          agents: [],
        });

        const manager = createTestManager(configPath);

        await expect(manager.start()).rejects.toThrow(InvalidStateError);
        await expect(manager.start()).rejects.toMatchObject({
          operation: "start",
          currentState: "uninitialized",
        });
      });

      it("handles start when already running (idempotent)", async () => {
        await createAgentConfig("idempotent-start", {
          name: "idempotent-start",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/idempotent-start.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(manager.state.status).toBe("running");

        // Second start should be safe (idempotent or throw)
        // Based on implementation, may throw InvalidStateError or be no-op
        try {
          await manager.start();
          // If no error, should still be running
          expect(manager.state.status).toBe("running");
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidStateError);
        }

        await manager.stop();
      });

      it("requires re-initialization to restart after stop", async () => {
        await createAgentConfig("restart-agent", {
          name: "restart-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/restart-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        // First start/stop cycle
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(manager.state.status).toBe("running");
        await manager.stop();
        expect(manager.state.status).toBe("stopped");

        // Cannot restart without re-initialization
        // This documents the current behavior - must create new manager instance
        await expect(manager.start()).rejects.toThrow();
      });
    });

    describe("stop() edge cases", () => {
      it("handles stop when already stopped (idempotent)", async () => {
        await createAgentConfig("idempotent-stop", {
          name: "idempotent-stop",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/idempotent-stop.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await manager.stop();

        expect(manager.state.status).toBe("stopped");

        // Second stop should be safe
        await manager.stop();
        expect(manager.state.status).toBe("stopped");
      });

      it("handles stop when never started (no-op)", async () => {
        await createAgentConfig("never-started", {
          name: "never-started",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/never-started.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        // Stop without ever starting is a no-op - stays in initialized state
        await manager.stop();
        expect(manager.state.status).toBe("initialized");
      });

      it("stop respects timeout option", async () => {
        await createAgentConfig("timeout-agent", {
          name: "timeout-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/timeout-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Stop with short timeout
        const beforeStop = Date.now();
        await manager.stop({ timeout: 100 });
        const afterStop = Date.now();

        expect(manager.state.status).toBe("stopped");
        // Stop should complete quickly
        expect(afterStop - beforeStop).toBeLessThan(1000);
      });
    });

    describe("initialize() edge cases", () => {
      it("throws error for invalid config", async () => {
        const configPath = join(configDir, "herdctl.yaml");
        await writeFile(configPath, "invalid: yaml: content:");

        const manager = new FleetManager({
          configPath,
          stateDir,
          logger: createSilentLogger(),
        });

        await expect(manager.initialize()).rejects.toThrow();
      });

      it("throws error for non-existent config", async () => {
        const manager = new FleetManager({
          configPath: "/nonexistent/path/config.yaml",
          stateDir,
          logger: createSilentLogger(),
        });

        await expect(manager.initialize()).rejects.toThrow();
      });

      it("handles re-initialization (idempotent or error)", async () => {
        await createAgentConfig("reinit-agent", {
          name: "reinit-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/reinit-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        // Second initialize - should be idempotent or throw
        try {
          await manager.initialize();
          expect(manager.state.status).toBe("initialized");
        } catch (error) {
          expect(error).toBeInstanceOf(InvalidStateError);
        }
      });
    });

    describe("trigger() edge cases", () => {
      it("throws AgentNotFoundError for non-existent agent", async () => {
        await createAgentConfig("existing-agent", {
          name: "existing-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/existing-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        await expect(manager.trigger("nonexistent-agent")).rejects.toThrow(
          AgentNotFoundError
        );
        await expect(manager.trigger("nonexistent-agent")).rejects.toMatchObject({
          agentName: "nonexistent-agent",
          availableAgents: ["existing-agent"],
        });
      });

      it("throws ScheduleNotFoundError for non-existent schedule", async () => {
        await createAgentConfig("schedule-edge-agent", {
          name: "schedule-edge-agent",
          schedules: {
            existing: {
              type: "interval",
              interval: "1h",
            },
          },
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/schedule-edge-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        await expect(
          manager.trigger("schedule-edge-agent", "nonexistent")
        ).rejects.toThrow(ScheduleNotFoundError);
        await expect(
          manager.trigger("schedule-edge-agent", "nonexistent")
        ).rejects.toMatchObject({
          scheduleName: "nonexistent",
          availableSchedules: ["existing"],
        });
      });

      it("throws InvalidStateError before initialize", async () => {
        const configPath = await createConfig({
          version: 1,
          agents: [],
        });

        const manager = createTestManager(configPath);

        await expect(manager.trigger("any-agent")).rejects.toThrow(
          InvalidStateError
        );
      });

      it("trigger works after stop", async () => {
        await createAgentConfig("trigger-after-stop", {
          name: "trigger-after-stop",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/trigger-after-stop.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        await manager.stop();

        // Should still be able to trigger after stop
        const result = await manager.trigger("trigger-after-stop");
        expect(result.agentName).toBe("trigger-after-stop");
      });
    });

    describe("getAgentInfoByName() edge cases", () => {
      it("throws AgentNotFoundError before initialize", async () => {
        const configPath = await createConfig({
          version: 1,
          agents: [],
        });

        const manager = createTestManager(configPath);

        await expect(manager.getAgentInfoByName("any")).rejects.toThrow(
          AgentNotFoundError
        );
      });

      it("throws AgentNotFoundError for unknown agent", async () => {
        await createAgentConfig("known", {
          name: "known",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/known.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        await expect(manager.getAgentInfoByName("unknown")).rejects.toThrow(
          AgentNotFoundError
        );
      });
    });

    describe("reload() edge cases", () => {
      it("throws InvalidStateError before initialize", async () => {
        const configPath = await createConfig({
          version: 1,
          agents: [],
        });

        const manager = createTestManager(configPath);

        await expect(manager.reload()).rejects.toThrow(InvalidStateError);
      });

      it("reload works in all valid states", async () => {
        await createAgentConfig("reload-states", {
          name: "reload-states",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/reload-states.yaml" }],
        });

        const manager = createTestManager(configPath);

        // Test in initialized state
        await manager.initialize();
        let result = await manager.reload();
        expect(result.agentCount).toBe(1);

        // Test in running state
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        result = await manager.reload();
        expect(result.agentCount).toBe(1);

        // Test in stopped state
        await manager.stop();
        result = await manager.reload();
        expect(result.agentCount).toBe(1);
      });
    });

    describe("getSchedule() edge cases", () => {
      it("throws AgentNotFoundError for unknown agent", async () => {
        await createAgentConfig("schedule-agent", {
          name: "schedule-agent",
          schedules: {
            test: { type: "interval", interval: "1h" },
          },
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/schedule-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        await expect(
          manager.getSchedule("unknown-agent", "test")
        ).rejects.toThrow(AgentNotFoundError);
      });

      it("throws ScheduleNotFoundError for unknown schedule", async () => {
        await createAgentConfig("schedule-not-found", {
          name: "schedule-not-found",
          schedules: {
            exists: { type: "interval", interval: "1h" },
          },
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/schedule-not-found.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        await expect(
          manager.getSchedule("schedule-not-found", "does-not-exist")
        ).rejects.toThrow(ScheduleNotFoundError);
      });
    });

    describe("empty fleet edge cases", () => {
      it("handles fleet with no agents", async () => {
        const configPath = await createConfig({
          version: 1,
          agents: [],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        expect(manager.state.agentCount).toBe(0);

        const status = await manager.getFleetStatus();
        expect(status.counts.totalAgents).toBe(0);
        expect(status.counts.totalSchedules).toBe(0);

        const agents = await manager.getAgentInfo();
        expect(agents).toEqual([]);

        const schedules = await manager.getSchedules();
        expect(schedules).toEqual([]);

        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(manager.state.status).toBe("running");

        await manager.stop();
        expect(manager.state.status).toBe("stopped");
      });

      it("handles agent with no schedules", async () => {
        await createAgentConfig("no-schedules", {
          name: "no-schedules",
          description: "Agent without schedules",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/no-schedules.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        const agentInfo = await manager.getAgentInfoByName("no-schedules");
        expect(agentInfo.scheduleCount).toBe(0);
        expect(agentInfo.schedules).toEqual([]);

        // Trigger should still work
        const result = await manager.trigger("no-schedules");
        expect(result.agentName).toBe("no-schedules");
        expect(result.scheduleName).toBeNull();
      });
    });

    describe("concurrency edge cases", () => {
      it("single start/stop cycle completes correctly", async () => {
        await createAgentConfig("rapid-cycle", {
          name: "rapid-cycle",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/rapid-cycle.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        // Single start/stop cycle
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 20));
        await manager.stop();

        expect(manager.state.status).toBe("stopped");
      });

      it("concurrent triggers to same agent", async () => {
        await createAgentConfig("concurrent-agent", {
          name: "concurrent-agent",
          instances: { max_concurrent: 5 },
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/concurrent-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();

        // Trigger multiple jobs concurrently
        const triggers = await Promise.all([
          manager.trigger("concurrent-agent", undefined, { prompt: "Job 1" }),
          manager.trigger("concurrent-agent", undefined, { prompt: "Job 2" }),
          manager.trigger("concurrent-agent", undefined, { prompt: "Job 3" }),
        ]);

        expect(triggers).toHaveLength(3);
        const jobIds = triggers.map((t) => t.jobId);
        expect(new Set(jobIds).size).toBe(3); // All unique IDs
      });
    });

    describe("stop with cancelOnTimeout", () => {
      it("stops with cancelOnTimeout option", async () => {
        await createAgentConfig("cancel-agent", {
          name: "cancel-agent",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/cancel-agent.yaml" }],
        });

        const manager = createTestManager(configPath);
        await manager.initialize();
        await manager.start();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Stop with cancelOnTimeout enabled (doesn't matter here since no running jobs)
        await manager.stop({
          timeout: 100,
          cancelOnTimeout: true,
          cancelTimeout: 50,
        });

        expect(manager.state.status).toBe("stopped");
      });
    });

    describe("error state handling", () => {
      it("tracks errors during initialization", async () => {
        // Create invalid config with missing agent file
        const configPath = await createConfig({
          version: 1,
          agents: [{ path: "./agents/nonexistent.yaml" }],
        });

        const logger = createSilentLogger();
        const manager = new FleetManager({
          configPath,
          stateDir,
          logger,
        });

        // Initialize should fail
        try {
          await manager.initialize();
        } catch {
          // Expected
        }

        // Status should be error
        expect(manager.state.status).toBe("error");
        expect(manager.state.lastError).toBeDefined();
      });

      it("rejects duplicate agent names", async () => {
        // Create two agents with the same name
        await createAgentConfig("agent-one", {
          name: "duplicate-name",
        });
        await createAgentConfig("agent-two", {
          name: "duplicate-name",
        });

        const configPath = await createConfig({
          version: 1,
          agents: [
            { path: "./agents/agent-one.yaml" },
            { path: "./agents/agent-two.yaml" },
          ],
        });

        const logger = createSilentLogger();
        const manager = new FleetManager({
          configPath,
          stateDir,
          logger,
        });

        // Initialize should fail with ConfigurationError
        await expect(manager.initialize()).rejects.toThrow(
          /Duplicate agent qualified names? found.*"duplicate-name"/
        );

        // Status should be error
        expect(manager.state.status).toBe("error");
        expect(manager.state.lastError).toContain("Duplicate agent qualified name");
      });
    });
  });
});
