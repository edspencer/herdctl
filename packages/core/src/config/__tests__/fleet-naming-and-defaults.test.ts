import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  FleetNameCollisionError,
  FleetLoadError,
} from "../loader.js";
import { ConfigError } from "../parser.js";

// =============================================================================
// Test helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-fleet-naming-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

async function createFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

const fixturesDir = resolve(
  __dirname,
  "fixtures",
  "fleet-composition"
);

// =============================================================================
// Fleet Name Resolution Tests
// =============================================================================

describe("fleet name resolution", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("priority order", () => {
    it("parent explicit name overrides sub-fleet fleet.name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: parent-chosen
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub-fleet-own-name
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["parent-chosen"]);
      expect(result.agents[0].qualifiedName).toBe("parent-chosen.worker");
    });

    it("sub-fleet fleet.name used when no parent override", async () => {
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
  name: self-declared
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["self-declared"]);
      expect(result.agents[0].qualifiedName).toBe("self-declared.worker");
    });

    it("directory name used when neither parent nor sub-fleet provides name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./my-cool-project/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "my-cool-project", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "my-cool-project", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].fleetPath).toEqual(["my-cool-project"]);
      expect(result.agents[0].qualifiedName).toBe("my-cool-project.worker");
    });

    it("parent override takes priority when both parent name and fleet.name are present", async () => {
      // Both parent name and sub-fleet fleet.name exist; parent wins
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./subdir/herdctl.yaml
    name: parent-override
`
      );
      await createFile(
        join(tempDir, "subdir", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-self-name
agents:
  - path: ./agents/a.yaml
  - path: ./agents/b.yaml
`
      );
      await createFile(
        join(tempDir, "subdir", "agents", "a.yaml"),
        "name: agent-a"
      );
      await createFile(
        join(tempDir, "subdir", "agents", "b.yaml"),
        "name: agent-b"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Both agents should use parent-override in their fleetPath
      for (const agent of result.agents) {
        expect(agent.fleetPath).toEqual(["parent-override"]);
        expect(agent.qualifiedName).toMatch(/^parent-override\./);
      }
      expect(result.agents.find((a) => a.name === "agent-a")!.qualifiedName).toBe(
        "parent-override.agent-a"
      );
      expect(result.agents.find((a) => a.name === "agent-b")!.qualifiedName).toBe(
        "parent-override.agent-b"
      );
    });

    it("directory name fallback uses containing directory, not config file name", async () => {
      // The config is at deeply/nested/path/herdctl.yaml => directory is "path"
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./deeply/nested/path/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "deeply", "nested", "path", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "deeply", "nested", "path", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Directory name is "path" (the immediate parent of herdctl.yaml)
      expect(result.agents[0].fleetPath).toEqual(["path"]);
      expect(result.agents[0].qualifiedName).toBe("path.worker");
    });
  });

  describe("valid fleet names", () => {
    it("accepts fleet name with hyphens", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: my-cool-project
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("my-cool-project.worker");
    });

    it("accepts fleet name with underscores", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: my_cool_project
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("my_cool_project.worker");
    });

    it("accepts fleet name with mixed hyphens and underscores", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: my-cool_project
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("my-cool_project.worker");
    });

    it("accepts fleet name starting with a number", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: 42project
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("42project.worker");
    });

    it("accepts single-character fleet name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: x
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("x.worker");
    });

    it("accepts fleet name from fleet.name with hyphens", async () => {
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
  name: hyphen-name
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("hyphen-name.worker");
    });

    it("accepts fleet name from directory with underscores", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./my_project_dir/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "my_project_dir", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "my_project_dir", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("my_project_dir.worker");
    });
  });

  describe("invalid fleet names", () => {
    it("rejects fleet name with dots via fleet.name", async () => {
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
  name: my.project
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(/invalid/i);
    });

    it("rejects fleet name starting with a hyphen via fleet.name", async () => {
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
  name: -starts-with-hyphen
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(/invalid/i);
    });

    it("rejects fleet name starting with underscore via fleet.name", async () => {
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
  name: _underscore_start
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(/invalid/i);
    });

    it("rejects fleet name with dots when derived from directory name", async () => {
      // Create a directory with a dot in its name
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./my.project/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "my.project", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "my.project", "agents", "worker.yaml"),
        "name: worker"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(/invalid/i);
    });

    it("rejects fleet name with dots via parent name override (schema validation)", async () => {
      // Parent name override with dots should fail at schema level
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: "my.bad.name"
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      // Should fail during config parsing (Zod regex on FleetReferenceSchema.name)
      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow();
    });

    it("provides clear error message for invalid fleet names", async () => {
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
  name: has.dots.in.name
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        const msg = (error as Error).message;
        expect(msg).toContain("has.dots.in.name");
        expect(msg.toLowerCase()).toContain("invalid");
      }
    });

    it("rejects fleet name with spaces via fleet.name", async () => {
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
  name: "has spaces"
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(/invalid/i);
    });
  });

  describe("qualified name construction", () => {
    it("root-level agents have qualifiedName equal to their local name", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/monitor.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "monitor.yaml"),
        "name: monitor"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("monitor");
      expect(result.agents[0].fleetPath).toEqual([]);
    });

    it("single-level sub-fleet agents use fleetName.agentName", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    name: myfleet
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].qualifiedName).toBe("myfleet.worker");
    });

    it("deeply nested agents include all intermediate fleet names", async () => {
      const result = await loadConfig(
        join(fixturesDir, "deep-nesting", "root.yaml"),
        { env: {}, envFile: false }
      );

      // Should have agents at 4 levels: root, level1, level2, level3
      expect(result.agents).toHaveLength(4);

      const rootAgent = result.agents.find((a) => a.name === "root-agent");
      expect(rootAgent).toBeDefined();
      expect(rootAgent!.qualifiedName).toBe("root-agent");
      expect(rootAgent!.fleetPath).toEqual([]);

      const l1Agent = result.agents.find((a) => a.name === "l1-agent");
      expect(l1Agent).toBeDefined();
      expect(l1Agent!.qualifiedName).toBe("level1.l1-agent");
      expect(l1Agent!.fleetPath).toEqual(["level1"]);

      const l2Agent = result.agents.find((a) => a.name === "l2-agent");
      expect(l2Agent).toBeDefined();
      expect(l2Agent!.qualifiedName).toBe("level1.level2.l2-agent");
      expect(l2Agent!.fleetPath).toEqual(["level1", "level2"]);

      const l3Agent = result.agents.find((a) => a.name === "l3-agent");
      expect(l3Agent).toBeDefined();
      expect(l3Agent!.qualifiedName).toBe("level1.level2.level3.l3-agent");
      expect(l3Agent!.fleetPath).toEqual(["level1", "level2", "level3"]);
    });

    it("same agent name in different sub-fleets produces different qualified names", async () => {
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
  name: fleet-a
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleet:
  name: fleet-b
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-a", "agents", "worker.yaml"),
        "name: worker"
      );
      await createFile(
        join(tempDir, "fleet-b", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(2);

      const fleetAWorker = result.agents.find(
        (a) => a.qualifiedName === "fleet-a.worker"
      );
      const fleetBWorker = result.agents.find(
        (a) => a.qualifiedName === "fleet-b.worker"
      );

      expect(fleetAWorker).toBeDefined();
      expect(fleetBWorker).toBeDefined();
      expect(fleetAWorker!.qualifiedName).not.toBe(fleetBWorker!.qualifiedName);
    });
  });
});

