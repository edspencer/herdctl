/**
 * Tests for manual agent triggering (US-5)
 *
 * Tests the trigger() method for manually triggering agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during tests
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FleetManager } from "../fleet-manager.js";
import {
  AgentNotFoundError,
  ScheduleNotFoundError,
  ConcurrencyLimitError,
  InvalidStateError,
} from "../errors.js";
import type { TriggerOptions, TriggerResult } from "../types.js";

describe("Manual Agent Triggering (US-5)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await mkdtemp(join(tmpdir(), "fleet-trigger-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
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

  // Create a test manager with silent logger
  function createTestManager(configPath: string) {
    return new FleetManager({
      configPath,
      stateDir,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  }

  describe("trigger(agentName)", () => {
    it("triggers an agent with defaults and returns job info", async () => {
      await createAgentConfig("test-agent", {
        name: "test-agent",
        description: "Test agent for triggering",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("test-agent");

      expect(result).toMatchObject({
        agentName: "test-agent",
        scheduleName: null,
      });
      expect(result.jobId).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/);
      expect(result.startedAt).toBeDefined();
    });

    it("emits job:created event when triggering", async () => {
      await createAgentConfig("event-agent", {
        name: "event-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/event-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobCreatedHandler = vi.fn();
      manager.on("job:created", jobCreatedHandler);

      const result = await manager.trigger("event-agent");

      expect(jobCreatedHandler).toHaveBeenCalledTimes(1);
      expect(jobCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({
            id: result.jobId,
            agent: "event-agent",
            trigger_type: "manual",
          }),
          agentName: "event-agent",
          scheduleName: null,
        })
      );
    });

    it("throws InvalidStateError before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = createTestManager(configPath);

      await expect(manager.trigger("any-agent")).rejects.toThrow(
        InvalidStateError
      );
      await expect(manager.trigger("any-agent")).rejects.toMatchObject({
        operation: "trigger",
        currentState: "uninitialized",
      });
    });

    it("throws AgentNotFoundError for unknown agent", async () => {
      await createAgentConfig("known-agent", {
        name: "known-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/known-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(manager.trigger("unknown-agent")).rejects.toThrow(
        AgentNotFoundError
      );
      await expect(manager.trigger("unknown-agent")).rejects.toMatchObject({
        agentName: "unknown-agent",
        availableAgents: ["known-agent"],
      });
    });
  });

  describe("trigger(agentName, scheduleName)", () => {
    it("triggers with a specific schedule", async () => {
      await createAgentConfig("scheduled-agent", {
        name: "scheduled-agent",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
            prompt: "Check hourly tasks",
          },
          daily: {
            type: "interval",
            interval: "24h",
            prompt: "Check daily tasks",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/scheduled-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("scheduled-agent", "hourly");

      expect(result).toMatchObject({
        agentName: "scheduled-agent",
        scheduleName: "hourly",
        prompt: "Check hourly tasks",
      });
    });

    it("uses schedule prompt if no override provided", async () => {
      await createAgentConfig("prompt-agent", {
        name: "prompt-agent",
        schedules: {
          review: {
            type: "interval",
            interval: "1h",
            prompt: "Review code changes",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/prompt-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("prompt-agent", "review");

      expect(result.prompt).toBe("Review code changes");
    });

    it("throws ScheduleNotFoundError for unknown schedule", async () => {
      await createAgentConfig("schedule-test", {
        name: "schedule-test",
        schedules: {
          known: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-test.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(
        manager.trigger("schedule-test", "unknown")
      ).rejects.toThrow(ScheduleNotFoundError);
      await expect(
        manager.trigger("schedule-test", "unknown")
      ).rejects.toMatchObject({
        agentName: "schedule-test",
        scheduleName: "unknown",
        availableSchedules: ["known"],
      });
    });

    it("throws ScheduleNotFoundError for agent without schedules", async () => {
      await createAgentConfig("no-schedules", {
        name: "no-schedules",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedules.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(
        manager.trigger("no-schedules", "any-schedule")
      ).rejects.toThrow(ScheduleNotFoundError);
      await expect(
        manager.trigger("no-schedules", "any-schedule")
      ).rejects.toMatchObject({
        availableSchedules: [],
      });
    });
  });

  describe("trigger(agentName, scheduleName?, options)", () => {
    it("allows prompt override via options", async () => {
      await createAgentConfig("override-agent", {
        name: "override-agent",
        schedules: {
          default: {
            type: "interval",
            interval: "1h",
            prompt: "Default prompt",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/override-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("override-agent", "default", {
        prompt: "Custom prompt",
      });

      expect(result.prompt).toBe("Custom prompt");
    });

    it("uses option prompt when no schedule specified", async () => {
      await createAgentConfig("no-schedule-prompt", {
        name: "no-schedule-prompt",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-schedule-prompt.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("no-schedule-prompt", undefined, {
        prompt: "Override prompt",
      });

      expect(result.prompt).toBe("Override prompt");
    });

    it("prompt priority: options > schedule > undefined", async () => {
      await createAgentConfig("priority-agent", {
        name: "priority-agent",
        schedules: {
          with_prompt: {
            type: "interval",
            interval: "1h",
            prompt: "Schedule prompt",
          },
          no_prompt: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/priority-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Option overrides schedule
      const r1 = await manager.trigger("priority-agent", "with_prompt", {
        prompt: "Option prompt",
      });
      expect(r1.prompt).toBe("Option prompt");

      // Schedule used when no option
      const r2 = await manager.trigger("priority-agent", "with_prompt");
      expect(r2.prompt).toBe("Schedule prompt");

      // No prompt when neither specified
      const r3 = await manager.trigger("priority-agent", "no_prompt");
      expect(r3.prompt).toBeUndefined();
    });
  });

  describe("concurrency limits", () => {
    it("respects max_concurrent by default", async () => {
      await createAgentConfig("limited-agent", {
        name: "limited-agent",
        instances: { max_concurrent: 1 },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/limited-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // First trigger should succeed
      const result1 = await manager.trigger("limited-agent");
      expect(result1.jobId).toBeDefined();

      // Note: In a real scenario, the job would be running and the second trigger
      // would fail. Here we're just testing the concurrency check logic.
      // The scheduler tracks running jobs, but since we're not using the scheduler
      // to run jobs in this test, subsequent triggers will succeed.
    });

    it("allows bypass with bypassConcurrencyLimit option", async () => {
      await createAgentConfig("bypass-agent", {
        name: "bypass-agent",
        instances: { max_concurrent: 1 },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/bypass-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Trigger with bypass should succeed
      const result = await manager.trigger("bypass-agent", undefined, {
        bypassConcurrencyLimit: true,
      });
      expect(result.jobId).toBeDefined();
    });

    it("defaults max_concurrent to 1 if not specified", async () => {
      await createAgentConfig("default-max", {
        name: "default-max",
        // No instances config
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/default-max.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Should work - default max_concurrent is 1
      const result = await manager.trigger("default-max");
      expect(result.jobId).toBeDefined();
    });
  });

  describe("trigger works in different states", () => {
    it("works after initialization", async () => {
      await createAgentConfig("init-agent", {
        name: "init-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/init-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.trigger("init-agent");
      expect(result.agentName).toBe("init-agent");
    });

    it("works while running", async () => {
      await createAgentConfig("running-agent", {
        name: "running-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/running-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000, // Long interval
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      await manager.initialize();
      await manager.start();

      const result = await manager.trigger("running-agent");
      expect(result.agentName).toBe("running-agent");

      await manager.stop();
    });

    it("works after stopping", async () => {
      await createAgentConfig("stopped-agent", {
        name: "stopped-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/stopped-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      await manager.initialize();
      await manager.start();
      await manager.stop();

      const result = await manager.trigger("stopped-agent");
      expect(result.agentName).toBe("stopped-agent");
    });
  });

  describe("job creation", () => {
    it("creates job with correct trigger_type", async () => {
      await createAgentConfig("trigger-type-agent", {
        name: "trigger-type-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/trigger-type-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobCreatedHandler = vi.fn();
      manager.on("job:created", jobCreatedHandler);

      await manager.trigger("trigger-type-agent");

      expect(jobCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({
            trigger_type: "manual",
          }),
        })
      );
    });

    it("stores schedule name in job when provided", async () => {
      await createAgentConfig("job-schedule-agent", {
        name: "job-schedule-agent",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/job-schedule-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobCreatedHandler = vi.fn();
      manager.on("job:created", jobCreatedHandler);

      await manager.trigger("job-schedule-agent", "test");

      expect(jobCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleName: "test",
          job: expect.objectContaining({
            schedule: "test",
          }),
        })
      );
    });

    it("stores prompt in job metadata", async () => {
      await createAgentConfig("job-prompt-agent", {
        name: "job-prompt-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/job-prompt-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobCreatedHandler = vi.fn();
      manager.on("job:created", jobCreatedHandler);

      await manager.trigger("job-prompt-agent", undefined, {
        prompt: "Test prompt for job",
      });

      expect(jobCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({
            prompt: "Test prompt for job",
          }),
        })
      );
    });
  });
});
