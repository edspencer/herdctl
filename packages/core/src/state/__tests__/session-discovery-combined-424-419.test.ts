import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// #424 × #419 — both failure modes live at once
//
// This suite proves the two fixes *cooperate* rather than merely coexist. It is
// deliberately a HIGH-fidelity integration test:
//
//   - The REAL `jsonl-parser` is used (no mock) so a directory named
//     `<uuid>.jsonl` reproduces the genuine `open(2)`-succeeds / `read(2)`-throws
//     EISDIR that only surfaces at read time on Linux — the #424 trigger.
//   - The REAL `SessionMetadataStore` is used (no mock) so a corrupt
//     `session-metadata/<agent>.json` reproduces the genuine #419 trigger: the
//     store must refuse to overwrite it when the listing warms its caches.
//
// Only `session-attribution` and `cli-session-path` are stubbed, exactly as the
// #424 suite (`session-discovery-unreadable.test.ts`) does: attribution so the
// good transcript is attributed to the agent under test, and `getCliSessionFile`
// / `getCliSessionDir` so per-session reads resolve to the temp fixture instead
// of the real `os.homedir()`. In production those coincide; the mock restores
// that invariant AND keeps the test off the live `~/.claude` tree.
// =============================================================================

const hoisted = vi.hoisted(() => ({ claudeHome: "" }));

vi.mock("../../runner/runtime/cli-session-path.js", async (importActual) => {
  const actual = await importActual<typeof import("../../runner/runtime/cli-session-path.js")>();
  const { join: joinPath } = await import("node:path");
  return {
    ...actual,
    getCliSessionDir: (workspacePath: string) =>
      joinPath(hoisted.claudeHome, "projects", actual.encodePathForCli(workspacePath)),
    getCliSessionFile: (workspacePath: string, sessionId: string) =>
      joinPath(
        hoisted.claudeHome,
        "projects",
        actual.encodePathForCli(workspacePath),
        `${sessionId}.jsonl`,
      ),
  };
});

vi.mock("../session-attribution.js", () => {
  const fn = vi.fn();
  return {
    buildAttributionIndex: fn,
    AttributionIndexBuilder: class MockAttributionIndexBuilder {
      build = fn;
    },
  };
});

import { buildAttributionIndex } from "../session-attribution.js";
import { SessionDiscoveryService } from "../session-discovery.js";

const mockBuildAttributionIndex = vi.mocked(buildAttributionIndex);

// =============================================================================
// Helpers
// =============================================================================

