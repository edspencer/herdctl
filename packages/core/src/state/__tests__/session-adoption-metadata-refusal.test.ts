/**
 * Adoption × #419 — a metadata write refusal must not abort an adoption listing.
 *
 * This covers an interaction that did not exist before the #423 adoption work
 * was merged with #419, and which nothing else exercises:
 *
 *   - #419 made `SessionMetadataStore` REFUSE to overwrite an existing metadata
 *     file it cannot read, throwing `SessionMetadataUnreadableError` rather than
 *     silently replacing it with an empty one.
 *   - The adoption paths (`listAdoptableSessions`, `adoptSessionsFrom`) warm the
 *     very same caches — auto-name, preview and sidechain — as the two ordinary
 *     listing paths, but they were written before that refusal existed.
 *
 * So a single corrupt `session-metadata/<agent>.json` — pure cache, never user
 * data — could take down adoption entirely: the user cannot list what they could
 * adopt, and cannot adopt anything, because of a damaged file that has nothing
 * to do with the transcripts being adopted. The refusal must degrade to a cold
 * cache, exactly as `persistCacheUpdates` makes it degrade for `getAgentSessions`
 * / `getAllSessions`.
 *
 * Deliberately HIGH-fidelity, matching the rest of the #423 suite: the REAL
 * metadata store (so the refusal is genuine, not a mocked rejection), the REAL
 * parser, attribution index and adoption store. Nothing is stubbed.
 *
 * Working directories sit under `/srv/herdctl423/...` because `getAllSessions`
 * discards anything under `os.tmpdir()` as scratch; only their *encoding*
 * matters, so they need not exist on disk.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePathForCli } from "../../runner/runtime/cli-session-path.js";
import { getAdoption } from "../adopted-sessions.js";
import { SessionDiscoveryService } from "../session-discovery.js";

const AGENT = "keeper";

/** A realistic CLI transcript for a session recorded in `workingDirectory`. */
function transcript(options: {
  workingDirectory: string;
  sessionId: string;
  title?: string;
  text?: string;
}): string {
  const { workingDirectory, sessionId, title, text } = options;
  const entries: Array<Record<string, unknown>> = [];
  if (title) {
    entries.push({ type: "ai-title", aiTitle: title });
  }
  entries.push({
    type: "user",
    uuid: `u-${sessionId}`,
    sessionId,
    cwd: workingDirectory,
    isSidechain: false,
    timestamp: "2026-07-01T09:00:00.000Z",
    message: { role: "user", content: text ?? `work in ${workingDirectory}` },
  });
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

describe("session adoption × unreadable session metadata (herdctl#423 × #419)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let stateDir: string;
  let agentDir: string;
  let otherDir: string;
  let metadataFile: string;

  /** Bytes of the corrupt metadata file, so we can prove it survives untouched. */
  const CORRUPT_METADATA = '{"version":1,"agentName":"keeper","sessions":{"a":{"customName":';

  const dirFor = (workingDirectory: string) =>
    path.join(claudeHome, "projects", encodePathForCli(workingDirectory));

  async function writeTranscript(
    workingDirectory: string,
    sessionId: string,
    options: { title?: string; text?: string } = {},
  ): Promise<void> {
    const dir = dirFor(workingDirectory);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, `${sessionId}.jsonl`),
      transcript({ workingDirectory, sessionId, ...options }),
    );
  }

  /**
   * Plant a metadata file that the store can open but cannot parse — truncated
   * JSON. `loadForWrite` classifies it as unreadable, so every cache write for
   * this agent throws `SessionMetadataUnreadableError`.
   */
  async function plantCorruptMetadata(): Promise<void> {
    await mkdir(path.join(stateDir, "session-metadata"), { recursive: true });
    await writeFile(metadataFile, CORRUPT_METADATA);
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "adoption-metadata-refusal-"));
    claudeHome = path.join(tempRoot, "claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    const unique = path.basename(tempRoot).replace(/[^A-Za-z0-9]/g, "");
    agentDir = `/srv/herdctl423/${unique}/agent`;
    otherDir = `/srv/herdctl423/${unique}/terminal`;
    metadataFile = path.join(stateDir, "session-metadata", `${AGENT}.json`);
    await mkdir(stateDir, { recursive: true });
    await mkdir(path.join(claudeHome, "projects"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  function makeService() {
    return new SessionDiscoveryService({ stateDir, claudeHomePath: claudeHome });
  }

  it("listAdoptableSessions still lists candidates when the metadata cache write is refused", async () => {
    await writeTranscript(agentDir, "sess-one", { title: "First terminal chat" });
    await writeTranscript(agentDir, "sess-two", { title: "Second terminal chat" });
    await plantCorruptMetadata();

    const adoptable = await makeService().listAdoptableSessions(AGENT, agentDir);

    // The listing survives: both candidates are returned, fully enriched. The
    // refusal only prevented the RESULT being cached — the extraction itself
    // (which reads transcripts, not metadata) is unaffected.
    expect(adoptable.map((s) => s.sessionId).sort()).toEqual(["sess-one", "sess-two"]);
    expect(adoptable.find((s) => s.sessionId === "sess-one")?.autoName).toBe("First terminal chat");
    expect(adoptable.find((s) => s.sessionId === "sess-two")?.autoName).toBe(
      "Second terminal chat",
    );
  });

  it("leaves the damaged metadata file byte-for-byte untouched", async () => {
    await writeTranscript(agentDir, "sess-one", { title: "First terminal chat" });
    await plantCorruptMetadata();

    await makeService().listAdoptableSessions(AGENT, agentDir);

    // The #419 guarantee: refusing to write means the operator can still
    // recover whatever the file held.
    expect(await readFile(metadataFile, "utf-8")).toBe(CORRUPT_METADATA);
  });

  it("adoptSessionsFrom still adopts when the metadata cache write is refused", async () => {
    // Source differs from the agent's own directory, so this exercises real
    // placement (copy) as well as the record write.
    await writeTranscript(otherDir, "sess-copied", { title: "Chat from the terminal" });
    await plantCorruptMetadata();

    const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
      fromWorkingDir: otherDir,
    });

    expect(result.adopted).toEqual(["sess-copied"]);
    expect(result.skipped).toEqual([]);

    // The adoption record — the part that is real user intent rather than cache
    // — was written despite the cache refusal.
    const record = await getAdoption(stateDir, "sess-copied");
    expect(record?.agentName).toBe(AGENT);
    expect(record?.sourceCwd).toBe(otherDir);
  });

  it("an adopted session is discoverable afterwards despite the refusal", async () => {
    await writeTranscript(agentDir, "sess-inplace", { title: "Already in the right folder" });
    await plantCorruptMetadata();

    const service = makeService();
    await service.adoptSessionsFrom(AGENT, agentDir);

    // End-to-end: the whole point of adoption is that the session becomes
    // visible under the agent. A poisoned cache file must not break that.
    const sessions = await service.getAgentSessions(AGENT, agentDir, false);
    expect(sessions.map((s) => s.sessionId)).toEqual(["sess-inplace"]);
    expect(sessions[0].origin).toBe("adopted");
  });
});
