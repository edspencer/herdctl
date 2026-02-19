import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  FleetCycleError,
  FleetNameCollisionError,
  FleetLoadError,
} from "../loader.js";

// =============================================================================
// Test helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

async function createFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

// =============================================================================
// Fixture-based tests (using static fixture YAML files)
// =============================================================================

const fixturesDir = resolve(
  __dirname,
  "fixtures",
  "fleet-composition"
);

describe("fleet composition (fixture-based)", () => {
  it("loads root fleet with two sub-fleets and a root-level agent", async () => {
    const result = await loadConfig(join(fixturesDir, "root.yaml"), {
      env: {},
      envFile: false,
    });

    // Should have 4 agents total: 2 from project-a, 1 from project-b, 1 root monitor
    expect(result.agents).toHaveLength(4);

    // Root-level agent
    const monitor = result.agents.find((a) => a.name === "monitor");
    expect(monitor).toBeDefined();
    expect(monitor!.fleetPath).toEqual([]);
    expect(monitor!.qualifiedName).toBe("monitor");

    // Project A agents
    const secAuditor = result.agents.find(
      (a) => a.name === "security-auditor"
    );
    expect(secAuditor).toBeDefined();
    expect(secAuditor!.fleetPath).toEqual(["project-a"]);
    expect(secAuditor!.qualifiedName).toBe("project-a.security-auditor");

    const engineer = result.agents.find((a) => a.name === "engineer");
    expect(engineer).toBeDefined();
    expect(engineer!.fleetPath).toEqual(["project-a"]);
    expect(engineer!.qualifiedName).toBe("project-a.engineer");

    // Project B agent (renamed via parent override)
    const designer = result.agents.find((a) => a.name === "designer");
    expect(designer).toBeDefined();
    expect(designer!.fleetPath).toEqual(["renamed-b"]);
    expect(designer!.qualifiedName).toBe("renamed-b.designer");
  });

  it("preserves root fleet web config", async () => {
    const result = await loadConfig(join(fixturesDir, "root.yaml"), {
      env: {},
      envFile: false,
    });

    expect(result.fleet.web?.enabled).toBe(true);
    expect(result.fleet.web?.port).toBe(3232);
  });

  it("detects fleet composition cycles", async () => {
    await expect(
      loadConfig(join(fixturesDir, "cycle-root.yaml"), {
        env: {},
        envFile: false,
      })
    ).rejects.toThrow(FleetCycleError);
  });

  it("detects fleet name collisions", async () => {
    await expect(
      loadConfig(join(fixturesDir, "collision-root.yaml"), {
        env: {},
        envFile: false,
      })
    ).rejects.toThrow(FleetNameCollisionError);
  });
});

// =============================================================================
// Dynamic tests (using temp directories)
// =============================================================================

