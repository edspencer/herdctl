import { mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yaml from "yaml";
import {
  ADOPTED_SESSIONS_DIR_NAME,
  getAdoptedSessionsDir,
  getAdoption,
  listAdoptions,
  recordAdoption,
  removeAdoption,
} from "../adopted-sessions.js";
import { PathTraversalError } from "../utils/path-safety.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-adopted-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// =============================================================================
// Tests
// =============================================================================

describe("adopted-sessions store", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  describe("recordAdoption / getAdoption", () => {
    it("round-trips a record through disk", async () => {
      const written = await recordAdoption(stateDir, "sess-abc123", {
        agentName: "fleet/keeper",
        sourceCwd: "/home/user/project",
      });

      expect(written).toEqual({
        version: 1,
        sessionId: "sess-abc123",
        agentName: "fleet/keeper",
        adoptedAt: expect.any(String),
        sourceCwd: "/home/user/project",
      });

      const read = await getAdoption(stateDir, "sess-abc123");
      expect(read).toEqual(written);
    });

    it("writes to <stateDir>/adopted-sessions/<session-id>.yaml", async () => {
      await recordAdoption(stateDir, "sess-layout", { agentName: "keeper" });

      const dir = join(stateDir, ADOPTED_SESSIONS_DIR_NAME);
      expect(getAdoptedSessionsDir(stateDir)).toBe(dir);
      expect(await readdir(dir)).toEqual(["sess-layout.yaml"]);
    });

    it("creates the store directory lazily on first write", async () => {
      // Nothing exists yet — the state dir is bare.
      expect(await readdir(stateDir)).toEqual([]);

      await recordAdoption(stateDir, "sess-lazy", { agentName: "keeper" });

      expect(await readdir(stateDir)).toEqual([ADOPTED_SESSIONS_DIR_NAME]);
    });

    it("omits sourceCwd when not supplied", async () => {
      const written = await recordAdoption(stateDir, "sess-nocwd", { agentName: "keeper" });
      expect(written.sourceCwd).toBeUndefined();

      const read = await getAdoption(stateDir, "sess-nocwd");
      expect(read?.sourceCwd).toBeUndefined();
    });

    it("is idempotent: re-adopting overwrites cleanly and does not throw", async () => {
      await recordAdoption(stateDir, "sess-dup", {
        agentName: "agent-one",
        adoptedAt: "2024-01-15T10:00:00.000Z",
      });

      const second = await recordAdoption(stateDir, "sess-dup", {
        agentName: "agent-two",
        sourceCwd: "/second/cwd",
        adoptedAt: "2024-01-16T10:00:00.000Z",
      });

      expect(second.agentName).toBe("agent-two");
      expect(second.adoptedAt).toBe("2024-01-16T10:00:00.000Z");

      // Exactly one file, holding the latest claim.
      const files = await readdir(getAdoptedSessionsDir(stateDir));
      expect(files).toEqual(["sess-dup.yaml"]);

      const read = await getAdoption(stateDir, "sess-dup");
      expect(read).toEqual({
        version: 1,
        sessionId: "sess-dup",
        agentName: "agent-two",
        adoptedAt: "2024-01-16T10:00:00.000Z",
        sourceCwd: "/second/cwd",
      });
    });

    it("returns null for a session that was never adopted", async () => {
      await recordAdoption(stateDir, "sess-present", { agentName: "keeper" });
      expect(await getAdoption(stateDir, "sess-absent")).toBeNull();
    });

    it("returns null when the store directory does not exist", async () => {
      expect(await getAdoption(stateDir, "sess-anything")).toBeNull();
    });
  });

  describe("listAdoptions", () => {
    it("returns an empty list when the store directory is missing", async () => {
      expect(await listAdoptions(stateDir)).toEqual([]);
    });

    it("returns an empty list when the store directory exists but is empty", async () => {
      await mkdir(getAdoptedSessionsDir(stateDir), { recursive: true });
      expect(await listAdoptions(stateDir)).toEqual([]);
    });

    it("returns every record in the store", async () => {
      await recordAdoption(stateDir, "sess-one", { agentName: "agent-a" });
      await recordAdoption(stateDir, "sess-two", { agentName: "agent-b", sourceCwd: "/b" });
      await recordAdoption(stateDir, "sess-three", { agentName: "agent-a" });

      const adoptions = await listAdoptions(stateDir);
      expect(adoptions).toHaveLength(3);

      const byId = new Map(adoptions.map((a) => [a.sessionId, a]));
      expect(byId.get("sess-one")?.agentName).toBe("agent-a");
      expect(byId.get("sess-two")?.agentName).toBe("agent-b");
      expect(byId.get("sess-two")?.sourceCwd).toBe("/b");
      expect(byId.get("sess-three")?.agentName).toBe("agent-a");
    });

    it("ignores non-YAML files in the store directory", async () => {
      await recordAdoption(stateDir, "sess-real", { agentName: "keeper" });
      const dir = getAdoptedSessionsDir(stateDir);
      await writeFile(join(dir, "README.md"), "not a record");
      await writeFile(join(dir, ".sess-real.yaml.tmp.deadbeef"), "half-written");

      const adoptions = await listAdoptions(stateDir);
      expect(adoptions.map((a) => a.sessionId)).toEqual(["sess-real"]);
    });
  });

  describe("removeAdoption", () => {
    it("removes an existing record and reports true", async () => {
      await recordAdoption(stateDir, "sess-gone", { agentName: "keeper" });

      expect(await removeAdoption(stateDir, "sess-gone")).toBe(true);
      expect(await getAdoption(stateDir, "sess-gone")).toBeNull();
      expect(await listAdoptions(stateDir)).toEqual([]);
    });

    it("reports false when there was nothing to remove", async () => {
      await mkdir(getAdoptedSessionsDir(stateDir), { recursive: true });
      expect(await removeAdoption(stateDir, "sess-never")).toBe(false);
    });

    it("reports false when the store directory does not exist", async () => {
      expect(await removeAdoption(stateDir, "sess-never")).toBe(false);
    });
  });

  describe("path traversal", () => {
    const hostile = "../../etc/passwd";

    it("rejects a traversing session id on write", async () => {
      await expect(recordAdoption(stateDir, hostile, { agentName: "keeper" })).rejects.toThrow(
        PathTraversalError,
      );
    });

    it("rejects a traversing session id on read", async () => {
      await expect(getAdoption(stateDir, hostile)).rejects.toThrow(PathTraversalError);
    });

    it("rejects a traversing session id on remove", async () => {
      await expect(removeAdoption(stateDir, hostile)).rejects.toThrow(PathTraversalError);
    });

    it("rejects other unsafe identifiers", async () => {
      for (const id of ["..", "a/b", "", ".hidden"]) {
        await expect(recordAdoption(stateDir, id, { agentName: "keeper" })).rejects.toThrow(
          PathTraversalError,
        );
      }
    });

    it("does not create the store directory when the id is rejected", async () => {
      await expect(recordAdoption(stateDir, hostile, { agentName: "keeper" })).rejects.toThrow(
        PathTraversalError,
      );
      expect(await readdir(stateDir)).toEqual([]);
    });
  });

  describe("malformed records", () => {
    it("tolerates unparseable YAML rather than throwing (getAdoption)", async () => {
      const dir = getAdoptedSessionsDir(stateDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "sess-broken.yaml"), "not valid yaml: [[[", "utf-8");

      await expect(getAdoption(stateDir, "sess-broken")).resolves.toBeNull();
    });

    it("tolerates a record that fails schema validation", async () => {
      const dir = getAdoptedSessionsDir(stateDir);
      await mkdir(dir, { recursive: true });
      // Missing agentName / adoptedAt
      await writeFile(join(dir, "sess-invalid.yaml"), yaml.stringify({ foo: "bar" }), "utf-8");

      await expect(getAdoption(stateDir, "sess-invalid")).resolves.toBeNull();
    });

    it("skips malformed records and still lists the valid ones", async () => {
      await recordAdoption(stateDir, "sess-good", { agentName: "keeper" });

      const dir = getAdoptedSessionsDir(stateDir);
      await writeFile(join(dir, "sess-broken.yaml"), "not valid yaml: [[[", "utf-8");
      await writeFile(join(dir, "sess-invalid.yaml"), yaml.stringify({ foo: "bar" }), "utf-8");

      const adoptions = await listAdoptions(stateDir);
      expect(adoptions.map((a) => a.sessionId)).toEqual(["sess-good"]);
    });

    it("overwrites a corrupted record on re-adoption", async () => {
      const dir = getAdoptedSessionsDir(stateDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "sess-fix.yaml"), "not valid yaml: [[[", "utf-8");

      await recordAdoption(stateDir, "sess-fix", { agentName: "keeper" });

      expect((await getAdoption(stateDir, "sess-fix"))?.agentName).toBe("keeper");
    });
  });
});
