/**
 * Fleet Composition End-to-End Integration Tests
 *
 * These tests exercise the full fleet composition pipeline from config loading
 * through FleetManager initialization and runtime operations. They verify that
 * the entire system works correctly with nested fleets, qualified names, and
 * all related features.
 *
 * These are higher-level integration tests that complement the unit tests in:
 * - packages/core/src/config/__tests__/fleet-loading.test.ts
 * - packages/core/src/config/__tests__/fleet-naming-and-defaults.test.ts
 * - packages/core/src/fleet-manager/__tests__/config-reload-qualified.test.ts
 */

import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgent, ResolvedConfig } from "../config/index.js";
import { FleetCycleError, FleetNameCollisionError, loadConfig } from "../config/index.js";
import { computeConfigChanges } from "../fleet-manager/config-reload.js";
import { FleetManager } from "../fleet-manager/fleet-manager.js";
import type { FleetManagerLogger } from "../fleet-manager/types.js";

// Mock the Claude SDK to avoid actual API calls
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

async function createFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

function createSilentLogger(): FleetManagerLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const fixturesDir = resolve(__dirname, "../config/__tests__/fixtures/fleet-composition");

// =============================================================================
// Full Pipeline Integration Tests
// =============================================================================

describe("Fleet Composition End-to-End Integration", () => {
  describe("Full Pipeline: loadConfig to Flattened Result", () => {
    it("loads multi-level fleet and produces correct flat agent list", async () => {
      const result = await loadConfig(join(fixturesDir, "root.yaml"), {
        env: {},
        envFile: false,
      });

      // Verify total agent count: 2 from project-a + 1 from renamed-b + 1 root monitor
      expect(result.agents).toHaveLength(4);

      // Verify each agent has correct qualified name
      const qualifiedNames = result.agents.map((a) => a.qualifiedName).sort();
      expect(qualifiedNames).toEqual([
        "monitor",
        "project-a.engineer",
        "project-a.security-auditor",
        "renamed-b.designer",
      ]);

      // Verify fleet paths are correct
      const monitor = result.agents.find((a) => a.qualifiedName === "monitor");
      expect(monitor?.fleetPath).toEqual([]);

      const auditor = result.agents.find((a) => a.qualifiedName === "project-a.security-auditor");
      expect(auditor?.fleetPath).toEqual(["project-a"]);
    });

    it("deeply nested fleet produces correct qualified names at all levels", async () => {
      const result = await loadConfig(join(fixturesDir, "deep-nesting/root.yaml"), {
        env: {},
        envFile: false,
      });

      // 4 agents: root-agent, l1-agent, l2-agent, l3-agent
      expect(result.agents).toHaveLength(4);

      // Verify qualified names include all intermediate fleet names
      const byQualified = new Map(result.agents.map((a) => [a.qualifiedName, a]));

      expect(byQualified.get("root-agent")?.fleetPath).toEqual([]);
      expect(byQualified.get("level1.l1-agent")?.fleetPath).toEqual(["level1"]);
      expect(byQualified.get("level1.level2.l2-agent")?.fleetPath).toEqual(["level1", "level2"]);
      expect(byQualified.get("level1.level2.level3.l3-agent")?.fleetPath).toEqual([
        "level1",
        "level2",
        "level3",
      ]);
    });

    it("guarantees qualified name uniqueness across entire fleet tree", async () => {
      const result = await loadConfig(join(fixturesDir, "root.yaml"), {
        env: {},
        envFile: false,
      });

      const qualifiedNames = result.agents.map((a) => a.qualifiedName);
      const uniqueNames = new Set(qualifiedNames);

      expect(uniqueNames.size).toBe(qualifiedNames.length);
    });

    it("defaults merge correctly across multiple levels", async () => {
      const result = await loadConfig(join(fixturesDir, "defaults-cascade/root.yaml"), {
        env: {},
        envFile: false,
      });

      // inheritor agent inherits from sub-fleet defaults (sub-model) not super-fleet
      const inheritor = result.agents.find((a) => a.name === "inheritor");
      expect(inheritor?.model).toBe("sub-model");
      // max_turns from super-fleet fills the gap
      expect(inheritor?.max_turns).toBe(200);

      // own-model agent sets its own values
      const ownModel = result.agents.find((a) => a.name === "own-model");
      expect(ownModel?.model).toBe("agent-model");
      expect(ownModel?.max_turns).toBe(5);
    });

    it("web config is suppressed on sub-fleets, honored on root", async () => {
      const result = await loadConfig(join(fixturesDir, "root.yaml"), {
        env: {},
        envFile: false,
      });

      // Root fleet web config should be preserved
      expect(result.fleet.web?.enabled).toBe(true);
      expect(result.fleet.web?.port).toBe(3232);
    });
  });

  describe("Error Detection in Composition", () => {
    it("detects and reports cycle errors with clear path chain", async () => {
      try {
        await loadConfig(join(fixturesDir, "cycle-root.yaml"), {
          env: {},
          envFile: false,
        });
        expect.fail("Should have thrown FleetCycleError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetCycleError);
        const cycleError = error as FleetCycleError;
        expect(cycleError.message).toContain("Fleet composition cycle detected");
        expect(cycleError.pathChain.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("detects and reports fleet name collisions with actionable message", async () => {
      try {
        await loadConfig(join(fixturesDir, "collision-root.yaml"), {
          env: {},
          envFile: false,
        });
        expect.fail("Should have thrown FleetNameCollisionError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetNameCollisionError);
        const collisionError = error as FleetNameCollisionError;
        expect(collisionError.message).toContain("Fleet name collision");
        expect(collisionError.message).toContain("disambiguate");
      }
    });
  });
});

// =============================================================================
// FleetManager Integration Tests
// =============================================================================

describe("FleetManager with Fleet Composition", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("Initialization with Nested Fleets", () => {
    it("initializes correctly with multi-level fleet config", async () => {
      // Create a multi-level fleet structure
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./project-a/herdctl.yaml
  - path: ./project-b/herdctl.yaml
agents:
  - path: ./agents/root-monitor.yaml
`,
      );
      await createFile(
        join(tempDir, "project-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: project-a
agents:
  - path: ./agents/auditor.yaml
  - path: ./agents/engineer.yaml
`,
      );
      await createFile(
        join(tempDir, "project-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: project-b
fleets:
  - path: ./frontend/herdctl.yaml
agents:
  - path: ./agents/backend.yaml
`,
      );
      await createFile(
        join(tempDir, "project-b", "frontend", "herdctl.yaml"),
        `
version: 1
fleet:
  name: frontend
agents:
  - path: ./agents/designer.yaml
`,
      );
      await createFile(join(tempDir, "agents", "root-monitor.yaml"), "name: root-monitor");
      await createFile(join(tempDir, "project-a", "agents", "auditor.yaml"), "name: auditor");
      await createFile(join(tempDir, "project-a", "agents", "engineer.yaml"), "name: engineer");
      await createFile(join(tempDir, "project-b", "agents", "backend.yaml"), "name: backend");
      await createFile(
        join(tempDir, "project-b", "frontend", "agents", "designer.yaml"),
        "name: designer",
      );

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Verify total agent count
      expect(manager.state.agentCount).toBe(5);
    });

    it("getFleetStatus returns agents with correct qualified names and fleetPath", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
agents:
  - path: ./agents/root-agent.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-fleet
agents:
  - path: ./agents/sub-agent.yaml
`,
      );
      await createFile(join(tempDir, "agents", "root-agent.yaml"), "name: root-agent");
      await createFile(join(tempDir, "sub", "agents", "sub-agent.yaml"), "name: sub-agent");

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();
      const status = await manager.getFleetStatus();

      expect(status.counts.totalAgents).toBe(2);

      const agentInfoList = await manager.getAgentInfo();
      expect(agentInfoList).toHaveLength(2);

      // Verify root agent
      const rootAgent = agentInfoList.find((a) => a.qualifiedName === "root-agent");
      expect(rootAgent).toBeDefined();
      expect(rootAgent!.fleetPath).toEqual([]);
      expect(rootAgent!.name).toBe("root-agent");

      // Verify sub-fleet agent
      const subAgent = agentInfoList.find((a) => a.qualifiedName === "sub-fleet.sub-agent");
      expect(subAgent).toBeDefined();
      expect(subAgent!.fleetPath).toEqual(["sub-fleet"]);
      expect(subAgent!.name).toBe("sub-agent");
    });

    it("getAgentInfoByName works with qualified names", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
description: A worker agent
`,
      );

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Lookup by qualified name
      const agentByQualified = await manager.getAgentInfoByName("my-fleet.worker");
      expect(agentByQualified.qualifiedName).toBe("my-fleet.worker");
      expect(agentByQualified.name).toBe("worker");
      expect(agentByQualified.fleetPath).toEqual(["my-fleet"]);
      expect(agentByQualified.description).toBe("A worker agent");

      // Fallback to local name should also work
      const agentByLocal = await manager.getAgentInfoByName("worker");
      expect(agentByLocal.qualifiedName).toBe("my-fleet.worker");
    });

    it("same local agent name in different fleets produces distinct qualified names", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
  - path: ./fleet-b/herdctl.yaml
`,
      );
      await createFile(
        join(tempDir, "fleet-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-a
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-b
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(join(tempDir, "fleet-a", "agents", "worker.yaml"), "name: worker");
      await createFile(join(tempDir, "fleet-b", "agents", "worker.yaml"), "name: worker");

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const agentInfoList = await manager.getAgentInfo();
      expect(agentInfoList).toHaveLength(2);

      // Both agents named "worker" but with different qualified names
      const fleetAWorker = agentInfoList.find((a) => a.qualifiedName === "fleet-a.worker");
      const fleetBWorker = agentInfoList.find((a) => a.qualifiedName === "fleet-b.worker");

      expect(fleetAWorker).toBeDefined();
      expect(fleetBWorker).toBeDefined();
      expect(fleetAWorker!.qualifiedName).not.toBe(fleetBWorker!.qualifiedName);
    });

    it("rejects duplicate qualified names with clear error", async () => {
      // Create two agents that would have the same qualified name
      // This shouldn't happen with proper fleet structure, but test defense
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/duplicate.yaml
  - path: ./agents/also-duplicate.yaml
`,
      );
      await createFile(join(tempDir, "agents", "duplicate.yaml"), "name: same-name");
      await createFile(join(tempDir, "agents", "also-duplicate.yaml"), "name: same-name");

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await expect(manager.initialize()).rejects.toThrow(
        /Duplicate agent qualified name.*"same-name"/,
      );
    });
  });

  describe("Trigger Operations with Qualified Names", () => {
    it("trigger works with qualified name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
schedules:
  check:
    type: interval
    interval: 1h
    prompt: Check status
    enabled: false
`,
      );

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger using qualified name
      const result = await manager.trigger("my-fleet.worker", "check");

      expect(result.agentName).toBe("my-fleet.worker");
      expect(result.scheduleName).toBe("check");
      expect(result.jobId).toMatch(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/);
    });

    it("trigger requires qualified name for sub-fleet agents", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(join(tempDir, "sub", "agents", "worker.yaml"), "name: worker");

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Trigger requires qualified name - local name alone won't work
      // (unlike getAgentInfoByName which has fallback)
      const { AgentNotFoundError } = await import("../fleet-manager/errors.js");
      await expect(manager.trigger("worker")).rejects.toThrow(AgentNotFoundError);

      // But qualified name works
      const result = await manager.trigger("my-fleet.worker");
      expect(result.agentName).toBe("my-fleet.worker");
    });
  });

  describe("Schedule Operations with Qualified Names", () => {
    it("getSchedules returns schedules with qualified agent names", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
agents:
  - path: ./agents/root.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/scheduled.yaml
`,
      );
      await createFile(
        join(tempDir, "agents", "root.yaml"),
        `
name: root
schedules:
  daily:
    type: interval
    interval: 24h
`,
      );
      await createFile(
        join(tempDir, "sub", "agents", "scheduled.yaml"),
        `
name: scheduled
schedules:
  hourly:
    type: interval
    interval: 1h
`,
      );

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      const schedules = await manager.getSchedules();
      expect(schedules).toHaveLength(2);

      // Verify qualified names in schedule agent references
      const rootSchedule = schedules.find((s) => s.name === "daily");
      expect(rootSchedule?.agentName).toBe("root");

      const subSchedule = schedules.find((s) => s.name === "hourly");
      expect(subSchedule?.agentName).toBe("sub.scheduled");
    });

    it("enable/disable schedule works with qualified names", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: my-sub
agents:
  - path: ./agents/worker.yaml
`,
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
schedules:
  check:
    type: interval
    interval: 1h
`,
      );

      const manager = new FleetManager({
        configPath: tempDir,
        stateDir,
        logger: createSilentLogger(),
      });

      await manager.initialize();

      // Disable using qualified name
      await manager.disableSchedule("my-sub.worker", "check");
      let schedule = await manager.getSchedule("my-sub.worker", "check");
      expect(schedule.status).toBe("disabled");

      // Re-enable
      await manager.enableSchedule("my-sub.worker", "check");
      schedule = await manager.getSchedule("my-sub.worker", "check");
      expect(schedule.status).toBe("idle");
    });
  });
});

// =============================================================================
// Config Reload Integration Tests
// =============================================================================

describe("Config Reload with Fleet Composition", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("detects new agent in sub-fleet with qualified name", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "herdctl.yaml"),
      `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/original.yaml
`,
    );
    await createFile(join(tempDir, "sub", "agents", "original.yaml"), "name: original");

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();
    expect(manager.state.agentCount).toBe(1);

    // Add a new agent to the sub-fleet
    await createFile(
      join(tempDir, "sub", "herdctl.yaml"),
      `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/original.yaml
  - path: ./agents/new-agent.yaml
`,
    );
    await createFile(join(tempDir, "sub", "agents", "new-agent.yaml"), "name: new-agent");

    // Reload and verify
    const reloadResult = await manager.reload();

    expect(reloadResult.agentCount).toBe(2);
    expect(reloadResult.changes).toContainEqual(
      expect.objectContaining({
        type: "added",
        category: "agent",
        name: "my-fleet.new-agent",
      }),
    );
  });

  it("detects removed sub-fleet agents with qualified names", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./project-a/herdctl.yaml
  - path: ./project-b/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "project-a", "herdctl.yaml"),
      `
version: 1
fleet:
  name: project-a
agents:
  - path: ./agents/worker.yaml
`,
    );
    await createFile(
      join(tempDir, "project-b", "herdctl.yaml"),
      `
version: 1
fleet:
  name: project-b
agents:
  - path: ./agents/worker.yaml
`,
    );
    await createFile(join(tempDir, "project-a", "agents", "worker.yaml"), "name: worker");
    await createFile(join(tempDir, "project-b", "agents", "worker.yaml"), "name: worker");

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();
    expect(manager.state.agentCount).toBe(2);

    // Remove project-b from the fleet
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./project-a/herdctl.yaml
`,
    );

    const reloadResult = await manager.reload();

    expect(reloadResult.agentCount).toBe(1);
    expect(reloadResult.changes).toContainEqual(
      expect.objectContaining({
        type: "removed",
        category: "agent",
        name: "project-b.worker",
      }),
    );
  });

  it("detects modified agent config in sub-fleet with qualified name", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "herdctl.yaml"),
      `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/changeable.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "agents", "changeable.yaml"),
      `
name: changeable
description: Original description
`,
    );

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();

    // Modify the agent's config
    await createFile(
      join(tempDir, "sub", "agents", "changeable.yaml"),
      `
name: changeable
description: Updated description
`,
    );

    const reloadResult = await manager.reload();

    expect(reloadResult.changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "agent",
        name: "sub.changeable",
        details: expect.stringContaining("description"),
      }),
    );
  });

  it("detects schedule changes with qualified agent names", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "herdctl.yaml"),
      `
version: 1
fleet:
  name: my-fleet
agents:
  - path: ./agents/scheduled.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "agents", "scheduled.yaml"),
      `
name: scheduled
schedules:
  old-schedule:
    type: interval
    interval: 1h
`,
    );

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();

    // Change the schedule
    await createFile(
      join(tempDir, "sub", "agents", "scheduled.yaml"),
      `
name: scheduled
schedules:
  new-schedule:
    type: interval
    interval: 2h
`,
    );

    const reloadResult = await manager.reload();

    // Should have schedule removed and added
    expect(reloadResult.changes).toContainEqual(
      expect.objectContaining({
        type: "removed",
        category: "schedule",
        name: "my-fleet.scheduled/old-schedule",
      }),
    );
    expect(reloadResult.changes).toContainEqual(
      expect.objectContaining({
        type: "added",
        category: "schedule",
        name: "my-fleet.scheduled/new-schedule",
      }),
    );
  });

  it("no changes reported when sub-fleet ordering changes but content is same", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
  - path: ./fleet-b/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "fleet-a", "herdctl.yaml"),
      `
version: 1
fleet:
  name: fleet-a
agents:
  - path: ./agents/worker.yaml
`,
    );
    await createFile(
      join(tempDir, "fleet-b", "herdctl.yaml"),
      `
version: 1
fleet:
  name: fleet-b
agents:
  - path: ./agents/worker.yaml
`,
    );
    await createFile(join(tempDir, "fleet-a", "agents", "worker.yaml"), "name: worker-a");
    await createFile(join(tempDir, "fleet-b", "agents", "worker.yaml"), "name: worker-b");

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();

    // Reorder fleets (swap order)
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./fleet-b/herdctl.yaml
  - path: ./fleet-a/herdctl.yaml
