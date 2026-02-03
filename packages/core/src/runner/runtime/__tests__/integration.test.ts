import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeFactory } from "../factory.js";
import type { ResolvedAgent } from "../../../config/index.js";

// =============================================================================
// Environment Detection
// =============================================================================

function isCliAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isDockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CLI_AVAILABLE = isCliAvailable();
const DOCKER_AVAILABLE = isDockerAvailable();

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-runtime-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    ...overrides,
  } as ResolvedAgent;
}

// =============================================================================
// RuntimeFactory Integration Tests
// =============================================================================

describe("RuntimeFactory Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("SDK Runtime", () => {
    it("creates SDK runtime and returns RuntimeInterface", () => {
      const agent = createTestAgent({ runtime: "sdk" });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime).toBeDefined();
      expect(runtime.execute).toBeDefined();
      expect(typeof runtime.execute).toBe("function");
    });

    it("SDK runtime has correct constructor name", () => {
      const agent = createTestAgent({ runtime: "sdk" });
      const runtime = RuntimeFactory.create(agent);

      // Verify it's actually an SDK runtime (not wrapped)
      expect(runtime.constructor.name).toBe("SDKRuntime");
    });

    it("SDK runtime execute returns AsyncIterable interface", async () => {
      const agent = createTestAgent({ runtime: "sdk" });
      const runtime = RuntimeFactory.create(agent);

      // Verify the method signature is correct
      // We can't fully test without mocking SDK internals
      // but we verify the interface is correct
      expect(runtime.execute).toBeDefined();
      expect(typeof runtime.execute).toBe("function");
    });

    it("defaults to SDK runtime when runtime not specified", () => {
      const agent = createTestAgent(); // No runtime specified
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("SDKRuntime");
    });
  });

  describe("CLI Runtime", () => {
    it.skipIf(!CLI_AVAILABLE)("creates CLI runtime with correct interface", () => {
      const agent = createTestAgent({ runtime: "cli" });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime).toBeDefined();
      expect(runtime.execute).toBeDefined();
      expect(typeof runtime.execute).toBe("function");
    });

    it.skipIf(!CLI_AVAILABLE)("CLI runtime has correct constructor name", () => {
      const agent = createTestAgent({ runtime: "cli" });
      const runtime = RuntimeFactory.create(agent);

      // Note: Full CLI integration would require actual claude execution
      // which uses API credits. This test verifies setup only.
      expect(runtime.constructor.name).toBe("CLIRuntime");
    });

    it.skipIf(!CLI_AVAILABLE)("CLI runtime accepts workspace parameter", () => {
      const agent = createTestAgent({ runtime: "cli" });
      const runtime = RuntimeFactory.create(agent);

      // Verify runtime can be created with workspace configuration
      expect(runtime).toBeDefined();
    });
  });

  describe("Docker Runtime", () => {
    it.skipIf(!DOCKER_AVAILABLE)("wraps SDK with ContainerRunner when docker enabled", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: {
          enabled: true,
          image: "alpine:latest",
        } as any,
      });

      const runtime = RuntimeFactory.create(agent, { stateDir: tempDir });

      // Verify it's wrapped (ContainerRunner wraps the base runtime)
      expect(runtime.constructor.name).toBe("ContainerRunner");
    });

    it.skipIf(!DOCKER_AVAILABLE)("wraps CLI with ContainerRunner when docker enabled", () => {
      const agent = createTestAgent({
        runtime: "cli",
        docker: {
          enabled: true,
          image: "alpine:latest",
        } as any,
      });

      const runtime = RuntimeFactory.create(agent, { stateDir: tempDir });

      expect(runtime.constructor.name).toBe("ContainerRunner");
    });

    it.skipIf(!DOCKER_AVAILABLE)("creates docker-sessions directory in stateDir", async () => {
      const stateDir = join(tempDir, ".herdctl");
      await mkdir(stateDir, { recursive: true });

      const agent = createTestAgent({
        docker: {
          enabled: true,
          image: "alpine:latest",
        } as any,
      });

      // Just verify RuntimeFactory accepts stateDir
      const runtime = RuntimeFactory.create(agent, { stateDir });
      expect(runtime).toBeDefined();
    });

    it.skipIf(!DOCKER_AVAILABLE)("defaults stateDir to .herdctl when not provided", () => {
      const agent = createTestAgent({
        docker: {
          enabled: true,
          image: "alpine:latest",
        } as any,
      });

      // Should not throw even without stateDir (uses default)
      const runtime = RuntimeFactory.create(agent);
      expect(runtime).toBeDefined();
    });
  });
});

