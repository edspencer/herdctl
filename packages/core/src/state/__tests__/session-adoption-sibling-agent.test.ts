/**
 * Tests for herdctl#437 — adoption must offer only *unattributed* sessions.
 *
 * `scanAdoptionCandidates` used to gate on `attribution.origin !== "native"`,
 * but `triggerTypeToOrigin` folds `manual`, `webhook`, `chat` and `fork` into
 * `"native"`. So a session with a genuine job record under a **sibling agent**
 * resolved to `{ origin: "native", agentName: "sweeper-x" }`: it passed the
 * adoption gate (its origin really is native) and then failed the listing gate
 * in `enrichAgentSession` (`attribution.agentName !== agentName`). The adoption
 * record was written, lost the precedence contest (job → platform → adopted →
 * native), and the session was reported as imported while never appearing —
 * and, because the marker was burned, was excluded from every retry.
 *
 * Everything here is REAL: real transcripts, real job records, real adoption
 * store, real attribution index. That is the whole point — the fixtures used
 * while #423 was developed had **no job records at all**, which is why every
 * earlier test passed.
 *
 * Working directories live under `/srv/herdctl437/...` rather than a temp path
 * because `getAllSessions` filters out anything under `os.tmpdir()` as scratch.
 * Only their *encoding* matters; they never have to exist on disk.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import { encodePathForCli } from "../../runner/runtime/cli-session-path.js";
import { getAdoption, listAdoptions, recordAdoption } from "../adopted-sessions.js";
import { SessionAdoptionRefusedError } from "../errors.js";
import type { TriggerType } from "../schemas/job-metadata.js";
import { SessionDiscoveryService } from "../session-discovery.js";

/** The agent doing the adopting. */
const AGENT = "keeper-myproject";
/** A different agent sharing the same transcript directory. */
const SIBLING = "sweeper-myproject";

/** Trigger types that `triggerTypeToOrigin` folds into `"native"`. */
const NATIVE_TRIGGER_TYPES = ["manual", "webhook", "chat", "fork"] as const;

/** A realistic CLI transcript for a session recorded in `workingDirectory`. */
function transcript(workingDirectory: string, sessionId: string): string {
  return `${JSON.stringify({
    type: "user",
    uuid: `u-${sessionId}`,
    sessionId,
    cwd: workingDirectory,
    isSidechain: false,
    timestamp: "2026-07-01T09:00:00.000Z",
    message: { role: "user", content: `work in ${workingDirectory}` },
  })}\n`;
}

