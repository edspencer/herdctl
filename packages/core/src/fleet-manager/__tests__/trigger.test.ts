/**
 * Tests for manual agent triggering (US-5)
 *
 * Tests the trigger() method for manually triggering agents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during tests
// Mock the SDK to return an async generator that yields a simple system message
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn().mockImplementation(async function* () {
    yield { type: "system", subtype: "init", session_id: "test-session-123" };
    yield { type: "assistant", content: "Test complete" };
  }),
}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentNotFoundError,
  InvalidStateError,
  InvalidWorkingDirectoryOverrideError,
  ScheduleNotFoundError,
} from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

/** Read the `cwd` passed to the (mocked) SDK query for the most recent trigger. */
function lastSdkCwd(): unknown {
  const mockQuery = vi.mocked(query);
  const lastCall = mockQuery.mock.calls.at(-1);
  const callOptions = (lastCall?.[0] as { options?: { cwd?: unknown } } | undefined)?.options;
  return callOptions?.cwd;
}

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
        }),
      );
    });

    it("emits job:created with 'pending' status at creation time (issue #328)", async () => {
      await createAgentConfig("pending-agent", { name: "pending-agent" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/pending-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobCreatedHandler = vi.fn();
      manager.on("job:created", jobCreatedHandler);

      await manager.trigger("pending-agent");

      // The record carried by job:created must reflect its state AT creation
      // (pending), not the finalized (completed) status — proving the event is
      // emitted up front rather than after execution resolves.
      expect(jobCreatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({ status: "pending" }),
        }),
      );
    });

    it("emits job:created BEFORE job:output and job:completed on manual trigger (issue #328)", async () => {
      await createAgentConfig("order-agent", { name: "order-agent" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/order-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const order: string[] = [];
      manager.on("job:created", () => order.push("job:created"));
      manager.on("job:output", () => order.push("job:output"));
      manager.on("job:completed", () => order.push("job:completed"));

      await manager.trigger("order-agent");

      // Manual triggers previously emitted ZERO job:output and fired
      // job:created only AFTER completion. Now: created → output → completed.
      expect(order[0]).toBe("job:created");
      expect(order).toContain("job:output");
      expect(order.at(-1)).toBe("job:completed");
      expect(order.indexOf("job:created")).toBeLessThan(order.indexOf("job:output"));
      expect(order.indexOf("job:output")).toBeLessThan(order.indexOf("job:completed"));
      // Exactly one job:created — the event was MOVED, not duplicated.
      expect(order.filter((e) => e === "job:created")).toHaveLength(1);
    });

    it("emits job:output for streamed assistant messages on manual trigger (issue #328)", async () => {
      await createAgentConfig("output-agent", { name: "output-agent" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/output-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const jobOutputHandler = vi.fn();
      manager.on("job:output", jobOutputHandler);

      const result = await manager.trigger("output-agent");

      // The mocked SDK yields an assistant message with content "Test complete".
      expect(jobOutputHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: result.jobId,
          agentName: "output-agent",
          output: "Test complete",
          outputType: "assistant",
        }),
      );
    });

    it("throws InvalidStateError before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = createTestManager(configPath);

      await expect(manager.trigger("any-agent")).rejects.toThrow(InvalidStateError);
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

      await expect(manager.trigger("unknown-agent")).rejects.toThrow(AgentNotFoundError);
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

      await expect(manager.trigger("schedule-test", "unknown")).rejects.toThrow(
        ScheduleNotFoundError,
      );
      await expect(manager.trigger("schedule-test", "unknown")).rejects.toMatchObject({
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

      await expect(manager.trigger("no-schedules", "any-schedule")).rejects.toThrow(
        ScheduleNotFoundError,
      );
      await expect(manager.trigger("no-schedules", "any-schedule")).rejects.toMatchObject({
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

      // Default prompt when neither specified (job execution requires a prompt)
      const r3 = await manager.trigger("priority-agent", "no_prompt");
      expect(r3.prompt).toBe("Execute your configured task");
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
        }),
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
        }),
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
        }),
      );
    });
  });

  describe("per-trigger working-directory override", () => {
    it("runs in the override cwd when workingDirectory is provided", async () => {
      // Agent configured with one working_directory...
      await createAgentConfig("wd-agent", {
        name: "wd-agent",
        working_directory: "/configured/dir",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // ...but triggered against a different absolute directory.
      const overrideDir = "/override/project";
      const result = await manager.trigger("wd-agent", undefined, {
        workingDirectory: overrideDir,
      });

      expect(result.success).toBe(true);
      // The SDK runtime should have been invoked with the override cwd, not the
      // configured working_directory.
      expect(lastSdkCwd()).toBe(overrideDir);
    });

    it("uses the configured working_directory when override is omitted (unchanged)", async () => {
      await createAgentConfig("wd-default-agent", {
        name: "wd-default-agent",
        working_directory: "/configured/dir",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-default-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.trigger("wd-default-agent");

      // Default behavior: SDK cwd is the configured working_directory.
      expect(lastSdkCwd()).toBe("/configured/dir");
    });

    it("leaves the resolved cwd unchanged for an agent without an explicit working_directory when override is omitted", async () => {
      await createAgentConfig("wd-none-agent", {
        name: "wd-none-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-none-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Baseline: trigger with no override. The loader resolves a default
      // working_directory (the agent's config dir), which becomes the SDK cwd.
      await manager.trigger("wd-none-agent");
      const baselineCwd = lastSdkCwd();

      // Triggering again with no override must produce the identical cwd —
      // proving the override code path is a no-op when omitted.
      await manager.trigger("wd-none-agent");
      expect(lastSdkCwd()).toBe(baselineCwd);
    });

    it("lets an agent without configured working_directory run against an override", async () => {
      await createAgentConfig("wd-bare-agent", {
        name: "wd-bare-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-bare-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.trigger("wd-bare-agent", undefined, {
        workingDirectory: "/sweeper/target",
      });

      expect(lastSdkCwd()).toBe("/sweeper/target");
    });

    it("resolves a relative override against process.cwd()", async () => {
      await createAgentConfig("wd-rel-agent", {
        name: "wd-rel-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-rel-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.trigger("wd-rel-agent", undefined, {
        workingDirectory: "some/relative/dir",
      });

      const cwd = lastSdkCwd();
      expect(typeof cwd).toBe("string");
      expect(isAbsolute(cwd as string)).toBe(true);
      expect(cwd).toBe(resolve(process.cwd(), "some/relative/dir"));
    });

    it("rejects an empty-string override", async () => {
      await createAgentConfig("wd-empty-agent", {
        name: "wd-empty-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-empty-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Typed error (extends FleetManagerError), not a raw Error — per repo
      // guidelines and the CodeRabbit fix.
      await expect(
        manager.trigger("wd-empty-agent", undefined, { workingDirectory: "   " }),
      ).rejects.toThrow(InvalidWorkingDirectoryOverrideError);
      await expect(
        manager.trigger("wd-empty-agent", undefined, { workingDirectory: "   " }),
      ).rejects.toThrow(/Invalid workingDirectory override/);
    });

    it("the override does not mutate the agent's configured working_directory", async () => {
      await createAgentConfig("wd-immutable-agent", {
        name: "wd-immutable-agent",
        working_directory: "/configured/dir",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/wd-immutable-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Trigger once with an override, then once without.
      await manager.trigger("wd-immutable-agent", undefined, {
        workingDirectory: "/override/dir",
      });
      expect(lastSdkCwd()).toBe("/override/dir");

      // The second (un-overridden) trigger must fall back to the configured dir,
      // proving the first trigger did not mutate the shared agent config.
      await manager.trigger("wd-immutable-agent");
      expect(lastSdkCwd()).toBe("/configured/dir");
    });
  });
});
