/**
 * Tests for AgentRepoMetadataSchema (herdctl.json validation)
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_NAME_PATTERN,
  AgentRepoMetadataSchema,
  AgentRequiresSchema,
} from "../agent-repo-metadata.js";

// =============================================================================
// Test Data
// =============================================================================

/**
 * Full valid metadata from the example-agent-repo.md document.
 * This is the canonical example that must always pass validation.
 */
const FULL_VALID_METADATA = {
  $schema: "https://herdctl.dev/schemas/agent-metadata.json",
  name: "website-monitor",
  version: "1.0.0",
  description: "Monitor website uptime and send Discord alerts when sites go down or recover",
  author: "herdctl-examples",
  repository: "github:herdctl-examples/website-monitor-agent",
  homepage: "https://github.com/herdctl-examples/website-monitor-agent",
  license: "MIT",
  keywords: ["monitoring", "uptime", "alerts", "discord", "devops"],
  requires: {
    herdctl: ">=0.1.0",
    runtime: "cli",
    env: ["WEBSITES", "DISCORD_WEBHOOK_URL"],
    workspace: true,
    docker: false,
  },
  category: "operations",
  tags: ["monitoring", "automation", "alerts"],
  screenshots: [
    "https://github.com/herdctl-examples/website-monitor-agent/blob/main/screenshots/discord-alert.png",
  ],
  examples: {
    basic: "Monitor 2-3 production websites with 5-minute checks",
    advanced: "Monitor multiple environments with different check intervals and alert thresholds",
  },
};

/**
 * Minimal valid metadata with only required fields.
 */
const MINIMAL_VALID_METADATA = {
  name: "my-agent",
  version: "0.1.0",
  description: "A simple agent",
  author: "test-author",
};

// =============================================================================
// AgentRepoMetadataSchema Tests
// =============================================================================

