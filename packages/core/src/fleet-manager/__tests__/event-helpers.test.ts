/**
 * Tests for FleetManager event emission helpers
 *
 * Tests the public event emission methods and error handling paths.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FleetManager } from "../fleet-manager.js";
import type {
  ConfigReloadedPayload,
  AgentStartedPayload,
  AgentStoppedPayload,
  ScheduleSkippedPayload,
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
  JobCancelledPayload,
  JobForkedPayload,
  FleetManagerLogger,
} from "../types.js";
import type { JobMetadata } from "../../state/schemas/job-metadata.js";

describe("FleetManager Event Emission Helpers", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "event-helpers-test-"));
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

  async function createInitializedManager() {
    await createAgentConfig("test-agent", {
      name: "test-agent",
      description: "Test agent",
    });

    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/test-agent.yaml" }],
    });

    const manager = new FleetManager({
      configPath,
      stateDir,
      checkInterval: 10000,
      logger: createSilentLogger(),
    });

    await manager.initialize();
    return manager;
  }

  // ===========================================================================
  // emitConfigReloaded
  // ===========================================================================
  describe("emitConfigReloaded", () => {
    it("emits config:reloaded event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("config:reloaded", handler);

      const payload: ConfigReloadedPayload = {
        agentCount: 2,
        agentNames: ["agent-1", "agent-2"],
        configPath: "/path/to/config.yaml",
        changes: [
          { type: "added", category: "agent", name: "agent-2" },
        ],
        timestamp: new Date().toISOString(),
      };

      manager.emitConfigReloaded(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitAgentStarted
  // ===========================================================================
  describe("emitAgentStarted", () => {
    it("emits agent:started event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("agent:started", handler);

      const payload: AgentStartedPayload = {
        agent: {
          name: "my-agent",
          configPath: "/path/to/agent.yaml",
          schedules: {
            hourly: { type: "interval", interval: "1h" },
            daily: { type: "cron", expression: "0 0 * * *" },
          },
        },
        timestamp: new Date().toISOString(),
      };

      manager.emitAgentStarted(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitAgentStopped
  // ===========================================================================
  describe("emitAgentStopped", () => {
    it("emits agent:stopped event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("agent:stopped", handler);

      const payload: AgentStoppedPayload = {
        agentName: "my-agent",
        reason: "removed",
        timestamp: new Date().toISOString(),
      };

      manager.emitAgentStopped(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitScheduleSkipped
  // ===========================================================================
  describe("emitScheduleSkipped", () => {
    it("emits schedule:skipped event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("schedule:skipped", handler);

      const payload: ScheduleSkippedPayload = {
        agentName: "my-agent",
        scheduleName: "hourly",
        reason: "already_running",
        timestamp: new Date().toISOString(),
      };

      manager.emitScheduleSkipped(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobCreated
  // ===========================================================================
  describe("emitJobCreated", () => {
    it("emits job:created event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:created", handler);

      const mockJob: JobMetadata = {
        id: "job-2024-01-15-abc123",
        agent: "my-agent",
        status: "pending",
        trigger_type: "schedule",
        schedule: "hourly",
        prompt: "Test prompt",
        started_at: new Date().toISOString(),
      };

      const payload: JobCreatedPayload = {
        job: mockJob,
        agentName: "my-agent",
        scheduleName: "hourly",
        timestamp: new Date().toISOString(),
      };

      manager.emitJobCreated(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobOutput
  // ===========================================================================
  describe("emitJobOutput", () => {
    it("emits job:output event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:output", handler);

      const payload: JobOutputPayload = {
        jobId: "job-2024-01-15-abc123",
        agentName: "my-agent",
        output: "Hello, world!",
        outputType: "stdout",
        timestamp: new Date().toISOString(),
      };

      manager.emitJobOutput(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobCompleted
  // ===========================================================================
  describe("emitJobCompleted", () => {
    it("emits job:completed event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:completed", handler);

      const mockJob: JobMetadata = {
        id: "job-2024-01-15-abc123",
        agent: "my-agent",
        status: "completed",
        trigger_type: "manual",
        prompt: "Test prompt",
        started_at: new Date(Date.now() - 60000).toISOString(),
        finished_at: new Date().toISOString(),
        exit_reason: "success",
      };

      const payload: JobCompletedPayload = {
        job: mockJob,
        agentName: "my-agent",
        exitReason: "success",
        durationSeconds: 60,
        timestamp: new Date().toISOString(),
      };

      manager.emitJobCompleted(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobFailed
  // ===========================================================================
  describe("emitJobFailed", () => {
    it("emits job:failed event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:failed", handler);

      const mockJob: JobMetadata = {
        id: "job-2024-01-15-abc123",
        agent: "my-agent",
        status: "failed",
        trigger_type: "schedule",
        schedule: "hourly",
        prompt: "Test prompt",
        started_at: new Date(Date.now() - 30000).toISOString(),
        finished_at: new Date().toISOString(),
        exit_reason: "error",
      };

      const payload: JobFailedPayload = {
        job: mockJob,
        agentName: "my-agent",
        error: new Error("Process failed with exit code 1"),
        exitReason: "error",
        durationSeconds: 30,
        timestamp: new Date().toISOString(),
      };

      manager.emitJobFailed(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobCancelled
  // ===========================================================================
  describe("emitJobCancelled", () => {
    it("emits job:cancelled event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:cancelled", handler);

      const mockJob: JobMetadata = {
        id: "job-2024-01-15-abc123",
        agent: "my-agent",
        status: "cancelled",
        trigger_type: "manual",
        prompt: "Test prompt",
        started_at: new Date(Date.now() - 120000).toISOString(),
        finished_at: new Date().toISOString(),
        exit_reason: "cancelled",
      };

      const payload: JobCancelledPayload = {
        job: mockJob,
        agentName: "my-agent",
        terminationType: "graceful",
        durationSeconds: 120,
        timestamp: new Date().toISOString(),
      };

      manager.emitJobCancelled(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // emitJobForked
  // ===========================================================================
  describe("emitJobForked", () => {
    it("emits job:forked event with payload", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();
      manager.on("job:forked", handler);

      const originalJob: JobMetadata = {
        id: "job-2024-01-15-orig",
        agent: "my-agent",
        status: "completed",
        trigger_type: "manual",
        prompt: "Original prompt",
        started_at: new Date(Date.now() - 3600000).toISOString(),
        finished_at: new Date(Date.now() - 3000000).toISOString(),
        exit_reason: "success",
      };

      const newJob: JobMetadata = {
        id: "job-2024-01-15-forked",
        agent: "my-agent",
        status: "pending",
        trigger_type: "fork",
        prompt: "Continue from previous",
        started_at: new Date().toISOString(),
        forked_from: "job-2024-01-15-orig",
      };

      const payload: JobForkedPayload = {
        job: newJob,
        originalJob,
        agentName: "my-agent",
        timestamp: new Date().toISOString(),
      };

      manager.emitJobForked(payload);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(payload);
    });
  });

  // ===========================================================================
  // Multiple listeners
  // ===========================================================================
  describe("multiple event listeners", () => {
    it("supports multiple listeners for the same event", async () => {
      const manager = await createInitializedManager();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.on("job:output", handler1);
      manager.on("job:output", handler2);

      const payload: JobOutputPayload = {
        jobId: "job-123",
        agentName: "agent",
        output: "test",
        outputType: "stdout",
        timestamp: new Date().toISOString(),
      };

      manager.emitJobOutput(payload);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("supports removing listeners", async () => {
      const manager = await createInitializedManager();
      const handler = vi.fn();

      manager.on("job:created", handler);
      manager.off("job:created", handler);

      const mockJob: JobMetadata = {
        id: "job-123",
        agent: "agent",
        status: "pending",
        trigger_type: "manual",
        prompt: "test",
        started_at: new Date().toISOString(),
      };

      manager.emitJobCreated({
        job: mockJob,
        agentName: "agent",
        timestamp: new Date().toISOString(),
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
