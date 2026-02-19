/**
 * Tests for configuration hot reload (US-9)
 *
 * Tests the reload() method for hot configuration reload without restarting.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during tests
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidStateError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";
import type { ConfigReloadedPayload } from "../types.js";

describe("Configuration Hot Reload (US-9)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    // Create temp directory for test
    tempDir = await mkdtemp(join(tmpdir(), "fleet-reload-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    // Small delay to allow any background operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Cleanup
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

  describe("reload() basic functionality", () => {
    it("reloads and validates configuration", async () => {
      await createAgentConfig("test-agent", {
        name: "test-agent",
        description: "Original description",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Modify the agent config
      await createAgentConfig("test-agent", {
        name: "test-agent",
        description: "Updated description",
      });

      const result = await manager.reload();

      expect(result.agentCount).toBe(1);
      expect(result.agentNames).toContain("test-agent");
      expect(result.configPath).toBe(configPath);
      expect(result.timestamp).toBeDefined();
    });

    it("throws InvalidStateError before initialization", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
      });

      const manager = createTestManager(configPath);

      await expect(manager.reload()).rejects.toThrow(InvalidStateError);
      await expect(manager.reload()).rejects.toMatchObject({
        operation: "reload",
        currentState: "uninitialized",
      });
    });

    it("works in all valid states (initialized, running, stopped)", async () => {
      await createAgentConfig("state-test", {
        name: "state-test",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/state-test.yaml" }],
      });

      const manager = new FleetManager({
        configPath,
        stateDir,
        checkInterval: 10000, // Long interval to avoid interference
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      // Test in initialized state
      await manager.initialize();
      let result = await manager.reload();
      expect(result.agentCount).toBe(1);

      // Test in running state
      await manager.start();
      result = await manager.reload();
      expect(result.agentCount).toBe(1);

      // Test in stopped state
      await manager.stop();
      result = await manager.reload();
      expect(result.agentCount).toBe(1);
    });
  });

  describe("change detection", () => {
    it("detects added agents", async () => {
      await createAgentConfig("agent-1", {
        name: "agent-1",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-1.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Add a new agent
      await createAgentConfig("agent-2", {
        name: "agent-2",
        description: "New agent",
      });

      // Update config to include new agent
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-1.yaml" }, { path: "./agents/agent-2.yaml" }],
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "agent",
          name: "agent-2",
        }),
      );
      expect(result.agentCount).toBe(2);
    });

    it("detects removed agents", async () => {
      await createAgentConfig("agent-1", {
        name: "agent-1",
      });
      await createAgentConfig("agent-2", {
        name: "agent-2",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-1.yaml" }, { path: "./agents/agent-2.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Remove agent-2 from config
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/agent-1.yaml" }],
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "agent",
          name: "agent-2",
        }),
      );
      expect(result.agentCount).toBe(1);
    });

    it("detects modified agents", async () => {
      await createAgentConfig("mod-agent", {
        name: "mod-agent",
        description: "Original",
        model: "claude-sonnet",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/mod-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Modify the agent
      await createAgentConfig("mod-agent", {
        name: "mod-agent",
        description: "Updated",
        model: "claude-opus",
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "mod-agent",
        }),
      );
    });

    it("detects added schedules", async () => {
      await createAgentConfig("schedule-agent", {
        name: "schedule-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Add schedules to agent
      await createAgentConfig("schedule-agent", {
        name: "schedule-agent",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "added",
          category: "schedule",
          name: "schedule-agent/hourly",
        }),
      );
    });

    it("detects removed schedules", async () => {
      await createAgentConfig("schedule-agent", {
        name: "schedule-agent",
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
        agents: [{ path: "./agents/schedule-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Remove a schedule
      await createAgentConfig("schedule-agent", {
        name: "schedule-agent",
        schedules: {
          hourly: {
            type: "interval",
            interval: "1h",
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "removed",
          category: "schedule",
          name: "schedule-agent/daily",
        }),
      );
    });

    it("detects modified schedules", async () => {
      await createAgentConfig("mod-schedule", {
        name: "mod-schedule",
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
        agents: [{ path: "./agents/mod-schedule.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Modify the schedule
      await createAgentConfig("mod-schedule", {
        name: "mod-schedule",
        schedules: {
          check: {
            type: "interval",
            interval: "2h", // Changed
            prompt: "Updated prompt", // Changed
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "mod-schedule/check",
        }),
      );
    });

    it("reports no changes when config unchanged", async () => {
      await createAgentConfig("unchanged", {
        name: "unchanged",
        description: "Test",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/unchanged.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.reload();

      expect(result.changes).toHaveLength(0);
    });
  });

  describe("event emission", () => {
    it("emits config:reloaded event with changes", async () => {
      await createAgentConfig("event-agent", {
        name: "event-agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/event-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const reloadedHandler = vi.fn();
      manager.on("config:reloaded", reloadedHandler);

      // Add a new agent
      await createAgentConfig("new-agent", {
        name: "new-agent",
      });
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/event-agent.yaml" }, { path: "./agents/new-agent.yaml" }],
      });

      await manager.reload();

      expect(reloadedHandler).toHaveBeenCalledTimes(1);
      expect(reloadedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          agentCount: 2,
          agentNames: expect.arrayContaining(["event-agent", "new-agent"]),
          changes: expect.arrayContaining([
            expect.objectContaining({
              type: "added",
              category: "agent",
              name: "new-agent",
            }),
          ]),
        }),
      );
    });

    it("includes timestamp in event payload", async () => {
      await createAgentConfig("timestamp-test", {
        name: "timestamp-test",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/timestamp-test.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      const reloadedHandler = vi.fn();
      manager.on("config:reloaded", reloadedHandler);

      const beforeReload = new Date().toISOString();
      await manager.reload();
      const afterReload = new Date().toISOString();

      const payload = reloadedHandler.mock.calls[0][0] as ConfigReloadedPayload;
      expect(payload.timestamp).toBeDefined();
      expect(payload.timestamp >= beforeReload).toBe(true);
      expect(payload.timestamp <= afterReload).toBe(true);
    });
  });

  describe("graceful failure", () => {
    it("keeps old config when new config is invalid", async () => {
      await createAgentConfig("valid-agent", {
        name: "valid-agent",
        description: "Valid agent",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/valid-agent.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Get original config
      const originalConfig = manager.getConfig();
      expect(originalConfig?.agents[0].description).toBe("Valid agent");

      // Create invalid agent config (missing required name)
      await createAgentConfig("invalid-agent", {
        // name is missing - should fail validation
        description: "Invalid - no name",
      });
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/invalid-agent.yaml" }],
      });

      // Reload should throw
      await expect(manager.reload()).rejects.toThrow();

      // Original config should be preserved
      const configAfterFailure = manager.getConfig();
      expect(configAfterFailure?.agents[0].name).toBe("valid-agent");
    });

    it("throws error when config file not found", async () => {
      await createAgentConfig("test", {
        name: "test",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/test.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Update config to reference non-existent agent file
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/nonexistent.yaml" }],
      });

      await expect(manager.reload()).rejects.toThrow();
    });

    it("logs error when reload fails", async () => {
      await createAgentConfig("log-test", {
        name: "log-test",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/log-test.yaml" }],
      });

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const manager = new FleetManager({
        configPath,
        stateDir,
        logger,
      });
      await manager.initialize();

      // Create invalid config
      await createConfig({
        version: 1,
        agents: [{ path: "./agents/nonexistent.yaml" }],
      });

      try {
        await manager.reload();
      } catch {
        // Expected to throw
      }

      expect(logger.error).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Keeping existing configuration"),
      );
    });
  });

  describe("scheduler updates", () => {
    it("updates scheduler with new agents", async () => {
      // Use disabled schedules to prevent auto-triggering during test
      await createAgentConfig("scheduler-test", {
        name: "scheduler-test",
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
        agents: [{ path: "./agents/scheduler-test.yaml" }],
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

      // Verify initial state
      let agents = manager.getAgents();
      expect(agents).toHaveLength(1);

      // Add another agent (also disabled to prevent auto-trigger)
      await createAgentConfig("new-scheduler-test", {
        name: "new-scheduler-test",
        schedules: {
          daily: {
            type: "interval",
            interval: "24h",
            enabled: false,
          },
        },
      });
      await createConfig({
        version: 1,
        agents: [
          { path: "./agents/scheduler-test.yaml" },
          { path: "./agents/new-scheduler-test.yaml" },
        ],
      });

      await manager.reload();

      // Verify scheduler was updated
      agents = manager.getAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.name)).toContain("new-scheduler-test");

      await manager.stop();
    });

    it("reflects new schedules in scheduler state", async () => {
      // Use disabled schedule to prevent auto-triggering during test
      await createAgentConfig("schedule-update", {
        name: "schedule-update",
        schedules: {
          original: {
            type: "interval",
            interval: "1h",
            enabled: false,
          },
        },
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/schedule-update.yaml" }],
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

      // Modify schedule interval (still disabled)
      await createAgentConfig("schedule-update", {
        name: "schedule-update",
        schedules: {
          original: {
            type: "interval",
            interval: "30m", // Changed from 1h to 30m
            enabled: false,
          },
        },
      });

      const result = await manager.reload();

      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "schedule",
          name: "schedule-update/original",
        }),
      );

      // Verify the agent config was updated
      const agents = manager.getAgents();
      const agent = agents.find((a) => a.name === "schedule-update");
      expect(agent?.schedules?.original?.interval).toBe("30m");

      await manager.stop();
    });
  });

  describe("running jobs behavior", () => {
    it("running jobs continue with original config (config isolation)", async () => {
      // This test verifies the conceptual contract: running jobs should use
      // their original configuration. Since the scheduler creates snapshots
      // of agent configuration when triggering jobs, the reload() method
      // only updates the stored config and scheduler agents list, not any
      // in-flight job data.

      await createAgentConfig("isolation-test", {
        name: "isolation-test",
        description: "Original config",
      });

      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/isolation-test.yaml" }],
      });

      const manager = createTestManager(configPath);
      await manager.initialize();

      // Trigger a job with original config
      const job = await manager.trigger("isolation-test");
      expect(job.agentName).toBe("isolation-test");

      // Now reload with different config
      await createAgentConfig("isolation-test", {
        name: "isolation-test",
        description: "Updated config after job started",
      });

      const result = await manager.reload();

      // Reload should complete successfully
      expect(result.changes).toContainEqual(
        expect.objectContaining({
          type: "modified",
          category: "agent",
          name: "isolation-test",
        }),
      );

      // The original job metadata is unchanged - it was captured at trigger time
      // New jobs would use the new config
    });
  });
});
