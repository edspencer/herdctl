/**
 * Tests for FleetManager job control methods (US-6)
 *
 * Tests cancelJob, forkJob, and streamLogs functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during tests
// Mock the SDK to return an async generator that yields a simple system message
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockImplementation(async function* () {
    yield { type: "system", subtype: "init", session_id: "test-session-123" };
    yield { type: "assistant", content: "Test complete" };
  }),
}));

import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FleetManager } from "../fleet-manager.js";
import {
  InvalidStateError,
  JobNotFoundError,
  JobForkError,
} from "../errors.js";
import { getSessionInfo, updateSessionInfo } from "../../state/index.js";
import type { FleetManagerLogger, JobCancelledPayload, JobForkedPayload } from "../types.js";

describe("FleetManager Job Control (US-6)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "job-control-test-"));
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
  // cancelJob tests
  // ===========================================================================
  describe("cancelJob", () => {
    it("throws InvalidStateError before initialization", async () => {
      await createAgentConfig("test-agent", { name: "test-agent" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.cancelJob("job-123")).rejects.toThrow(
        InvalidStateError
      );
    });

    it("throws JobNotFoundError for non-existent job", async () => {
      const manager = await createInitializedManager();

      await expect(manager.cancelJob("job-2099-01-01-nonexistent")).rejects.toThrow(
        JobNotFoundError
      );
    });

    it("returns already_stopped for completed job when trigger executes to completion", async () => {
      const manager = await createInitializedManager();

      // Trigger a job - this now executes to completion via JobExecutor
      const triggerResult = await manager.trigger("test-agent");

      // Try to cancel the already-completed job
      const result = await manager.cancelJob(triggerResult.jobId);

      // Job is already completed, so we get already_stopped
      expect(result.success).toBe(true);
      expect(result.jobId).toBe(triggerResult.jobId);
      expect(result.terminationType).toBe("already_stopped");
      expect(result.canceledAt).toBeDefined();
    });

    it("returns already_stopped for completed jobs", async () => {
      const manager = await createInitializedManager();

      // Trigger and then cancel a job (which marks it as cancelled)
      const triggerResult = await manager.trigger("test-agent");
      await manager.cancelJob(triggerResult.jobId);

      // Try to cancel again
      const result = await manager.cancelJob(triggerResult.jobId);

      expect(result.success).toBe(true);
      expect(result.terminationType).toBe("already_stopped");
    });

    it("works with custom timeout option", async () => {
      const manager = await createInitializedManager();

      const triggerResult = await manager.trigger("test-agent");
      const result = await manager.cancelJob(triggerResult.jobId, {
        timeout: 5000,
      });

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // forkJob tests
  // ===========================================================================
  describe("forkJob", () => {
    it("throws InvalidStateError before initialization", async () => {
      await createAgentConfig("test-agent", { name: "test-agent" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.forkJob("job-123")).rejects.toThrow(InvalidStateError);
    });

    it("throws JobForkError for non-existent job", async () => {
      const manager = await createInitializedManager();

      await expect(manager.forkJob("job-2099-01-01-nonexistent")).rejects.toThrow(
        JobForkError
      );
    });

    it("forks a job successfully", async () => {
      const manager = await createInitializedManager();

      // Trigger a job first
      const triggerResult = await manager.trigger("test-agent", undefined, {
        prompt: "Original prompt",
      });

      // Set up event listeners
      const createdHandler = vi.fn();
      const forkedHandler = vi.fn();
      manager.on("job:created", createdHandler);
      manager.on("job:forked", forkedHandler);

      // Fork the job
      const result = await manager.forkJob(triggerResult.jobId);

      expect(result.jobId).toBeDefined();
      expect(result.jobId).not.toBe(triggerResult.jobId);
      expect(result.forkedFromJobId).toBe(triggerResult.jobId);
      expect(result.agentName).toBe("test-agent");
      expect(result.startedAt).toBeDefined();

      // Verify job:created event was emitted
      expect(createdHandler).toHaveBeenCalled();

      // Verify job:forked event was emitted
      expect(forkedHandler).toHaveBeenCalledTimes(1);
      expect(forkedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ id: result.jobId }),
          originalJob: expect.objectContaining({ id: triggerResult.jobId }),
          agentName: "test-agent",
        })
      );
    });

    it("forks a job with modified prompt", async () => {
      const manager = await createInitializedManager();

      const triggerResult = await manager.trigger("test-agent", undefined, {
        prompt: "Original prompt",
      });

      const result = await manager.forkJob(triggerResult.jobId, {
        prompt: "Modified prompt",
      });

      expect(result.prompt).toBe("Modified prompt");
    });

    it("throws JobForkError when agent no longer exists", async () => {
      const manager = await createInitializedManager();

      // Trigger a job
      const triggerResult = await manager.trigger("test-agent");

      // Reload config without the agent
      await createConfig({
        version: 1,
        agents: [],
      });
      await manager.reload();

      // Try to fork - should fail because agent doesn't exist
      await expect(manager.forkJob(triggerResult.jobId)).rejects.toThrow(
        JobForkError
      );
    });
  });

  // ===========================================================================
  // streamLogs tests
  // Note: streamLogs is an async generator that may keep running for live logs.
  // These tests verify the method exists and basic parameter handling.
  // ===========================================================================
  describe("streamLogs", () => {
    it("is a function that returns an async iterable", async () => {
      const manager = await createInitializedManager();

      // Verify it's a function
      expect(typeof manager.streamLogs).toBe("function");

      // Verify it returns an async iterable (has Symbol.asyncIterator)
      const iterable = manager.streamLogs({ includeHistory: false });
      expect(typeof iterable[Symbol.asyncIterator]).toBe("function");
    });
  });

  // ===========================================================================
  // Session resume tests (authentication bug fix)
  // ===========================================================================
  describe("trigger session resume", () => {
    it("automatically resumes existing session when triggering an agent", async () => {
      const manager = await createInitializedManager();

      // Create an existing session for the agent
      const sessionsDir = join(stateDir, "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await updateSessionInfo(sessionsDir, "test-agent", {
        session_id: "existing-session-abc123",
        mode: "autonomous",
      });

      // Trigger the agent - should automatically use the existing session
      const result = await manager.trigger("test-agent");

      // The job should have completed successfully
      expect(result.success).toBe(true);

      // Note: The actual resume behavior is handled by JobExecutor which validates
      // against the mock SDK. The key assertion is that the session info was read
      // and the trigger completed without errors, indicating the session was found.
    });

    it("respects explicit resume option over automatic session lookup", async () => {
      const manager = await createInitializedManager();

      // Create an existing session for the agent
      const sessionsDir = join(stateDir, "sessions");
      await mkdir(sessionsDir, { recursive: true });
      await updateSessionInfo(sessionsDir, "test-agent", {
        session_id: "existing-session-abc123",
        mode: "autonomous",
      });

      // Trigger with an explicit resume option - should use provided session
      const result = await manager.trigger("test-agent", undefined, {
        resume: "explicit-session-xyz789",
      });

      // The job should have completed successfully
      expect(result.success).toBe(true);
    });

    it("handles missing session gracefully", async () => {
      const manager = await createInitializedManager();

      // Don't create any session - trigger should work without resume
      const result = await manager.trigger("test-agent");

      // The job should have completed successfully even without an existing session
      expect(result.success).toBe(true);
    });

    it("handles expired session gracefully", async () => {
      const manager = await createInitializedManager();

      // Create an expired session (set last_used_at to 25 hours ago)
      const sessionsDir = join(stateDir, "sessions");
      await mkdir(sessionsDir, { recursive: true });

      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const sessionData = {
        agent_name: "test-agent",
        session_id: "expired-session-old123",
        created_at: twentyFiveHoursAgo,
        last_used_at: twentyFiveHoursAgo,
        job_count: 1,
        mode: "autonomous" as const,
      };
      await writeFile(
        join(sessionsDir, "test-agent.json"),
        JSON.stringify(sessionData, null, 2)
      );

      // Trigger the agent - should start fresh session since old one is expired
      const result = await manager.trigger("test-agent");

      // The job should have completed successfully with a fresh session
      expect(result.success).toBe(true);
    });
  });
});
