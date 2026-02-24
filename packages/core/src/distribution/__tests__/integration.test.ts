/**
 * Integration Tests for Agent Distribution System
 *
 * These tests exercise the complete installation pipeline: source parsing,
 * file installation, fleet config updating, and env var scanning.
 *
 * Uses real filesystem operations with fixture data, no mocking.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Config loader for end-to-end testing
import { loadConfig } from "../../config/loader.js";
// Distribution modules
import { scanEnvVariables } from "../env-scanner.js";
import { AGENT_ALREADY_EXISTS, AgentInstallError, installAgentFiles } from "../file-installer.js";
import {
  addAgentToFleetConfig,
  CONFIG_NOT_FOUND,
  FleetConfigError,
} from "../fleet-config-updater.js";
import { fetchRepository } from "../repository-fetcher.js";
import { validateRepository } from "../repository-validator.js";
import { isLocalSource, parseSourceSpecifier } from "../source-specifier.js";

// =============================================================================
// Test Setup
// =============================================================================

const FIXTURE_DIR = path.resolve(__dirname, "fixtures", "sample-agent");

describe("Agent Distribution Integration", () => {
  let tempDir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "herdctl-integration-"));

    // Store original env values
    originalEnv.WEBSITES = process.env.WEBSITES;
    originalEnv.DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
    originalEnv.DOCKER_ENABLED = process.env.DOCKER_ENABLED;
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });

    // Restore original env values
    if (originalEnv.WEBSITES !== undefined) {
      process.env.WEBSITES = originalEnv.WEBSITES;
    } else {
      delete process.env.WEBSITES;
    }
    if (originalEnv.DISCORD_WEBHOOK_URL !== undefined) {
      process.env.DISCORD_WEBHOOK_URL = originalEnv.DISCORD_WEBHOOK_URL;
    } else {
      delete process.env.DISCORD_WEBHOOK_URL;
    }
    if (originalEnv.DOCKER_ENABLED !== undefined) {
      process.env.DOCKER_ENABLED = originalEnv.DOCKER_ENABLED;
    } else {
      delete process.env.DOCKER_ENABLED;
    }
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /**
   * Creates a minimal valid herdctl.yaml for testing
   */
  async function createMinimalFleetConfig(dir: string): Promise<string> {
    const configPath = path.join(dir, "herdctl.yaml");
    const content = `version: 1
agents: []
`;
    await fs.writeFile(configPath, content, "utf-8");
    return configPath;
  }

  /**
   * Creates a fleet config with the installed agent reference
   */
  async function createFleetConfigWithAgent(dir: string, agentPath: string): Promise<string> {
    const configPath = path.join(dir, "herdctl.yaml");
    const content = `version: 1
agents:
  - path: ${agentPath}
`;
    await fs.writeFile(configPath, content, "utf-8");
    return configPath;
  }

  // ===========================================================================
  // Test 1: Full Installation Flow from Local Path
  // ===========================================================================

  describe("full installation flow from local path", () => {
    it("completes the entire installation pipeline", async () => {
      // 1. Create project root with minimal herdctl.yaml
      const configPath = await createMinimalFleetConfig(tempDir);

      // 2. Parse source specifier (local path to fixture)
      const source = parseSourceSpecifier(FIXTURE_DIR);
      expect(source.type).toBe("local");
      expect(isLocalSource(source)).toBe(true);

      // 3. Fetch repository (copies local to temp)
      const fetchResult = await fetchRepository(source);
      expect(fetchResult.path).toBeTruthy();

      try {
        // 4. Validate the repository
        const validationResult = await validateRepository(fetchResult.path);
        expect(validationResult.valid).toBe(true);
        expect(validationResult.agentName).toBe("sample-agent");
        expect(validationResult.errors).toHaveLength(0);

        // 5. Install agent files
        const installResult = await installAgentFiles({
          sourceDir: fetchResult.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
        });

        expect(installResult.agentName).toBe("sample-agent");
        expect(installResult.installPath).toBe(path.join(tempDir, "agents", "sample-agent"));

        // 6. Verify files were copied
        const agentDir = installResult.installPath;

        // Check agent.yaml exists
        const agentYamlExists = await fs
          .access(path.join(agentDir, "agent.yaml"))
          .then(() => true)
          .catch(() => false);
        expect(agentYamlExists).toBe(true);

        // Check CLAUDE.md exists
        const claudeMdExists = await fs
          .access(path.join(agentDir, "CLAUDE.md"))
          .then(() => true)
          .catch(() => false);
        expect(claudeMdExists).toBe(true);

        // Check herdctl.json exists
        const herdctlJsonExists = await fs
          .access(path.join(agentDir, "herdctl.json"))
          .then(() => true)
          .catch(() => false);
        expect(herdctlJsonExists).toBe(true);

        // Check knowledge/guide.md exists
        const knowledgeExists = await fs
          .access(path.join(agentDir, "knowledge", "guide.md"))
          .then(() => true)
          .catch(() => false);
        expect(knowledgeExists).toBe(true);

        // Check workspace/ directory was created
        const workspaceExists = await fs
          .access(path.join(agentDir, "workspace"))
          .then(() => true)
          .catch(() => false);
        expect(workspaceExists).toBe(true);

        // Check metadata.json was created
        const metadataPath = path.join(agentDir, "metadata.json");
        const metadataContent = await fs.readFile(metadataPath, "utf-8");
        const metadata = JSON.parse(metadataContent);
        expect(metadata.source.type).toBe("local");
        expect(metadata.source.url).toBe(FIXTURE_DIR);
        expect(metadata.installed_at).toBeTruthy();
        expect(metadata.installed_by).toBeTruthy();

        // 7. Update fleet config to add agent reference
        const agentRelPath = "./agents/sample-agent/agent.yaml";
        const updateResult = await addAgentToFleetConfig({
          configPath,
          agentPath: agentRelPath,
        });

        expect(updateResult.modified).toBe(true);
        expect(updateResult.alreadyExists).toBe(false);

        // Verify the herdctl.yaml was updated
        const updatedConfig = await fs.readFile(configPath, "utf-8");
        expect(updatedConfig).toContain(agentRelPath);

        // 8. Scan env variables from installed agent.yaml
        const installedAgentYaml = await fs.readFile(path.join(agentDir, "agent.yaml"), "utf-8");
        const envScan = scanEnvVariables(installedAgentYaml);

        // The fixture uses env vars in string contexts (the prompt field)
        // but not in boolean fields (docker.enabled is a literal false)
        expect(envScan.required).toHaveLength(2);
        expect(envScan.required.map((v) => v.name).sort()).toEqual([
          "DISCORD_WEBHOOK_URL",
          "WEBSITES",
        ]);

        // No optional env vars in this fixture (docker.enabled is a literal boolean)
        expect(envScan.optional).toHaveLength(0);
      } finally {
        await fetchResult.cleanup();
      }
    });
  });

  // ===========================================================================
  // Test 2: Installed Agent is Loadable by loadConfig()
  // ===========================================================================

  describe("installed agent is loadable by loadConfig()", () => {
    it("loads the installed agent configuration successfully", async () => {
      // Set required env vars for interpolation
      process.env.WEBSITES = "https://example.com";
      process.env.DISCORD_WEBHOOK_URL = "https://discord.com/webhook/test";

      // 1. Fetch and install the agent
      const fetchResult = await fetchRepository({
        type: "local",
        path: FIXTURE_DIR,
      });

      try {
        const installResult = await installAgentFiles({
          sourceDir: fetchResult.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
        });

        // 2. Create herdctl.yaml that references the installed agent
        const agentRelPath = "./agents/sample-agent/agent.yaml";
        await createFleetConfigWithAgent(tempDir, agentRelPath);

        // 3. Load the config using the standard loader
        const configPath = path.join(tempDir, "herdctl.yaml");
        const config = await loadConfig(configPath, {
          envFile: false, // Don't auto-load .env
        });

        // 4. Verify the config loaded correctly
        expect(config.agents).toHaveLength(1);

        const agent = config.agents[0];
        expect(agent.name).toBe("sample-agent");
        expect(agent.runtime).toBe("cli");
        expect(agent.permission_mode).toBe("default");

        // Verify interpolation worked in the prompt string
        expect(agent.schedules?.heartbeat?.prompt).toContain("https://example.com");
        expect(agent.schedules?.heartbeat?.prompt).toContain("https://discord.com/webhook/test");

        // Docker.enabled is a literal false in the fixture (not an env var)
        expect(agent.docker?.enabled).toBe(false);

        // Verify qualified name (root-level agent)
        expect(agent.qualifiedName).toBe("sample-agent");
        expect(agent.fleetPath).toEqual([]);

        // Verify configPath is set
        expect(agent.configPath).toBe(path.join(installResult.installPath, "agent.yaml"));
      } finally {
        await fetchResult.cleanup();
      }
    });
  });

  // ===========================================================================
  // Test 3: Installation Rejects Existing Agent Directory
  // ===========================================================================

  describe("installation rejects existing agent directory", () => {
    it("throws AGENT_ALREADY_EXISTS when agent directory exists", async () => {
      // 1. Install once
      const fetchResult = await fetchRepository({
        type: "local",
        path: FIXTURE_DIR,
      });

      try {
        await installAgentFiles({
          sourceDir: fetchResult.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
        });

        // 2. Try to install again without force
        await expect(
          installAgentFiles({
            sourceDir: fetchResult.path,
            targetBaseDir: tempDir,
            source: {
              type: "local",
              url: FIXTURE_DIR,
            },
            force: false, // Explicitly false
          }),
        ).rejects.toThrow(AgentInstallError);

        // 3. Verify error code
        try {
          await installAgentFiles({
            sourceDir: fetchResult.path,
            targetBaseDir: tempDir,
            source: {
              type: "local",
              url: FIXTURE_DIR,
            },
          });
        } catch (err) {
          expect(err).toBeInstanceOf(AgentInstallError);
          expect((err as AgentInstallError).code).toBe(AGENT_ALREADY_EXISTS);
        }
      } finally {
        await fetchResult.cleanup();
      }
    });
  });

  // ===========================================================================
  // Test 4: Installation with --force Overwrites
  // ===========================================================================

  describe("installation with force overwrites", () => {
    it("successfully reinstalls when force is true", async () => {
      // 1. Install once
      const fetchResult1 = await fetchRepository({
        type: "local",
        path: FIXTURE_DIR,
      });

      let firstMetadataTime: string;

      try {
        const firstInstall = await installAgentFiles({
          sourceDir: fetchResult1.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
        });

        // Record the first installation time
        const firstMetadata = JSON.parse(
          await fs.readFile(path.join(firstInstall.installPath, "metadata.json"), "utf-8"),
        );
        firstMetadataTime = firstMetadata.installed_at;
      } finally {
        await fetchResult1.cleanup();
      }

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 2. Install again with force
      const fetchResult2 = await fetchRepository({
        type: "local",
        path: FIXTURE_DIR,
      });

      try {
        const secondInstall = await installAgentFiles({
          sourceDir: fetchResult2.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
          force: true,
        });

        // 3. Verify installation succeeded
        expect(secondInstall.agentName).toBe("sample-agent");

        // 4. Verify metadata was updated
        const secondMetadata = JSON.parse(
          await fs.readFile(path.join(secondInstall.installPath, "metadata.json"), "utf-8"),
        );
        expect(secondMetadata.installed_at).not.toBe(firstMetadataTime);
      } finally {
        await fetchResult2.cleanup();
      }
    });
  });

  // ===========================================================================
  // Test 5: Validation Stops Installation on Errors
  // ===========================================================================

  describe("validation stops installation on errors", () => {
    it("validateRepository returns errors for invalid repo", async () => {
      // Create a temp directory with no agent.yaml
      const invalidRepoDir = path.join(tempDir, "invalid-repo");
      await fs.mkdir(invalidRepoDir, { recursive: true });
      await fs.writeFile(
        path.join(invalidRepoDir, "README.md"),
        "# Invalid Agent\n\nNo agent.yaml here!",
      );

      // Validation should return errors
      const validationResult = await validateRepository(invalidRepoDir);
      expect(validationResult.valid).toBe(false);
      expect(validationResult.errors.length).toBeGreaterThan(0);
      expect(validationResult.errors.some((e) => e.code === "MISSING_AGENT_YAML")).toBe(true);
    });

    it("installAgentFiles errors on missing agent.yaml", async () => {
      // Create a temp directory with no agent.yaml
      const invalidRepoDir = path.join(tempDir, "invalid-repo");
      await fs.mkdir(invalidRepoDir, { recursive: true });
      await fs.writeFile(
        path.join(invalidRepoDir, "README.md"),
        "# Invalid Agent\n\nNo agent.yaml here!",
      );

      // Install should fail
      await expect(
        installAgentFiles({
          sourceDir: invalidRepoDir,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: invalidRepoDir,
          },
        }),
      ).rejects.toThrow(AgentInstallError);
    });
  });

  // ===========================================================================
  // Test 6: Fleet Config Already Has Agent Reference
  // ===========================================================================

  describe("fleet config already has the agent reference", () => {
    it("returns alreadyExists: true when adding duplicate reference", async () => {
      // 1. Create fleet config with agent already referenced
      const agentRelPath = "./agents/sample-agent/agent.yaml";
      const configPath = await createFleetConfigWithAgent(tempDir, agentRelPath);

      // 2. Try to add the same agent reference
      const result = await addAgentToFleetConfig({
        configPath,
        agentPath: agentRelPath,
      });

      // 3. Verify it was not modified
      expect(result.modified).toBe(false);
      expect(result.alreadyExists).toBe(true);
      expect(result.agentPath).toBe(agentRelPath);
    });

    it("does not duplicate agent reference on second add", async () => {
      // 1. Create minimal config
      const configPath = await createMinimalFleetConfig(tempDir);

      // 2. Add agent reference
      const agentRelPath = "./agents/sample-agent/agent.yaml";
      await addAgentToFleetConfig({
        configPath,
        agentPath: agentRelPath,
      });

      // 3. Try to add again
      const result = await addAgentToFleetConfig({
        configPath,
        agentPath: agentRelPath,
      });

      expect(result.modified).toBe(false);
      expect(result.alreadyExists).toBe(true);

      // 4. Verify config only has one reference
      const configContent = await fs.readFile(configPath, "utf-8");
      const matches = configContent.match(/sample-agent/g);
      expect(matches).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Test 7: Env Var Scanner Finds All Variables
  // ===========================================================================

  describe("env var scanner finds all variables", () => {
    it("correctly partitions required and optional variables", async () => {
      // Read the fixture agent.yaml
      const agentYaml = await fs.readFile(path.join(FIXTURE_DIR, "agent.yaml"), "utf-8");

      const result = scanEnvVariables(agentYaml);

      // The fixture has 2 env vars in the prompt string (WEBSITES and DISCORD_WEBHOOK_URL)
      // docker.enabled is a literal boolean (not an env var reference)
      expect(result.variables).toHaveLength(2);

      // Check required variables (no default)
      expect(result.required).toHaveLength(2);
      const requiredNames = result.required.map((v) => v.name).sort();
      expect(requiredNames).toEqual(["DISCORD_WEBHOOK_URL", "WEBSITES"]);

      // Verify required vars have no default
      for (const reqVar of result.required) {
        expect(reqVar.defaultValue).toBeUndefined();
      }

      // No optional variables in this fixture
      // (docker.enabled is a literal false, not ${DOCKER_ENABLED:-false})
      expect(result.optional).toHaveLength(0);
    });

    it("handles YAML content with no env vars", () => {
      const yamlContent = `
name: simple-agent
runtime: cli
description: No environment variables here
`;
      const result = scanEnvVariables(yamlContent);
      expect(result.variables).toHaveLength(0);
      expect(result.required).toHaveLength(0);
      expect(result.optional).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Additional Integration Tests
  // ===========================================================================

  describe("end-to-end error handling", () => {
    it("addAgentToFleetConfig throws when config file is missing", async () => {
      const nonExistentConfig = path.join(tempDir, "non-existent.yaml");

      await expect(
        addAgentToFleetConfig({
          configPath: nonExistentConfig,
          agentPath: "./agents/test/agent.yaml",
        }),
      ).rejects.toThrow(FleetConfigError);

      try {
        await addAgentToFleetConfig({
          configPath: nonExistentConfig,
          agentPath: "./agents/test/agent.yaml",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(FleetConfigError);
        expect((err as FleetConfigError).code).toBe(CONFIG_NOT_FOUND);
      }
    });

    it("validates and installs in correct order", async () => {
      // This test verifies the expected workflow: validate THEN install

      const fetchResult = await fetchRepository({
        type: "local",
        path: FIXTURE_DIR,
      });

      try {
        // Step 1: Validate
        const validation = await validateRepository(fetchResult.path);
        expect(validation.valid).toBe(true);

        // Only proceed if validation passes
        if (!validation.valid) {
          throw new Error("Validation failed unexpectedly");
        }

        // Step 2: Install
        const install = await installAgentFiles({
          sourceDir: fetchResult.path,
          targetBaseDir: tempDir,
          source: {
            type: "local",
            url: FIXTURE_DIR,
          },
        });

        // Step 3: Verify the agent name matches
        expect(install.agentName).toBe(validation.agentName);
      } finally {
        await fetchResult.cleanup();
      }
    });
  });

  describe("repository fetcher integration", () => {
    it("local source fetch copies all files correctly", async () => {
      const source = parseSourceSpecifier(FIXTURE_DIR);
      expect(isLocalSource(source)).toBe(true);

      const fetchResult = await fetchRepository(source);

      try {
        // Verify the temp directory contains the expected files
        const files = await fs.readdir(fetchResult.path, { recursive: true });

        // Should have agent.yaml, CLAUDE.md, herdctl.json, knowledge/guide.md
        expect(files).toContain("agent.yaml");
        expect(files).toContain("CLAUDE.md");
        expect(files).toContain("herdctl.json");
        // Note: readdir with recursive returns relative paths with path separators
        expect(files.some((f) => f.includes("guide.md"))).toBe(true);
      } finally {
        await fetchResult.cleanup();
      }
    });
  });
});
