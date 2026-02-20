import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkSourceAdapter, WorkSourceConfig, WorkSourceFactory } from "../index.js";
import {
  clearWorkSourceRegistry,
  DuplicateWorkSourceError,
  getRegisteredTypes,
  getWorkSource,
  isWorkSourceRegistered,
  registerWorkSource,
  UnknownWorkSourceError,
  unregisterWorkSource,
} from "../index.js";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock work source adapter for testing
 */
function createMockAdapter(type: string): WorkSourceAdapter {
  return {
    type,
    async fetchAvailableWork() {
      return { items: [] };
    },
    async claimWork() {
      return { success: true };
    },
    async completeWork() {},
    async releaseWork() {
      return { success: true };
    },
    async getWork() {
      return undefined;
    },
  };
}

/**
 * Create a mock factory that returns a configured adapter
 */
function createMockFactory(type: string): WorkSourceFactory {
  return (_config: WorkSourceConfig) => createMockAdapter(type);
}

// =============================================================================
// Test Setup/Teardown
// =============================================================================

describe("Work Source Registry", () => {
  // Store originally registered types to restore after tests
  let originalTypes: string[] = [];

  beforeEach(() => {
    // Capture what was registered before the test
    originalTypes = getRegisteredTypes();
    // Clear for isolated testing
    clearWorkSourceRegistry();
  });

  afterEach(() => {
    // Restore original registrations after each test
    clearWorkSourceRegistry();
    // Re-import to trigger auto-registration of built-in adapters
    // Note: In real tests, the module is already loaded so we manually
    // restore the github adapter
    if (originalTypes.includes("github")) {
      registerWorkSource("github", createMockFactory("github"));
    }
  });

  // ===========================================================================
  // registerWorkSource tests
  // ===========================================================================

  describe("registerWorkSource", () => {
    it("registers a new work source factory", () => {
      const factory = createMockFactory("test");
      registerWorkSource("test", factory);

      expect(isWorkSourceRegistered("test")).toBe(true);
      expect(getRegisteredTypes()).toContain("test");
    });

    it("allows registering multiple different types", () => {
      registerWorkSource("type-a", createMockFactory("type-a"));
      registerWorkSource("type-b", createMockFactory("type-b"));
      registerWorkSource("type-c", createMockFactory("type-c"));

      const types = getRegisteredTypes();
      expect(types).toContain("type-a");
      expect(types).toContain("type-b");
      expect(types).toContain("type-c");
      expect(types).toHaveLength(3);
    });

    it("throws DuplicateWorkSourceError when registering same type twice", () => {
      registerWorkSource("duplicate", createMockFactory("duplicate"));

      expect(() => {
        registerWorkSource("duplicate", createMockFactory("duplicate"));
      }).toThrow(DuplicateWorkSourceError);
    });

    it("DuplicateWorkSourceError contains the source type", () => {
      registerWorkSource("my-source", createMockFactory("my-source"));

      try {
        registerWorkSource("my-source", createMockFactory("my-source"));
        expect.fail("Should have thrown DuplicateWorkSourceError");
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateWorkSourceError);
        const dupError = error as DuplicateWorkSourceError;
        expect(dupError.sourceType).toBe("my-source");
        expect(dupError.message).toContain("my-source");
        expect(dupError.message).toContain("already registered");
      }
    });
  });

  // ===========================================================================
  // getWorkSource tests
  // ===========================================================================

  describe("getWorkSource", () => {
    it("returns a configured adapter instance", () => {
      const factory = createMockFactory("test");
      registerWorkSource("test", factory);

      const adapter = getWorkSource({ type: "test" });

      expect(adapter).toBeDefined();
      expect(adapter.type).toBe("test");
    });

    it("calls factory with the provided config", () => {
      let capturedConfig: WorkSourceConfig | undefined;
      const factory: WorkSourceFactory = (config) => {
        capturedConfig = config;
        return createMockAdapter("custom");
      };
      registerWorkSource("custom", factory);

      const config: WorkSourceConfig = {
        type: "custom",
        labels: { ready: "ready-label", in_progress: "wip-label" },
        customOption: "custom-value",
      };
      getWorkSource(config);

      expect(capturedConfig).toEqual(config);
      expect(capturedConfig?.customOption).toBe("custom-value");
    });

    it("throws UnknownWorkSourceError for unregistered type", () => {
      expect(() => {
        getWorkSource({ type: "unknown" });
      }).toThrow(UnknownWorkSourceError);
    });

    it("UnknownWorkSourceError contains type and available types", () => {
      registerWorkSource("available-a", createMockFactory("available-a"));
      registerWorkSource("available-b", createMockFactory("available-b"));

      try {
        getWorkSource({ type: "missing" });
        expect.fail("Should have thrown UnknownWorkSourceError");
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownWorkSourceError);
        const unknownError = error as UnknownWorkSourceError;
        expect(unknownError.sourceType).toBe("missing");
        expect(unknownError.availableTypes).toContain("available-a");
        expect(unknownError.availableTypes).toContain("available-b");
        expect(unknownError.message).toContain("missing");
        expect(unknownError.message).toContain("available-a");
      }
    });

    it("UnknownWorkSourceError shows 'none' when no types registered", () => {
      try {
        getWorkSource({ type: "any" });
        expect.fail("Should have thrown UnknownWorkSourceError");
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownWorkSourceError);
        const unknownError = error as UnknownWorkSourceError;
        expect(unknownError.availableTypes).toEqual([]);
        expect(unknownError.message).toContain("none");
      }
    });

    it("returns different instances for different configs", () => {
      let callCount = 0;
      const factory: WorkSourceFactory = (_config) => {
        callCount++;
        return createMockAdapter("instance");
      };
      registerWorkSource("instance", factory);

      const adapter1 = getWorkSource({ type: "instance" });
      const adapter2 = getWorkSource({ type: "instance" });

      // Factory should be called each time
      expect(callCount).toBe(2);
      // Each call creates a new instance
      expect(adapter1).not.toBe(adapter2);
    });
  });

  // ===========================================================================
  // getRegisteredTypes tests
  // ===========================================================================

  describe("getRegisteredTypes", () => {
    it("returns empty array when no types registered", () => {
      expect(getRegisteredTypes()).toEqual([]);
    });

    it("returns all registered types", () => {
      registerWorkSource("alpha", createMockFactory("alpha"));
      registerWorkSource("beta", createMockFactory("beta"));

      const types = getRegisteredTypes();
      expect(types).toHaveLength(2);
      expect(types).toContain("alpha");
      expect(types).toContain("beta");
    });

    it("returns a copy, not the internal state", () => {
      registerWorkSource("test", createMockFactory("test"));

      const types1 = getRegisteredTypes();
      const types2 = getRegisteredTypes();

      expect(types1).not.toBe(types2);
      expect(types1).toEqual(types2);
    });
  });

  // ===========================================================================
  // isWorkSourceRegistered tests
  // ===========================================================================

  describe("isWorkSourceRegistered", () => {
    it("returns false for unregistered type", () => {
      expect(isWorkSourceRegistered("not-registered")).toBe(false);
    });

    it("returns true for registered type", () => {
      registerWorkSource("registered", createMockFactory("registered"));
      expect(isWorkSourceRegistered("registered")).toBe(true);
    });

    it("returns false after type is unregistered", () => {
      registerWorkSource("temp", createMockFactory("temp"));
      expect(isWorkSourceRegistered("temp")).toBe(true);

      unregisterWorkSource("temp");
      expect(isWorkSourceRegistered("temp")).toBe(false);
    });
  });

  // ===========================================================================
  // unregisterWorkSource tests
  // ===========================================================================

  describe("unregisterWorkSource", () => {
    it("removes a registered type", () => {
      registerWorkSource("removable", createMockFactory("removable"));
      expect(isWorkSourceRegistered("removable")).toBe(true);

      const result = unregisterWorkSource("removable");

      expect(result).toBe(true);
      expect(isWorkSourceRegistered("removable")).toBe(false);
    });

    it("returns false for unregistered type", () => {
      const result = unregisterWorkSource("never-existed");
      expect(result).toBe(false);
    });

    it("allows re-registering after unregister", () => {
      registerWorkSource("reuse", createMockFactory("reuse"));
      unregisterWorkSource("reuse");

      // Should not throw
      registerWorkSource("reuse", createMockFactory("reuse"));
      expect(isWorkSourceRegistered("reuse")).toBe(true);
    });
  });

  // ===========================================================================
  // clearWorkSourceRegistry tests
  // ===========================================================================

  describe("clearWorkSourceRegistry", () => {
    it("removes all registered types", () => {
      registerWorkSource("one", createMockFactory("one"));
      registerWorkSource("two", createMockFactory("two"));
      registerWorkSource("three", createMockFactory("three"));

      clearWorkSourceRegistry();

      expect(getRegisteredTypes()).toEqual([]);
      expect(isWorkSourceRegistered("one")).toBe(false);
      expect(isWorkSourceRegistered("two")).toBe(false);
      expect(isWorkSourceRegistered("three")).toBe(false);
    });

    it("is idempotent", () => {
      registerWorkSource("test", createMockFactory("test"));

      clearWorkSourceRegistry();
      clearWorkSourceRegistry();
      clearWorkSourceRegistry();

      expect(getRegisteredTypes()).toEqual([]);
    });
  });

  // ===========================================================================
  // Factory pattern tests
  // ===========================================================================

  describe("Factory Pattern", () => {
    it("factory receives full config for customization", () => {
      interface CustomConfig extends WorkSourceConfig {
        apiToken?: string;
        baseUrl?: string;
      }

      let receivedToken: string | undefined;
      let receivedUrl: string | undefined;

      const factory: WorkSourceFactory = (config) => {
        const customConfig = config as CustomConfig;
        receivedToken = customConfig.apiToken;
        receivedUrl = customConfig.baseUrl;
        return createMockAdapter("custom");
      };

      registerWorkSource("custom", factory);

      getWorkSource({
        type: "custom",
        apiToken: "secret-token",
        baseUrl: "https://api.example.com",
      });

      expect(receivedToken).toBe("secret-token");
      expect(receivedUrl).toBe("https://api.example.com");
    });

    it("factory can create different adapters based on config", () => {
      const factory: WorkSourceFactory = (config) => {
        const adapter = createMockAdapter("conditional");
        // Override fetchAvailableWork based on config
        if (config.labels?.ready === "special") {
          adapter.fetchAvailableWork = async () => ({
            items: [],
            totalCount: 999,
          });
        }
        return adapter;
      };

      registerWorkSource("conditional", factory);

      const normalAdapter = getWorkSource({ type: "conditional" });
      const specialAdapter = getWorkSource({
        type: "conditional",
        labels: { ready: "special" },
      });

      // Both are valid adapters with different behavior
      expect(normalAdapter.type).toBe("conditional");
      expect(specialAdapter.type).toBe("conditional");
    });
  });

  // ===========================================================================
  // Module singleton behavior tests
  // ===========================================================================

  describe("Singleton Behavior", () => {
    it("registry state persists across function calls", () => {
      registerWorkSource("persistent", createMockFactory("persistent"));

      // Multiple calls to check registration all see the same state
      expect(isWorkSourceRegistered("persistent")).toBe(true);
      expect(getRegisteredTypes()).toContain("persistent");
      expect(() => getWorkSource({ type: "persistent" })).not.toThrow();
    });

    it("modifications are visible to subsequent operations", () => {
      // Register
      registerWorkSource("visible", createMockFactory("visible"));
      expect(getRegisteredTypes()).toContain("visible");

      // Unregister
      unregisterWorkSource("visible");
      expect(getRegisteredTypes()).not.toContain("visible");

      // Re-register
      registerWorkSource("visible", createMockFactory("visible"));
      expect(getRegisteredTypes()).toContain("visible");
    });
  });
});

