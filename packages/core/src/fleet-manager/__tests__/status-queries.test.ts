/**
 * Tests for fleet status query methods (US-3)
 *
 * Tests getFleetStatus(), getAgentInfo(), and getAgentInfoByName() methods.
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
import { AgentNotFoundError } from "../errors.js";
import type { FleetStatus, AgentInfo } from "../types.js";

describe("Fleet Status Query Methods", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await mkdtemp(join(tmpdir(), "fleet-status-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup with retry to handle race conditions from async operations
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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

  describe("getFleetStatus()", () => {
    it("returns status before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const status = await manager.getFleetStatus();

      expect(status.state).toBe("uninitialized");
      expect(status.uptimeSeconds).toBeNull();
      expect(status.initializedAt).toBeNull();
      expect(status.startedAt).toBeNull();
      expect(status.counts.totalAgents).toBe(0);
      expect(status.scheduler.status).toBe("stopped");
    });

    it("returns status after initialization", async () => {
      // Create agent config
      await createAgentConfig("test-agent", {
        name: "test-agent",
        description: "Test agent for status queries",
        schedules: {
          daily: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const status = await manager.getFleetStatus();

      expect(status.state).toBe("initialized");
      expect(status.uptimeSeconds).toBeNull(); // Not started yet
      expect(status.initializedAt).not.toBeNull();
      expect(status.counts.totalAgents).toBe(1);
      expect(status.counts.idleAgents).toBe(1);
      expect(status.counts.totalSchedules).toBe(1);
      expect(status.scheduler.status).toBe("stopped");
    });

    it("returns status after start", async () => {
      // Use disabled schedule to prevent auto-triggering during test
      await createAgentConfig("test-agent", {
        name: "test-agent",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
            enabled: false,
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000, // Long interval to avoid triggers during test
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      await manager.start();

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = await manager.getFleetStatus();

      expect(status.state).toBe("running");
      expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(status.startedAt).not.toBeNull();
      expect(status.scheduler.status).toBe("running");
      expect(status.scheduler.checkIntervalMs).toBe(10000);

      await manager.stop();
    });

    it("returns status after stop", async () => {
      await createAgentConfig("test-agent", {
        name: "test-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await manager.stop();

      const status = await manager.getFleetStatus();

      expect(status.state).toBe("stopped");
      expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(status.stoppedAt).not.toBeNull();
      expect(status.scheduler.status).toBe("stopped");
    });

    it("returns correct counts for multiple agents", async () => {
      await createAgentConfig("agent-1", {
        name: "agent-1",
        schedules: {
          s1: { type: "interval", interval: "1h" },
          s2: { type: "interval", interval: "2h" },
        },
      });

      await createAgentConfig("agent-2", {
        name: "agent-2",
        schedules: {
          s1: { type: "interval", interval: "30m" },
        },
      });

      await createAgentConfig("agent-3", {
        name: "agent-3",
        // No schedules
      });

      const configPath = await createConfig({
        version: 1,
        agents: [
          { path: "./agents/agent-1.yaml" },
          { path: "./agents/agent-2.yaml" },
          { path: "./agents/agent-3.yaml" },
        ],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const status = await manager.getFleetStatus();

      expect(status.counts.totalAgents).toBe(3);
      expect(status.counts.idleAgents).toBe(3);
      expect(status.counts.runningAgents).toBe(0);
      expect(status.counts.errorAgents).toBe(0);
      expect(status.counts.totalSchedules).toBe(3);
      expect(status.counts.runningSchedules).toBe(0);
      expect(status.counts.runningJobs).toBe(0);
    });
  });

  describe("getAgentInfo()", () => {
    it("returns empty array before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      const agents = await manager.getAgentInfo();
      expect(agents).toEqual([]);
    });

    it("returns agent info with schedules", async () => {
      await createAgentConfig("my-agent", {
        name: "my-agent",
        description: "My test agent",
        model: "claude-3-5-sonnet",
        working_directory: "/path/to/workspace",
        instances: { max_concurrent: 2 },
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
        agents: [{ path: "./agents/my-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agents = await manager.getAgentInfo();

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("my-agent");
      expect(agents[0].description).toBe("My test agent");
      expect(agents[0].model).toBe("claude-3-5-sonnet");
      expect(agents[0].working_directory).toBe("/path/to/workspace");
      expect(agents[0].maxConcurrent).toBe(2);
      expect(agents[0].status).toBe("idle");
      expect(agents[0].currentJobId).toBeNull();
      expect(agents[0].lastJobId).toBeNull();
      expect(agents[0].runningCount).toBe(0);
      expect(agents[0].scheduleCount).toBe(2);

      // Check schedules
      expect(agents[0].schedules).toHaveLength(2);
      const hourlySchedule = agents[0].schedules.find((s) => s.name === "hourly");
      expect(hourlySchedule).toBeDefined();
      expect(hourlySchedule!.type).toBe("interval");
      expect(hourlySchedule!.interval).toBe("1h");
      expect(hourlySchedule!.status).toBe("idle");
    });

    it("returns agent info for agent without schedules", async () => {
      await createAgentConfig("simple-agent", {
        name: "simple-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/simple-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agents = await manager.getAgentInfo();

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("simple-agent");
      expect(agents[0].scheduleCount).toBe(0);
      expect(agents[0].schedules).toEqual([]);
      expect(agents[0].maxConcurrent).toBe(1); // Default
    });

    it("returns consistent snapshot for multiple agents", async () => {
      await createAgentConfig("agent-a", { name: "agent-a" });
      await createAgentConfig("agent-b", { name: "agent-b" });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-a.yaml" }, { path: "./agents/agent-b.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agents = await manager.getAgentInfo();

      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name).sort()).toEqual(["agent-a", "agent-b"]);
    });
  });

  describe("getAgentInfoByName()", () => {
    it("returns specific agent info", async () => {
      await createAgentConfig("target-agent", {
        name: "target-agent",
        description: "The target",
        model: "claude-opus",
      });

      await createAgentConfig("other-agent", {
        name: "other-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/target-agent.yaml" }, { path: "./agents/other-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agent = await manager.getAgentInfoByName("target-agent");

      expect(agent.name).toBe("target-agent");
      expect(agent.description).toBe("The target");
      expect(agent.model).toBe("claude-opus");
    });

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
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();

      await expect(manager.getAgentInfoByName("unknown-agent")).rejects.toThrow(AgentNotFoundError);

      await expect(manager.getAgentInfoByName("unknown-agent")).rejects.toMatchObject({
        name: "AgentNotFoundError",
        agentName: "unknown-agent",
      });
    });

    it("throws AgentNotFoundError before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await expect(manager.getAgentInfoByName("any-agent")).rejects.toThrow(AgentNotFoundError);
    });
  });

  describe("status queries work with running fleet", () => {
    it("getFleetStatus works while running", async () => {
      await createAgentConfig("running-test", {
        name: "running-test",
        schedules: {
          test: { type: "interval", interval: "1h" },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/running-test.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000, // Long interval
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      await manager.start();

      // Query multiple times while running
      const status1 = await manager.getFleetStatus();
      const status2 = await manager.getFleetStatus();

      expect(status1.state).toBe("running");
      expect(status2.state).toBe("running");
      expect(status1.scheduler.status).toBe("running");
      expect(status2.scheduler.status).toBe("running");

      await manager.stop();
    });

    it("getAgentInfo works while running", async () => {
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
        checkInterval: 10000,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      await manager.start();

      const agents = await manager.getAgentInfo();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe("running-agent");

      await manager.stop();
    });

    it("getAgentInfoByName works while running", async () => {
      await createAgentConfig("specific-agent", {
        name: "specific-agent",
        description: "Specific running agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/specific-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      await manager.start();

      const agent = await manager.getAgentInfoByName("specific-agent");
      expect(agent.name).toBe("specific-agent");
      expect(agent.description).toBe("Specific running agent");

      await manager.stop();
    });
  });

  describe("working directory handling", () => {
    it("handles string working directory", async () => {
      await createAgentConfig("string-ws-agent", {
        name: "string-ws-agent",
        working_directory: "/simple/path",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/string-ws-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agent = await manager.getAgentInfoByName("string-ws-agent");
      expect(agent.working_directory).toBe("/simple/path");
    });

    it("handles object working directory", async () => {
      await createAgentConfig("object-ws-agent", {
        name: "object-ws-agent",
        working_directory: {
          root: "/workspace/root",
          auto_clone: true,
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/object-ws-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agent = await manager.getAgentInfoByName("object-ws-agent");
      expect(agent.working_directory).toBe("/workspace/root");
    });

    it("handles missing working directory", async () => {
      await createAgentConfig("no-ws-agent", {
        name: "no-ws-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-ws-agent.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await manager.initialize();
      const agent = await manager.getAgentInfoByName("no-ws-agent");
      // With no explicit working directory, defaults to agent config directory
      expect(agent.working_directory).toBe(join(configDir, "agents"));
    });
  });
});
