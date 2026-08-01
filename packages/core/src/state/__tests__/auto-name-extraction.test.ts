/**
 * Tests for auto-name extraction through session discovery (herdctl#423,
 * gotchas 3 & 5).
 *
 * Two things are pinned here, and both need the REAL parser and the REAL
 * metadata store — `session-discovery.test.ts` mocks both, so it can prove the
 * plumbing but not the behaviour:
 *
 * 1. A terminal transcript's display name comes from its title entries
 *    (`custom-title` → `ai-title` → `summary`), with the first user message as
 *    a fallback. Summary-only extraction left every CLI session showing its raw
 *    session id, because CLI sessions never emit `type:"summary"`.
 * 2. Changing that extraction logic actually reaches existing data. The
 *    auto-name cache is authoritative on `autoNameMtime`, including for
 *    negative results, so every already-listed session holds an entry that
 *    would keep winning forever. The per-field `autoNameVersion` stamp makes
 *    such an entry miss exactly once — WITHOUT discarding the rest of the
 *    entry, which is what bumping the file-level schema `version` would do
 *    (`loadMetadata` drops the whole file on a parse failure, taking user-set
 *    custom names with it).
 */

import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodePathForCli } from "../../runner/runtime/cli-session-path.js";
import { SessionDiscoveryService } from "../session-discovery.js";
import { AUTO_NAME_EXTRACTOR_VERSION } from "../session-metadata.js";

const AGENT = "keeper";