async function createTempDir(prefix: string): Promise<string> {
  const baseDir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

/** A minimal but valid transcript: one plain user line, not a sidechain. */
async function writeGoodTranscript(dir: string, sessionId: string, cwd: string): Promise<void> {
  const line = JSON.stringify({
    type: "user",
    isSidechain: false,
    timestamp: "2026-08-01T00:00:00.000Z",
    cwd,
    message: { role: "user", content: "hello from a healthy transcript" },
  });
  await writeFile(join(dir, `${sessionId}.jsonl`), `${line}\n`);
}

/** A poison entry: a DIRECTORY named `<uuid>.jsonl` — the #424 trigger. */
async function writePoisonEntry(dir: string, sessionId: string): Promise<void> {
  await mkdir(join(dir, `${sessionId}.jsonl`), { recursive: true });
}

function mockAttribution(attributedIds: Set<string>, agentName: string) {
  const getAttribute = (sessionId: string) => ({
    origin: "native" as const,
    agentName: attributedIds.has(sessionId) ? agentName : undefined,
    triggerType: undefined,
  });
  return {
    getAttribute,
    getAttributes: (ids: string[]) => new Map(ids.map((id) => [id, getAttribute(id)])),
    size: 0,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("SessionDiscoveryService — #424 poison entry AND #419 corrupt metadata, simultaneously", () => {
  let tempHome: string;
  let claudeHomePath: string;
  let tempStateDir: string;
  const agentName = "my-agent";
  const workingDir = "/Users/ed/Code/myproject";
  const encodedPath = "-Users-ed-Code-myproject";
  const goodId = "11111111-1111-1111-1111-111111111111";
  const poisonId = "22222222-2222-2222-2222-222222222222";

  // A metadata file that WAS a healthy store for this agent but is now truncated
  // mid-write, so JSON.parse fails. The user-set customName bytes are still on
  // disk and recoverable — unless #419's fix is absent and a listing overwrites
  // the file. `metadataKey` is `agentName` (session-discovery: `metadataKey =
  // agentName ?? "adhoc"`), so `<agent>.json` is exactly what the listing writes.
  const CORRUPT_METADATA =
    `{"version":1,"agentName":"${agentName}","sessions":{` +
    `"${goodId}":{"customName":"Precious user-set name"`;

  async function seedCorruptMetadata(): Promise<string> {
    const metadataDir = join(tempStateDir, "session-metadata");
    await mkdir(metadataDir, { recursive: true });
    const filePath = join(metadataDir, `${agentName}.json`);
    await writeFile(filePath, CORRUPT_METADATA, "utf-8");
    return filePath;
  }

  beforeEach(async () => {
    tempHome = await createTempDir("home-combined");
    tempStateDir = await createTempDir("state-combined");
    claudeHomePath = join(tempHome, ".claude");
    // Route the mocked getCliSessionDir/File at the temp fixture (never ~/.claude).
    hoisted.claudeHome = claudeHomePath;
    mockBuildAttributionIndex.mockResolvedValue(mockAttribution(new Set([goodId]), agentName));

    // Fixture: a good transcript beside a poison directory entry.
    const projectDir = join(claudeHomePath, "projects", encodedPath);
    await mkdir(projectDir, { recursive: true });
    await writeGoodTranscript(projectDir, goodId, workingDir);
    await writePoisonEntry(projectDir, poisonId);
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
    await rm(tempStateDir, { recursive: true, force: true });
    hoisted.claudeHome = "";
    vi.restoreAllMocks();
  });

  it("getAgentSessions returns the good session AND leaves the corrupt metadata file byte-for-byte intact", async () => {
    const filePath = await seedCorruptMetadata();

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });

    const sessions = await discovery.getAgentSessions(agentName, workingDir, false);

    // #424: the poison entry is skipped, the good session survives.
    expect(sessions.map((s) => s.sessionId)).toEqual([goodId]);

    // #419: warming the caches for the good session tried to write <agent>.json,
    // the store refused, and the damaged bytes are untouched — still recoverable.
    const after = await readFile(filePath, "utf-8");
    expect(after).toBe(CORRUPT_METADATA);
    expect(after).toContain("Precious user-set name");
  });

  it("getAllSessions returns the good session, keeps sessionCount in sync, AND preserves the corrupt file", async () => {
    const filePath = await seedCorruptMetadata();

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });

    const groups = await discovery.getAllSessions([
      { name: agentName, workingDirectory: workingDir, dockerEnabled: false },
    ]);

    const allIds = groups.flatMap((g) => g.sessions.map((s) => s.sessionId));
    // #424: only the good session is listed; the poison entry is gone.
    expect(allIds).toContain(goodId);
    expect(allIds).not.toContain(poisonId);

    // The reported count agrees with the sessions actually returned — a *refused
    // write* is not a *skipped read entry*, so it must not perturb the count.
    for (const g of groups) {
      expect(g.sessionCount).toBe(g.sessions.length);
    }

    // #419: the corrupt metadata file is preserved byte-for-byte.
    expect(await readFile(filePath, "utf-8")).toBe(CORRUPT_METADATA);
  });

  it("does not create or leave any stray/temp metadata file — only the original corrupt one remains", async () => {
    await seedCorruptMetadata();

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });
    await discovery.getAllSessions([
      { name: agentName, workingDirectory: workingDir, dockerEnabled: false },
    ]);

    const files = await readdir(join(tempStateDir, "session-metadata"));
    // Exactly the corrupt file — no empty replacement, no lingering atomic temp.
    expect(files).toEqual([`${agentName}.json`]);
  });
});