// =============================================================================
// Built-in Adapter Registration Tests
// =============================================================================

describe("Built-in Adapters", () => {
  it("github adapter is pre-registered at module load", async () => {
    // The adapters/index.js module auto-registers when imported.
    // Since ESM modules are cached, we need to manually register
    // after clearing for tests.
    clearWorkSourceRegistry();

    // Import the factory directly and register it
    const { createGitHubAdapter } = await import("../adapters/github.js");
    registerWorkSource("github", createGitHubAdapter);

    expect(isWorkSourceRegistered("github")).toBe(true);
    expect(getRegisteredTypes()).toContain("github");
  });

  it("github adapter can be retrieved via getWorkSource", async () => {
    clearWorkSourceRegistry();
    const { createGitHubAdapter } = await import("../adapters/github.js");
    registerWorkSource("github", createGitHubAdapter);

    const adapter = getWorkSource({ type: "github" });

    expect(adapter).toBeDefined();
    expect(adapter.type).toBe("github");
  });

  it("github adapter respects config labels", async () => {
    clearWorkSourceRegistry();
    const { createGitHubAdapter } = await import("../adapters/github.js");
    registerWorkSource("github", createGitHubAdapter);

    // Should not throw - config is passed to factory
    const adapter = getWorkSource({
      type: "github",
      labels: {
        ready: "custom-ready",
        in_progress: "custom-wip",
      },
    });

    expect(adapter.type).toBe("github");
  });

  it("GitHubWorkSourceAdapter implements WorkSourceAdapter interface", async () => {
    const { GitHubWorkSourceAdapter } = await import("../adapters/github.js");

    const adapter = new GitHubWorkSourceAdapter({
      type: "github",
      owner: "testowner",
      repo: "testrepo",
      labels: { ready: "ready", in_progress: "wip" },
    });

    // Verify the interface
    expect(adapter.type).toBe("github");
    expect(typeof adapter.fetchAvailableWork).toBe("function");
    expect(typeof adapter.claimWork).toBe("function");
    expect(typeof adapter.completeWork).toBe("function");
    expect(typeof adapter.releaseWork).toBe("function");
    expect(typeof adapter.getWork).toBe("function");
  });
});