/** A transcript line set with an optional title entry, as JSONL text. */
function transcript(options: {
  workingDirectory: string;
  sessionId: string;
  titleEntries?: Array<Record<string, unknown>>;
  firstUserText?: string;
}): string {
  const { workingDirectory, sessionId, titleEntries = [], firstUserText } = options;
  const entries: Array<Record<string, unknown>> = [
    ...titleEntries,
    {
      type: "user",
      uuid: "u-1",
      sessionId,
      cwd: workingDirectory,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: { role: "user", content: firstUserText ?? "hello from the terminal" },
    },
  ];
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

describe("auto-name extraction (herdctl#423)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let stateDir: string;
  /** Non-temp-looking so `getAllSessions` doesn't filter it out as scratch. */
  let workDir: string;
  let sessionDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "auto-name-"));
    claudeHome = path.join(tempRoot, "claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    workDir = `/srv/herdctl423/${path.basename(tempRoot).replace(/[^A-Za-z0-9]/g, "")}`;
    sessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(sessionDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  function makeService() {
    return new SessionDiscoveryService({ stateDir, claudeHomePath: claudeHome });
  }

  async function listOne(sessionId: string) {
    const groups = await makeService().getAllSessions([
      { name: AGENT, workingDirectory: workDir, dockerEnabled: false },
    ]);
    return groups.flatMap((g) => g.sessions).find((s) => s.sessionId === sessionId);
  }

  async function readMetadataEntry(sessionId: string) {
    const raw = await readFile(path.join(stateDir, "session-metadata", `${AGENT}.json`), "utf-8");
    return JSON.parse(raw).sessions[sessionId] as Record<string, unknown>;
  }

  it("prefers a custom-title over an ai-title and a summary", async () => {
    const sessionId = "sess-titled";
    await writeFile(
      path.join(sessionDir, `${sessionId}.jsonl`),
      transcript({
        workingDirectory: workDir,
        sessionId,
        titleEntries: [
          { type: "summary", summary: "Summary title" },
          { type: "custom-title", customTitle: "What the user called it" },
          // A LATER ai-title must not clobber the user's own title: precedence
          // is by entry type, not file position.
          { type: "ai-title", aiTitle: "What the model called it" },
        ],
      }),
    );

    expect((await listOne(sessionId))?.autoName).toBe("What the user called it");
  });

  it("falls back to the first user message when the transcript has no title entry", async () => {
    const sessionId = "sess-untitled";
    await writeFile(
      path.join(sessionDir, `${sessionId}.jsonl`),
      transcript({
        workingDirectory: workDir,
        sessionId,
        firstUserText: "fix the flaky test in the parser",
      }),
    );

    // The pre-#423 behaviour: no `type:"summary"` entry, so no name at all, so
    // the UI rendered the raw session id.
    expect((await listOne(sessionId))?.autoName).toBe("fix the flaky test in the parser");
  });

  it("stamps the extractor version on every cache write", async () => {
    const sessionId = "sess-stamped";
    await writeFile(
      path.join(sessionDir, `${sessionId}.jsonl`),
      transcript({
        workingDirectory: workDir,
        sessionId,
        titleEntries: [{ type: "ai-title", aiTitle: "Model chosen title" }],
      }),
    );

    await listOne(sessionId);

    const entry = await readMetadataEntry(sessionId);
    expect(entry.autoName).toBe("Model chosen title");
    expect(entry.autoNameVersion).toBe(AUTO_NAME_EXTRACTOR_VERSION);
  });

  it("re-extracts a legacy entry once and preserves the rest of it", async () => {
    const sessionId = "sess-legacy";
    const transcriptPath = path.join(sessionDir, `${sessionId}.jsonl`);
    await writeFile(
      transcriptPath,
      transcript({
        workingDirectory: workDir,
        sessionId,
        titleEntries: [{ type: "ai-title", aiTitle: "Recovered by the new extractor" }],
      }),
    );

    // A metadata file exactly as the previous release would have left it: the
    // old extractor found no `summary`, negative-cached that against a mtime
    // that is still current, and there is no `autoNameVersion` field at all.
    // The user has since renamed the chat, and the preview/usage caches are
    // warm — none of that may be lost to a cache invalidation.
    await mkdir(path.join(stateDir, "session-metadata"), { recursive: true });
    await writeFile(
      path.join(stateDir, "session-metadata", `${AGENT}.json`),
      JSON.stringify({
        version: 1,
        agentName: AGENT,
        sessions: {
          [sessionId]: {
            customName: "The name the user typed",
            autoNameMtime: "2099-01-01T00:00:00.000Z",
            preview: "hello from the terminal",
            previewMtime: "2099-01-01T00:00:00.000Z",
            isSidechain: false,
            isSidechainMtime: "2099-01-01T00:00:00.000Z",
            usage: { inputTokens: 1234, turnCount: 2, hasData: true },
            usageMtime: "2099-01-01T00:00:00.000Z",
          },
        },
      }),
    );

    const listed = await listOne(sessionId);

    // The whole point: the legacy negative cache did NOT win.
    expect(listed?.autoName).toBe("Recovered by the new extractor");
    // ...and the user's own name is still there, on the returned session...
    expect(listed?.customName).toBe("The name the user typed");

    // ...and on disk, along with every other cached field.
    const entry = await readMetadataEntry(sessionId);
    expect(entry).toMatchObject({
      customName: "The name the user typed",
      autoName: "Recovered by the new extractor",
      autoNameVersion: AUTO_NAME_EXTRACTOR_VERSION,
      preview: "hello from the terminal",
      isSidechain: false,
      usage: { inputTokens: 1234, turnCount: 2, hasData: true },
    });

    // The miss costs one re-extraction per session, not one per listing: the
    // rewritten entry is now stamped, so the next pass is a cache hit. Proven
    // by rewriting the transcript's title while RESTORING its mtime — only a
    // re-extraction could pick the new title up.
    const before = await stat(transcriptPath);
    await writeFile(
      transcriptPath,
      transcript({
        workingDirectory: workDir,
        sessionId,
        titleEntries: [{ type: "ai-title", aiTitle: "Should not be seen" }],
      }),
    );
    await utimes(transcriptPath, before.atime, before.mtime);

    expect((await listOne(sessionId))?.autoName).toBe("Recovered by the new extractor");
  });
});
