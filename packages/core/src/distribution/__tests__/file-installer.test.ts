/**
 * Tests for file installer
 *
 * Uses real file I/O with temporary directories to test installation logic.
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ALREADY_EXISTS,
  AgentInstallError,
  INVALID_AGENT_NAME,
  INVALID_AGENT_YAML,
  installAgentFiles,
  MISSING_AGENT_YAML,
} from "../file-installer.js";
import type { InstallationMetadata, InstallationSource } from "../installation-metadata.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("installAgentFiles", () => {
  let sourceDir: string;
  let targetDir: string;

  beforeEach(async () => {
    // Create fresh temp directories for each test
    sourceDir = await mkdtemp(join(tmpdir(), "herdctl-installer-source-"));
    targetDir = await mkdtemp(join(tmpdir(), "herdctl-installer-target-"));
  });

  afterEach(async () => {
    // Clean up temp directories
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  /**
   * Minimal valid agent.yaml content
   */
  const minimalAgentYaml = `
name: test-agent
runtime: cli
`;

  /**
   * Standard source for metadata tracking
   */
  const standardSource: InstallationSource = {
    type: "github",
    url: "https://github.com/user/test-agent",
    ref: "v1.0.0",
  };

  /**
   * Helper to check if a path exists
   */
  async function pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper to read JSON file
   */
  async function readJsonFile<T>(filePath: string): Promise<T> {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  }

  // ===========================================================================
  // Successful Installation Tests
  // ===========================================================================

  describe("successful installation", () => {
    it("installs agent from source directory", async () => {
      // Setup source directory with minimal agent.yaml
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      expect(result.agentName).toBe("test-agent");
      expect(result.installPath).toBe(join(targetDir, "agents", "test-agent"));
      expect(result.copiedFiles).toContain("agent.yaml");
    });

    it("creates workspace directory", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      const workspacePath = join(result.installPath, "workspace");
      expect(await pathExists(workspacePath)).toBe(true);
    });

    it("writes valid metadata.json", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      const metadataPath = join(result.installPath, "metadata.json");
      expect(await pathExists(metadataPath)).toBe(true);

      const metadata = await readJsonFile<InstallationMetadata>(metadataPath);
      expect(metadata.source.type).toBe("github");
      expect(metadata.source.url).toBe("https://github.com/user/test-agent");
      expect(metadata.source.ref).toBe("v1.0.0");
      expect(metadata.installed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(metadata.installed_by).toMatch(/^herdctl@/);
    });

    it("excludes .git directory", async () => {
      // Setup source with .git directory
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await mkdir(join(sourceDir, ".git"), { recursive: true });
      await writeFile(join(sourceDir, ".git", "config"), "git config");
      await writeFile(join(sourceDir, ".git", "HEAD"), "ref: refs/heads/main");

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // .git should not exist in target
      expect(await pathExists(join(result.installPath, ".git"))).toBe(false);
      // agent.yaml should exist
      expect(await pathExists(join(result.installPath, "agent.yaml"))).toBe(true);
      // copiedFiles should not include .git entries
      expect(result.copiedFiles.some((f) => f.includes(".git"))).toBe(false);
    });

    it("excludes node_modules directory", async () => {
      // Setup source with node_modules directory
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await mkdir(join(sourceDir, "node_modules", "some-package"), { recursive: true });
      await writeFile(
        join(sourceDir, "node_modules", "some-package", "index.js"),
        "module.exports = {};",
      );

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // node_modules should not exist in target
      expect(await pathExists(join(result.installPath, "node_modules"))).toBe(false);
      // copiedFiles should not include node_modules entries
      expect(result.copiedFiles.some((f) => f.includes("node_modules"))).toBe(false);
    });

    it("handles nested directory structures", async () => {
      // Setup source with nested directories
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(sourceDir, "CLAUDE.md"), "# Agent");
      await mkdir(join(sourceDir, "knowledge"), { recursive: true });
      await writeFile(join(sourceDir, "knowledge", "guide.md"), "# Guide");
      await mkdir(join(sourceDir, "knowledge", "deep"), { recursive: true });
      await writeFile(join(sourceDir, "knowledge", "deep", "nested.md"), "# Nested");

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // All files should be copied
      expect(await pathExists(join(result.installPath, "agent.yaml"))).toBe(true);
      expect(await pathExists(join(result.installPath, "CLAUDE.md"))).toBe(true);
      expect(await pathExists(join(result.installPath, "knowledge", "guide.md"))).toBe(true);
      expect(await pathExists(join(result.installPath, "knowledge", "deep", "nested.md"))).toBe(
        true,
      );

      // copiedFiles should include all relative paths
      expect(result.copiedFiles).toContain("agent.yaml");
      expect(result.copiedFiles).toContain("CLAUDE.md");
      expect(result.copiedFiles).toContain(join("knowledge", "guide.md"));
      expect(result.copiedFiles).toContain(join("knowledge", "deep", "nested.md"));
    });

    it("works with --path override option", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const customPath = join(targetDir, "custom", "location", "my-agent");
      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
        targetPath: customPath,
      });

      expect(result.installPath).toBe(customPath);
      expect(await pathExists(join(customPath, "agent.yaml"))).toBe(true);
      expect(await pathExists(join(customPath, "workspace"))).toBe(true);
      expect(await pathExists(join(customPath, "metadata.json"))).toBe(true);
    });

    it("returns correct copiedFiles list", async () => {
      // Setup source with multiple files
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(sourceDir, "CLAUDE.md"), "# Identity");
      await writeFile(join(sourceDir, "README.md"), "# Docs");
      await writeFile(join(sourceDir, "herdctl.json"), "{}");

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      expect(result.copiedFiles).toHaveLength(4);
      expect(result.copiedFiles).toContain("agent.yaml");
      expect(result.copiedFiles).toContain("CLAUDE.md");
      expect(result.copiedFiles).toContain("README.md");
      expect(result.copiedFiles).toContain("herdctl.json");
    });

    it("handles local source type in metadata", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const localSource: InstallationSource = {
        type: "local",
        url: "/path/to/local/agent",
      };

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: localSource,
      });

      const metadata = await readJsonFile<InstallationMetadata>(
        join(result.installPath, "metadata.json"),
      );
      expect(metadata.source.type).toBe("local");
      expect(metadata.source.url).toBe("/path/to/local/agent");
    });
  });

  // ===========================================================================
  // Error: Agent Already Exists
  // ===========================================================================

  describe("agent already exists error", () => {
    it("errors when target already exists", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      // Create existing agent directory
      const existingPath = join(targetDir, "agents", "test-agent");
      await mkdir(existingPath, { recursive: true });
      await writeFile(join(existingPath, "agent.yaml"), minimalAgentYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(AGENT_ALREADY_EXISTS);
        expect(error.message).toContain("test-agent");
        expect(error.message).toContain("already exists");
      }
    });

    it("errors even if target is an empty directory", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      // Create existing empty directory
      const existingPath = join(targetDir, "agents", "test-agent");
      await mkdir(existingPath, { recursive: true });

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);
    });
  });

  // ===========================================================================
  // Error: Invalid Agent Name
  // ===========================================================================

  describe("invalid agent name error", () => {
    it("errors on agent name with spaces", async () => {
      const invalidNameYaml = `
name: "invalid name with spaces"
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), invalidNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_NAME);
        expect(error.message).toContain("Invalid agent name");
      }
    });

    it("errors on agent name starting with hyphen", async () => {
      const invalidNameYaml = `
name: "-starts-with-hyphen"
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), invalidNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_NAME);
      }
    });

    it("errors on agent name with special characters", async () => {
      const invalidNameYaml = `
name: "agent@name.with.dots"
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), invalidNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_NAME);
      }
    });

    it("errors on agent name with path traversal", async () => {
      const invalidNameYaml = `
name: "../../../etc/passwd"
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), invalidNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_NAME);
      }
    });

    it("allows valid agent names with underscores and hyphens", async () => {
      const validNameYaml = `
name: my-agent_v2
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), validNameYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      expect(result.agentName).toBe("my-agent_v2");
    });

    it("allows valid agent names starting with number", async () => {
      const validNameYaml = `
name: 2fast2furious
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), validNameYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      expect(result.agentName).toBe("2fast2furious");
    });
  });

  // ===========================================================================
  // Error: Missing agent.yaml
  // ===========================================================================

  describe("missing agent.yaml error", () => {
    it("errors on missing agent.yaml", async () => {
      // Don't create agent.yaml - empty source directory

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(MISSING_AGENT_YAML);
        expect(error.message).toContain("agent.yaml not found");
      }
    });

    it("errors when only other files exist", async () => {
      // Create other files but not agent.yaml
      await writeFile(join(sourceDir, "README.md"), "# Docs");
      await writeFile(join(sourceDir, "CLAUDE.md"), "# Identity");

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(MISSING_AGENT_YAML);
      }
    });
  });

  // ===========================================================================
  // Error: Invalid agent.yaml
  // ===========================================================================

  describe("invalid agent.yaml error", () => {
    it("errors on invalid YAML syntax", async () => {
      const invalidYaml = `
name: test-agent
  bad-indent: invalid
    nested: wrong
`;
      await writeFile(join(sourceDir, "agent.yaml"), invalidYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
        expect(error.message).toContain("Invalid YAML syntax");
      }
    });

    it("errors on empty agent.yaml", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), "");

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
      }
    });

    it("errors on agent.yaml without name field", async () => {
      const noNameYaml = `
description: An agent without a name
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), noNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
        expect(error.message).toContain("name");
      }
    });

    it("errors on agent.yaml with empty name", async () => {
      const emptyNameYaml = `
name: ""
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), emptyNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
      }
    });

    it("errors on agent.yaml with non-string name", async () => {
      const nonStringNameYaml = `
name: 123
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), nonStringNameYaml);

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
      }
    });

    it("errors on agent.yaml that is just a string", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), "just a string");

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
      }
    });

    it("errors on agent.yaml with only comments", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), "# Just a comment\n# Another comment");

      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);

      try {
        await installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        });
      } catch (err) {
        const error = err as AgentInstallError;
        expect(error.code).toBe(INVALID_AGENT_YAML);
      }
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles source with both .git and node_modules", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await mkdir(join(sourceDir, ".git", "objects"), { recursive: true });
      await mkdir(join(sourceDir, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(sourceDir, "src"), { recursive: true });
      await writeFile(join(sourceDir, ".git", "objects", "abc123"), "blob");
      await writeFile(join(sourceDir, "node_modules", "pkg", "index.js"), "code");
      await writeFile(join(sourceDir, "src", "main.ts"), "export default {}");

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // Excluded directories should not exist
      expect(await pathExists(join(result.installPath, ".git"))).toBe(false);
      expect(await pathExists(join(result.installPath, "node_modules"))).toBe(false);

      // Other files should exist
      expect(await pathExists(join(result.installPath, "agent.yaml"))).toBe(true);
      expect(await pathExists(join(result.installPath, "src", "main.ts"))).toBe(true);
    });

    it("handles deeply nested excluded directories", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);
      await mkdir(join(sourceDir, "project", ".git", "hooks"), { recursive: true });
      await writeFile(join(sourceDir, "project", ".git", "hooks", "pre-commit"), "#!/bin/sh");
      await mkdir(join(sourceDir, "project", "lib"), { recursive: true });
      await writeFile(join(sourceDir, "project", "lib", "utils.ts"), "code");

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // .git in nested project should still be excluded
      expect(await pathExists(join(result.installPath, "project", ".git"))).toBe(false);
      // Other nested files should exist
      expect(await pathExists(join(result.installPath, "project", "lib", "utils.ts"))).toBe(true);
    });

    it("preserves file contents after copy", async () => {
      const yamlContent = `
name: test-agent
description: "A test agent for content verification"
runtime: cli
`;
      const readmeContent = "# Test Agent\n\nThis is the readme content.";
      const codeContent = 'export const VERSION = "1.0.0";';

      await writeFile(join(sourceDir, "agent.yaml"), yamlContent);
      await writeFile(join(sourceDir, "README.md"), readmeContent);
      await mkdir(join(sourceDir, "src"), { recursive: true });
      await writeFile(join(sourceDir, "src", "index.ts"), codeContent);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      // Verify content is preserved
      const copiedYaml = await readFile(join(result.installPath, "agent.yaml"), "utf-8");
      const copiedReadme = await readFile(join(result.installPath, "README.md"), "utf-8");
      const copiedCode = await readFile(join(result.installPath, "src", "index.ts"), "utf-8");

      expect(copiedYaml).toBe(yamlContent);
      expect(copiedReadme).toBe(readmeContent);
      expect(copiedCode).toBe(codeContent);
    });

    it("handles agent name that is just numbers", async () => {
      const numbersNameYaml = `
name: "123456"
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), numbersNameYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      expect(result.agentName).toBe("123456");
      expect(result.installPath).toBe(join(targetDir, "agents", "123456"));
    });

    it("handles whitespace in agent.yaml name (after trim)", async () => {
      // YAML will preserve the string including whitespace
      const whitespaceNameYaml = `
name: "  spaced  "
runtime: cli
`;
      await writeFile(join(sourceDir, "agent.yaml"), whitespaceNameYaml);

      // The name with spaces should fail validation
      await expect(
        installAgentFiles({
          sourceDir,
          targetBaseDir: targetDir,
          source: standardSource,
        }),
      ).rejects.toThrow(AgentInstallError);
    });
  });

  // ===========================================================================
  // Metadata Content Tests
  // ===========================================================================

  describe("metadata content", () => {
    it("includes all source fields in metadata", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const fullSource: InstallationSource = {
        type: "github",
        url: "https://github.com/org/repo",
        ref: "v2.0.0",
        version: "2.0.0",
      };

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: fullSource,
      });

      const metadata = await readJsonFile<InstallationMetadata>(
        join(result.installPath, "metadata.json"),
      );

      expect(metadata.source.type).toBe("github");
      expect(metadata.source.url).toBe("https://github.com/org/repo");
      expect(metadata.source.ref).toBe("v2.0.0");
      expect(metadata.source.version).toBe("2.0.0");
    });

    it("generates valid ISO 8601 timestamp", async () => {
      await writeFile(join(sourceDir, "agent.yaml"), minimalAgentYaml);

      const result = await installAgentFiles({
        sourceDir,
        targetBaseDir: targetDir,
        source: standardSource,
      });

      const metadata = await readJsonFile<InstallationMetadata>(
        join(result.installPath, "metadata.json"),
      );

      // Check it's a valid ISO 8601 timestamp
      const timestamp = new Date(metadata.installed_at);
      expect(timestamp).toBeInstanceOf(Date);
      expect(Number.isNaN(timestamp.getTime())).toBe(false);

      // Check it's recent (within last minute)
      const now = Date.now();
      const installedTime = timestamp.getTime();
      expect(now - installedTime).toBeLessThan(60000);
    });
  });
});
