/**
 * Tests for agent discovery
 *
 * Uses real file I/O with temporary directories to test discovery logic.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentDiscoveryError,
  DISCOVERY_CONFIG_INVALID,
  DISCOVERY_CONFIG_NOT_FOUND,
  discoverAgents,
} from "../agent-discovery.js";
import type { InstallationMetadata } from "../installation-metadata.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("discoverAgents", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-discovery-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /**
   * Create a minimal herdctl.yaml fleet config
   */
  async function createFleetConfig(
    agentPaths: string[] = [],
    options: { name?: string } = {},
  ): Promise<string> {
    const { name = "test-fleet" } = options;

    const agentsYaml =
      agentPaths.length > 0 ? agentPaths.map((p) => `  - path: ${p}`).join("\n") : "";

    const content = `version: 1

fleet:
  name: ${name}

agents:
${agentsYaml}
`;

    const configPath = join(tempDir, "herdctl.yaml");
    await writeFile(configPath, content, "utf-8");
    return configPath;
  }

  /**
   * Create an agent directory with agent.yaml
   */
  async function createAgent(
    name: string,
    options: {
      description?: string;
      withMetadata?: boolean;
      metadata?: Partial<InstallationMetadata>;
      withHerdctlJson?: boolean;
      herdctlJsonVersion?: string;
    } = {},
  ): Promise<string> {
    const agentDir = join(tempDir, "agents", name);
    await mkdir(agentDir, { recursive: true });

    // Create agent.yaml
    const agentYaml = `name: ${name}
permission_mode: default
runtime: sdk
${options.description ? `description: "${options.description}"` : ""}
`;
    await writeFile(join(agentDir, "agent.yaml"), agentYaml, "utf-8");

    // Create metadata.json if requested
    if (options.withMetadata) {
      const metadata: InstallationMetadata = {
        source: {
          type: "github",
          url: "https://github.com/user/repo",
          ref: "v1.0.0",
          version: options.metadata?.source?.version ?? "1.0.0",
          ...options.metadata?.source,
        },
        installed_at: options.metadata?.installed_at ?? new Date().toISOString(),
        installed_by: options.metadata?.installed_by ?? "herdctl@0.5.0",
        ...options.metadata,
      };
      await writeFile(join(agentDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
    }

    // Create herdctl.json if requested
    if (options.withHerdctlJson) {
      const herdctlJson = {
        name,
        version: options.herdctlJsonVersion ?? "1.0.0",
      };
      await writeFile(
        join(agentDir, "herdctl.json"),
        JSON.stringify(herdctlJson, null, 2),
        "utf-8",
      );
    }

    return agentDir;
  }

  // ===========================================================================
  // Empty Fleet Tests
  // ===========================================================================

  describe("empty fleet config", () => {
    it("returns empty result when no agents in config", async () => {
      const configPath = await createFleetConfig([]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(0);
    });

    it("returns empty result when agents key is missing", async () => {
      const configPath = join(tempDir, "herdctl.yaml");
      await writeFile(
        configPath,
        `version: 1
fleet:
  name: test-fleet
`,
        "utf-8",
      );

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Single Agent Tests
  // ===========================================================================

  describe("single agent", () => {
    it("discovers installed agent with metadata.json", async () => {
      await createAgent("my-agent", { withMetadata: true });
      const configPath = await createFleetConfig(["./agents/my-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("my-agent");
      expect(result.agents[0].installed).toBe(true);
      expect(result.agents[0].metadata).toBeDefined();
      expect(result.agents[0].metadata?.source.type).toBe("github");
    });

    it("discovers manual agent without metadata.json", async () => {
      await createAgent("manual-agent", { withMetadata: false });
      const configPath = await createFleetConfig(["./agents/manual-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("manual-agent");
      expect(result.agents[0].installed).toBe(false);
      expect(result.agents[0].metadata).toBeUndefined();
    });

    it("includes description from agent.yaml", async () => {
      await createAgent("described-agent", {
        description: "A helpful agent that does things",
      });
      const configPath = await createFleetConfig(["./agents/described-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].description).toBe("A helpful agent that does things");
    });

    it("includes version from metadata.json source", async () => {
      await createAgent("versioned-agent", {
        withMetadata: true,
        metadata: { source: { type: "github", version: "2.0.0" } },
      });
      const configPath = await createFleetConfig(["./agents/versioned-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].version).toBe("2.0.0");
    });

    it("falls back to herdctl.json version when no metadata", async () => {
      await createAgent("json-versioned-agent", {
        withMetadata: false,
        withHerdctlJson: true,
        herdctlJsonVersion: "3.0.0",
      });
      const configPath = await createFleetConfig(["./agents/json-versioned-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].version).toBe("3.0.0");
    });
  });

  // ===========================================================================
  // Multiple Agents Tests
  // ===========================================================================

  describe("multiple agents", () => {
    it("discovers multiple agents, some installed some manual", async () => {
      await createAgent("agent-a", { withMetadata: true });
      await createAgent("agent-b", { withMetadata: false });
      await createAgent("agent-c", { withMetadata: true });

      const configPath = await createFleetConfig([
        "./agents/agent-a/agent.yaml",
        "./agents/agent-b/agent.yaml",
        "./agents/agent-c/agent.yaml",
      ]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(3);

      // Should be sorted by name
      expect(result.agents[0].name).toBe("agent-a");
      expect(result.agents[0].installed).toBe(true);

      expect(result.agents[1].name).toBe("agent-b");
      expect(result.agents[1].installed).toBe(false);

      expect(result.agents[2].name).toBe("agent-c");
      expect(result.agents[2].installed).toBe(true);
    });

    it("sorts agents by name alphabetically", async () => {
      await createAgent("zebra-agent", { withMetadata: false });
      await createAgent("alpha-agent", { withMetadata: false });
      await createAgent("middle-agent", { withMetadata: false });

      const configPath = await createFleetConfig([
        "./agents/zebra-agent/agent.yaml",
        "./agents/alpha-agent/agent.yaml",
        "./agents/middle-agent/agent.yaml",
      ]);

      const result = await discoverAgents({ configPath });

      expect(result.agents.map((a) => a.name)).toEqual([
        "alpha-agent",
        "middle-agent",
        "zebra-agent",
      ]);
    });
  });

  // ===========================================================================
  // Missing/Invalid Agent Tests
  // ===========================================================================

  describe("missing or invalid agents", () => {
    it("skips agent when directory does not exist", async () => {
      await createAgent("exists-agent", { withMetadata: false });
      // Don't create "missing-agent" directory
      const configPath = await createFleetConfig([
        "./agents/exists-agent/agent.yaml",
        "./agents/missing-agent/agent.yaml",
      ]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("exists-agent");
    });

    it("handles invalid/corrupt metadata.json gracefully", async () => {
      const agentDir = join(tempDir, "agents", "corrupt-metadata");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "agent.yaml"),
        "name: corrupt-metadata\nruntime: sdk\n",
        "utf-8",
      );
      // Write invalid JSON
      await writeFile(join(agentDir, "metadata.json"), "{ invalid json }", "utf-8");

      const configPath = await createFleetConfig(["./agents/corrupt-metadata/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("corrupt-metadata");
      expect(result.agents[0].installed).toBe(false);
      expect(result.agents[0].metadata).toBeUndefined();
    });

    it("handles metadata.json that fails schema validation", async () => {
      const agentDir = join(tempDir, "agents", "bad-schema");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: bad-schema\nruntime: sdk\n", "utf-8");
      // Write JSON that is valid but doesn't match schema
      await writeFile(
        join(agentDir, "metadata.json"),
        JSON.stringify({ source: { type: "invalid-type" }, installed_at: "not-iso" }),
        "utf-8",
      );

      const configPath = await createFleetConfig(["./agents/bad-schema/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].installed).toBe(false);
    });

    it("uses directory name when agent.yaml has no name field", async () => {
      const agentDir = join(tempDir, "agents", "no-name-agent");
      await mkdir(agentDir, { recursive: true });
      // agent.yaml without name field
      await writeFile(
        join(agentDir, "agent.yaml"),
        "runtime: sdk\npermission_mode: default\n",
        "utf-8",
      );

      const configPath = await createFleetConfig(["./agents/no-name-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("no-name-agent");
    });

    it("uses directory name when agent.yaml is missing", async () => {
      const agentDir = join(tempDir, "agents", "no-yaml-agent");
      await mkdir(agentDir, { recursive: true });
      // No agent.yaml created

      const configPath = await createFleetConfig(["./agents/no-yaml-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("no-yaml-agent");
    });

    it("uses directory name when agent.yaml is invalid YAML", async () => {
      const agentDir = join(tempDir, "agents", "bad-yaml-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "agent.yaml"),
        "name: test\n  bad: indent\n    invalid",
        "utf-8",
      );

      const configPath = await createFleetConfig(["./agents/bad-yaml-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("bad-yaml-agent");
    });
  });

  // ===========================================================================
  // Config Path Tests
  // ===========================================================================

  describe("config path handling", () => {
    it("throws when config file does not exist", async () => {
      const configPath = join(tempDir, "nonexistent.yaml");

      await expect(discoverAgents({ configPath })).rejects.toThrow(AgentDiscoveryError);

      try {
        await discoverAgents({ configPath });
      } catch (err) {
        const error = err as AgentDiscoveryError;
        expect(error.code).toBe(DISCOVERY_CONFIG_NOT_FOUND);
        expect(error.message).toContain("Fleet config not found");
      }
    });

    it("throws when config file is invalid YAML", async () => {
      const configPath = join(tempDir, "herdctl.yaml");
      await writeFile(configPath, "invalid: yaml: content:\n  bad", "utf-8");

      await expect(discoverAgents({ configPath })).rejects.toThrow(AgentDiscoveryError);

      try {
        await discoverAgents({ configPath });
      } catch (err) {
        const error = err as AgentDiscoveryError;
        expect(error.code).toBe(DISCOVERY_CONFIG_INVALID);
      }
    });

    it("throws when config file is empty", async () => {
      const configPath = join(tempDir, "herdctl.yaml");
      await writeFile(configPath, "", "utf-8");

      await expect(discoverAgents({ configPath })).rejects.toThrow(AgentDiscoveryError);

      try {
        await discoverAgents({ configPath });
      } catch (err) {
        const error = err as AgentDiscoveryError;
        expect(error.code).toBe(DISCOVERY_CONFIG_INVALID);
      }
    });

    it("uses custom baseDir when provided", async () => {
      // Create agent in a different base directory
      const customBase = join(tempDir, "custom-base");
      const agentDir = join(customBase, "agents", "custom-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: custom-agent\nruntime: sdk\n", "utf-8");

      // Config is in tempDir but baseDir is customBase
      const configPath = await createFleetConfig(["./agents/custom-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath, baseDir: customBase });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("custom-agent");
      expect(result.agents[0].path).toBe(agentDir);
    });
  });

  // ===========================================================================
  // Agent Reference Format Tests
  // ===========================================================================

  describe("agent reference formats", () => {
    it("handles object form agent references", async () => {
      await createAgent("object-ref", { withMetadata: false });
      const configPath = await createFleetConfig(["./agents/object-ref/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].configPath).toBe("./agents/object-ref/agent.yaml");
    });

    it("handles nested agent paths", async () => {
      const nestedDir = join(tempDir, "deep", "nested", "agents", "nested-agent");
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(nestedDir, "agent.yaml"), "name: nested-agent\nruntime: sdk\n", "utf-8");

      const configPath = await createFleetConfig(["./deep/nested/agents/nested-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("nested-agent");
    });

    it("skips invalid agent references in config", async () => {
      await createAgent("valid-agent", { withMetadata: false });

      // Create config manually with an invalid reference
      const configPath = join(tempDir, "herdctl.yaml");
      await writeFile(
        configPath,
        `version: 1
fleet:
  name: test-fleet
agents:
  - path: ./agents/valid-agent/agent.yaml
  - invalid_key: not_a_path
  - 12345
`,
        "utf-8",
      );

      const result = await discoverAgents({ configPath });

      // Should only discover the valid agent
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("valid-agent");
    });
  });

  // ===========================================================================
  // Path Resolution Tests
  // ===========================================================================

  describe("path resolution", () => {
    it("resolves agent path correctly", async () => {
      await createAgent("path-test", { withMetadata: false });
      const configPath = await createFleetConfig(["./agents/path-test/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].path).toBe(join(tempDir, "agents", "path-test"));
      expect(result.agents[0].configPath).toBe("./agents/path-test/agent.yaml");
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles agent with all optional fields", async () => {
      await createAgent("full-agent", {
        description: "A fully specified agent",
        withMetadata: true,
        metadata: {
          source: {
            type: "github",
            url: "https://github.com/org/full-agent",
            ref: "main",
            version: "1.2.3",
          },
          installed_at: "2024-01-15T10:30:00Z",
          installed_by: "herdctl@1.0.0",
        },
      });
      const configPath = await createFleetConfig(["./agents/full-agent/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      const agent = result.agents[0];
      expect(agent.name).toBe("full-agent");
      expect(agent.description).toBe("A fully specified agent");
      expect(agent.installed).toBe(true);
      expect(agent.version).toBe("1.2.3");
      expect(agent.metadata?.installed_at).toBe("2024-01-15T10:30:00Z");
      expect(agent.metadata?.installed_by).toBe("herdctl@1.0.0");
    });

    it("handles agent with minimal fields", async () => {
      const agentDir = join(tempDir, "agents", "minimal");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: minimal\n", "utf-8");

      const configPath = await createFleetConfig(["./agents/minimal/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].name).toBe("minimal");
      expect(result.agents[0].description).toBeUndefined();
      expect(result.agents[0].version).toBeUndefined();
      expect(result.agents[0].installed).toBe(false);
    });

    it("handles local source type in metadata", async () => {
      await createAgent("local-source", {
        withMetadata: true,
        metadata: {
          source: {
            type: "local",
            url: "/path/to/local/agent",
          },
        },
      });
      const configPath = await createFleetConfig(["./agents/local-source/agent.yaml"]);

      const result = await discoverAgents({ configPath });

      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].installed).toBe(true);
      expect(result.agents[0].metadata?.source.type).toBe("local");
    });

    it("handles duplicate agent paths in config (returns one entry)", async () => {
      await createAgent("duplicate-agent", { withMetadata: false });
      const configPath = await createFleetConfig([
        "./agents/duplicate-agent/agent.yaml",
        "./agents/duplicate-agent/agent.yaml",
      ]);

      const result = await discoverAgents({ configPath });

      // Both entries are processed, so we get two results
      // (deduplication would be a feature enhancement)
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].name).toBe("duplicate-agent");
      expect(result.agents[1].name).toBe("duplicate-agent");
    });
  });
});
