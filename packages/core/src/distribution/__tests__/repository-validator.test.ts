/**
 * Tests for repository validator
 *
 * Uses real file I/O with temporary directories to test validation logic.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DOCKER_NETWORK_NONE,
  INVALID_AGENT_YAML,
  INVALID_HERDCTL_JSON,
  JSON_PARSE_ERROR,
  MISSING_AGENT_YAML,
  MISSING_CLAUDE_MD,
  MISSING_HERDCTL_JSON,
  MISSING_README,
  NAME_MISMATCH,
  validateRepository,
  YAML_PARSE_ERROR,
} from "../repository-validator.js";

// =============================================================================
// Test Setup
// =============================================================================

describe("validateRepository", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-validator-test-"));
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
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
   * Valid agent.yaml with docker enabled (no network field - that's fleet-level)
   */
  const agentYamlWithDocker = `
name: test-agent
runtime: cli
docker:
  enabled: true
  memory: 2g
`;

  /**
   * Agent.yaml with docker.network: none (invalid - also network field is not allowed in agent.yaml)
   */
  const agentYamlWithNetworkNone = `
name: test-agent
runtime: cli
docker:
  enabled: true
  network: none
`;

  /**
   * Minimal valid herdctl.json content
   */
  const minimalHerdctlJson = JSON.stringify({
    name: "test-agent",
    version: "1.0.0",
    description: "A test agent",
    author: "Test Author",
  });

  /**
   * herdctl.json with different name than agent.yaml
   */
  const herdctlJsonDifferentName = JSON.stringify({
    name: "different-name",
    version: "1.0.0",
    description: "A test agent",
    author: "Test Author",
  });

  // ===========================================================================
  // Valid Repository Tests
  // ===========================================================================

  describe("valid repositories", () => {
    it("validates a minimal repo with only agent.yaml", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.agentName).toBe("test-agent");
      expect(result.agentConfig).not.toBeNull();
      expect(result.agentConfig?.name).toBe("test-agent");
      expect(result.agentConfig?.runtime).toBe("cli");
      expect(result.errors).toHaveLength(0);
      // Should have warnings for missing optional files
      expect(result.warnings.some((w) => w.code === MISSING_HERDCTL_JSON)).toBe(true);
      expect(result.warnings.some((w) => w.code === MISSING_CLAUDE_MD)).toBe(true);
      expect(result.warnings.some((w) => w.code === MISSING_README)).toBe(true);
    });

    it("validates a repo with agent.yaml and herdctl.json", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "herdctl.json"), minimalHerdctlJson);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.agentName).toBe("test-agent");
      expect(result.repoMetadata).not.toBeNull();
      expect(result.repoMetadata?.name).toBe("test-agent");
      expect(result.repoMetadata?.version).toBe("1.0.0");
      expect(result.errors).toHaveLength(0);
      // Should not have warning for missing herdctl.json
      expect(result.warnings.some((w) => w.code === MISSING_HERDCTL_JSON)).toBe(false);
    });

    it("validates a repo with all recommended files", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "herdctl.json"), minimalHerdctlJson);
      await writeFile(join(tempDir, "CLAUDE.md"), "# Test Agent\n\nYou are a test agent.");
      await writeFile(join(tempDir, "README.md"), "# Test Agent\n\nA test agent.");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      // Should have no warnings for missing files
      expect(result.warnings.some((w) => w.code === MISSING_HERDCTL_JSON)).toBe(false);
      expect(result.warnings.some((w) => w.code === MISSING_CLAUDE_MD)).toBe(false);
      expect(result.warnings.some((w) => w.code === MISSING_README)).toBe(false);
    });

    it("validates a repo with docker enabled", async () => {
      await writeFile(join(tempDir, "agent.yaml"), agentYamlWithDocker);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.agentConfig?.docker?.enabled).toBe(true);
      expect(result.agentConfig?.docker?.memory).toBe("2g");
      expect(result.errors).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Missing agent.yaml Tests
  // ===========================================================================

  describe("missing agent.yaml", () => {
    it("reports error when agent.yaml is missing", async () => {
      // Empty directory - no files

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.agentName).toBeNull();
      expect(result.agentConfig).toBeNull();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe(MISSING_AGENT_YAML);
      expect(result.errors[0].path).toBe("agent.yaml");
      expect(result.errors[0].message).toContain("Required file agent.yaml not found");
    });

    it("reports error even if herdctl.json exists without agent.yaml", async () => {
      await writeFile(join(tempDir, "herdctl.json"), minimalHerdctlJson);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === MISSING_AGENT_YAML)).toBe(true);
    });
  });

  // ===========================================================================
  // Invalid YAML Tests
  // ===========================================================================

  describe("invalid YAML in agent.yaml", () => {
    it("reports error for invalid YAML syntax", async () => {
      const invalidYaml = `
name: test-agent
  bad-indent: this is wrong
    nested: invalid
`;
      await writeFile(join(tempDir, "agent.yaml"), invalidYaml);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.agentName).toBeNull();
      expect(result.agentConfig).toBeNull();
      expect(result.errors.some((e) => e.code === YAML_PARSE_ERROR)).toBe(true);
      expect(result.errors[0].path).toBe("agent.yaml");
      expect(result.errors[0].message).toContain("Invalid YAML syntax");
    });

    it("reports error for truncated YAML", async () => {
      const truncatedYaml = `name: test
schedules:
  check:
    type: cron
    cron: "* * * * *
`; // Missing closing quote
      await writeFile(join(tempDir, "agent.yaml"), truncatedYaml);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === YAML_PARSE_ERROR)).toBe(true);
    });
  });

  // ===========================================================================
  // Schema Validation Tests
  // ===========================================================================

  describe("agent.yaml schema validation", () => {
    it("reports error when required fields are missing", async () => {
      // Missing 'name' field
      const missingName = `
description: A test agent
`;
      await writeFile(join(tempDir, "agent.yaml"), missingName);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
      expect(result.errors[0].message).toContain("validation failed");
    });

    it("reports error for invalid agent name format", async () => {
      const invalidName = `
name: "invalid name with spaces"
runtime: cli
`;
      await writeFile(join(tempDir, "agent.yaml"), invalidName);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });

    it("reports error for unknown fields (strict schema)", async () => {
      const unknownField = `
name: test-agent
runtime: cli
unknown_field: should fail
`;
      await writeFile(join(tempDir, "agent.yaml"), unknownField);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });
  });

  // ===========================================================================
  // Docker Network None Tests
  // ===========================================================================

  describe("docker.network: none validation", () => {
    it("reports error when docker.network is none", async () => {
      await writeFile(join(tempDir, "agent.yaml"), agentYamlWithNetworkNone);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === DOCKER_NETWORK_NONE)).toBe(true);
      const networkError = result.errors.find((e) => e.code === DOCKER_NETWORK_NONE);
      expect(networkError?.message).toContain("Anthropic APIs");
      expect(networkError?.message).toContain("bridge");
      // Also gets schema validation error since network is not allowed in agent.yaml
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });

    it("reports error when docker.network is any value (network is fleet-level only)", async () => {
      // The 'network' field is not allowed in agent.yaml (it's a fleet-level setting)
      // This will get a schema validation error
      const withNetwork = `
name: test-agent
runtime: cli
docker:
  enabled: true
  network: bridge
`;
      await writeFile(join(tempDir, "agent.yaml"), withNetwork);

      const result = await validateRepository(tempDir);

      // Will fail due to unrecognized 'network' key in AgentDockerSchema
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });
  });

  // ===========================================================================
  // herdctl.json Validation Tests
  // ===========================================================================

  describe("herdctl.json validation", () => {
    it("reports error for invalid JSON syntax", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "herdctl.json"), "{ invalid json");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.repoMetadata).toBeNull();
      expect(result.errors.some((e) => e.code === JSON_PARSE_ERROR)).toBe(true);
      const jsonError = result.errors.find((e) => e.code === JSON_PARSE_ERROR);
      expect(jsonError?.path).toBe("herdctl.json");
    });

    it("reports error when herdctl.json fails schema validation", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      // Missing required fields (version, description, author)
      const invalidMetadata = JSON.stringify({ name: "test-agent" });
      await writeFile(join(tempDir, "herdctl.json"), invalidMetadata);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.repoMetadata).toBeNull();
      expect(result.errors.some((e) => e.code === INVALID_HERDCTL_JSON)).toBe(true);
      const schemaError = result.errors.find((e) => e.code === INVALID_HERDCTL_JSON);
      expect(schemaError?.message).toContain("validation failed");
    });

    it("reports error for invalid version format in herdctl.json", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      const badVersion = JSON.stringify({
        name: "test-agent",
        version: "not-a-semver",
        description: "Test",
        author: "Test",
      });
      await writeFile(join(tempDir, "herdctl.json"), badVersion);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_HERDCTL_JSON)).toBe(true);
    });
  });

  // ===========================================================================
  // Name Mismatch Tests
  // ===========================================================================

  describe("name mismatch warning", () => {
    it("warns when agent.yaml and herdctl.json have different names", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml); // name: test-agent
      await writeFile(join(tempDir, "herdctl.json"), herdctlJsonDifferentName); // name: different-name

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true); // Warning, not error
      expect(result.agentName).toBe("test-agent"); // Uses agent.yaml name
      expect(result.warnings.some((w) => w.code === NAME_MISMATCH)).toBe(true);
      const nameWarning = result.warnings.find((w) => w.code === NAME_MISMATCH);
      expect(nameWarning?.message).toContain("test-agent");
      expect(nameWarning?.message).toContain("different-name");
      expect(nameWarning?.message).toContain("agent.yaml will be used");
    });

    it("does not warn when names match", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "herdctl.json"), minimalHerdctlJson);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === NAME_MISMATCH)).toBe(false);
    });
  });

  // ===========================================================================
  // Optional File Warnings
  // ===========================================================================

  describe("optional file warnings", () => {
    it("warns when CLAUDE.md is missing", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === MISSING_CLAUDE_MD)).toBe(true);
      const claudeWarning = result.warnings.find((w) => w.code === MISSING_CLAUDE_MD);
      expect(claudeWarning?.message).toContain("agent identity");
    });

    it("warns when README.md is missing", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.code === MISSING_README)).toBe(true);
      const readmeWarning = result.warnings.find((w) => w.code === MISSING_README);
      expect(readmeWarning?.message).toContain("documentation");
    });

    it("does not warn when CLAUDE.md exists", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "CLAUDE.md"), "# Agent Identity");

      const result = await validateRepository(tempDir);

      expect(result.warnings.some((w) => w.code === MISSING_CLAUDE_MD)).toBe(false);
    });

    it("does not warn when README.md exists", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "README.md"), "# Documentation");

      const result = await validateRepository(tempDir);

      expect(result.warnings.some((w) => w.code === MISSING_README)).toBe(false);
    });
  });

  // ===========================================================================
  // Complex Scenarios
  // ===========================================================================

  describe("complex scenarios", () => {
    it("handles multiple errors at once", async () => {
      // Invalid YAML in agent.yaml and invalid JSON in herdctl.json
      await writeFile(join(tempDir, "agent.yaml"), "invalid: yaml: syntax:");
      await writeFile(join(tempDir, "herdctl.json"), "not valid json");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("validates a realistic agent repository", async () => {
      const realisticAgent = `
name: website-monitor
description: "Website uptime monitor"
runtime: cli
working_directory: ./workspace
setting_sources:
  - project
schedules:
  check-websites:
    type: cron
    cron: "*/5 * * * *"
    prompt: "Check website uptime"
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - WebFetch
docker:
  enabled: true
  memory: 2g
`;
      const realisticMetadata = JSON.stringify({
        name: "website-monitor",
        version: "1.0.0",
        description: "Monitor website uptime and send Discord alerts",
        author: "herdctl-examples",
        repository: "github:herdctl-examples/website-monitor-agent",
        license: "MIT",
        keywords: ["monitoring", "uptime", "alerts"],
        requires: {
          herdctl: ">=0.1.0",
          runtime: "cli",
          env: ["WEBSITES", "DISCORD_WEBHOOK_URL"],
          workspace: true,
        },
        category: "operations",
        tags: ["monitoring", "automation"],
      });

      await writeFile(join(tempDir, "agent.yaml"), realisticAgent);
      await writeFile(join(tempDir, "herdctl.json"), realisticMetadata);
      await writeFile(join(tempDir, "CLAUDE.md"), "# Website Monitor\n\nYou monitor websites.");
      await writeFile(join(tempDir, "README.md"), "# Website Monitor Agent\n\nUsage docs here.");
      await mkdir(join(tempDir, "knowledge"), { recursive: true });
      await writeFile(join(tempDir, "knowledge", "monitoring-guide.md"), "# Monitoring Guide");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(true);
      expect(result.agentName).toBe("website-monitor");
      expect(result.agentConfig?.schedules?.["check-websites"]).toBeDefined();
      expect(result.repoMetadata?.version).toBe("1.0.0");
      expect(result.repoMetadata?.keywords).toContain("monitoring");
      expect(result.errors).toHaveLength(0);
      // Should have no warnings for missing files
      expect(result.warnings.some((w) => w.code === MISSING_HERDCTL_JSON)).toBe(false);
      expect(result.warnings.some((w) => w.code === MISSING_CLAUDE_MD)).toBe(false);
      expect(result.warnings.some((w) => w.code === MISSING_README)).toBe(false);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("edge cases", () => {
    it("handles empty agent.yaml file", async () => {
      await writeFile(join(tempDir, "agent.yaml"), "");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      // Empty YAML parses to null/undefined, which fails schema validation
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });

    it("handles agent.yaml with only comments", async () => {
      await writeFile(join(tempDir, "agent.yaml"), "# Just a comment\n# Another comment");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });

    it("handles empty herdctl.json object", async () => {
      await writeFile(join(tempDir, "agent.yaml"), minimalAgentYaml);
      await writeFile(join(tempDir, "herdctl.json"), "{}");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_HERDCTL_JSON)).toBe(true);
    });

    it("handles whitespace-only agent.yaml", async () => {
      await writeFile(join(tempDir, "agent.yaml"), "   \n\n   \t\t\n   ");

      const result = await validateRepository(tempDir);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === INVALID_AGENT_YAML)).toBe(true);
    });
  });
});
