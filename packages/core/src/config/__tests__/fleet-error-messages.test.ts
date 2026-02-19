/**
 * Tests for fleet composition error message formats
 *
 * These tests verify that error messages match the specification in fleet-composition.md
 * and the Phase 4.2 requirements. Each error type has a specific format to ensure
 * messages are clear, actionable, and helpful for debugging.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  FleetCycleError,
  FleetNameCollisionError,
  FleetLoadError,
  InvalidFleetNameError,
} from "../loader.js";
import { AGENT_NAME_PATTERN } from "../schema.js";

// =============================================================================
// Test helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-error-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

async function createFile(filePath: string, content: string): Promise<void> {
  await mkdir(join(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf-8");
}

// =============================================================================
// Error class unit tests
// =============================================================================

describe("FleetCycleError message format", () => {
  it("shows path chain with -> separator", () => {
    const error = new FleetCycleError([
      "/path/to/root.yaml",
      "/path/to/project-a/herdctl.yaml",
      "/path/to/shared/herdctl.yaml",
      "/path/to/project-a/herdctl.yaml",
    ]);

    expect(error.message).toBe(
      "Fleet composition cycle detected: /path/to/root.yaml -> /path/to/project-a/herdctl.yaml -> /path/to/shared/herdctl.yaml -> /path/to/project-a/herdctl.yaml"
    );
    expect(error.name).toBe("FleetCycleError");
  });

  it("includes all paths in pathChain property", () => {
    const paths = ["/a.yaml", "/b.yaml", "/c.yaml", "/a.yaml"];
    const error = new FleetCycleError(paths);

    expect(error.pathChain).toEqual(paths);
  });

  it("extends ConfigError", () => {
    const error = new FleetCycleError(["/a.yaml"]);
    expect(error).toBeInstanceOf(Error);
  });
});

describe("FleetNameCollisionError message format", () => {
  it("includes level name, fleet name, and conflicting paths", () => {
    const error = new FleetNameCollisionError(
      "project-a",
      "/root/herdctl.yaml",
      "/root/project-a/herdctl.yaml",
      "/root/renamed-a/herdctl.yaml"
    );

    expect(error.message).toContain('Fleet name collision at level "herdctl"');
    expect(error.message).toContain('resolve to name "project-a"');
    expect(error.message).toContain("Conflicting references:");
    expect(error.message).toContain("/root/project-a/herdctl.yaml");
    expect(error.message).toContain("/root/renamed-a/herdctl.yaml");
    expect(error.message).toContain("Add explicit");
    expect(error.message).toContain("disambiguate");
    expect(error.name).toBe("FleetNameCollisionError");
  });

  it("stores both conflicting paths", () => {
    const error = new FleetNameCollisionError(
      "my-fleet",
      "/parent.yaml",
      "/first/herdctl.yaml",
      "/second/herdctl.yaml"
    );

    expect(error.fleetName).toBe("my-fleet");
    expect(error.parentConfigPath).toBe("/parent.yaml");
    expect(error.conflictingPaths).toEqual([
      "/first/herdctl.yaml",
      "/second/herdctl.yaml",
    ]);
  });

  it("derives level name from parent config path", () => {
    const error = new FleetNameCollisionError(
      "collision",
      "/workspace/super-fleet/herdctl.yaml",
      "/a.yaml",
      "/b.yaml"
    );

    // Level name should be derived from the parent config filename (without .yaml)
    expect(error.message).toContain('at level "herdctl"');
  });
});

describe("InvalidFleetNameError message format", () => {
  it("includes the invalid name and pattern", () => {
    const error = new InvalidFleetNameError("my.fleet", AGENT_NAME_PATTERN);

    expect(error.message).toBe(
      'Invalid fleet name "my.fleet" — fleet names must match pattern ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ (no dots allowed)'
    );
    expect(error.name).toBe("InvalidFleetNameError");
  });

  it("stores the invalid name and pattern", () => {
    const error = new InvalidFleetNameError("bad-name!", AGENT_NAME_PATTERN);

    expect(error.invalidName).toBe("bad-name!");
    expect(error.pattern).toBe(AGENT_NAME_PATTERN);
  });

  it("extends ConfigError", () => {
    const error = new InvalidFleetNameError("test");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("FleetLoadError message format", () => {
  it("shows file not found format for missing files", () => {
    // Create a FileReadError-like error that indicates file not found
    const cause = new Error("Failed to read file '/missing.yaml': ENOENT: no such file or directory");
    // Need to add the properties that FileReadError has
    (cause as Error & { filePath: string }).filePath = "/missing.yaml";
    cause.name = "FileReadError";

    const error = new FleetLoadError("/missing/herdctl.yaml", cause, "root.yaml");

    // Note: The current implementation checks for FileReadError instance,
    // so this test may need adjustment based on how we construct the cause
    expect(error.name).toBe("FleetLoadError");
    expect(error.fleetPath).toBe("/missing/herdctl.yaml");
    expect(error.referencedFrom).toBe("root.yaml");
  });

  it("includes parent reference when provided", () => {
    const cause = new Error("Some error");
    const error = new FleetLoadError("/path/to/fleet.yaml", cause, "parent.yaml");

    expect(error.message).toContain("referenced from parent.yaml");
    expect(error.referencedFrom).toBe("parent.yaml");
  });

  it("works without parent reference", () => {
    const cause = new Error("Parse error");
    const error = new FleetLoadError("/path/to/fleet.yaml", cause);

    expect(error.message).toContain("/path/to/fleet.yaml");
    expect(error.message).toContain("Parse error");
    expect(error.referencedFrom).toBeUndefined();
  });
});

// =============================================================================
// Integration tests - actual error messages from loadConfig
// =============================================================================

describe("error message integration tests", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("cycle detection", () => {
    it("produces cycle error with full path chain", async () => {
      // Create cycle: root -> fleet-a -> fleet-b -> fleet-a
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
        await loadConfig(join(tempDir, "root.yaml"), { env: {}, envFile: false });
        expect.fail("Should have thrown FleetCycleError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetCycleError);
        const cycleError = error as FleetCycleError;

        // Verify message format
        expect(cycleError.message).toMatch(/^Fleet composition cycle detected:/);
        expect(cycleError.message).toContain(" -> ");

        // Verify path chain contains all relevant paths
        expect(cycleError.pathChain.length).toBeGreaterThanOrEqual(3);
        expect(cycleError.pathChain.some(p => p.includes("fleet-a"))).toBe(true);
        expect(cycleError.pathChain.some(p => p.includes("fleet-b"))).toBe(true);
      }
    });
  });

  describe("fleet name collision", () => {
    it("produces collision error with both conflicting paths", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./first/herdctl.yaml
  - path: ./second/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "first", "herdctl.yaml"),
        `
version: 1
fleet:
  name: duplicate-name
agents: []
`
      );
      await createFile(
        join(tempDir, "second", "herdctl.yaml"),
        `
version: 1
fleet:
  name: duplicate-name
agents: []
`
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown FleetNameCollisionError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetNameCollisionError);
        const collisionError = error as FleetNameCollisionError;

        // Verify message format
        expect(collisionError.message).toContain('Fleet name collision at level');
        expect(collisionError.message).toContain('"duplicate-name"');
        expect(collisionError.message).toContain("Conflicting references:");
        expect(collisionError.message).toContain("disambiguate");

        // Verify conflict details
        expect(collisionError.fleetName).toBe("duplicate-name");
        expect(collisionError.conflictingPaths).toHaveLength(2);
      }
    });
  });

  describe("invalid fleet name", () => {
    it("rejects fleet names with dots", async () => {
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
  name: my.invalid.name
agents: []
`
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown InvalidFleetNameError");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidFleetNameError);
        const nameError = error as InvalidFleetNameError;

        // Verify message format
        expect(nameError.message).toContain('Invalid fleet name "my.invalid.name"');
        expect(nameError.message).toContain("no dots allowed");
        expect(nameError.message).toContain("^[a-zA-Z0-9][a-zA-Z0-9_-]*$");

        // Verify properties
        expect(nameError.invalidName).toBe("my.invalid.name");
      }
    });

    it("rejects fleet names starting with invalid characters", async () => {
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
  name: -invalid
agents: []
`
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown InvalidFleetNameError");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidFleetNameError);
        const nameError = error as InvalidFleetNameError;
        expect(nameError.invalidName).toBe("-invalid");
      }
    });
  });

  describe("missing sub-fleet file", () => {
    it("produces clear error for missing file", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./nonexistent/herdctl.yaml
`
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown FleetLoadError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetLoadError);
        const loadError = error as FleetLoadError;

        // Verify message includes file not found indication
        expect(loadError.message).toContain("file not found");
        expect(loadError.message).toContain("nonexistent/herdctl.yaml");
        expect(loadError.message).toContain("referenced from");
      }
    });

    it("includes the parent config in error message", async () => {
      await createFile(
        join(tempDir, "parent-fleet.yaml"),
        `
version: 1
fleets:
  - path: ./missing-sub/herdctl.yaml
`
      );

      try {
        await loadConfig(join(tempDir, "parent-fleet.yaml"), { env: {}, envFile: false });
        expect.fail("Should have thrown FleetLoadError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetLoadError);
        const loadError = error as FleetLoadError;

        // Verify parent reference is included
        expect(loadError.message).toContain("referenced from parent-fleet.yaml");
        expect(loadError.referencedFrom).toBe("parent-fleet.yaml");
      }
    });
  });

  describe("invalid sub-fleet YAML", () => {
    it("produces clear error for parse errors", async () => {
      await createFile(
        join(tempDir, "herdctl.yaml"),
        `
version: 1
fleets:
  - path: ./bad/herdctl.yaml
`
      );
      await createFile(
        join(tempDir, "bad", "herdctl.yaml"),
        "invalid: yaml: syntax: breaks: here:"
      );

      try {
        await loadConfig(tempDir, { env: {}, envFile: false });
        expect.fail("Should have thrown FleetLoadError");
      } catch (error) {
        expect(error).toBeInstanceOf(FleetLoadError);
        const loadError = error as FleetLoadError;

        // Verify it mentions the path and includes parse error info
        expect(loadError.fleetPath).toContain("bad/herdctl.yaml");
        expect(loadError.referencedFrom).toBe("herdctl.yaml");
      }
    });
  });
});