// =============================================================================
// Defaults Merging Edge Case Tests
// =============================================================================

describe("defaults merging edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("5-level merge priority", () => {
    it("sub-fleet defaults override super-fleet defaults for model", async () => {
      // Priority level 2 (sub-fleet defaults) > level 1 (super-fleet defaults)
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: super-model
  max_turns: 200
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
  model: sub-model
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // sub-fleet model wins over super-fleet model
      expect(result.agents[0].model).toBe("sub-model");
      // super-fleet max_turns fills the gap (sub-fleet doesn't set it)
      expect(result.agents[0].max_turns).toBe(200);
    });

    it("super-fleet defaults fill gaps when sub-fleet sets nothing", async () => {
      // Priority level 1 acts as gap-filler
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: super-model
  max_turns: 100
  permission_mode: plan
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

      expect(result.agents[0].model).toBe("super-model");
      expect(result.agents[0].max_turns).toBe(100);
      expect(result.agents[0].permission_mode).toBe("plan");
    });

    it("agent own config overrides both super-fleet and sub-fleet defaults", async () => {
      // Priority level 3 (agent's own config) > levels 1 and 2
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: super-model
  max_turns: 200
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
  model: sub-model
  max_turns: 50
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
model: agent-model
max_turns: 10
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents[0].model).toBe("agent-model");
      expect(result.agents[0].max_turns).toBe(10);
    });

    it("per-agent overrides from sub-fleet agents entry override agent config", async () => {
      // Priority level 4 (per-agent overrides from sub-fleet's agents entry)
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
    overrides:
      model: per-agent-override
      max_turns: 999
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
model: agent-model
max_turns: 10
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Per-agent overrides win
      expect(result.agents[0].model).toBe("per-agent-override");
      expect(result.agents[0].max_turns).toBe(999);
    });

    it("per-fleet defaults override from super-fleet forcefully overrides sub-fleet defaults", async () => {
      // Priority level 5: per-fleet overrides on the fleets entry
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: super-default
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      defaults:
        model: forced-override-model
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: sub-model
  max_turns: 50
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // forced-override-model from per-fleet overrides should win
      expect(result.agents[0].model).toBe("forced-override-model");
      // max_turns still from sub-fleet defaults
      expect(result.agents[0].max_turns).toBe(50);
    });

    it("full 5-level priority chain with all levels set", async () => {
      // All 5 levels set model, verify highest applicable priority wins
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: level1-super-default
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      defaults:
        model: level5-fleet-override
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: level2-sub-default
agents:
  - path: ./agents/worker.yaml
    overrides:
      model: level4-per-agent-override
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        `
name: worker
model: level3-agent-own
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // The merge order: effective defaults = deepMerge(super-default, sub-default + fleet-override)
      // Then: mergeAgentConfig(effective, agent) => agent's own model wins over defaults
      // Then: per-agent overrides are applied last on the agent level
      // So level4-per-agent-override should win over level3-agent-own
      expect(result.agents[0].model).toBe("level4-per-agent-override");
    });
  });

  describe("multi-level defaults inheritance (fixture-based)", () => {
    it("sub-fleet model wins over super-fleet model for inheriting agent", async () => {
      const result = await loadConfig(
        join(fixturesDir, "defaults-cascade", "root.yaml"),
        { env: {}, envFile: false }
      );

      const inheritor = result.agents.find((a) => a.name === "inheritor");
      expect(inheritor).toBeDefined();
      // sub-fleet model (sub-model) overrides super-fleet model (super-model)
      expect(inheritor!.model).toBe("sub-model");
      // max_turns from super-fleet gap-fills
      expect(inheritor!.max_turns).toBe(200);
    });

    it("agent own model wins over both fleet defaults", async () => {
      const result = await loadConfig(
        join(fixturesDir, "defaults-cascade", "root.yaml"),
        { env: {}, envFile: false }
      );

      const ownModel = result.agents.find((a) => a.name === "own-model");
      expect(ownModel).toBeDefined();
      // Agent sets its own model and max_turns
      expect(ownModel!.model).toBe("agent-model");
      expect(ownModel!.max_turns).toBe(5);
    });
  });

  describe("3-level nesting defaults (fixture-based)", () => {
    it("correct model reaches agents at each level in deep nesting", async () => {
      const result = await loadConfig(
        join(fixturesDir, "deep-nesting", "root.yaml"),
        { env: {}, envFile: false }
      );

      // root-agent: gets root defaults (model: root-model, max_turns: 100)
      const rootAgent = result.agents.find((a) => a.name === "root-agent");
      expect(rootAgent!.model).toBe("root-model");
      expect(rootAgent!.max_turns).toBe(100);

      // l1-agent: level1 defaults override root defaults (model: level1-model, max_turns: 50)
      const l1Agent = result.agents.find((a) => a.name === "l1-agent");
      expect(l1Agent!.model).toBe("level1-model");
      expect(l1Agent!.max_turns).toBe(50);

      // l2-agent: level2 defaults override (model: level2-model), max_turns from level1 (50)
      const l2Agent = result.agents.find((a) => a.name === "l2-agent");
      expect(l2Agent!.model).toBe("level2-model");
      expect(l2Agent!.max_turns).toBe(50);

      // l3-agent: level3 sets no defaults, so inherits from level2 (model: level2-model, max_turns: 50)
      const l3Agent = result.agents.find((a) => a.name === "l3-agent");
      expect(l3Agent!.model).toBe("level2-model");
      expect(l3Agent!.max_turns).toBe(50);
    });
  });

  describe("defaults merging with no defaults", () => {
    it("agent with no fleet defaults gets no extra fields", async () => {
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

      // No defaults at any level, so model and max_turns should be undefined
      expect(result.agents[0].model).toBeUndefined();
      expect(result.agents[0].max_turns).toBeUndefined();
    });

    it("super-fleet defaults do not override sub-fleet agent explicit values", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: super-model
  max_turns: 999
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
model: my-model
max_turns: 5
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Agent's own values should win
      expect(result.agents[0].model).toBe("my-model");
      expect(result.agents[0].max_turns).toBe(5);
    });
  });

  describe("defaults merging with per-fleet override on defaults", () => {
    it("per-fleet overrides on defaults merge into sub-fleet defaults before agent application", async () => {
      // Super-fleet overrides sub-fleet's defaults via fleet-level overrides
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      defaults:
        max_turns: 777
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
defaults:
  model: sub-model
  max_turns: 50
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "worker.yaml"),
        "name: worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Fleet-level override replaces sub-fleet's max_turns
      expect(result.agents[0].max_turns).toBe(777);
      // sub-fleet model still applies
      expect(result.agents[0].model).toBe("sub-model");
    });

    it("per-fleet defaults override applies to all agents in the sub-fleet", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
    overrides:
      defaults:
        model: forced-model
`
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
  - path: ./agents/a.yaml
  - path: ./agents/b.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "agents", "a.yaml"),
        "name: agent-a"
      );
      await createFile(
        join(tempDir, "sub", "agents", "b.yaml"),
        "name: agent-b"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Both agents should get the forced model from fleet-level override
      for (const agent of result.agents) {
        expect(agent.model).toBe("forced-model");
      }
    });
  });
});