describe("fleet composition (dynamic)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("basic composition", () => {
    it("flattens agents from sub-fleets with correct count", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub-a/herdctl.yaml
  - path: ./sub-b/herdctl.yaml
agents:
  - path: ./agents/root-agent.yaml
`
      );
      await createFile(
        join(tempDir, "sub-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-a
agents:
  - path: ./agents/a1.yaml
  - path: ./agents/a2.yaml
`
      );
      await createFile(
        join(tempDir, "sub-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-b
agents:
  - path: ./agents/b1.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "root-agent.yaml"),
        "name: root-agent"
      );
      await createFile(
        join(tempDir, "sub-a", "agents", "a1.yaml"),
        "name: agent-a1"
      );
      await createFile(
        join(tempDir, "sub-a", "agents", "a2.yaml"),
        "name: agent-a2"
      );
      await createFile(
        join(tempDir, "sub-b", "agents", "b1.yaml"),
        "name: agent-b1"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(4);
    });

    it("sets correct fleetPath for sub-fleet agents", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: my-sub
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["my-sub"]);
      expect(result.agents[0].qualifiedName).toBe("my-sub.worker");
    });
  });

  describe("root-level agents", () => {
    it("root agents have empty fleetPath and qualifiedName equals name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/direct.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "direct.yaml"),
        "name: direct-agent"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].fleetPath).toEqual([]);
      expect(result.agents[0].qualifiedName).toBe("direct-agent");
    });
  });

  describe("fleet naming", () => {
    it("uses parent override name when provided", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: override-name
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: original-name
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["override-name"]);
      expect(result.agents[0].qualifiedName).toBe("override-name.worker");
    });

    it("uses sub-fleet fleet.name when no parent override", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-own-name
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["fleet-own-name"]);
      expect(result.agents[0].qualifiedName).toBe("fleet-own-name.worker");
    });

    it("uses directory name when neither parent nor sub-fleet provides name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./my-project-dir/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "my-project-dir", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "my-project-dir", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["my-project-dir"]);
      expect(result.agents[0].qualifiedName).toBe("my-project-dir.worker");
    });
  });

  describe("web suppression", () => {
    it("suppresses sub-fleet web config by default", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
web:
  enabled: true
  port: 3232
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-fleet
web:
  enabled: true
  port: 4000
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Root web should be preserved
      expect(result.fleet.web?.enabled).toBe(true);
      expect(result.fleet.web?.port).toBe(3232);
    });

    it("does not suppress sub-fleet web when parent explicitly overrides web", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      web:
        enabled: true
        port: 5000
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-fleet
web:
  enabled: true
  port: 4000
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      // Should not throw, and the web override should be applied
      const result = await loadConfig(tempDir, { env: {}, envFile: false });
      expect(result.agents).toHaveLength(1);
    });
  });

  describe("cycle detection", () => {
    it("detects direct cycle (A -> B -> A) and throws FleetCycleError", async () => {
      await createFile(
        join(tempDir, "root.yaml"),
        `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-a
fleets:
  - path: ../fleet-b/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-b
fleets:
  - path: ../fleet-a/herdctl.yaml
`
      );

      await expect(
        loadConfig(join(tempDir, "root.yaml"), { env: {}, envFile: false })
      ).rejects.toThrow(FleetCycleError);
    });

    it("cycle error message shows the full path chain", async () => {
      await createFile(
        join(tempDir, "root.yaml"),
        `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-a
fleets:
  - path: ../fleet-b/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-b
fleets:
  - path: ../fleet-a/herdctl.yaml
`
      );

      try {
        await loadConfig(join(tempDir, "root.yaml"), {
          env: {},
          envFile: false,
        });
        expect.fail("Should have thrown FleetCycleError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetCycleError);
        const cycleError = error as FleetCycleError;
        expect(cycleError.message).toContain("Fleet composition cycle detected");
        // Path chain should include the cycle
        expect(cycleError.pathChain.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("fleet name collision", () => {
    it("throws FleetNameCollisionError for same-name sub-fleets at same level", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
  - path: ./fleet-b/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: duplicate-name
agents: []
`
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: duplicate-name
agents: []
`
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(FleetNameCollisionError);
    });

    it("collision error message is actionable", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./a/herdctl.yaml
  - path: ./b/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "a", "herdctl.yaml"),
        `
version: 1
fleet:
  name: conflict
agents: []
`
      );
      await createFile(
        join(tempDir, "b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: conflict
agents: []
`
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown FleetNameCollisionError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetNameCollisionError);
        const collisionError = error as FleetNameCollisionError;
        expect(collisionError.message).toContain("conflict");
        expect(collisionError.message).toContain("disambiguate");
      }
    });
  });

  describe("backward compatibility", () => {
    it("config with no fleets array works exactly as before", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("worker");
      expect(result.agents[0].fleetPath).toEqual([]);
      expect(result.agents[0].qualifiedName).toBe("worker");
    });

    it("config with empty fleets array works exactly as before", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets: []
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("worker");
      expect(result.agents[0].fleetPath).toEqual([]);
      expect(result.agents[0].qualifiedName).toBe("worker");
    });

    it("config with no agents and no fleets works", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toEqual([]);
    });
  });

  describe("defaults merging across levels", () => {
    it("super-fleet defaults fill gaps for sub-fleet agents", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Worker should inherit model and max_turns from super-fleet defaults
      expect(result.agents[0].model).toBe("claude-sonnet-4-20250514");
      expect(result.agents[0].max_turns).toBe(100);
    });

    it("sub-fleet defaults override super-fleet defaults", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: claude-opus-4-20250514
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Worker gets sub-fleet's model (overrides super-fleet)
      expect(result.agents[0].model).toBe("claude-opus-4-20250514");
      // Worker gets super-fleet's max_turns (gap-fill)
      expect(result.agents[0].max_turns).toBe(100);
    });

    it("agent config overrides both fleet defaults", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: claude-sonnet-4-20250514
  max_turns: 100
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: claude-opus-4-20250514
  max_turns: 50
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
model: haiku
max_turns: 10
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Worker's own config takes precedence
      expect(result.agents[0].model).toBe("haiku");
      expect(result.agents[0].max_turns).toBe(10);
    });
  });

  describe("working directory normalization", () => {
    it("resolves agent working_directory relative to its own config file", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
working_directory: ../workspace
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // ../workspace relative to sub/agents/ = sub/workspace
      expect(result.agents[0].working_directory).toBe(
        join(tempDir, "sub", "workspace")
      );
    });

    it("defaults working_directory to agent config directory", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].working_directory).toBe(
        join(tempDir, "sub", "agents")
      );
    });
  });

  describe("fleet-level overrides", () => {
    it("fleet-level overrides apply to sub-fleet config", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      defaults:
        model: override-model
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: original-model
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Override model should be applied (fleet-level override applies to sub-fleet config)
      expect(result.agents[0].model).toBe("override-model");
    });
  });

  describe("deeply nested fleets", () => {
    it("handles three levels of nesting", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./level1/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "level1", "herdctl.yaml"),
        `
version: 1
fleet:
  name: level1
fleets:
  - path: ./level2/herdctl.yaml
agents:
  - path: ./agents/l1-agent.yaml
`
      );
      await createFile(
        join(tempDir, "level1", "level2", "herdctl.yaml"),
        `
version: 1
fleet:
  name: level2
agents:
  - path: ./agents/l2-agent.yaml
`
      );
      await createFile(
        join(tempDir, "level1", "agents", "l1-agent.yaml"),
        "name: l1-agent"
      );
      await createFile(
        join(tempDir, "level1", "level2", "agents", "l2-agent.yaml"),
        "name: l2-agent"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(2);

      const l1Agent = result.agents.find((a) => a.name === "l1-agent");
      expect(l1Agent).toBeDefined();
      expect(l1Agent!.fleetPath).toEqual(["level1"]);
      expect(l1Agent!.qualifiedName).toBe("level1.l1-agent");

      const l2Agent = result.agents.find((a) => a.name === "l2-agent");
      expect(l2Agent).toBeDefined();
      expect(l2Agent!.fleetPath).toEqual(["level1", "level2"]);
      expect(l2Agent!.qualifiedName).toBe("level1.level2.l2-agent");
    });
  });

  describe("error handling", () => {
    it("throws FleetLoadError when sub-fleet file is missing", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./nonexistent/herdctl.yaml
`
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(FleetLoadError);
    });

    it("throws FleetLoadError when sub-fleet YAML is invalid", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        "invalid: yaml: syntax:"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(FleetLoadError);
    });
  });

  describe("environment interpolation", () => {
    it("interpolates env vars in sub-fleet agent configs", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
model: \${AGENT_MODEL}
`
      );

      const result = await loadConfig(tempDir, {
        env: { AGENT_MODEL: "claude-sonnet-4-20250514" },
        envFile: false,
      });

      expect(result.agents[0].model).toBe("claude-sonnet-4-20250514");
    });
  });
});
