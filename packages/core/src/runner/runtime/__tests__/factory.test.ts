import { describe, it, expect } from "vitest";
import { RuntimeFactory } from "../factory.js";
import type { ResolvedAgent } from "../../../config/index.js";
import type { DockerInput } from "../../../config/schema.js";

// =============================================================================
// Test Helpers
// =============================================================================

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    ...overrides,
  } as ResolvedAgent;
}

// =============================================================================
// RuntimeFactory Tests
// =============================================================================

describe("RuntimeFactory", () => {
  describe("runtime type selection", () => {
    it("defaults to SDK runtime when runtime not specified", () => {
      const agent = createTestAgent();
      const runtime = RuntimeFactory.create(agent);

      // Verify it's SDKRuntime by checking constructor name
      expect(runtime.constructor.name).toBe("SDKRuntime");
    });

    it("creates SDK runtime for runtime: sdk", () => {
      const agent = createTestAgent({ runtime: "sdk" });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("SDKRuntime");
    });

    it("creates CLI runtime for runtime: cli", () => {
      const agent = createTestAgent({ runtime: "cli" });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("CLIRuntime");
    });

    it("throws for unknown runtime type", () => {
      const agent = createTestAgent({ runtime: "unknown" as any });

      expect(() => RuntimeFactory.create(agent)).toThrow("Unknown runtime type: unknown");
      expect(() => RuntimeFactory.create(agent)).toThrow("Supported types: 'sdk' (default), 'cli'");
    });
  });

  describe("Docker wrapping", () => {
    it("returns base runtime when docker not enabled", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: { enabled: false } as any,
      });
      const runtime = RuntimeFactory.create(agent);

      // Should be SDKRuntime, not ContainerRunner
      expect(runtime.constructor.name).toBe("SDKRuntime");
    });

    it("returns base runtime when docker undefined", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        // No docker config at all
      });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("SDKRuntime");
    });

    it("wraps with ContainerRunner when docker.enabled is true", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: { enabled: true } as any,
      });
      const runtime = RuntimeFactory.create(agent, {
        stateDir: "/test/.herdctl",
      });

      // Should be wrapped with ContainerRunner
      expect(runtime.constructor.name).toBe("ContainerRunner");
    });

    it("passes stateDir to ContainerRunner", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: { enabled: true } as any,
      });
      const customStateDir = "/custom/state/dir";
      const runtime = RuntimeFactory.create(agent, {
        stateDir: customStateDir,
      });

      expect(runtime.constructor.name).toBe("ContainerRunner");
      // ContainerRunner has a stateDir property we can check
      expect((runtime as any).stateDir).toBe(customStateDir);
    });

    it("uses default stateDir when not provided", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: { enabled: true } as any,
      });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("ContainerRunner");
      // Default should be {cwd}/.herdctl
      const expectedDefault = process.cwd() + "/.herdctl";
      expect((runtime as any).stateDir).toBe(expectedDefault);
    });
  });

  describe("combined scenarios", () => {
    it("wraps SDK with Docker", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: { enabled: true } as any,
      });
      const runtime = RuntimeFactory.create(agent, {
        stateDir: "/test/.herdctl",
      });

      // Should be wrapped with ContainerRunner
      expect(runtime.constructor.name).toBe("ContainerRunner");
      // Has execute method from RuntimeInterface
      expect(typeof runtime.execute).toBe("function");
    });

    it("wraps CLI with Docker", () => {
      const agent = createTestAgent({
        runtime: "cli",
        docker: { enabled: true } as any,
      });
      const runtime = RuntimeFactory.create(agent, {
        stateDir: "/test/.herdctl",
      });

      // Should be wrapped with ContainerRunner
      expect(runtime.constructor.name).toBe("ContainerRunner");
      // Has execute method from RuntimeInterface
      expect(typeof runtime.execute).toBe("function");
    });

    it("CLI without Docker is unwrapped", () => {
      const agent = createTestAgent({
        runtime: "cli",
        docker: { enabled: false } as any,
      });
      const runtime = RuntimeFactory.create(agent);

      expect(runtime.constructor.name).toBe("CLIRuntime");
    });

    it("handles complex Docker config", () => {
      const agent = createTestAgent({
        runtime: "sdk",
        docker: {
          enabled: true,
          image: "custom:latest",
          network: "none",
          memory: "4g",
          ephemeral: true,
        } as any,
      });
      const runtime = RuntimeFactory.create(agent, {
        stateDir: "/test/.herdctl",
      });

      // Verify it creates ContainerRunner (config is private, we can't test it directly)
      expect(runtime.constructor.name).toBe("ContainerRunner");
      expect(typeof runtime.execute).toBe("function");
    });
  });
});