describe("session adoption vs sibling-agent attribution (herdctl#437)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let stateDir: string;
  /** The adopting agent's own working directory (adoption destination). */
  let agentDir: string;
  /** A different directory the user ran `claude` in (adoption source). */
  let otherDir: string;
  let jobSeq = 0;

  const dirFor = (workingDirectory: string) =>
    path.join(claudeHome, "projects", encodePathForCli(workingDirectory));

  async function writeTranscript(
    workingDirectory: string,
    sessionId: string,
    options: { mtime?: Date } = {},
  ): Promise<string> {
    const dir = dirFor(workingDirectory);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.jsonl`);
    await writeFile(file, transcript(workingDirectory, sessionId));
    if (options.mtime) {
      await utimes(file, options.mtime, options.mtime);
    }
    return file;
  }

  /**
   * Write a real `job-<id>.yaml` claiming `sessionId` for `agent`.
   *
   * This is the fixture the #423 tests never had. `AttributionIndexBuilder`
   * reads these files straight out of `<stateDir>/jobs/`, so nothing is mocked.
   */
  async function writeJobRecord(
    agent: string,
    sessionId: string,
    triggerType: TriggerType = "chat",
  ): Promise<void> {
    const jobsDir = path.join(stateDir, "jobs");
    await mkdir(jobsDir, { recursive: true });
    jobSeq += 1;
    const id = `job-2026-07-01-${String(jobSeq).padStart(6, "0")}`;
    await writeFile(
      path.join(jobsDir, `${id}.yaml`),
      yaml.stringify({
        id,
        agent,
        trigger_type: triggerType,
        status: "completed",
        exit_reason: "success",
        session_id: sessionId,
        started_at: "2026-07-01T09:00:00.000Z",
        finished_at: "2026-07-01T09:05:00.000Z",
      }),
    );
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "session-adoption-437-"));
    claudeHome = path.join(tempRoot, "claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    const unique = path.basename(tempRoot).replace(/[^A-Za-z0-9]/g, "");
    agentDir = `/srv/herdctl437/${unique}/agent`;
    otherDir = `/srv/herdctl437/${unique}/terminal`;
    await mkdir(stateDir, { recursive: true });
    await mkdir(path.join(claudeHome, "projects"), { recursive: true });
    jobSeq = 0;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  function makeService(options?: { cacheTtlMs?: number }) {
    return new SessionDiscoveryService({ stateDir, claudeHomePath: claudeHome, ...options });
  }

  // ===========================================================================
  // The scan gate
  // ===========================================================================

  describe("listAdoptableSessions", () => {
    it("does not offer a session owned by a sibling agent", async () => {
      await writeTranscript(otherDir, "sess-sibling");
      await writeJobRecord(SIBLING, "sess-sibling", "chat");

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual([]);
    });

    it.each(
      NATIVE_TRIGGER_TYPES,
    )("does not offer a sibling-owned session with trigger_type %s (folds to origin native)", async (triggerType) => {
      await writeTranscript(otherDir, `sess-${triggerType}`);
      await writeJobRecord(SIBLING, `sess-${triggerType}`, triggerType);

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual([]);
    });

    it("still offers a genuinely unattributed transcript alongside an owned one", async () => {
      await writeTranscript(otherDir, "sess-free");
      await writeTranscript(otherDir, "sess-owned");
      await writeJobRecord(SIBLING, "sess-owned", "chat");

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual(["sess-free"]);
    });

    it("does not offer a session the adopting agent already owns via its own job record", async () => {
      // The same-agent case behaves DIFFERENTLY from the sibling case and would
      // pass a naive regression test: this session is already visible under the
      // agent, so an adoption record buys nothing. Pinned so the distinction
      // cannot quietly collapse into "any job record is a sibling's".
      await writeTranscript(agentDir, "sess-mine");
      await writeJobRecord(AGENT, "sess-mine", "chat");

      const service = makeService();
      const listed = await service.listAdoptableSessions(AGENT, agentDir);
      const visible = await service.getAgentSessions(AGENT, agentDir, false);

      expect(listed.map((s) => s.sessionId)).toEqual([]);
      // ...because it is already there, not because it is hidden.
      expect(visible.map((s) => s.sessionId)).toEqual(["sess-mine"]);
    });

    it("control: a `web` job record was already excluded before the fix", async () => {
      // `trigger_type: "web"` maps to origin "web", so the OLD `origin !==
      // "native"` gate already caught it. A regression test built on this
      // trigger type passes against the unfixed code and proves nothing — it is
      // kept only to document why the four native-folding types above matter.
      await writeTranscript(otherDir, "sess-web");
      await writeJobRecord(SIBLING, "sess-web", "web");

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual([]);
    });
  });

  // ===========================================================================
  // The batch adopt path
  // ===========================================================================

  describe("adoptSessionsFrom", () => {
    it("skips a sibling-owned session and names the owner", async () => {
      await writeTranscript(otherDir, "sess-sibling");
      await writeJobRecord(SIBLING, "sess-sibling", "chat");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      expect(result.adopted).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          sessionId: "sess-sibling",
          reason: "attributed-to-run",
          ownedBy: SIBLING,
        }),
      ]);
      // Nothing inert was written, so a retry is still possible.
      expect(await listAdoptions(stateDir)).toEqual([]);
    });

    it("reports exactly the sessions that then become visible", async () => {
      // The headline symptom: "Imported 96 chats" while the chat count moves by
      // 2. Every id in `adopted` must actually show up under the agent.
      await writeTranscript(otherDir, "sess-free-a");
      await writeTranscript(otherDir, "sess-free-b");
      for (const id of ["sess-owned-a", "sess-owned-b", "sess-owned-c"]) {
        await writeTranscript(otherDir, id);
        await writeJobRecord(SIBLING, id, "chat");
      }

      const service = makeService();
      const result = await service.adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });
      const visible = await service.getAgentSessions(AGENT, agentDir, false);

      expect(result.adopted.sort()).toEqual(["sess-free-a", "sess-free-b"]);
      expect(visible.map((s) => s.sessionId).sort()).toEqual(result.adopted.sort());
    });

    it("refuses a candidate that becomes sibling-owned between the scan and the write", async () => {
      // The scan and the write are separated by real I/O (a 1500-transcript
      // import runs for minutes), so the scan's verdict can go stale. Simulate
      // that by writing the sibling's job record from inside the first
      // placement, with the attribution cache disabled so the write-site guard
      // genuinely re-reads state.
      // Explicit mtimes: candidates are scanned newest-first, so this pins
      // `sess-a` as the first placement and `sess-b` as the one the sibling
      // claims mid-batch.
      await writeTranscript(otherDir, "sess-a", { mtime: new Date("2026-07-02T00:00:00Z") });
      await writeTranscript(otherDir, "sess-b", { mtime: new Date("2026-07-01T00:00:00Z") });

      type Placer = { placeTranscript: (...a: unknown[]) => Promise<void> };
      const service = makeService({ cacheTtlMs: 0 });
      const real = (service as unknown as Placer).placeTranscript;
      const place = vi
        .spyOn(service as unknown as Placer, "placeTranscript")
        .mockImplementation(async (...args: unknown[]) => {
          await writeJobRecord(SIBLING, "sess-b", "manual");
          place.mockRestore();
          return real.apply(service, args);
        });

      const result = await service.adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      expect(result.adopted).toEqual(["sess-a"]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          sessionId: "sess-b",
          reason: "attributed-to-run",
          ownedBy: SIBLING,
        }),
      ]);
      expect(await getAdoption(stateDir, "sess-b")).toBeNull();
    });
  });

  // ===========================================================================
  // The single-session adopt path
  // ===========================================================================

  describe("adoptSession", () => {
    it("refuses a session that became sibling-owned between the scan and the adopt", async () => {
      await writeTranscript(agentDir, "sess-race");

      const service = makeService();
      const listed = await service.listAdoptableSessions(AGENT, agentDir);
      expect(listed.map((s) => s.sessionId)).toEqual(["sess-race"]);

      // A sibling's run lands between the picker rendering and the user clicking.
      await writeJobRecord(SIBLING, "sess-race", "chat");
      // Drops the attribution index too, standing in for the TTL lapsing.
      service.invalidateWorkingDirectory(agentDir);

      await expect(
        service.adoptSession(AGENT, "sess-race", { workingDirectory: agentDir }),
      ).rejects.toBeInstanceOf(SessionAdoptionRefusedError);

      // The refusal must leave no inert record behind, or the retry path is dead.
      expect(await getAdoption(stateDir, "sess-race")).toBeNull();
    });

    it("carries the owning agent on the refusal", async () => {
      await writeTranscript(agentDir, "sess-owned");
      await writeJobRecord(SIBLING, "sess-owned", "fork");

      const error = await makeService()
        .adoptSession(AGENT, "sess-owned", { workingDirectory: agentDir })
        .then(
          () => null,
          (e: unknown) => e as SessionAdoptionRefusedError,
        );

      expect(error).toBeInstanceOf(SessionAdoptionRefusedError);
      expect(error?.sessionId).toBe("sess-owned");
      expect(error?.ownedBy).toBe(SIBLING);
      expect(error?.message).toContain(SIBLING);
    });

    it("still allows claiming a session this agent already owns (idempotent no-op)", async () => {
      // Same-agent again: the record cannot win precedence either, but the
      // session is already visible under the agent, so refusing would break a
      // legitimate re-claim.
      await writeTranscript(agentDir, "sess-mine");
      await writeJobRecord(AGENT, "sess-mine", "chat");

      const record = await makeService().adoptSession(AGENT, "sess-mine", {
        workingDirectory: agentDir,
      });

      expect(record.agentName).toBe(AGENT);
    });

    it("still allows re-adopting a session another agent had merely adopted", async () => {
      // Adoption records do NOT outrank a later adoption — `recordAdoption`
      // overwrites — so this one really would take effect and must be allowed.
      await writeTranscript(agentDir, "sess-handover");
      await recordAdoption(stateDir, "sess-handover", { agentName: SIBLING });

      const service = makeService();
      const record = await service.adoptSession(AGENT, "sess-handover", {
        workingDirectory: agentDir,
      });

      expect(record.agentName).toBe(AGENT);
      const visible = await service.getAgentSessions(AGENT, agentDir, false);
      expect(visible.map((s) => s.sessionId)).toEqual(["sess-handover"]);
    });

    it("still allows adopting a genuinely unattributed session", async () => {
      await writeTranscript(agentDir, "sess-free");

      const service = makeService();
      const record = await service.adoptSession(AGENT, "sess-free", {
        workingDirectory: agentDir,
      });

      expect(record.agentName).toBe(AGENT);
      const visible = await service.getAgentSessions(AGENT, agentDir, false);
      expect(visible.map((s) => s.sessionId)).toEqual(["sess-free"]);
    });
  });
});