// =============================================================================
// Structural Edge Case Tests
// =============================================================================

describe("fleet structural edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("empty/missing fleets and agents", () => {
    it("empty fleets array behaves exactly as no fleets", async () => {
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
      expect(result.agents[0].qualifiedName).toBe("worker");
      expect(result.agents[0].fleetPath).toEqual([]);
    });

    it("fleet with fleets but no agents is valid", async () => {
      const result = await loadConfig(
        join(fixturesDir, "fleets-only", "root.yaml"),
        { env: {}, envFile: false }
      );

      expect(result.agents).toHaveLength(2);
      expect(result.agents.find((a) => a.name === "worker-a")).toBeDefined();
      expect(result.agents.find((a) => a.name === "worker-b")).toBeDefined();
    });

    it("fleet with agents but no fleets behaves exactly as before", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/a.yaml
  - path: ./agents/b.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "a.yaml"),
        "name: agent-a"
      );
      await createFile(
        join(tempDir, "agents", "b.yaml"),
        "name: agent-b"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(2);
      for (const agent of result.agents) {
        expect(agent.fleetPath).toEqual([]);
        expect(agent.qualifiedName).toBe(agent.name);
      }
    });

    it("fleet with no agents and no fleets produces empty agent list", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
`
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toEqual([]);
    });

    it("sub-fleet with no agents is valid", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
agents:
  - path: ./agents/root-agent.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: empty-sub
agents: []
`
      );
      await createFile(
        join(tempDir, "agents", "root-agent.yaml"),
        "name: root-agent"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      // Only root-agent, nothing from empty sub-fleet
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("root-agent");
    });
  });

  describe("deeply nested fleets", () => {
    it("4-level nesting produces correct qualified names (fixture-based)", async () => {
      const result = await loadConfig(
        join(fixturesDir, "deep-nesting", "root.yaml"),
        { env: {}, envFile: false }
      );

      expect(result.agents).toHaveLength(4);

      // Verify qualified names for all levels
      const names = result.agents.map((a) => a.qualifiedName).sort();
      expect(names).toEqual([
        "level1.l1-agent",
        "level1.level2.l2-agent",
        "level1.level2.level3.l3-agent",
        "root-agent",
      ]);
    });

    it("fleetPath arrays grow correctly with depth", async () => {
      const result = await loadConfig(
        join(fixturesDir, "deep-nesting", "root.yaml"),
        { env: {}, envFile: false }
      );

      const l3Agent = result.agents.find((a) => a.name === "l3-agent");
      expect(l3Agent!.fleetPath).toEqual(["level1", "level2", "level3"]);
      expect(l3Agent!.fleetPath).toHaveLength(3);
    });
  });

  describe("fleet with only fleets (pure delegation)", () => {
    it("all agents come from sub-fleets, none from root (fixture-based)", async () => {
      const result = await loadConfig(
        join(fixturesDir, "fleets-only", "root.yaml"),
        { env: {}, envFile: false }
      );

      // All agents should have non-empty fleetPath
      for (const agent of result.agents) {
        expect(agent.fleetPath.length).toBeGreaterThan(0);
      }
    });

    it("qualified names include sub-fleet names for delegation fleet", async () => {
      const result = await loadConfig(
        join(fixturesDir, "fleets-only", "root.yaml"),
        { env: {}, envFile: false }
      );

      const workerA = result.agents.find((a) => a.name === "worker-a");
      const workerB = result.agents.find((a) => a.name === "worker-b");

      expect(workerA!.qualifiedName).toBe("sub-a.worker-a");
      expect(workerB!.qualifiedName).toBe("sub-b.worker-b");
    });
  });

  describe("fleet name collision edge cases", () => {
    it("same name at different levels does NOT collide", async () => {
      // "same-name" at level 1, and "same-name" nested inside another fleet at level 2
      // These are at different levels so no collision
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./fleet-a/herdctl.yaml
    name: fleet-a
  - path: ./fleet-b/herdctl.yaml
    name: fleet-b
`
      );
      await createFile(
        join(tempDir, "fleet-a", "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./nested/herdctl.yaml
    name: same-name
`
      );
      await createFile(
        join(tempDir, "fleet-a", "nested", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-a", "nested", "agents", "worker.yaml"),
        "name: worker-a-nested"
      );
      await createFile(
        join(tempDir, "fleet-b", "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./nested/herdctl.yaml
    name: same-name
`
      );
      await createFile(
        join(tempDir, "fleet-b", "nested", "herdctl.yaml"),
        `
version: 1
agents:
  - path: ./agents/worker.yaml
`
      );
      await createFile(
        join(tempDir, "fleet-b", "nested", "agents", "worker.yaml"),
        "name: worker-b-nested"
      );

      // Should NOT throw — "same-name" is at different levels (under fleet-a vs fleet-b)
      const result = await loadConfig(tempDir, { env: {}, envFile: false });
      expect(result.agents).toHaveLength(2);

      expect(
        result.agents.find((a) => a.qualifiedName === "fleet-a.same-name.worker-a-nested")
      ).toBeDefined();
      expect(
        result.agents.find((a) => a.qualifiedName === "fleet-b.same-name.worker-b-nested")
      ).toBeDefined();
    });

    it("directory-derived names that collide are detected", async () => {
      // Two sub-fleets in directories both named "project" with no explicit names
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./path-a/project/herdctl.yaml
  - path: ./path-b/project/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "path-a", "project", "herdctl.yaml"),
        `
version: 1
agents: []
`
      );
      await createFile(
        join(tempDir, "path-b", "project", "herdctl.yaml"),
        `
version: 1
agents: []
`
      );

      // Both resolve to "project" directory name => collision
      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(FleetNameCollisionError);
    });

    it("collision between explicit name and directory-derived name", async () => {
      // One fleet has explicit name "myfleet", another's directory derives to "myfleet"
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./first/herdctl.yaml
    name: myfleet
  - path: ./myfleet/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "first", "herdctl.yaml"),
        `
version: 1
agents: []
`
      );
      await createFile(
        join(tempDir, "myfleet", "herdctl.yaml"),
        `
version: 1
agents: []
`
      );

      await expect(
        loadConfig(tempDir, { env: {}, envFile: false })
      ).rejects.toThrow(FleetNameCollisionError);
    });
  });

  describe("mixed root agents and sub-fleet agents", () => {
    it("root agents and sub-fleet agents coexist correctly", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./sub/herdctl.yaml
agents:
  - path: ./agents/root-worker.yaml
`
      );
      await createFile(
        join(tempDir, "sub", "herdctl.yaml"),
        `
version: 1
fleet:
  name: sub
agents:
  - path: ./agents/sub-worker.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "root-worker.yaml"),
        "name: root-worker"
      );
      await createFile(
        join(tempDir, "sub", "agents", "sub-worker.yaml"),
        "name: sub-worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      expect(result.agents).toHaveLength(2);

      const rootWorker = result.agents.find((a) => a.name === "root-worker");
      const subWorker = result.agents.find((a) => a.name === "sub-worker");

      expect(rootWorker!.fleetPath).toEqual([]);
      expect(rootWorker!.qualifiedName).toBe("root-worker");

      expect(subWorker!.fleetPath).toEqual(["sub"]);
      expect(subWorker!.qualifiedName).toBe("sub.sub-worker");
    });

    it("root defaults apply to root agents but not sub-fleet agents with their own defaults", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
defaults:
  model: root-model
fleets:
  - path: ./sub/herdctl.yaml
agents:
  - path: ./agents/root-worker.yaml
`
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
  - path: ./agents/sub-worker.yaml
`
      );
      await createFile(
        join(tempDir, "agents", "root-worker.yaml"),
        "name: root-worker"
      );
      await createFile(
        join(tempDir, "sub", "agents", "sub-worker.yaml"),
        "name: sub-worker"
      );

      const result = await loadConfig(tempDir, { env: {}, envFile: false });

      const rootWorker = result.agents.find((a) => a.name === "root-worker");
      const subWorker = result.agents.find((a) => a.name === "sub-worker");

      expect(rootWorker!.model).toBe("root-model");
      expect(subWorker!.model).toBe("sub-model");
    });
  });
});
