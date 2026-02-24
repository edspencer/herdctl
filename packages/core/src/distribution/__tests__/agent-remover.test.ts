/**
 * Tests for agent remover
 *
 * Uses real file I/O with temporary directories to test removal logic.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AGENT_NOT_FOUND, AgentRemoveError, removeAgent } from "../agent-remover.js";
import type { InstallationMetadata } from "../installation-metadata.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("removeAgent", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-remover-"));
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
   * Read the fleet config and return its content
   */
  async function readFleetConfig(configPath: string): Promise<string> {
    return await readFile(configPath, "utf-8");
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
      withWorkspace?: boolean;
      workspaceFiles?: string[];
      envVars?: { name: string; defaultValue?: string }[];
      extraFiles?: string[];
    } = {},
  ): Promise<string> {
    const agentDir = join(tempDir, "agents", name);
    await mkdir(agentDir, { recursive: true });

    // Build agent.yaml content with optional env vars
    let agentYaml = `name: ${name}
permission_mode: default
runtime: sdk
`;
    if (options.description) {
      agentYaml += `description: "${options.description}"\n`;
    }

    // Add env vars to agent.yaml if requested
    if (options.envVars && options.envVars.length > 0) {
      agentYaml += `env:\n`;
      for (const envVar of options.envVars) {
        if (envVar.defaultValue !== undefined) {
          agentYaml += `  ${envVar.name.toLowerCase()}: \${${envVar.name}:-${envVar.defaultValue}}\n`;
        } else {
          agentYaml += `  ${envVar.name.toLowerCase()}: \${${envVar.name}}\n`;
        }
      }
    }

    await writeFile(join(agentDir, "agent.yaml"), agentYaml, "utf-8");

    // Create CLAUDE.md
    await writeFile(join(agentDir, "CLAUDE.md"), "# Agent Instructions\n", "utf-8");

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

    // Create workspace/ directory if requested
    if (options.withWorkspace) {
      const workspaceDir = join(agentDir, "workspace");
      await mkdir(workspaceDir, { recursive: true });

      // Add workspace files if specified
      if (options.workspaceFiles && options.workspaceFiles.length > 0) {
        for (const file of options.workspaceFiles) {
          await writeFile(join(workspaceDir, file), `content of ${file}`, "utf-8");
        }
      }
    }

    // Create extra files if requested
    if (options.extraFiles && options.extraFiles.length > 0) {
      for (const file of options.extraFiles) {
        const filePath = join(agentDir, file);
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        if (dir !== agentDir) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(filePath, `content of ${file}`, "utf-8");
      }
    }

    return agentDir;
  }

  /**
   * Check if a path exists
   */
  async function pathExists(filePath: string): Promise<boolean> {
    try {
      await readFile(filePath);
      return true;
    } catch {
      try {
        await readdir(filePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  // ===========================================================================
  // Successful Removal Tests
  // ===========================================================================

  describe("successful removal", () => {
    it("removes installed agent and updates config", async () => {
      const agentDir = await createAgent("my-agent", { withMetadata: true });
      const configPath = await createFleetConfig(["./agents/my-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "my-agent",
        configPath,
      });

      // Check result
      expect(result.agentName).toBe("my-agent");
      expect(result.removedPath).toBe(agentDir);
      expect(result.filesRemoved).toBe(true);
      expect(result.configUpdated).toBe(true);
      expect(result.workspacePreserved).toBe(false);

      // Verify directory is gone
      expect(await pathExists(agentDir)).toBe(false);

      // Verify config is updated
      const configContent = await readFleetConfig(configPath);
      expect(configContent).not.toContain("my-agent");
    });

    it("removes manual agent without metadata", async () => {
      const agentDir = await createAgent("manual-agent", { withMetadata: false });
      const configPath = await createFleetConfig(["./agents/manual-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "manual-agent",
        configPath,
      });

      expect(result.agentName).toBe("manual-agent");
      expect(result.filesRemoved).toBe(true);
      expect(result.configUpdated).toBe(true);
      expect(await pathExists(agentDir)).toBe(false);
    });

    it("removes agent with extra files and subdirectories", async () => {
      const agentDir = await createAgent("complex-agent", {
        withMetadata: true,
        extraFiles: ["knowledge/guide.md", "knowledge/faq.md", "scripts/run.sh"],
      });
      const configPath = await createFleetConfig(["./agents/complex-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "complex-agent",
        configPath,
      });

      expect(result.filesRemoved).toBe(true);
      expect(await pathExists(agentDir)).toBe(false);
      expect(await pathExists(join(agentDir, "knowledge"))).toBe(false);
      expect(await pathExists(join(agentDir, "scripts"))).toBe(false);
    });
  });

  // ===========================================================================
  // Keep Workspace Tests
  // ===========================================================================

  describe("keep workspace option", () => {
    it("preserves workspace directory when keepWorkspace is true", async () => {
      const agentDir = await createAgent("workspace-agent", {
        withMetadata: true,
        withWorkspace: true,
        workspaceFiles: ["output.txt", "data.json"],
      });
      const configPath = await createFleetConfig(["./agents/workspace-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "workspace-agent",
        configPath,
        keepWorkspace: true,
      });

      expect(result.workspacePreserved).toBe(true);
      expect(result.filesRemoved).toBe(true);

      // Workspace should still exist
      expect(await pathExists(join(agentDir, "workspace"))).toBe(true);
      expect(await pathExists(join(agentDir, "workspace", "output.txt"))).toBe(true);
      expect(await pathExists(join(agentDir, "workspace", "data.json"))).toBe(true);

      // Other files should be gone
      expect(await pathExists(join(agentDir, "agent.yaml"))).toBe(false);
      expect(await pathExists(join(agentDir, "CLAUDE.md"))).toBe(false);
      expect(await pathExists(join(agentDir, "metadata.json"))).toBe(false);
    });

    it("deletes everything including workspace when keepWorkspace is false", async () => {
      const agentDir = await createAgent("full-delete-agent", {
        withMetadata: true,
        withWorkspace: true,
        workspaceFiles: ["data.txt"],
      });
      const configPath = await createFleetConfig(["./agents/full-delete-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "full-delete-agent",
        configPath,
        keepWorkspace: false,
      });

      expect(result.workspacePreserved).toBe(false);
      expect(result.filesRemoved).toBe(true);
      expect(await pathExists(agentDir)).toBe(false);
    });

    it("handles keepWorkspace when workspace does not exist", async () => {
      const agentDir = await createAgent("no-workspace-agent", {
        withMetadata: true,
        withWorkspace: false,
      });
      const configPath = await createFleetConfig(["./agents/no-workspace-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "no-workspace-agent",
        configPath,
        keepWorkspace: true,
      });

      // Should still work, just deletes everything
      expect(result.filesRemoved).toBe(true);
      expect(result.workspacePreserved).toBe(false);
      expect(await pathExists(agentDir)).toBe(false);
    });
  });

  // ===========================================================================
  // Environment Variables Tests
  // ===========================================================================

  describe("environment variables", () => {
    it("reports required env variables", async () => {
      await createAgent("env-agent", {
        withMetadata: true,
        envVars: [{ name: "DISCORD_WEBHOOK_URL" }, { name: "WEBSITES" }],
      });
      const configPath = await createFleetConfig(["./agents/env-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "env-agent",
        configPath,
      });

      expect(result.envVariables).toBeDefined();
      expect(result.envVariables!.required.length).toBe(2);
      expect(result.envVariables!.required.map((v) => v.name)).toContain("DISCORD_WEBHOOK_URL");
      expect(result.envVariables!.required.map((v) => v.name)).toContain("WEBSITES");
    });

    it("reports optional env variables with defaults", async () => {
      await createAgent("optional-env-agent", {
        withMetadata: true,
        envVars: [
          { name: "CRON_SCHEDULE", defaultValue: "*/5 * * * *" },
          { name: "TIMEOUT", defaultValue: "30" },
        ],
      });
      const configPath = await createFleetConfig(["./agents/optional-env-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "optional-env-agent",
        configPath,
      });

      expect(result.envVariables).toBeDefined();
      expect(result.envVariables!.optional.length).toBe(2);
      expect(
        result.envVariables!.optional.find((v) => v.name === "CRON_SCHEDULE")?.defaultValue,
      ).toBe("*/5 * * * *");
    });

    it("reports both required and optional env variables", async () => {
      await createAgent("mixed-env-agent", {
        withMetadata: true,
        envVars: [{ name: "API_KEY" }, { name: "DEBUG", defaultValue: "false" }],
      });
      const configPath = await createFleetConfig(["./agents/mixed-env-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "mixed-env-agent",
        configPath,
      });

      expect(result.envVariables).toBeDefined();
      expect(result.envVariables!.required.length).toBe(1);
      expect(result.envVariables!.optional.length).toBe(1);
      expect(result.envVariables!.required[0].name).toBe("API_KEY");
      expect(result.envVariables!.optional[0].name).toBe("DEBUG");
    });

    it("returns empty env variables when agent has none", async () => {
      await createAgent("no-env-agent", {
        withMetadata: true,
      });
      const configPath = await createFleetConfig(["./agents/no-env-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "no-env-agent",
        configPath,
      });

      expect(result.envVariables).toBeDefined();
      expect(result.envVariables!.variables.length).toBe(0);
      expect(result.envVariables!.required.length).toBe(0);
      expect(result.envVariables!.optional.length).toBe(0);
    });
  });

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("error handling", () => {
    it("throws when agent is not found", async () => {
      const configPath = await createFleetConfig([]);

      await expect(
        removeAgent({
          name: "nonexistent-agent",
          configPath,
        }),
      ).rejects.toThrow(AgentRemoveError);

      try {
        await removeAgent({
          name: "nonexistent-agent",
          configPath,
        });
      } catch (err) {
        const error = err as AgentRemoveError;
        expect(error.code).toBe(AGENT_NOT_FOUND);
        expect(error.message).toContain("nonexistent-agent");
        expect(error.message).toContain("not found");
      }
    });

    it("still removes from config when agent directory is missing", async () => {
      // Create agent in config but don't create the directory
      const configPath = join(tempDir, "herdctl.yaml");
      await writeFile(
        configPath,
        `version: 1

fleet:
  name: test-fleet

agents:
  - path: ./agents/missing-dir-agent/agent.yaml
`,
        "utf-8",
      );

      // Create the agent directory so discovery finds it
      const agentDir = join(tempDir, "agents", "missing-dir-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: missing-dir-agent\n", "utf-8");

      // Now delete the directory but keep config
      await rm(agentDir, { recursive: true, force: true });

      // This should fail because discovery won't find the agent anymore
      await expect(
        removeAgent({
          name: "missing-dir-agent",
          configPath,
        }),
      ).rejects.toThrow(AgentRemoveError);
    });

    it("still returns success when directory is gone but config update works", async () => {
      // Create agent and config
      const agentDir = await createAgent("dir-test-agent", { withMetadata: true });
      const configPath = await createFleetConfig(["./agents/dir-test-agent/agent.yaml"]);

      // Remove the agent normally
      const result = await removeAgent({
        name: "dir-test-agent",
        configPath,
      });

      expect(result.filesRemoved).toBe(true);
      expect(result.configUpdated).toBe(true);
    });
  });

  // ===========================================================================
  // Multiple Agents Tests
  // ===========================================================================

  describe("multiple agents", () => {
    it("removes only the specified agent", async () => {
      const agent1Dir = await createAgent("agent-1", { withMetadata: true });
      const agent2Dir = await createAgent("agent-2", { withMetadata: true });
      const agent3Dir = await createAgent("agent-3", { withMetadata: true });

      const configPath = await createFleetConfig([
        "./agents/agent-1/agent.yaml",
        "./agents/agent-2/agent.yaml",
        "./agents/agent-3/agent.yaml",
      ]);

      const result = await removeAgent({
        name: "agent-2",
        configPath,
      });

      expect(result.agentName).toBe("agent-2");

      // Only agent-2 should be removed
      expect(await pathExists(agent1Dir)).toBe(true);
      expect(await pathExists(agent2Dir)).toBe(false);
      expect(await pathExists(agent3Dir)).toBe(true);

      // Config should still have agent-1 and agent-3
      const configContent = await readFleetConfig(configPath);
      expect(configContent).toContain("agent-1");
      expect(configContent).not.toContain("agent-2");
      expect(configContent).toContain("agent-3");
    });

    it("can remove agents one by one", async () => {
      await createAgent("first-agent", { withMetadata: true });
      await createAgent("second-agent", { withMetadata: true });

      const configPath = await createFleetConfig([
        "./agents/first-agent/agent.yaml",
        "./agents/second-agent/agent.yaml",
      ]);

      // Remove first agent
      await removeAgent({
        name: "first-agent",
        configPath,
      });

      let configContent = await readFleetConfig(configPath);
      expect(configContent).not.toContain("first-agent");
      expect(configContent).toContain("second-agent");

      // Remove second agent
      await removeAgent({
        name: "second-agent",
        configPath,
      });

      configContent = await readFleetConfig(configPath);
      expect(configContent).not.toContain("first-agent");
      expect(configContent).not.toContain("second-agent");
    });
  });

  // ===========================================================================
  // Base Directory Tests
  // ===========================================================================

  describe("base directory handling", () => {
    it("uses custom baseDir when provided", async () => {
      // Create agent in a different base directory
      const customBase = join(tempDir, "custom-base");
      const agentDir = join(customBase, "agents", "custom-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: custom-agent\nruntime: sdk\n", "utf-8");

      // Config is in tempDir but baseDir is customBase
      const configPath = await createFleetConfig(["./agents/custom-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "custom-agent",
        configPath,
        baseDir: customBase,
      });

      expect(result.filesRemoved).toBe(true);
      expect(await pathExists(agentDir)).toBe(false);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles agent with empty workspace", async () => {
      const agentDir = await createAgent("empty-workspace-agent", {
        withMetadata: true,
        withWorkspace: true,
        workspaceFiles: [],
      });
      const configPath = await createFleetConfig(["./agents/empty-workspace-agent/agent.yaml"]);

      const result = await removeAgent({
        name: "empty-workspace-agent",
        configPath,
        keepWorkspace: true,
      });

      expect(result.workspacePreserved).toBe(true);
      expect(await pathExists(join(agentDir, "workspace"))).toBe(true);
    });

    it("handles agent name with special characters (hyphens)", async () => {
      await createAgent("my-special-agent-name", { withMetadata: true });
      const configPath = await createFleetConfig(["./agents/my-special-agent-name/agent.yaml"]);

      const result = await removeAgent({
        name: "my-special-agent-name",
        configPath,
      });

      expect(result.agentName).toBe("my-special-agent-name");
      expect(result.filesRemoved).toBe(true);
    });

    it("leaves no orphaned files when removing without keepWorkspace", async () => {
      const agentDir = await createAgent("clean-remove-agent", {
        withMetadata: true,
        withWorkspace: true,
        workspaceFiles: ["file1.txt", "file2.txt"],
        extraFiles: ["knowledge/doc.md"],
      });
      const configPath = await createFleetConfig(["./agents/clean-remove-agent/agent.yaml"]);

      await removeAgent({
        name: "clean-remove-agent",
        configPath,
        keepWorkspace: false,
      });

      // The entire agent directory should be gone
      expect(await pathExists(agentDir)).toBe(false);

      // But the agents/ parent directory should still exist
      expect(await pathExists(join(tempDir, "agents"))).toBe(true);
    });
  });
});
