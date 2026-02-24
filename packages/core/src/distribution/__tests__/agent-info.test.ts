/**
 * Tests for agent info module
 *
 * Uses real file I/O with temporary directories to test agent info gathering.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAgentInfo } from "../agent-info.js";
import type { InstallationMetadata } from "../installation-metadata.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("getAgentInfo", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-agent-info-"));
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
  async function createFleetConfig(agentPaths: string[] = []): Promise<string> {
    const agentsYaml =
      agentPaths.length > 0 ? agentPaths.map((p) => `  - path: ${p}`).join("\n") : "";

    const content = `version: 1

fleet:
  name: test-fleet

agents:
${agentsYaml}
`;

    const configPath = join(tempDir, "herdctl.yaml");
    await writeFile(configPath, content, "utf-8");
    return configPath;
  }

  /**
   * Create an agent directory with optional components
   */
  async function createAgent(
    name: string,
    options: {
      description?: string;
      withMetadata?: boolean;
      metadata?: Partial<InstallationMetadata>;
      withHerdctlJson?: boolean;
      herdctlJson?: Record<string, unknown>;
      withWorkspace?: boolean;
      withEnvVars?: boolean;
      envVars?: { required?: string[]; optional?: Record<string, string> };
      withSchedules?: boolean;
      schedules?: Record<string, unknown>;
      additionalFiles?: Record<string, string>;
    } = {},
  ): Promise<string> {
    const agentDir = join(tempDir, "agents", name);
    await mkdir(agentDir, { recursive: true });

    // Build agent.yaml content
    let agentYaml = `name: ${name}
permission_mode: default
runtime: sdk
`;
    if (options.description) {
      agentYaml += `description: "${options.description}"\n`;
    }

    // Add environment variables if requested
    if (options.withEnvVars || options.envVars) {
      const envConfig = options.envVars ?? { required: ["API_KEY"] };
      agentYaml += "env:\n";
      if (envConfig.required) {
        for (const varName of envConfig.required) {
          agentYaml += `  ${varName.toLowerCase()}: \${${varName}}\n`;
        }
      }
      if (envConfig.optional) {
        for (const [varName, defaultValue] of Object.entries(envConfig.optional)) {
          agentYaml += `  ${varName.toLowerCase()}: \${${varName}:-${defaultValue}}\n`;
        }
      }
    }

    // Add schedules if requested
    if (options.withSchedules || options.schedules) {
      const scheduleConfig = options.schedules ?? {
        daily: { type: "cron", cron: "0 0 * * *" },
      };
      agentYaml += "schedules:\n";
      for (const [scheduleName, scheduleValue] of Object.entries(scheduleConfig)) {
        if (typeof scheduleValue === "object" && scheduleValue !== null) {
          agentYaml += `  ${scheduleName}:\n`;
          for (const [key, value] of Object.entries(scheduleValue)) {
            agentYaml += `    ${key}: "${value}"\n`;
          }
        }
      }
    }

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
      const herdctlJson = options.herdctlJson ?? {
        name,
        version: "1.0.0",
        description: `${name} agent`,
        author: "test-author",
      };
      await writeFile(
        join(agentDir, "herdctl.json"),
        JSON.stringify(herdctlJson, null, 2),
        "utf-8",
      );
    }

    // Create workspace directory if requested
    if (options.withWorkspace) {
      await mkdir(join(agentDir, "workspace"), { recursive: true });
    }

    // Create additional files if provided
    if (options.additionalFiles) {
      for (const [filePath, content] of Object.entries(options.additionalFiles)) {
        const fullPath = join(agentDir, filePath);
        await mkdir(join(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, content, "utf-8");
      }
    }

    return agentDir;
  }

  // ===========================================================================
  // Agent Not Found Tests
  // ===========================================================================

  describe("agent not found", () => {
    it("returns null when agent does not exist", async () => {
      const configPath = await createFleetConfig([]);

      const result = await getAgentInfo({
        name: "nonexistent-agent",
        configPath,
      });

      expect(result).toBeNull();
    });

    it("returns null when agent name does not match any discovered agent", async () => {
      await createAgent("my-agent");
      const configPath = await createFleetConfig(["./agents/my-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "other-agent",
        configPath,
      });

      expect(result).toBeNull();
    });

    it("returns null when config file does not exist", async () => {
      const result = await getAgentInfo({
        name: "any-agent",
        configPath: join(tempDir, "nonexistent.yaml"),
      });

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Basic Installed Agent Tests
  // ===========================================================================

  describe("basic installed agent", () => {
    it("returns full info for installed agent with metadata", async () => {
      await createAgent("my-agent", {
        description: "A helpful agent",
        withMetadata: true,
        metadata: {
          source: {
            type: "github",
            url: "https://github.com/user/my-agent",
            ref: "v1.0.0",
            version: "1.0.0",
          },
          installed_at: "2024-01-15T10:30:00Z",
          installed_by: "herdctl@0.5.0",
        },
      });
      const configPath = await createFleetConfig(["./agents/my-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "my-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("my-agent");
      expect(result!.description).toBe("A helpful agent");
      expect(result!.installed).toBe(true);
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata?.source.type).toBe("github");
      expect(result!.metadata?.source.url).toBe("https://github.com/user/my-agent");
      expect(result!.metadata?.source.ref).toBe("v1.0.0");
      expect(result!.metadata?.installed_at).toBe("2024-01-15T10:30:00Z");
      expect(result!.version).toBe("1.0.0");
      expect(result!.configPath).toBe("./agents/my-agent/agent.yaml");
      expect(result!.path).toBe(join(tempDir, "agents", "my-agent"));
    });

    it("includes files list", async () => {
      await createAgent("files-agent", {
        additionalFiles: {
          "CLAUDE.md": "# Agent Instructions",
          "knowledge/guide.md": "# Guide content",
        },
      });
      const configPath = await createFleetConfig(["./agents/files-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "files-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.files).toContain("agent.yaml");
      expect(result!.files).toContain("CLAUDE.md");
      expect(result!.files).toContain(join("knowledge", "guide.md"));
      // Files should be sorted
      expect(result!.files).toEqual([...result!.files].sort());
    });
  });

  // ===========================================================================
  // Manual Agent Tests
  // ===========================================================================

  describe("manual (non-installed) agent", () => {
    it("returns info with installed: false and no metadata", async () => {
      await createAgent("manual-agent", {
        description: "A manually created agent",
      });
      const configPath = await createFleetConfig(["./agents/manual-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "manual-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("manual-agent");
      expect(result!.installed).toBe(false);
      expect(result!.metadata).toBeUndefined();
      expect(result!.version).toBeUndefined();
    });
  });

  // ===========================================================================
  // herdctl.json Tests
  // ===========================================================================

  describe("agent with herdctl.json", () => {
    it("includes repoMetadata from valid herdctl.json", async () => {
      await createAgent("repo-agent", {
        withHerdctlJson: true,
        herdctlJson: {
          name: "repo-agent",
          version: "2.0.0",
          description: "An agent with repo metadata",
          author: "test-author",
          repository: "github:user/repo-agent",
          license: "MIT",
          keywords: ["test", "monitoring"],
        },
      });
      const configPath = await createFleetConfig(["./agents/repo-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "repo-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.repoMetadata).toBeDefined();
      expect(result!.repoMetadata?.name).toBe("repo-agent");
      expect(result!.repoMetadata?.version).toBe("2.0.0");
      expect(result!.repoMetadata?.description).toBe("An agent with repo metadata");
      expect(result!.repoMetadata?.author).toBe("test-author");
      expect(result!.repoMetadata?.license).toBe("MIT");
      expect(result!.repoMetadata?.keywords).toEqual(["test", "monitoring"]);
    });

    it("handles invalid herdctl.json gracefully (no repoMetadata)", async () => {
      await createAgent("invalid-json-agent");
      const agentDir = join(tempDir, "agents", "invalid-json-agent");
      // Write invalid JSON
      await writeFile(join(agentDir, "herdctl.json"), "{ invalid json }", "utf-8");
      const configPath = await createFleetConfig(["./agents/invalid-json-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "invalid-json-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.repoMetadata).toBeUndefined();
    });

    it("handles herdctl.json that fails schema validation (missing required fields)", async () => {
      await createAgent("bad-schema-agent");
      const agentDir = join(tempDir, "agents", "bad-schema-agent");
      // Write JSON that is valid but doesn't match schema (missing required fields)
      await writeFile(
        join(agentDir, "herdctl.json"),
        JSON.stringify({ name: "bad-schema-agent" }), // Missing version, description, author
        "utf-8",
      );
      const configPath = await createFleetConfig(["./agents/bad-schema-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "bad-schema-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.repoMetadata).toBeUndefined();
    });
  });

  // ===========================================================================
  // Environment Variables Tests
  // ===========================================================================

  describe("agent with environment variables", () => {
    it("includes envVariables from agent.yaml", async () => {
      await createAgent("env-agent", {
        withEnvVars: true,
        envVars: {
          required: ["DISCORD_WEBHOOK_URL", "WEBSITES"],
          optional: { CRON_SCHEDULE: "*/5 * * * *" },
        },
      });
      const configPath = await createFleetConfig(["./agents/env-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "env-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.envVariables).toBeDefined();
      expect(result!.envVariables!.variables).toHaveLength(3);

      // Check required vars
      const requiredNames = result!.envVariables!.required.map((v) => v.name);
      expect(requiredNames).toContain("DISCORD_WEBHOOK_URL");
      expect(requiredNames).toContain("WEBSITES");

      // Check optional vars
      const optionalNames = result!.envVariables!.optional.map((v) => v.name);
      expect(optionalNames).toContain("CRON_SCHEDULE");
      const cronVar = result!.envVariables!.optional.find((v) => v.name === "CRON_SCHEDULE");
      expect(cronVar?.defaultValue).toBe("*/5 * * * *");
    });

    it("returns undefined envVariables when no env vars in agent.yaml", async () => {
      await createAgent("no-env-agent");
      const configPath = await createFleetConfig(["./agents/no-env-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "no-env-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.envVariables).toBeUndefined();
    });
  });

  // ===========================================================================
  // Schedules Tests
  // ===========================================================================

  describe("agent with schedules", () => {
    it("includes schedules from agent.yaml", async () => {
      await createAgent("scheduled-agent", {
        withSchedules: true,
        schedules: {
          "check-websites": { type: "cron", cron: "*/5 * * * *" },
          "daily-report": { type: "cron", cron: "0 9 * * *" },
        },
      });
      const configPath = await createFleetConfig(["./agents/scheduled-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "scheduled-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.schedules).toBeDefined();
      expect(Object.keys(result!.schedules!)).toContain("check-websites");
      expect(Object.keys(result!.schedules!)).toContain("daily-report");
    });

    it("returns undefined schedules when no schedules in agent.yaml", async () => {
      await createAgent("no-schedule-agent");
      const configPath = await createFleetConfig(["./agents/no-schedule-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "no-schedule-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.schedules).toBeUndefined();
    });
  });

  // ===========================================================================
  // Workspace Tests
  // ===========================================================================

  describe("agent workspace directory", () => {
    it("has hasWorkspace true when workspace directory exists", async () => {
      await createAgent("workspace-agent", {
        withWorkspace: true,
      });
      const configPath = await createFleetConfig(["./agents/workspace-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "workspace-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.hasWorkspace).toBe(true);
    });

    it("has hasWorkspace false when no workspace directory", async () => {
      await createAgent("no-workspace-agent");
      const configPath = await createFleetConfig(["./agents/no-workspace-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "no-workspace-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.hasWorkspace).toBe(false);
    });
  });

  // ===========================================================================
  // File Listing Tests
  // ===========================================================================

  describe("file listing", () => {
    it("lists all files in agent directory", async () => {
      await createAgent("full-agent", {
        withMetadata: true,
        withHerdctlJson: true,
        herdctlJson: {
          name: "full-agent",
          version: "1.0.0",
          description: "Test agent",
          author: "test",
        },
        additionalFiles: {
          "CLAUDE.md": "# Instructions",
          "README.md": "# Readme",
          "knowledge/guide.md": "# Guide",
          "scripts/setup.sh": "#!/bin/bash\necho hello",
        },
      });
      const configPath = await createFleetConfig(["./agents/full-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "full-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.files).toContain("agent.yaml");
      expect(result!.files).toContain("metadata.json");
      expect(result!.files).toContain("herdctl.json");
      expect(result!.files).toContain("CLAUDE.md");
      expect(result!.files).toContain("README.md");
      expect(result!.files).toContain(join("knowledge", "guide.md"));
      expect(result!.files).toContain(join("scripts", "setup.sh"));
    });

    it("excludes .git and node_modules directories from file listing", async () => {
      await createAgent("git-agent", {
        additionalFiles: {
          ".git/config": "git config",
          ".git/HEAD": "ref: refs/heads/main",
          "node_modules/package/index.js": "module.exports = {}",
          "real-file.md": "# Real file",
        },
      });
      const configPath = await createFleetConfig(["./agents/git-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "git-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.files).toContain("real-file.md");
      expect(result!.files).not.toContain(".git/config");
      expect(result!.files).not.toContain(".git/HEAD");
      expect(result!.files).not.toContain("node_modules/package/index.js");
      // Check no files from excluded dirs
      expect(result!.files.some((f) => f.startsWith(".git"))).toBe(false);
      expect(result!.files.some((f) => f.startsWith("node_modules"))).toBe(false);
    });

    it("returns sorted file list", async () => {
      await createAgent("sort-agent", {
        additionalFiles: {
          "z-file.md": "Z",
          "a-file.md": "A",
          "m-file.md": "M",
        },
      });
      const configPath = await createFleetConfig(["./agents/sort-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "sort-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      const sortedFiles = [...result!.files].sort();
      expect(result!.files).toEqual(sortedFiles);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles agent with all optional fields present", async () => {
      await createAgent("complete-agent", {
        description: "A complete agent with everything",
        withMetadata: true,
        metadata: {
          source: {
            type: "github",
            url: "https://github.com/org/complete-agent",
            ref: "v2.0.0",
            version: "2.0.0",
          },
          installed_at: "2024-02-15T10:30:00Z",
          installed_by: "herdctl@1.0.0",
        },
        withHerdctlJson: true,
        herdctlJson: {
          name: "complete-agent",
          version: "2.0.0",
          description: "Complete agent description",
          author: "complete-author",
          keywords: ["complete", "test"],
        },
        withWorkspace: true,
        withEnvVars: true,
        envVars: {
          required: ["API_KEY"],
          optional: { DEBUG: "false" },
        },
        withSchedules: true,
        schedules: {
          hourly: { type: "cron", cron: "0 * * * *" },
        },
        additionalFiles: {
          "CLAUDE.md": "# Complete Instructions",
        },
      });
      const configPath = await createFleetConfig(["./agents/complete-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "complete-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("complete-agent");
      expect(result!.description).toBe("A complete agent with everything");
      expect(result!.installed).toBe(true);
      expect(result!.metadata).toBeDefined();
      expect(result!.version).toBe("2.0.0");
      expect(result!.repoMetadata).toBeDefined();
      expect(result!.envVariables).toBeDefined();
      expect(result!.schedules).toBeDefined();
      expect(result!.hasWorkspace).toBe(true);
      expect(result!.files.length).toBeGreaterThan(0);
    });

    it("handles agent with minimal fields (just name)", async () => {
      const agentDir = join(tempDir, "agents", "minimal-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: minimal-agent\n", "utf-8");
      const configPath = await createFleetConfig(["./agents/minimal-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "minimal-agent",
        configPath,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("minimal-agent");
      expect(result!.description).toBeUndefined();
      expect(result!.installed).toBe(false);
      expect(result!.metadata).toBeUndefined();
      expect(result!.version).toBeUndefined();
      expect(result!.repoMetadata).toBeUndefined();
      expect(result!.envVariables).toBeUndefined();
      expect(result!.schedules).toBeUndefined();
      expect(result!.hasWorkspace).toBe(false);
      expect(result!.files).toContain("agent.yaml");
    });

    it("uses custom baseDir when provided", async () => {
      // Create agent in a different base directory
      const customBase = join(tempDir, "custom-base");
      const agentDir = join(customBase, "agents", "custom-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, "agent.yaml"), "name: custom-agent\nruntime: sdk\n", "utf-8");

      // Config is in tempDir but baseDir is customBase
      const configPath = await createFleetConfig(["./agents/custom-agent/agent.yaml"]);

      const result = await getAgentInfo({
        name: "custom-agent",
        configPath,
        baseDir: customBase,
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe("custom-agent");
      expect(result!.path).toBe(agentDir);
    });
  });
});