describe("AgentRepoMetadataSchema", () => {
  describe("valid metadata", () => {
    it("should accept full valid metadata from the example", () => {
      const result = AgentRepoMetadataSchema.safeParse(FULL_VALID_METADATA);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("website-monitor");
        expect(result.data.version).toBe("1.0.0");
        expect(result.data.author).toBe("herdctl-examples");
        expect(result.data.requires?.herdctl).toBe(">=0.1.0");
        expect(result.data.requires?.env).toEqual(["WEBSITES", "DISCORD_WEBHOOK_URL"]);
      }
    });

    it("should accept minimal valid metadata (required fields only)", () => {
      const result = AgentRepoMetadataSchema.safeParse(MINIMAL_VALID_METADATA);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("my-agent");
        expect(result.data.version).toBe("0.1.0");
        expect(result.data.description).toBe("A simple agent");
        expect(result.data.author).toBe("test-author");
        // Optional fields should be undefined
        expect(result.data.repository).toBeUndefined();
        expect(result.data.homepage).toBeUndefined();
        expect(result.data.license).toBeUndefined();
        expect(result.data.keywords).toBeUndefined();
        expect(result.data.requires).toBeUndefined();
        expect(result.data.category).toBeUndefined();
        expect(result.data.tags).toBeUndefined();
        expect(result.data.screenshots).toBeUndefined();
        expect(result.data.examples).toBeUndefined();
      }
    });

    it("should accept agent names with underscores and hyphens", () => {
      const names = [
        "my-agent",
        "my_agent",
        "my-agent_v2",
        "Agent1",
        "agent123",
        "A",
        "a1",
        "1agent", // starts with number - valid per pattern
      ];

      for (const name of names) {
        const result = AgentRepoMetadataSchema.safeParse({
          ...MINIMAL_VALID_METADATA,
          name,
        });
        expect(result.success, `Expected name "${name}" to be valid`).toBe(true);
      }
    });

    it("should accept various valid semver versions", () => {
      const versions = [
        "0.0.1",
        "1.0.0",
        "10.20.30",
        "1.0.0-alpha",
        "1.0.0-alpha.1",
        "1.0.0-beta.2",
        "1.0.0-rc.1",
        "1.0.0+build.123",
        "1.0.0-alpha+build",
      ];

      for (const version of versions) {
        const result = AgentRepoMetadataSchema.safeParse({
          ...MINIMAL_VALID_METADATA,
          version,
        });
        expect(result.success, `Expected version "${version}" to be valid`).toBe(true);
      }
    });
  });

  describe("missing required fields", () => {
    it("should reject metadata without name", () => {
      const { name: _, ...withoutName } = MINIMAL_VALID_METADATA;
      const result = AgentRepoMetadataSchema.safeParse(withoutName);

      expect(result.success).toBe(false);
      if (!result.success) {
        const nameError = result.error.issues.find((i) => i.path.includes("name"));
        expect(nameError).toBeDefined();
      }
    });

    it("should reject metadata without version", () => {
      const { version: _, ...withoutVersion } = MINIMAL_VALID_METADATA;
      const result = AgentRepoMetadataSchema.safeParse(withoutVersion);

      expect(result.success).toBe(false);
      if (!result.success) {
        const versionError = result.error.issues.find((i) => i.path.includes("version"));
        expect(versionError).toBeDefined();
      }
    });

    it("should reject metadata without description", () => {
      const { description: _, ...withoutDescription } = MINIMAL_VALID_METADATA;
      const result = AgentRepoMetadataSchema.safeParse(withoutDescription);

      expect(result.success).toBe(false);
      if (!result.success) {
        const descriptionError = result.error.issues.find((i) => i.path.includes("description"));
        expect(descriptionError).toBeDefined();
      }
    });

    it("should reject metadata without author", () => {
      const { author: _, ...withoutAuthor } = MINIMAL_VALID_METADATA;
      const result = AgentRepoMetadataSchema.safeParse(withoutAuthor);

      expect(result.success).toBe(false);
      if (!result.success) {
        const authorError = result.error.issues.find((i) => i.path.includes("author"));
        expect(authorError).toBeDefined();
      }
    });

    it("should reject completely empty object", () => {
      const result = AgentRepoMetadataSchema.safeParse({});

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should have errors for all required fields
        expect(result.error.issues.length).toBeGreaterThanOrEqual(4);
      }
    });
  });

  describe("invalid name", () => {
    it("should reject names starting with underscore", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        name: "_invalid-name",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const nameError = result.error.issues.find((i) => i.path.includes("name"));
        expect(nameError?.message).toContain("must start with a letter or number");
      }
    });

    it("should reject names starting with hyphen", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        name: "-invalid-name",
      });

      expect(result.success).toBe(false);
    });

    it("should reject names with dots", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        name: "invalid.name",
      });

      expect(result.success).toBe(false);
    });

    it("should reject names with spaces", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        name: "invalid name",
      });

      expect(result.success).toBe(false);
    });

    it("should reject names with special characters", () => {
      const invalidNames = ["name!", "name@", "name#", "name$", "name%", "name/path", "name\\path"];

      for (const name of invalidNames) {
        const result = AgentRepoMetadataSchema.safeParse({
          ...MINIMAL_VALID_METADATA,
          name,
        });
        expect(result.success, `Expected name "${name}" to be invalid`).toBe(false);
      }
    });

    it("should reject empty name", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        name: "",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("invalid version", () => {
    it("should reject non-semver versions", () => {
      const invalidVersions = [
        "1.0",
        "1",
        "v1.0.0",
        "1.0.0.0",
        "latest",
        "1.x.0",
        "",
        "abc",
        "1.0.0-",
        "1.0.0+",
      ];

      for (const version of invalidVersions) {
        const result = AgentRepoMetadataSchema.safeParse({
          ...MINIMAL_VALID_METADATA,
          version,
        });
        expect(result.success, `Expected version "${version}" to be invalid`).toBe(false);
      }
    });
  });

  describe("invalid description", () => {
    it("should reject empty description", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        description: "",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const descError = result.error.issues.find((i) => i.path.includes("description"));
        expect(descError?.message).toContain("cannot be empty");
      }
    });
  });

  describe("invalid author", () => {
    it("should reject empty author", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        author: "",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const authorError = result.error.issues.find((i) => i.path.includes("author"));
        expect(authorError?.message).toContain("cannot be empty");
      }
    });
  });

  describe("optional fields", () => {
    it("should accept valid homepage URL", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        homepage: "https://example.com/my-agent",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid homepage URL", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        homepage: "not-a-url",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const homepageError = result.error.issues.find((i) => i.path.includes("homepage"));
        expect(homepageError?.message).toContain("must be a valid URL");
      }
    });

    it("should accept valid screenshot URLs", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        screenshots: ["https://example.com/screenshot1.png", "https://example.com/screenshot2.png"],
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid screenshot URLs", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        screenshots: ["https://valid.com/img.png", "not-a-url"],
      });

      expect(result.success).toBe(false);
    });

    it("should accept keywords array", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        keywords: ["monitoring", "alerts", "devops"],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keywords).toEqual(["monitoring", "alerts", "devops"]);
      }
    });

    it("should accept tags array", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        tags: ["automation", "monitoring"],
      });

      expect(result.success).toBe(true);
    });

    it("should accept examples record", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        examples: {
          basic: "Simple usage example",
          advanced: "Complex usage with multiple configurations",
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples?.basic).toBe("Simple usage example");
      }
    });

    it("should accept $schema field", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        $schema: "https://herdctl.dev/schemas/agent-metadata.json",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.$schema).toBe("https://herdctl.dev/schemas/agent-metadata.json");
      }
    });
  });

  describe("unknown fields (strict mode)", () => {
    it("should reject unknown top-level fields", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        unknownField: "should fail",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const unknownError = result.error.issues.find(
          (i) => i.code === "unrecognized_keys" || i.message.includes("Unrecognized key"),
        );
        expect(unknownError).toBeDefined();
      }
    });

    it("should reject unknown fields in requires object", () => {
      const result = AgentRepoMetadataSchema.safeParse({
        ...MINIMAL_VALID_METADATA,
        requires: {
          herdctl: ">=0.1.0",
          unknownRequirement: true,
        },
      });

      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// AgentRequiresSchema Tests
// =============================================================================

describe("AgentRequiresSchema", () => {
  describe("valid requires", () => {
    it("should accept full requires object", () => {
      const result = AgentRequiresSchema.safeParse({
        herdctl: ">=0.1.0",
        runtime: "cli",
        env: ["API_KEY", "WEBHOOK_URL"],
        workspace: true,
        docker: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.herdctl).toBe(">=0.1.0");
        expect(result.data.runtime).toBe("cli");
        expect(result.data.env).toEqual(["API_KEY", "WEBHOOK_URL"]);
        expect(result.data.workspace).toBe(true);
        expect(result.data.docker).toBe(false);
      }
    });

    it("should accept empty requires object", () => {
      const result = AgentRequiresSchema.safeParse({});

      expect(result.success).toBe(true);
    });

    it("should accept partial requires object", () => {
      const result = AgentRequiresSchema.safeParse({
        env: ["DISCORD_WEBHOOK"],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.env).toEqual(["DISCORD_WEBHOOK"]);
        expect(result.data.herdctl).toBeUndefined();
      }
    });
  });

  describe("herdctl version ranges", () => {
    it("should accept various valid semver ranges", () => {
      const validRanges = [
        ">=0.1.0",
        ">=1.0.0",
        "^1.0.0",
        "~1.2.3",
        "1.0.0",
        "1.x",
        "1.2.x",
        "*",
        ">1.0.0",
        "<2.0.0",
        ">=1.0.0 <2.0.0",
      ];

      for (const range of validRanges) {
        const result = AgentRequiresSchema.safeParse({
          herdctl: range,
        });
        expect(result.success, `Expected range "${range}" to be valid`).toBe(true);
      }
    });

    it("should reject invalid version ranges", () => {
      const invalidRanges = ["latest", "stable", "v1.0.0", "abc", ""];

      for (const range of invalidRanges) {
        const result = AgentRequiresSchema.safeParse({
          herdctl: range,
        });
        expect(result.success, `Expected range "${range}" to be invalid`).toBe(false);
      }
    });
  });

  describe("env array", () => {
    it("should accept empty env array", () => {
      const result = AgentRequiresSchema.safeParse({
        env: [],
      });

      expect(result.success).toBe(true);
    });

    it("should accept multiple env vars", () => {
      const result = AgentRequiresSchema.safeParse({
        env: ["VAR1", "VAR2", "VAR3"],
      });

      expect(result.success).toBe(true);
    });
  });

  describe("unknown fields (strict mode)", () => {
    it("should reject unknown fields in requires", () => {
      const result = AgentRequiresSchema.safeParse({
        herdctl: ">=0.1.0",
        unknownField: true,
      });

      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// AGENT_NAME_PATTERN Tests
// =============================================================================

describe("AGENT_NAME_PATTERN", () => {
  it("should match valid agent names", () => {
    const validNames = [
      "agent",
      "my-agent",
      "my_agent",
      "Agent1",
      "agent123",
      "A",
      "a",
      "1agent",
      "a1b2c3",
      "test-agent_v2",
    ];

    for (const name of validNames) {
      expect(AGENT_NAME_PATTERN.test(name), `Expected "${name}" to match`).toBe(true);
    }
  });

  it("should not match invalid agent names", () => {
    const invalidNames = [
      "",
      "-agent",
      "_agent",
      "agent.name",
      "agent/name",
      "agent name",
      "agent!",
      "@agent",
      "agent@",
    ];

    for (const name of invalidNames) {
      expect(AGENT_NAME_PATTERN.test(name), `Expected "${name}" to not match`).toBe(false);
    }
  });
});
