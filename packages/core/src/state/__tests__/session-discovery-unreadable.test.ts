import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Mocks
//
// This suite deliberately leaves the REAL `jsonl-parser` in place so the
// enrichment path streams real files. That's the whole point: a directory named
// `<uuid>.jsonl` reproduces the genuine EISDIR that `open(2)`-succeeds /
// `read(2)`-fails yields on Linux (issue #424) — a mock can't reproduce that.
//
// `cli-session-path` is mocked in ONE respect only: `getCliSessionDir` /
// `getCliSessionFile` normally derive their path from `os.homedir()`, NOT from
// the service's `claudeHomePath`. In production those coincide (`claudeHomePath`
// IS `~/.claude`), so the poison directory that the listing finds is the same
// file the enrichment then reads. Under test we point both at the temp fixture
// via `hoisted.claudeHome`; everything else in the module stays real.
//
// Attribution and the metadata store ARE mocked: attribution so the good
// transcript is attributed to the agent under test, and the metadata store so
// every cache lookup misses (forcing real extraction) without touching disk.
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

vi.mock("../session-attribution.js", async (importActual) => {
  const actual = await importActual<typeof import("../session-attribution.js")>();
  const fn = vi.fn();
  return {
    // Spread the ACTUAL module so the pure ownership predicates
    // (`isOwnedByAgent`, `isUnattributed`, `canAgentAdopt` — herdctl#437)
    // survive the mock. Only the index *builder* is replaced; the predicates
    // are the shared logic under test and must not be stubbed out.
    ...actual,
    buildAttributionIndex: fn,
    AttributionIndexBuilder: class MockAttributionIndexBuilder {
      build = fn;
    },
  };
});

const mockGetCustomName = vi.fn().mockResolvedValue(undefined);
const mockGetAutoName = vi.fn().mockResolvedValue(undefined);
const mockBatchSetAutoNames = vi.fn().mockResolvedValue(undefined);
const mockGetPreview = vi.fn().mockResolvedValue(undefined);
const mockBatchSetPreviews = vi.fn().mockResolvedValue(undefined);
const mockGetSidechain = vi.fn().mockResolvedValue(undefined);
const mockBatchSetSidechains = vi.fn().mockResolvedValue(undefined);
const mockGetUsage = vi.fn().mockResolvedValue(undefined);
const mockSetUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("../session-metadata.js", () => ({
  SessionMetadataStore: class MockSessionMetadataStore {
    getCustomName = mockGetCustomName;
    getAutoName = mockGetAutoName;
    batchSetAutoNames = mockBatchSetAutoNames;
    getPreview = mockGetPreview;
    batchSetPreviews = mockBatchSetPreviews;
    getSidechain = mockGetSidechain;
    batchSetSidechains = mockBatchSetSidechains;
    getUsage = mockGetUsage;
    setUsage = mockSetUsage;
  },
}));

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

/** A poison entry: a DIRECTORY named `<uuid>.jsonl`. `stat()`s as a valid file,
 * throws EISDIR on read. */
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

describe("SessionDiscoveryService — unreadable transcript entries (issue #424)", () => {
  let claudeHomePath: string;
  let tempStateDir: string;
  const workingDir = "/Users/ed/Code/myproject";
  const encodedPath = "-Users-ed-Code-myproject";
  const goodId = "11111111-1111-1111-1111-111111111111";
  const poisonId = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    const home = await createTempDir("claude-home-unreadable");
    claudeHomePath = join(home, ".claude");
    await mkdir(claudeHomePath, { recursive: true });
    hoisted.claudeHome = claudeHomePath;
    tempStateDir = await createTempDir("state-dir-unreadable");
    mockBuildAttributionIndex.mockResolvedValue(mockAttribution(new Set([goodId]), "my-agent"));
  });

  afterEach(async () => {
    await rm(join(claudeHomePath, ".."), { recursive: true, force: true });
    await rm(tempStateDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("getAgentSessions returns the good session even when a sibling entry is an unreadable directory", async () => {
    const projectDir = join(claudeHomePath, "projects", encodedPath);
    await mkdir(projectDir, { recursive: true });
    await writeGoodTranscript(projectDir, goodId, workingDir);
    await writePoisonEntry(projectDir, poisonId);

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });

    const sessions = await discovery.getAgentSessions("my-agent", workingDir, false);

    const ids = sessions.map((s) => s.sessionId);
    expect(ids).toContain(goodId);
    expect(ids).not.toContain(poisonId);
  });

  it("getAllSessions returns the good session even when a sibling entry is an unreadable directory", async () => {
    const projectDir = join(claudeHomePath, "projects", encodedPath);
    await mkdir(projectDir, { recursive: true });
    await writeGoodTranscript(projectDir, goodId, workingDir);
    await writePoisonEntry(projectDir, poisonId);

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });

    const groups = await discovery.getAllSessions([
      { name: "my-agent", workingDirectory: workingDir, dockerEnabled: false },
    ]);

    const allIds = groups.flatMap((g) => g.sessions.map((s) => s.sessionId));
    expect(allIds).toContain(goodId);
    expect(allIds).not.toContain(poisonId);
  });

  it("getAllSessions still lists other directories when one directory holds an unreadable entry", async () => {
    // Two sibling project directories; the poison lives in one of them. Before the
    // fix, one bad entry aborted enrichment for every directory in the listing.
    const otherWorkingDir = "/Users/ed/Code/other";
    const otherEncoded = "-Users-ed-Code-other";
    const otherId = "33333333-3333-3333-3333-333333333333";

    const projectDir = join(claudeHomePath, "projects", encodedPath);
    const otherDir = join(claudeHomePath, "projects", otherEncoded);
    await mkdir(projectDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });
    await writeGoodTranscript(projectDir, goodId, workingDir);
    await writePoisonEntry(projectDir, poisonId);
    await writeGoodTranscript(otherDir, otherId, otherWorkingDir);

    mockBuildAttributionIndex.mockResolvedValue(
      mockAttribution(new Set([goodId, otherId]), "my-agent"),
    );

    const discovery = new SessionDiscoveryService({ claudeHomePath, stateDir: tempStateDir });

    const groups = await discovery.getAllSessions([
      { name: "my-agent", workingDirectory: workingDir, dockerEnabled: false },
      { name: "other-agent", workingDirectory: otherWorkingDir, dockerEnabled: false },
    ]);

    const allIds = groups.flatMap((g) => g.sessions.map((s) => s.sessionId));
    expect(allIds).toContain(goodId);
    expect(allIds).toContain(otherId);
    expect(allIds).not.toContain(poisonId);
  });
});
