/**
 * Tests for fleet config updater
 *
 * Uses real file I/O with temporary directories to test fleet config operations.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addAgentToFleetConfig,
  CONFIG_NOT_FOUND,
  CONFIG_PARSE_ERROR,
  FleetConfigError,
  removeAgentFromFleetConfig,
} from "../fleet-config-updater.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("fleet-config-updater", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-fleet-config-"));
    configPath = join(tempDir, "herdctl.yaml");
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /**
   * Read the config file and return its content
   */
  async function readConfig(): Promise<string> {
    return readFile(configPath, "utf-8");
  }

  // ===========================================================================
  // addAgentToFleetConfig Tests
  // ===========================================================================

  describe("addAgentToFleetConfig", () => {
    describe("successful operations", () => {
      it("adds agent reference to existing agents array", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/existing-agent.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/new-agent/agent.yaml",
        });

        expect(result.modified).toBe(true);
        expect(result.agentPath).toBe("./agents/new-agent/agent.yaml");
        expect(result.alreadyExists).toBe(false);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("./agents/new-agent/agent.yaml");
        expect(updatedConfig).toContain("./agents/existing-agent.yaml");
      });

      it("creates agents array when none exists", async () => {
        const initialConfig = `name: my-fleet
description: A fleet without agents
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/first-agent/agent.yaml",
        });

        expect(result.modified).toBe(true);
        expect(result.alreadyExists).toBe(false);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("agents:");
        expect(updatedConfig).toContain("./agents/first-agent/agent.yaml");
      });

      it("preserves comments and formatting in YAML", async () => {
        const initialConfig = `# Fleet configuration
name: my-fleet  # The fleet name
description: A test fleet

# Agent definitions
agents:
  # First agent
  - path: ./agents/agent-one.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/agent-two/agent.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        // Check comments are preserved
        expect(updatedConfig).toContain("# Fleet configuration");
        expect(updatedConfig).toContain("# The fleet name");
        expect(updatedConfig).toContain("# Agent definitions");
        expect(updatedConfig).toContain("# First agent");
        // Check both agents exist
        expect(updatedConfig).toContain("./agents/agent-one.yaml");
        expect(updatedConfig).toContain("./agents/agent-two/agent.yaml");
      });

      it("detects duplicate agent references", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/my-agent/agent.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/my-agent/agent.yaml",
        });

        expect(result.modified).toBe(false);
        expect(result.agentPath).toBe("./agents/my-agent/agent.yaml");
        expect(result.alreadyExists).toBe(true);

        // Config should be unchanged
        const updatedConfig = await readConfig();
        expect(updatedConfig).toBe(initialConfig);
      });

      it("handles empty agents array", async () => {
        const initialConfig = `name: my-fleet
agents: []
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/new-agent/agent.yaml",
        });

        expect(result.modified).toBe(true);
        expect(result.alreadyExists).toBe(false);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("./agents/new-agent/agent.yaml");
      });

      it("handles config with only comments", async () => {
        const initialConfig = `# This is a fleet config
# More comments here
name: my-fleet
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/my-agent/agent.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("# This is a fleet config");
        expect(updatedConfig).toContain("agents:");
        expect(updatedConfig).toContain("./agents/my-agent/agent.yaml");
      });

      it("handles multiple agents in array", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/agent-1.yaml
  - path: ./agents/agent-2.yaml
  - path: ./agents/agent-3.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/agent-4/agent.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("./agents/agent-1.yaml");
        expect(updatedConfig).toContain("./agents/agent-2.yaml");
        expect(updatedConfig).toContain("./agents/agent-3.yaml");
        expect(updatedConfig).toContain("./agents/agent-4/agent.yaml");
      });

      it("stores agent path exactly as provided", async () => {
        const initialConfig = `name: my-fleet
agents: []
`;
        await writeFile(configPath, initialConfig);

        // Use a specific path format
        const agentPath = "./agents/sub-dir/my-special-agent/agent.yaml";
        const result = await addAgentToFleetConfig({
          configPath,
          agentPath,
        });

        expect(result.modified).toBe(true);
        expect(result.agentPath).toBe(agentPath);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain(agentPath);
      });
    });

    describe("error handling", () => {
      it("errors when config file does not exist", async () => {
        await expect(
          addAgentToFleetConfig({
            configPath: join(tempDir, "nonexistent.yaml"),
            agentPath: "./agents/agent.yaml",
          }),
        ).rejects.toThrow(FleetConfigError);

        try {
          await addAgentToFleetConfig({
            configPath: join(tempDir, "nonexistent.yaml"),
            agentPath: "./agents/agent.yaml",
          });
        } catch (err) {
          const error = err as FleetConfigError;
          expect(error.code).toBe(CONFIG_NOT_FOUND);
          expect(error.message).toContain("herdctl init fleet");
        }
      });

      it("errors on invalid YAML syntax", async () => {
        // YAML with unclosed quotes and truly invalid structure
        const invalidYaml = `name: "unclosed
agents: [invalid: yaml`;
        await writeFile(configPath, invalidYaml);

        await expect(
          addAgentToFleetConfig({
            configPath,
            agentPath: "./agents/agent.yaml",
          }),
        ).rejects.toThrow(FleetConfigError);

        try {
          await addAgentToFleetConfig({
            configPath,
            agentPath: "./agents/agent.yaml",
          });
        } catch (err) {
          const error = err as FleetConfigError;
          expect(error.code).toBe(CONFIG_PARSE_ERROR);
          expect(error.message).toContain("Invalid YAML syntax");
        }
      });

      it("handles empty config file gracefully", async () => {
        await writeFile(configPath, "");

        // Empty YAML file should be parseable (results in null document)
        // Adding an agent should create the agents array
        const result = await addAgentToFleetConfig({
          configPath,
          agentPath: "./agents/agent.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("agents:");
        expect(updatedConfig).toContain("./agents/agent.yaml");
      });
    });
  });

  // ===========================================================================
  // removeAgentFromFleetConfig Tests
  // ===========================================================================

  describe("removeAgentFromFleetConfig", () => {
    describe("successful operations", () => {
      it("removes existing agent reference", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/agent-one.yaml
  - path: ./agents/agent-two.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/agent-one.yaml",
        });

        expect(result.modified).toBe(true);
        expect(result.agentPath).toBe("./agents/agent-one.yaml");
        expect(result.alreadyExists).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).not.toContain("./agents/agent-one.yaml");
        expect(updatedConfig).toContain("./agents/agent-two.yaml");
      });

      it("is no-op for non-existent agent reference", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/agent-one.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/nonexistent.yaml",
        });

        expect(result.modified).toBe(false);
        expect(result.agentPath).toBe("./agents/nonexistent.yaml");
        expect(result.alreadyExists).toBe(false);

        // Config should be unchanged
        const updatedConfig = await readConfig();
        expect(updatedConfig).toBe(initialConfig);
      });

      it("preserves comments when removing", async () => {
        const initialConfig = `# Fleet config
name: my-fleet

# Agents
agents:
  # Agent one
  - path: ./agents/agent-one.yaml
  # Agent two
  - path: ./agents/agent-two.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/agent-two.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("# Fleet config");
        expect(updatedConfig).toContain("# Agents");
        expect(updatedConfig).toContain("./agents/agent-one.yaml");
        expect(updatedConfig).not.toContain("./agents/agent-two.yaml");
      });

      it("handles removing last agent from array", async () => {
        const initialConfig = `name: my-fleet
agents:
  - path: ./agents/only-agent.yaml
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/only-agent.yaml",
        });

        expect(result.modified).toBe(true);

        const updatedConfig = await readConfig();
        expect(updatedConfig).toContain("agents:");
        expect(updatedConfig).not.toContain("./agents/only-agent.yaml");
      });

      it("handles config without agents array", async () => {
        const initialConfig = `name: my-fleet
description: No agents here
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/agent.yaml",
        });

        expect(result.modified).toBe(false);
        expect(result.alreadyExists).toBe(false);

        // Config should be unchanged
        const updatedConfig = await readConfig();
        expect(updatedConfig).toBe(initialConfig);
      });

      it("handles empty agents array", async () => {
        const initialConfig = `name: my-fleet
agents: []
`;
        await writeFile(configPath, initialConfig);

        const result = await removeAgentFromFleetConfig({
          configPath,
          agentPath: "./agents/agent.yaml",
        });

        expect(result.modified).toBe(false);
        expect(result.alreadyExists).toBe(false);
      });
    });

    describe("error handling", () => {
      it("errors when config file does not exist", async () => {
        await expect(
          removeAgentFromFleetConfig({
            configPath: join(tempDir, "nonexistent.yaml"),
            agentPath: "./agents/agent.yaml",
          }),
        ).rejects.toThrow(FleetConfigError);

        try {
          await removeAgentFromFleetConfig({
            configPath: join(tempDir, "nonexistent.yaml"),
            agentPath: "./agents/agent.yaml",
          });
        } catch (err) {
          const error = err as FleetConfigError;
          expect(error.code).toBe(CONFIG_NOT_FOUND);
        }
      });

      it("errors on invalid YAML syntax", async () => {
        // YAML with unclosed quotes and truly invalid structure
        const invalidYaml = `name: "unclosed
agents: [invalid: yaml`;
        await writeFile(configPath, invalidYaml);

        await expect(
          removeAgentFromFleetConfig({
            configPath,
            agentPath: "./agents/agent.yaml",
          }),
        ).rejects.toThrow(FleetConfigError);

        try {
          await removeAgentFromFleetConfig({
            configPath,
            agentPath: "./agents/agent.yaml",
          });
        } catch (err) {
          const error = err as FleetConfigError;
          expect(error.code).toBe(CONFIG_PARSE_ERROR);
        }
      });
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles agent path with special characters", async () => {
      const initialConfig = `name: my-fleet
agents: []
`;
      await writeFile(configPath, initialConfig);

      const agentPath = "./agents/my-agent_v2-beta/agent.yaml";
      const result = await addAgentToFleetConfig({
        configPath,
        agentPath,
      });

      expect(result.modified).toBe(true);

      const updatedConfig = await readConfig();
      expect(updatedConfig).toContain(agentPath);
    });

    it("handles add and remove sequence", async () => {
      const initialConfig = `name: my-fleet
agents: []
`;
      await writeFile(configPath, initialConfig);

      // Add an agent
      const addResult = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/temp-agent/agent.yaml",
      });
      expect(addResult.modified).toBe(true);

      // Verify it was added
      let config = await readConfig();
      expect(config).toContain("./agents/temp-agent/agent.yaml");

      // Remove the agent
      const removeResult = await removeAgentFromFleetConfig({
        configPath,
        agentPath: "./agents/temp-agent/agent.yaml",
      });
      expect(removeResult.modified).toBe(true);

      // Verify it was removed
      config = await readConfig();
      expect(config).not.toContain("./agents/temp-agent/agent.yaml");
    });

    it("handles duplicate add attempts", async () => {
      const initialConfig = `name: my-fleet
agents: []
`;
      await writeFile(configPath, initialConfig);

      // Add an agent
      const firstAdd = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/my-agent/agent.yaml",
      });
      expect(firstAdd.modified).toBe(true);

      // Try to add the same agent again
      const secondAdd = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/my-agent/agent.yaml",
      });
      expect(secondAdd.modified).toBe(false);
      expect(secondAdd.alreadyExists).toBe(true);

      // Verify only one entry exists
      const config = await readConfig();
      const matches = config.match(/\.\/agents\/my-agent\/agent\.yaml/g);
      expect(matches).toHaveLength(1);
    });

    it("handles duplicate remove attempts", async () => {
      const initialConfig = `name: my-fleet
agents:
  - path: ./agents/my-agent/agent.yaml
`;
      await writeFile(configPath, initialConfig);

      // Remove the agent
      const firstRemove = await removeAgentFromFleetConfig({
        configPath,
        agentPath: "./agents/my-agent/agent.yaml",
      });
      expect(firstRemove.modified).toBe(true);

      // Try to remove the same agent again
      const secondRemove = await removeAgentFromFleetConfig({
        configPath,
        agentPath: "./agents/my-agent/agent.yaml",
      });
      expect(secondRemove.modified).toBe(false);
      expect(secondRemove.alreadyExists).toBe(false);
    });

    it("handles agents array with null items", async () => {
      // This is an edge case where the array might have explicit null values
      const initialConfig = `name: my-fleet
agents:
  - path: ./agents/agent-one.yaml
  -
  - path: ./agents/agent-two.yaml
`;
      await writeFile(configPath, initialConfig);

      const result = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/agent-three/agent.yaml",
      });

      expect(result.modified).toBe(true);

      const updatedConfig = await readConfig();
      expect(updatedConfig).toContain("./agents/agent-three/agent.yaml");
    });

    it("handles inline array format", async () => {
      const initialConfig = `name: my-fleet
agents: [{ path: ./agents/agent-one.yaml }]
`;
      await writeFile(configPath, initialConfig);

      const result = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/agent-two/agent.yaml",
      });

      expect(result.modified).toBe(true);

      const updatedConfig = await readConfig();
      expect(updatedConfig).toContain("./agents/agent-two/agent.yaml");
    });

    it("handles deeply nested fleet config", async () => {
      const initialConfig = `# Complex fleet config
name: my-fleet
description: A complex fleet

settings:
  logging:
    level: debug
  docker:
    enabled: true

# Agents section
agents:
  - path: ./agents/agent-one.yaml
    # inline comment

schedules:
  daily:
    type: cron
    expression: "0 9 * * *"
`;
      await writeFile(configPath, initialConfig);

      const result = await addAgentToFleetConfig({
        configPath,
        agentPath: "./agents/agent-two/agent.yaml",
      });

      expect(result.modified).toBe(true);

      const updatedConfig = await readConfig();
      // Verify structure is preserved
      expect(updatedConfig).toContain("settings:");
      expect(updatedConfig).toContain("schedules:");
      expect(updatedConfig).toContain("./agents/agent-one.yaml");
      expect(updatedConfig).toContain("./agents/agent-two/agent.yaml");
    });
  });
});