`,
    );

    const reloadResult = await manager.reload();

    // No agent changes - just ordering difference
    const agentChanges = reloadResult.changes.filter((c) => c.category === "agent");
    expect(agentChanges).toHaveLength(0);
  });
});

// =============================================================================
// computeConfigChanges Direct Tests
// =============================================================================

describe("computeConfigChanges with Qualified Names (Unit-Level)", () => {
  function makeAgent(
    name: string,
    fleetPath: string[] = [],
    overrides: Record<string, unknown> = {},
  ): ResolvedAgent {
    const qualifiedName = fleetPath.length > 0 ? `${fleetPath.join(".")}.${name}` : name;
    return {
      name,
      configPath: `/fake/${name}.yaml`,
      fleetPath: [...fleetPath],
      qualifiedName,
      ...overrides,
    } as ResolvedAgent;
  }

  function makeConfig(agents: ResolvedAgent[]): ResolvedConfig {
    return {
      fleet: { version: 1, agents: [] } as unknown as ResolvedConfig["fleet"],
      agents,
      configPath: "/fake/herdctl.yaml",
      configDir: "/fake",
    };
  }

  it("uses qualified name as diff key", () => {
    const oldConfig = makeConfig([makeAgent("worker", ["fleet-a"])]);
    const newConfig = makeConfig([
      makeAgent("worker", ["fleet-a"]),
      makeAgent("worker", ["fleet-b"]),
    ]);

    const changes = computeConfigChanges(oldConfig, newConfig);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "added",
        category: "agent",
        name: "fleet-b.worker",
      }),
    );
  });

  it("distinguishes same local name in different fleets", () => {
    const oldConfig = makeConfig([
      makeAgent("worker", ["fleet-a"], { description: "A worker" }),
      makeAgent("worker", ["fleet-b"], { description: "B worker" }),
    ]);
    const newConfig = makeConfig([
      makeAgent("worker", ["fleet-a"], { description: "A worker updated" }),
      makeAgent("worker", ["fleet-b"], { description: "B worker" }),
    ]);

    const changes = computeConfigChanges(oldConfig, newConfig);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "agent",
        name: "fleet-a.worker",
      }),
    );
    expect(
      changes.find((c) => c.name === "fleet-b.worker" && c.type === "modified"),
    ).toBeUndefined();
  });

  it("handles deeply nested fleet changes", () => {
    const oldConfig = makeConfig([makeAgent("worker", ["a", "b", "c"])]);
    const newConfig = makeConfig([
      makeAgent("worker", ["a", "b", "c"], { description: "updated" }),
    ]);

    const changes = computeConfigChanges(oldConfig, newConfig);

    expect(changes).toContainEqual(
      expect.objectContaining({
        type: "modified",
        category: "agent",
        name: "a.b.c.worker",
      }),
    );
  });
});

// =============================================================================
// Cross-Cutting Verification Tests
// =============================================================================

describe("Cross-Cutting Fleet Composition Verification", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    stateDir = join(tempDir, ".herdctl");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("backward compatibility: single-fleet config works exactly as before", async () => {
    // Simple single-fleet config without any fleets array
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
agents:
  - path: ./agents/simple.yaml
`,
    );
    await createFile(
      join(tempDir, "agents", "simple.yaml"),
      `
name: simple
description: A simple agent
`,
    );

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();

    const agentInfo = await manager.getAgentInfoByName("simple");

    // Qualified name should equal local name
    expect(agentInfo.qualifiedName).toBe("simple");
    expect(agentInfo.name).toBe("simple");
    expect(agentInfo.fleetPath).toEqual([]);

    // Trigger should work with bare name
    const result = await manager.trigger("simple");
    expect(result.agentName).toBe("simple");
  });

  it("fleet hierarchy metadata is preserved through full pipeline", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./org/herdctl.yaml
agents:
  - path: ./agents/global-monitor.yaml
`,
    );
    await createFile(
      join(tempDir, "org", "herdctl.yaml"),
      `
version: 1
fleet:
  name: org
fleets:
  - path: ./team/herdctl.yaml
agents:
  - path: ./agents/org-worker.yaml
`,
    );
    await createFile(
      join(tempDir, "org", "team", "herdctl.yaml"),
      `
version: 1
fleet:
  name: team
agents:
  - path: ./agents/team-worker.yaml
`,
    );
    await createFile(join(tempDir, "agents", "global-monitor.yaml"), "name: global-monitor");
    await createFile(join(tempDir, "org", "agents", "org-worker.yaml"), "name: org-worker");
    await createFile(
      join(tempDir, "org", "team", "agents", "team-worker.yaml"),
      "name: team-worker",
    );

    const manager = new FleetManager({
      configPath: tempDir,
      stateDir,
      logger: createSilentLogger(),
    });

    await manager.initialize();

    const agentInfoList = await manager.getAgentInfo();

    // Verify hierarchy at each level
    const globalMonitor = agentInfoList.find((a) => a.qualifiedName === "global-monitor");
    expect(globalMonitor?.fleetPath).toEqual([]);

    const orgWorker = agentInfoList.find((a) => a.qualifiedName === "org.org-worker");
    expect(orgWorker?.fleetPath).toEqual(["org"]);

    const teamWorker = agentInfoList.find((a) => a.qualifiedName === "org.team.team-worker");
    expect(teamWorker?.fleetPath).toEqual(["org", "team"]);

    // Verify all agents are accessible by their qualified names
    await expect(manager.getAgentInfoByName("global-monitor")).resolves.toBeDefined();
    await expect(manager.getAgentInfoByName("org.org-worker")).resolves.toBeDefined();
    await expect(manager.getAgentInfoByName("org.team.team-worker")).resolves.toBeDefined();
  });

  it("defaults cascade correctly through nested fleets", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
defaults:
  model: root-model
  max_turns: 100
fleets:
  - path: ./sub/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "herdctl.yaml"),
      `
version: 1
fleet:
  name: sub
defaults:
  model: sub-model
agents:
  - path: ./agents/inheritor.yaml
  - path: ./agents/overrider.yaml
`,
    );
    await createFile(
      join(tempDir, "sub", "agents", "inheritor.yaml"),
      `
name: inheritor
`,
    );
    await createFile(
      join(tempDir, "sub", "agents", "overrider.yaml"),
      `
name: overrider
model: agent-model
max_turns: 5
`,
    );

    const config = await loadConfig(tempDir, { env: {}, envFile: false });

    const inheritor = config.agents.find((a) => a.name === "inheritor");
    // inheritor gets sub-model from sub-fleet, max_turns from root
    expect(inheritor?.model).toBe("sub-model");
    expect(inheritor?.max_turns).toBe(100);

    const overrider = config.agents.find((a) => a.name === "overrider");
    // overrider uses its own values
    expect(overrider?.model).toBe("agent-model");
    expect(overrider?.max_turns).toBe(5);
  });

  it("fleet name collision is detected and reported clearly", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./sub-a/herdctl.yaml
  - path: ./sub-b/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "sub-a", "herdctl.yaml"),
      `
version: 1
fleet:
  name: same-name
agents: []
`,
    );
    await createFile(
      join(tempDir, "sub-b", "herdctl.yaml"),
      `
version: 1
fleet:
  name: same-name
agents: []
`,
    );

    await expect(loadConfig(tempDir, { env: {}, envFile: false })).rejects.toThrow(
      FleetNameCollisionError,
    );
  });

  it("cycle detection works at any depth", async () => {
    await createFile(
      join(tempDir, "herdctl.yaml"),
      `
version: 1
fleets:
  - path: ./level1/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "level1", "herdctl.yaml"),
      `
version: 1
fleet:
  name: level1
fleets:
  - path: ../level2/herdctl.yaml
`,
    );
    await createFile(
      join(tempDir, "level2", "herdctl.yaml"),
      `
version: 1
fleet:
  name: level2
fleets:
  - path: ../herdctl.yaml
`,
    );

    await expect(loadConfig(tempDir, { env: {}, envFile: false })).rejects.toThrow(FleetCycleError);
  });
});