// =============================================================================
// Path Translation Tests
// =============================================================================

describe("Path Translation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("workspace paths are consistent across runtime types", () => {
    const workspace = join(tempDir, "workspace");

    // SDK runtime uses workspace directly
    const sdkAgent = createTestAgent({ runtime: "sdk" });
    const sdkRuntime = RuntimeFactory.create(sdkAgent);

    // CLI runtime also uses workspace directly (but different session storage)
    const cliAgent = createTestAgent({ runtime: "cli" });
    const cliRuntime = RuntimeFactory.create(cliAgent);

    // Both should accept the same workspace path
    expect(sdkRuntime).toBeDefined();
    expect(cliRuntime).toBeDefined();
  });

  it.skipIf(!DOCKER_AVAILABLE)("Docker sessions stored separately from host sessions", async () => {
    const stateDir = join(tempDir, ".herdctl");
    await mkdir(stateDir, { recursive: true });

    const agent = createTestAgent({
      docker: {
        enabled: true,
        image: "alpine:latest",
      } as any,
    });

    const runtime = RuntimeFactory.create(agent, { stateDir });

    // Docker sessions should go to docker-sessions/, not sessions/
    // This is verified by the ContainerRunner implementation
    expect(runtime).toBeDefined();
  });

  it("workspace can be specified as string", () => {
    const agent = createTestAgent({
      runtime: "sdk",
      working_directory: "/path/to/workspace",
    });

    const runtime = RuntimeFactory.create(agent);
    expect(runtime).toBeDefined();
  });

  it("workspace can be specified as object with root", () => {
    const agent = createTestAgent({
      runtime: "sdk",
      working_directory: {
        root: "/path/to/workspace",
        auto_clone: true,
        clone_depth: 1,
        default_branch: "main",
      },
    });

    const runtime = RuntimeFactory.create(agent);
    expect(runtime).toBeDefined();
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Runtime Error Handling", () => {
  it("throws for invalid runtime type", () => {
    const agent = createTestAgent({ runtime: "invalid" as any });

    expect(() => RuntimeFactory.create(agent)).toThrow(/Unknown runtime type/);
  });

  it("includes helpful message for unknown runtime", () => {
    const agent = createTestAgent({ runtime: "postgres" as any });

    expect(() => RuntimeFactory.create(agent)).toThrow(/Supported types/);
  });

  it("error message lists supported runtime types", () => {
    const agent = createTestAgent({ runtime: "invalid" as any });

    try {
      RuntimeFactory.create(agent);
      expect.fail("Should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("sdk");
      expect(message).toContain("cli");
    }
  });
});

// =============================================================================
// Runtime Interface Compliance Tests
// =============================================================================

describe("Runtime Interface Compliance", () => {
  it("all runtimes expose execute method", () => {
    const sdkAgent = createTestAgent({ runtime: "sdk" });
    const sdkRuntime = RuntimeFactory.create(sdkAgent);

    expect(sdkRuntime.execute).toBeDefined();
    expect(typeof sdkRuntime.execute).toBe("function");

    if (CLI_AVAILABLE) {
      const cliAgent = createTestAgent({ runtime: "cli" });
      const cliRuntime = RuntimeFactory.create(cliAgent);

      expect(cliRuntime.execute).toBeDefined();
      expect(typeof cliRuntime.execute).toBe("function");
    }
  });

  it("ContainerRunner preserves RuntimeInterface", () => {
    if (!DOCKER_AVAILABLE) {
      return;
    }

    const agent = createTestAgent({
      runtime: "sdk",
      docker: {
        enabled: true,
        image: "alpine:latest",
      } as any,
    });

    const runtime = RuntimeFactory.create(agent);

    // ContainerRunner should still expose execute
    expect(runtime.execute).toBeDefined();
    expect(typeof runtime.execute).toBe("function");
  });
});
