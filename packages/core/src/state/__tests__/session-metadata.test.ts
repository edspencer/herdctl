import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMetadataStore } from "../session-metadata.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-session-metadata-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

describe("SessionMetadataStore", () => {
  let tempDir: string;
  let store: SessionMetadataStore;

  beforeEach(async () => {
    tempDir = await createTempDir();
    store = new SessionMetadataStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getCustomName", () => {
    it("returns undefined when no metadata file exists", async () => {
      const result = await store.getCustomName("test-agent", "session-123");
      expect(result).toBeUndefined();
    });

    it("returns undefined when session has no custom name", async () => {
      // Create a metadata file without a custom name for this session
      const metadataDir = join(tempDir, "session-metadata");
      await mkdir(metadataDir, { recursive: true });
      await writeFile(
        join(metadataDir, "test-agent.json"),
        JSON.stringify({
          version: 1,
          agentName: "test-agent",
          sessions: {
            "other-session": { customName: "Other Name" },
          },
        }),
        "utf-8",
      );

      const result = await store.getCustomName("test-agent", "session-123");
      expect(result).toBeUndefined();
    });

    it("returns custom name when it exists", async () => {
      const metadataDir = join(tempDir, "session-metadata");
      await mkdir(metadataDir, { recursive: true });
      await writeFile(
        join(metadataDir, "test-agent.json"),
        JSON.stringify({
          version: 1,
          agentName: "test-agent",
          sessions: {
            "session-123": { customName: "My Custom Session" },
          },
        }),
        "utf-8",
      );

      const result = await store.getCustomName("test-agent", "session-123");
      expect(result).toBe("My Custom Session");
    });
  });

  describe("setCustomName", () => {
    it("creates file and directory on first call", async () => {
      await store.setCustomName("test-agent", "session-123", "My Session");

      const metadataDir = join(tempDir, "session-metadata");
      const files = await readdir(metadataDir);
      expect(files).toContain("test-agent.json");

      const content = await readFile(join(metadataDir, "test-agent.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe(1);
      expect(parsed.agentName).toBe("test-agent");
      expect(parsed.sessions["session-123"].customName).toBe("My Session");
    });

    it("roundtrips with getCustomName correctly", async () => {
      await store.setCustomName("test-agent", "session-abc", "Test Session Name");

      const result = await store.getCustomName("test-agent", "session-abc");
      expect(result).toBe("Test Session Name");
    });

    it("handles multiple sessions on same agent", async () => {
      await store.setCustomName("test-agent", "session-1", "First Session");
      await store.setCustomName("test-agent", "session-2", "Second Session");
      await store.setCustomName("test-agent", "session-3", "Third Session");

      expect(await store.getCustomName("test-agent", "session-1")).toBe("First Session");
      expect(await store.getCustomName("test-agent", "session-2")).toBe("Second Session");
      expect(await store.getCustomName("test-agent", "session-3")).toBe("Third Session");
    });

    it("overwrites previous custom name", async () => {
      await store.setCustomName("test-agent", "session-123", "Original Name");
      expect(await store.getCustomName("test-agent", "session-123")).toBe("Original Name");

      await store.setCustomName("test-agent", "session-123", "Updated Name");
      expect(await store.getCustomName("test-agent", "session-123")).toBe("Updated Name");
    });
  });

  describe("removeCustomName", () => {
    it("removes the custom name", async () => {
      await store.setCustomName("test-agent", "session-123", "My Session");
      expect(await store.getCustomName("test-agent", "session-123")).toBe("My Session");

      await store.removeCustomName("test-agent", "session-123");
      expect(await store.getCustomName("test-agent", "session-123")).toBeUndefined();
    });

    it("does nothing when no metadata file exists", async () => {
      // Should not throw
      await store.removeCustomName("non-existent-agent", "session-123");

      // Directory should not be created
      const metadataDirExists = await readdir(tempDir)
        .then((files) => files.includes("session-metadata"))
        .catch(() => false);
      expect(metadataDirExists).toBe(false);
    });

    it("does nothing when session does not exist", async () => {
      await store.setCustomName("test-agent", "session-1", "Session One");

      // Remove non-existent session - should not throw
      await store.removeCustomName("test-agent", "session-999");

      // Original session should still exist
      expect(await store.getCustomName("test-agent", "session-1")).toBe("Session One");
    });

    it("removes session entry entirely when empty", async () => {
      await store.setCustomName("test-agent", "session-123", "My Session");
      await store.removeCustomName("test-agent", "session-123");

      const metadata = await store.getAgentMetadata("test-agent");
      expect(metadata).not.toBeNull();
      expect(metadata!.sessions["session-123"]).toBeUndefined();
    });

    it("preserves other sessions when removing one", async () => {
      await store.setCustomName("test-agent", "session-1", "First");
      await store.setCustomName("test-agent", "session-2", "Second");

      await store.removeCustomName("test-agent", "session-1");

      expect(await store.getCustomName("test-agent", "session-1")).toBeUndefined();
      expect(await store.getCustomName("test-agent", "session-2")).toBe("Second");
    });
  });

  describe("getAgentMetadata", () => {
    it("returns null when no file exists", async () => {
      const result = await store.getAgentMetadata("non-existent-agent");
      expect(result).toBeNull();
    });

    it("returns full structure after setCustomName", async () => {
      await store.setCustomName("test-agent", "session-1", "First");
      await store.setCustomName("test-agent", "session-2", "Second");

      const metadata = await store.getAgentMetadata("test-agent");

      expect(metadata).not.toBeNull();
      expect(metadata!.version).toBe(1);
      expect(metadata!.agentName).toBe("test-agent");
      expect(Object.keys(metadata!.sessions)).toHaveLength(2);
      expect(metadata!.sessions["session-1"].customName).toBe("First");
      expect(metadata!.sessions["session-2"].customName).toBe("Second");
    });
  });

  describe("error handling", () => {
    it("returns null for corrupted JSON file", async () => {
      const metadataDir = join(tempDir, "session-metadata");
      await mkdir(metadataDir, { recursive: true });
      await writeFile(join(metadataDir, "corrupted-agent.json"), "{ invalid json", "utf-8");

      const result = await store.getCustomName("corrupted-agent", "session-123");
      expect(result).toBeUndefined();

      const metadata = await store.getAgentMetadata("corrupted-agent");
      expect(metadata).toBeNull();
    });

    it("returns null for invalid schema file", async () => {
      const metadataDir = join(tempDir, "session-metadata");
      await mkdir(metadataDir, { recursive: true });
      // Valid JSON but wrong schema (missing required fields, wrong version)
      await writeFile(
        join(metadataDir, "invalid-schema-agent.json"),
        JSON.stringify({
          version: 999,
          agentName: "invalid-schema-agent",
          sessions: {},
        }),
        "utf-8",
      );

      const result = await store.getCustomName("invalid-schema-agent", "session-123");
      expect(result).toBeUndefined();

      const metadata = await store.getAgentMetadata("invalid-schema-agent");
      expect(metadata).toBeNull();
    });

    it("returns null for file with missing required fields", async () => {
      const metadataDir = join(tempDir, "session-metadata");
      await mkdir(metadataDir, { recursive: true });
      // Missing agentName field
      await writeFile(
        join(metadataDir, "missing-fields.json"),
        JSON.stringify({
          version: 1,
          sessions: {},
        }),
        "utf-8",
      );

      const metadata = await store.getAgentMetadata("missing-fields");
      expect(metadata).toBeNull();
    });
  });

  describe("cache behavior", () => {
    it("uses cache on second getCustomName call", async () => {
      await store.setCustomName("test-agent", "session-123", "Cached Name");

      // First call loads from disk and caches
      const result1 = await store.getCustomName("test-agent", "session-123");
      expect(result1).toBe("Cached Name");

      // Manually corrupt the file on disk
      const metadataDir = join(tempDir, "session-metadata");
      await writeFile(join(metadataDir, "test-agent.json"), "{ corrupted }", "utf-8");

      // Second call should still return cached value
      const result2 = await store.getCustomName("test-agent", "session-123");
      expect(result2).toBe("Cached Name");
    });

    it("updates cache when setCustomName is called", async () => {
      await store.setCustomName("test-agent", "session-123", "First Name");
      expect(await store.getCustomName("test-agent", "session-123")).toBe("First Name");

      await store.setCustomName("test-agent", "session-123", "Updated Name");

      // Should use updated cache value, not re-read corrupted file
      const metadataDir = join(tempDir, "session-metadata");
      await writeFile(join(metadataDir, "test-agent.json"), "{ corrupted }", "utf-8");

      expect(await store.getCustomName("test-agent", "session-123")).toBe("Updated Name");
    });

    it("updates cache when removeCustomName is called", async () => {
      await store.setCustomName("test-agent", "session-123", "To Be Removed");
      await store.removeCustomName("test-agent", "session-123");

      // Corrupt file on disk
      const metadataDir = join(tempDir, "session-metadata");
      await writeFile(
        join(metadataDir, "test-agent.json"),
        JSON.stringify({
          version: 1,
          agentName: "test-agent",
          sessions: { "session-123": { customName: "Corrupted" } },
        }),
        "utf-8",
      );

      // Should use cache showing the name was removed
      expect(await store.getCustomName("test-agent", "session-123")).toBeUndefined();
    });
  });

  describe("multiple agents", () => {
    it("maintains separate metadata files for each agent", async () => {
      await store.setCustomName("agent-alpha", "session-1", "Alpha Session");
      await store.setCustomName("agent-beta", "session-1", "Beta Session");
      await store.setCustomName("agent-gamma", "session-1", "Gamma Session");

      // Verify separate files exist
      const metadataDir = join(tempDir, "session-metadata");
      const files = await readdir(metadataDir);
      expect(files).toContain("agent-alpha.json");
      expect(files).toContain("agent-beta.json");
      expect(files).toContain("agent-gamma.json");

      // Verify each has correct data
      expect(await store.getCustomName("agent-alpha", "session-1")).toBe("Alpha Session");
      expect(await store.getCustomName("agent-beta", "session-1")).toBe("Beta Session");
      expect(await store.getCustomName("agent-gamma", "session-1")).toBe("Gamma Session");
    });

    it("operations on one agent do not affect others", async () => {
      await store.setCustomName("agent-one", "session-1", "One");
      await store.setCustomName("agent-two", "session-1", "Two");

      await store.removeCustomName("agent-one", "session-1");

      expect(await store.getCustomName("agent-one", "session-1")).toBeUndefined();
      expect(await store.getCustomName("agent-two", "session-1")).toBe("Two");
    });
  });

  describe("concurrent operations", () => {
    it("handles sequential setCustomName calls for different sessions", async () => {
      // Note: Concurrent writes to the same agent's metadata file can cause race conditions.
      // This test verifies that sequential writes work correctly.
      for (let i = 0; i < 10; i++) {
        await store.setCustomName("test-agent", `session-${i}`, `Session ${i}`);
      }

      // All sessions should be saved
      for (let i = 0; i < 10; i++) {
        expect(await store.getCustomName("test-agent", `session-${i}`)).toBe(`Session ${i}`);
      }
    });

    it("handles concurrent operations on different agents", async () => {
      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(store.setCustomName(`agent-${i}`, "session-1", `Agent ${i} Session`));
      }

      await Promise.all(operations);

      for (let i = 0; i < 10; i++) {
        expect(await store.getCustomName(`agent-${i}`, "session-1")).toBe(`Agent ${i} Session`);
      }
    });
  });

  describe("atomic write behavior", () => {
    it("does not leave temp files on successful write", async () => {
      await store.setCustomName("test-agent", "session-123", "Test Session");

      const metadataDir = join(tempDir, "session-metadata");
      const files = await readdir(metadataDir);
      const tempFiles = files.filter((f) => f.includes(".tmp."));
      expect(tempFiles).toHaveLength(0);
    });

    it("creates valid JSON file", async () => {
      await store.setCustomName("test-agent", "session-123", "Test Session");

      const metadataDir = join(tempDir, "session-metadata");
      const content = await readFile(join(metadataDir, "test-agent.json"), "utf-8");

      // Should not throw when parsing
      const parsed = JSON.parse(content);
      expect(parsed).toBeDefined();
      expect(parsed.version).toBe(1);
    });
  });

  describe("file path handling", () => {
    it("stores metadata in session-metadata subdirectory", async () => {
      await store.setCustomName("test-agent", "session-123", "Test");

      const expectedPath = join(tempDir, "session-metadata", "test-agent.json");
      const content = await readFile(expectedPath, "utf-8");
      expect(content).toContain("test-agent");
    });

    it("handles agent names with special characters", async () => {
      await store.setCustomName("my-special_agent-123", "session-1", "Special");

      const result = await store.getCustomName("my-special_agent-123", "session-1");
      expect(result).toBe("Special");
    });

    it("handles qualified agent names with dots", async () => {
      await store.setCustomName("fleet.sub-fleet.agent", "session-1", "Qualified");

      const result = await store.getCustomName("fleet.sub-fleet.agent", "session-1");
      expect(result).toBe("Qualified");

      const metadata = await store.getAgentMetadata("fleet.sub-fleet.agent");
      expect(metadata).not.toBeNull();
      expect(metadata!.agentName).toBe("fleet.sub-fleet.agent");
    });
  });

  describe("fresh instance behavior", () => {
    it("new store instance reads from disk", async () => {
      // First store writes data
      await store.setCustomName("test-agent", "session-123", "Persisted Name");

      // Create a new store instance with same state directory
      const newStore = new SessionMetadataStore(tempDir);

      // Should read from disk
      const result = await newStore.getCustomName("test-agent", "session-123");
      expect(result).toBe("Persisted Name");
    });
  });

  // ===========================================================================
  // Auto Name Methods
  // ===========================================================================

  describe("getAutoName", () => {
    it("returns undefined when no metadata file exists", async () => {
      const result = await store.getAutoName("test-agent", "session-123");
      expect(result).toBeUndefined();
    });

    it("returns undefined when session has no auto name", async () => {
      // Create a metadata file with only a custom name
      await store.setCustomName("test-agent", "session-123", "Custom Name");

      const result = await store.getAutoName("test-agent", "session-123");
      expect(result).toBeDefined();
      expect(result!.autoName).toBeUndefined();
      expect(result!.autoNameMtime).toBeUndefined();
    });

    it("returns auto name and mtime when they exist", async () => {
      await store.setAutoName("test-agent", "session-123", "Auto Name", "2024-01-15T10:00:00.000Z");

      const result = await store.getAutoName("test-agent", "session-123");
      expect(result).toBeDefined();
      expect(result!.autoName).toBe("Auto Name");
      expect(result!.autoNameMtime).toBe("2024-01-15T10:00:00.000Z");
    });
  });

  describe("setAutoName", () => {
    it("creates file and directory on first call", async () => {
      await store.setAutoName(
        "test-agent",
        "session-123",
        "Auto Session",
        "2024-01-15T10:00:00.000Z",
      );

      const metadataDir = join(tempDir, "session-metadata");
      const files = await readdir(metadataDir);
      expect(files).toContain("test-agent.json");

      const content = await readFile(join(metadataDir, "test-agent.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.sessions["session-123"].autoName).toBe("Auto Session");
      expect(parsed.sessions["session-123"].autoNameMtime).toBe("2024-01-15T10:00:00.000Z");
    });

    it("preserves existing customName when setting autoName", async () => {
      await store.setCustomName("test-agent", "session-123", "Custom Name");
      await store.setAutoName("test-agent", "session-123", "Auto Name", "2024-01-15T10:00:00.000Z");

      const customName = await store.getCustomName("test-agent", "session-123");
      expect(customName).toBe("Custom Name");

      const autoName = await store.getAutoName("test-agent", "session-123");
      expect(autoName!.autoName).toBe("Auto Name");
    });

    it("roundtrips with getAutoName correctly", async () => {
      await store.setAutoName(
        "test-agent",
        "session-abc",
        "Test Auto Name",
        "2024-01-15T10:00:00.000Z",
      );

      const result = await store.getAutoName("test-agent", "session-abc");
      expect(result!.autoName).toBe("Test Auto Name");
      expect(result!.autoNameMtime).toBe("2024-01-15T10:00:00.000Z");
    });

    it("overwrites previous auto name", async () => {
      await store.setAutoName("test-agent", "session-123", "Original", "2024-01-15T10:00:00.000Z");
      await store.setAutoName("test-agent", "session-123", "Updated", "2024-01-15T11:00:00.000Z");

      const result = await store.getAutoName("test-agent", "session-123");
      expect(result!.autoName).toBe("Updated");
      expect(result!.autoNameMtime).toBe("2024-01-15T11:00:00.000Z");
    });
  });

  describe("batchSetAutoNames", () => {
    it("writes multiple entries in a single operation", async () => {
      await store.batchSetAutoNames("test-agent", [
        { sessionId: "session-1", autoName: "First Session", mtime: "2024-01-15T10:00:00.000Z" },
        { sessionId: "session-2", autoName: "Second Session", mtime: "2024-01-15T11:00:00.000Z" },
        { sessionId: "session-3", autoName: "Third Session", mtime: "2024-01-15T12:00:00.000Z" },
      ]);

      const result1 = await store.getAutoName("test-agent", "session-1");
      expect(result1!.autoName).toBe("First Session");

      const result2 = await store.getAutoName("test-agent", "session-2");
      expect(result2!.autoName).toBe("Second Session");

      const result3 = await store.getAutoName("test-agent", "session-3");
      expect(result3!.autoName).toBe("Third Session");
    });

    it("does nothing when entries array is empty", async () => {
      await store.batchSetAutoNames("test-agent", []);

      const metadata = await store.getAgentMetadata("test-agent");
      expect(metadata).toBeNull();
    });

    it("preserves existing data when batch updating", async () => {
      // Set up existing data
      await store.setCustomName("test-agent", "session-1", "Custom One");
      await store.setAutoName("test-agent", "session-2", "Old Auto", "2024-01-14T10:00:00.000Z");

      // Batch update
      await store.batchSetAutoNames("test-agent", [
        { sessionId: "session-1", autoName: "New Auto One", mtime: "2024-01-15T10:00:00.000Z" },
        { sessionId: "session-3", autoName: "New Auto Three", mtime: "2024-01-15T10:00:00.000Z" },
      ]);

      // Custom name should be preserved
      expect(await store.getCustomName("test-agent", "session-1")).toBe("Custom One");

      // Session 1 should have new auto name
      const result1 = await store.getAutoName("test-agent", "session-1");
      expect(result1!.autoName).toBe("New Auto One");

      // Session 2 should still have old auto name (not in batch)
      const result2 = await store.getAutoName("test-agent", "session-2");
      expect(result2!.autoName).toBe("Old Auto");

      // Session 3 should have new auto name
      const result3 = await store.getAutoName("test-agent", "session-3");
      expect(result3!.autoName).toBe("New Auto Three");
    });
  });

  describe("adhoc agent key", () => {
    it("supports 'adhoc' as agent name for unattributed sessions", async () => {
      await store.setAutoName(
        "adhoc",
        "session-unattributed",
        "Unattributed Session",
        "2024-01-15T10:00:00.000Z",
      );

      const result = await store.getAutoName("adhoc", "session-unattributed");
      expect(result!.autoName).toBe("Unattributed Session");

      // Verify file is created
      const metadataDir = join(tempDir, "session-metadata");
      const files = await readdir(metadataDir);
      expect(files).toContain("adhoc.json");
    });
  });
});
