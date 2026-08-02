/**
 * Tests for adopting pre-existing Claude Code CLI sessions (herdctl#423).
 *
 * These use REAL transcripts, the REAL attribution index and the REAL adoption
 * store — no parser or metadata mocks — because the headline behaviour is
 * precisely the interaction between them: an unattributed native transcript is
 * invisible under an agent, and an adoption record is what makes it visible.
 *
 * Working directories are deliberately under `/srv/herdctl423/...` rather than
 * a temp path: `getAllSessions` filters out anything under `os.tmpdir()` as
 * scratch. Only the *encoding* of these paths matters — they never have to
 * exist on disk.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import { FleetManager } from "../../fleet-manager/fleet-manager.js";
import { encodePathForCli } from "../../runner/runtime/cli-session-path.js";
import { getAdoptedSessionsDir, getAdoption, listAdoptions } from "../adopted-sessions.js";
import { SessionDiscoveryService } from "../session-discovery.js";
import { PathTraversalError } from "../utils/path-safety.js";

const AGENT = "keeper";

/** A realistic CLI transcript for a session recorded in `workingDirectory`. */
function transcript(options: {
  workingDirectory: string;
  sessionId: string;
  title?: string;
  text?: string;
  isSidechain?: boolean;
}): string {
  const { workingDirectory, sessionId, title, text, isSidechain } = options;
  const entries: Array<Record<string, unknown>> = [];
  if (title) {
    entries.push({ type: "ai-title", aiTitle: title });
  }
  entries.push({
    type: "user",
    uuid: `u-${sessionId}`,
    sessionId,
    cwd: workingDirectory,
    isSidechain: isSidechain === true,
    timestamp: "2026-07-01T09:00:00.000Z",
    message: { role: "user", content: text ?? `work in ${workingDirectory}` },
  });
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

describe("session adoption (herdctl#423)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let stateDir: string;
  /** The agent's own working directory (adoption destination). */
  let agentDir: string;
  /** A different directory the user ran `claude` in (adoption source). */
  let otherDir: string;

  const dirFor = (workingDirectory: string) =>
    path.join(claudeHome, "projects", encodePathForCli(workingDirectory));

  async function writeTranscript(
    workingDirectory: string,
    sessionId: string,
    options: { title?: string; text?: string; isSidechain?: boolean; mtime?: Date } = {},
  ): Promise<string> {
    const dir = dirFor(workingDirectory);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.jsonl`);
    await writeFile(file, transcript({ workingDirectory, sessionId, ...options }));
    if (options.mtime) {
      await utimes(file, options.mtime, options.mtime);
    }
    return file;
  }

  async function exists(file: string): Promise<boolean> {
    try {
      await stat(file);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "session-adoption-"));
    claudeHome = path.join(tempRoot, "claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    const unique = path.basename(tempRoot).replace(/[^A-Za-z0-9]/g, "");
    agentDir = `/srv/herdctl423/${unique}/agent`;
    otherDir = `/srv/herdctl423/${unique}/terminal`;
    await mkdir(stateDir, { recursive: true });
    await mkdir(path.join(claudeHome, "projects"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  });

  function makeService() {
    return new SessionDiscoveryService({ stateDir, claudeHomePath: claudeHome });
  }

  // ===========================================================================
  // listAdoptableSessions
  // ===========================================================================

  describe("listAdoptableSessions", () => {
    it("lists native sessions with the fields a picker needs, newest first", async () => {
      await writeTranscript(otherDir, "sess-old", {
        title: "Older chat",
        mtime: new Date("2026-01-01T00:00:00.000Z"),
      });
      await writeTranscript(otherDir, "sess-new", {
        text: "please refactor the parser",
        mtime: new Date("2026-06-01T00:00:00.000Z"),
      });

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual(["sess-new", "sess-old"]);
      expect(listed[0]).toMatchObject({
        sessionId: "sess-new",
        sourceCwd: otherDir,
        mtime: "2026-06-01T00:00:00.000Z",
        // No title entry → falls back to the first user message.
        autoName: "please refactor the parser",
        preview: "please refactor the parser",
      });
      expect(listed[0].sizeBytes).toBeGreaterThan(0);
      expect(listed[1].autoName).toBe("Older chat");
    });

    it("defaults to the agent's own working directory", async () => {
      await writeTranscript(agentDir, "sess-own", { title: "Already here" });
      await writeTranscript(otherDir, "sess-elsewhere", { title: "Somewhere else" });

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir);

      expect(listed.map((s) => s.sessionId)).toEqual(["sess-own"]);
      expect(listed[0].sourceCwd).toBe(agentDir);
    });

    it("excludes sidechains, adopted sessions and sessions attributed to a run", async () => {
      await writeTranscript(otherDir, "sess-plain");
      await writeTranscript(otherDir, "sess-sidechain", { isSidechain: true });
      await writeTranscript(otherDir, "sess-adopted");
      await writeTranscript(otherDir, "sess-webrun");

      // Already adopted (by any agent).
      await makeService().adoptSession("someone-else", "sess-adopted");
      // Attributed to a real run via a platform session record.
      await mkdir(path.join(stateDir, "web-sessions"), { recursive: true });
      await writeFile(
        path.join(stateDir, "web-sessions", `${AGENT}.yaml`),
        yaml.stringify({
          version: 1,
          agentName: AGENT,
          channels: {
            "chan-1": { sessionId: "sess-webrun", lastMessageAt: "2026-07-01T00:00:00Z" },
          },
        }),
      );

      const listed = await makeService().listAdoptableSessions(AGENT, agentDir, otherDir);

      expect(listed.map((s) => s.sessionId)).toEqual(["sess-plain"]);
    });

    it("returns an empty list when the transcript folder does not exist", async () => {
      expect(
        await makeService().listAdoptableSessions(AGENT, agentDir, "/srv/herdctl423/nope"),
      ).toEqual([]);
    });
  });

  // ===========================================================================
  // adoptSessionsFrom — placement
  // ===========================================================================

  describe("adoptSessionsFrom", () => {
    it("copies by default, leaving the user's original transcript intact", async () => {
      await writeTranscript(otherDir, "sess-1", { title: "Terminal chat" });
      const sourceFile = path.join(dirFor(otherDir), "sess-1.jsonl");
      const destFile = path.join(dirFor(agentDir), "sess-1.jsonl");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      expect(result).toEqual({ adopted: ["sess-1"], skipped: [] });
      // THE default-safety guarantee: the source is untouched.
      expect(await exists(sourceFile)).toBe(true);
      expect(await exists(destFile)).toBe(true);

      const record = await getAdoption(stateDir, "sess-1");
      expect(record).toMatchObject({ agentName: AGENT, sourceCwd: otherDir });
    });

    it("preserves the source mtime when copying", async () => {
      // Months old: if adoption stamped "now", this chat would sort to the top
      // of the user's list AND needlessly bust the auto-name/preview/sidechain
      // caches, all of which are keyed on transcript mtime.
      const old = new Date("2026-02-03T04:05:06.000Z");
      await writeTranscript(otherDir, "sess-old", { mtime: old });

      await makeService().adoptSessionsFrom(AGENT, agentDir, { fromWorkingDir: otherDir });

      const copied = await stat(path.join(dirFor(agentDir), "sess-old.jsonl"));
      expect(copied.mtime.toISOString()).toBe(old.toISOString());
    });

    it("moves the transcript only when explicitly asked", async () => {
      await writeTranscript(otherDir, "sess-move", { mtime: new Date("2026-03-01T00:00:00.000Z") });

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
        mode: "move",
      });

      expect(result.adopted).toEqual(["sess-move"]);
      expect(await exists(path.join(dirFor(otherDir), "sess-move.jsonl"))).toBe(false);
      const moved = await stat(path.join(dirFor(agentDir), "sess-move.jsonl"));
      expect(moved.mtime.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    });

    it("links the transcript when asked, sharing one file", async () => {
      await writeTranscript(otherDir, "sess-link");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
        mode: "link",
      });

      expect(result.adopted).toEqual(["sess-link"]);
      const source = await stat(path.join(dirFor(otherDir), "sess-link.jsonl"));
      // lstat, not stat: stat() follows a symlink, so a symlink placement would
      // report the source's own inode and pass the identity check below. The
      // documented behaviour is a HARD link, with symlink only as the
      // cross-device fallback.
      const dest = await lstat(path.join(dirFor(agentDir), "sess-link.jsonl"));
      expect(await exists(path.join(dirFor(otherDir), "sess-link.jsonl"))).toBe(true);
      expect(dest.isSymbolicLink()).toBe(false);
      expect(dest.ino).toBe(source.ino);
      expect(dest.nlink).toBe(2);
    });

    it("records attribution without moving anything when the source is the agent's own folder", async () => {
      await writeTranscript(agentDir, "sess-here", { title: "Already in place" });

      // No fromWorkingDir at all: the source IS the destination folder.
      const result = await makeService().adoptSessionsFrom(AGENT, agentDir);

      expect(result.adopted).toEqual(["sess-here"]);
      // Exactly one transcript exists — nothing was duplicated onto itself.
      expect(await readdir(dirFor(agentDir))).toEqual(["sess-here.jsonl"]);
      expect(await getAdoption(stateDir, "sess-here")).toMatchObject({ sourceCwd: agentDir });
    });

    it("treats a different cwd that encodes to the same folder as in-place", async () => {
      // encodePathForCli is lossy: these two distinct directories share one
      // transcript folder, so there is nothing to move between them.
      const a = "/srv/herdctl423/lossy/a-b";
      const b = "/srv/herdctl423/lossy-a/b";
      expect(encodePathForCli(a)).toBe(encodePathForCli(b));
      await writeTranscript(a, "sess-lossy");

      const result = await makeService().adoptSessionsFrom(AGENT, a, { fromWorkingDir: b });

      expect(result.adopted).toEqual(["sess-lossy"]);
      expect(await readdir(dirFor(a))).toEqual(["sess-lossy.jsonl"]);
    });
  });

  // ===========================================================================
  // adoptSessionsFrom — skips and resilience
  // ===========================================================================

  describe("adoptSessionsFrom skips", () => {
    it("never clobbers an existing transcript in the destination", async () => {
      await writeTranscript(otherDir, "sess-dup", { text: "the source version" });
      await writeTranscript(agentDir, "sess-dup", { text: "the destination version" });
      const destFile = path.join(dirFor(agentDir), "sess-dup.jsonl");
      const before = await stat(destFile);

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      expect(result.adopted).toEqual([]);
      expect(result.skipped[0]).toMatchObject({
        sessionId: "sess-dup",
        reason: "destination-exists",
      });
      // The destination file is byte-for-byte untouched.
      const after = await stat(destFile);
      expect(after.size).toBe(before.size);
      expect(after.mtimeMs).toBe(before.mtimeMs);
      expect(await getAdoption(stateDir, "sess-dup")).toBeNull();
    });

    it("never clobbers an existing transcript when moving", async () => {
      // `move` is the dangerous mode: it is the one that also destroys the
      // source, so a clobber here loses BOTH copies of a chat.
      await writeTranscript(otherDir, "sess-dup", { text: "the source version" });
      await writeTranscript(agentDir, "sess-dup", { text: "the destination version" });
      const sourceFile = path.join(dirFor(otherDir), "sess-dup.jsonl");
      const destFile = path.join(dirFor(agentDir), "sess-dup.jsonl");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
        mode: "move",
      });

      expect(result.adopted).toEqual([]);
      expect(result.skipped[0]).toMatchObject({
        sessionId: "sess-dup",
        reason: "destination-exists",
      });
      expect(await readFile(destFile, "utf8")).toContain("the destination version");
      // ...and the source the user asked us to move is still there too.
      expect(await readFile(sourceFile, "utf8")).toContain("the source version");
      expect(await getAdoption(stateDir, "sess-dup")).toBeNull();
    });

    it("refuses to move onto a destination the existence pre-check cannot see", async () => {
      // A dangling symlink is a destination `stat()` reports as ENOENT, so the
      // caller's pre-check waves it through. It is exactly what an earlier
      // cross-device `mode: "link"` placement leaves behind once the user
      // deletes the original, and it stands in here for the general case: the
      // pre-check is an optimisation, and never-clobber has to be enforced by
      // the placement syscall itself. `rename` does not enforce it — it
      // replaces the destination silently — so a move used to consume the
      // source and report success.
      await writeTranscript(otherDir, "sess-ghost", { text: "the only copy" });
      const sourceFile = path.join(dirFor(otherDir), "sess-ghost.jsonl");
      const destFile = path.join(dirFor(agentDir), "sess-ghost.jsonl");
      await mkdir(dirFor(agentDir), { recursive: true });
      await symlink(path.join(dirFor(agentDir), "vanished.jsonl"), destFile);
      expect(await exists(destFile)).toBe(false); // stat() follows and fails

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
        mode: "move",
      });

      expect(result.adopted).toEqual([]);
      expect(result.skipped[0]).toMatchObject({
        sessionId: "sess-ghost",
        reason: "destination-exists",
      });
      // The user's only copy of the transcript survives...
      expect(await readFile(sourceFile, "utf8")).toContain("the only copy");
      // ...and the occupied destination entry was not replaced.
      expect((await lstat(destFile)).isSymbolicLink()).toBe(true);
      expect(await getAdoption(stateDir, "sess-ghost")).toBeNull();
    });

    it("reports sidechain, already-adopted and attributed-to-run skips by reason", async () => {
      await writeTranscript(otherDir, "sess-ok");
      await writeTranscript(otherDir, "sess-side", { isSidechain: true });
      await writeTranscript(otherDir, "sess-taken");
      await makeService().adoptSession("other-agent", "sess-taken");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      expect(result.adopted).toEqual(["sess-ok"]);
      const reasons = Object.fromEntries(result.skipped.map((s) => [s.sessionId, s.reason]));
      expect(reasons).toEqual({ "sess-side": "sidechain", "sess-taken": "already-adopted" });
      // A skip must say enough to close a support ticket without a debugger.
      expect(result.skipped.find((s) => s.sessionId === "sess-taken")?.detail).toContain(
        "other-agent",
      );
      // Neither skipped session was placed.
      expect((await readdir(dirFor(agentDir))).sort()).toEqual(["sess-ok.jsonl"]);
    });

    it("is idempotent: re-running adopts nothing new and changes nothing", async () => {
      await writeTranscript(otherDir, "sess-1");
      const service = makeService();

      const first = await service.adoptSessionsFrom(AGENT, agentDir, { fromWorkingDir: otherDir });
      expect(first.adopted).toEqual(["sess-1"]);
      const recordAfterFirst = await getAdoption(stateDir, "sess-1");

      const second = await service.adoptSessionsFrom(AGENT, agentDir, { fromWorkingDir: otherDir });

      expect(second.adopted).toEqual([]);
      expect(second.skipped).toEqual([
        expect.objectContaining({ sessionId: "sess-1", reason: "already-adopted" }),
      ]);
      // The original claim (and its adoptedAt) is not rewritten.
      expect(await getAdoption(stateDir, "sess-1")).toEqual(recordAfterFirst);
    });

    it("keeps going when one transcript cannot be placed", async () => {
      await writeTranscript(otherDir, "sess-before", { mtime: new Date("2026-05-03T00:00:00Z") });
      await writeTranscript(otherDir, "sess-after", { mtime: new Date("2026-05-01T00:00:00Z") });
      // A "transcript" that cannot be read or copied. A directory in the
      // transcript folder's place reproduces the unreadable/corrupt case on a
      // box where the tests run as root and chmod 000 would not deny us.
      await mkdir(path.join(dirFor(otherDir), "sess-broken.jsonl"), { recursive: true });
      await utimes(
        path.join(dirFor(otherDir), "sess-broken.jsonl"),
        new Date("2026-05-02T00:00:00Z"),
        new Date("2026-05-02T00:00:00Z"),
      );

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });

      // The bad entry is sandwiched between two good ones by mtime, so a batch
      // that aborted on failure would drop `sess-after`.
      expect(result.adopted.sort()).toEqual(["sess-after", "sess-before"]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ sessionId: "sess-broken", reason: "unreadable" }),
      ]);
      expect(result.skipped[0].detail).toBeTruthy();
      // ...and the two readable ones really were placed.
      expect((await readdir(dirFor(agentDir))).sort()).toEqual([
        "sess-after.jsonl",
        "sess-before.jsonl",
      ]);
    });
  });

  // ===========================================================================
  // dryRun
  // ===========================================================================

  describe("adoptSessionsFrom dryRun", () => {
    it("writes absolutely nothing but reports what would happen", async () => {
      await writeTranscript(otherDir, "sess-1", { mtime: new Date("2026-04-01T00:00:00.000Z") });
      await writeTranscript(otherDir, "sess-side", { isSidechain: true });
      await writeTranscript(agentDir, "sess-dup");
      await writeTranscript(otherDir, "sess-dup");

      const result = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
        dryRun: true,
      });

      expect(result.adopted).toEqual(["sess-1"]);
      expect(Object.fromEntries(result.skipped.map((s) => [s.sessionId, s.reason]))).toEqual({
        "sess-side": "sidechain",
        "sess-dup": "destination-exists",
      });

      // No transcript placed...
      expect((await readdir(dirFor(agentDir))).sort()).toEqual(["sess-dup.jsonl"]);
      // ...and no adoption record written (the store dir isn't even created).
      expect(await listAdoptions(stateDir)).toEqual([]);
      expect(await exists(getAdoptedSessionsDir(stateDir))).toBe(false);
      // ...and not so much as a cache file. `sess-side` has to be classified as
      // a sidechain to be skipped, and that classification used to be written
      // straight back to `session-metadata/<agent>.json` — a dry run that
      // creates a file, contradicting the documented "nothing at all is
      // written". The whole state dir must be untouched.
      expect(await readdir(stateDir)).toEqual([]);

      // And a real run afterwards still does the work.
      const real = await makeService().adoptSessionsFrom(AGENT, agentDir, {
        fromWorkingDir: otherDir,
      });
      expect(real.adopted).toEqual(["sess-1"]);
    });
  });

  // ===========================================================================
  // The headline: adoption makes an invisible session visible
  // ===========================================================================

  describe("visibility through FleetManager", () => {
    const silentLogger = () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    async function buildManager(): Promise<FleetManager> {
      const configDir = path.join(tempRoot, "config");
      const agentsDir = path.join(configDir, "agents");
      await mkdir(agentsDir, { recursive: true });
      await writeFile(
        path.join(agentsDir, "keeper.yaml"),
        yaml.stringify({ name: AGENT, working_directory: agentDir }),
      );
      const configPath = path.join(configDir, "herdctl.yaml");
      await writeFile(
        configPath,
        yaml.stringify({ version: 1, agents: [{ path: "./agents/keeper.yaml" }] }),
      );

      const manager = new FleetManager({
        configPath,
        stateDir,
        claudeHomePath: claudeHome,
        checkInterval: 10_000,
        logger: silentLogger(),
      });
      await manager.initialize();
      return manager;
    }

    it("adopts a terminal session into the agent and lists it with origin 'adopted'", async () => {
      await writeTranscript(otherDir, "sess-terminal", {
        title: "A chat I had in my terminal",
        mtime: new Date("2026-05-05T05:05:05.000Z"),
      });
      const manager = await buildManager();

      // Before: the transcript exists but nothing attributes it, so the agent
      // cannot see it. This is the whole problem #423 describes.
      expect(await manager.getAgentSessions(AGENT)).toEqual([]);

      const adoptable = await manager.listAdoptableSessions(AGENT, otherDir);
      expect(adoptable.map((s) => s.sessionId)).toEqual(["sess-terminal"]);
      expect(adoptable[0].autoName).toBe("A chat I had in my terminal");

      const result = await manager.adoptSessionsFrom(AGENT, { fromWorkingDir: otherDir });
      expect(result).toEqual({ adopted: ["sess-terminal"], skipped: [] });

      // After: visible under the agent, attributed as adopted, correctly named,
      // and still carrying its original timestamp. No cache flush in between —
      // adoption must invalidate the discovery caches itself, or this would
      // only pass after the 30s TTL lapsed.
      const sessions = await manager.getAgentSessions(AGENT);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        sessionId: "sess-terminal",
        origin: "adopted",
        agentName: AGENT,
        autoName: "A chat I had in my terminal",
        mtime: "2026-05-05T05:05:05.000Z",
        resumable: true,
      });

      // ...and the session the listing advertises actually opens.
      const messages = await manager.getAgentSessionMessages(AGENT, "sess-terminal");
      expect(messages[0].content).toContain("work in");

      // unadoptSession drops the claim and the session goes invisible again,
      // without deleting the transcript.
      expect(await manager.unadoptSession(AGENT, "sess-terminal")).toBe(true);
      expect(await manager.getAgentSessions(AGENT)).toEqual([]);
      expect(await exists(path.join(dirFor(agentDir), "sess-terminal.jsonl"))).toBe(true);
      // Dropping it again is a no-op, not an error.
      expect(await manager.unadoptSession(AGENT, "sess-terminal")).toBe(false);
    });

    it("adoptSession alone makes a session already in the agent's folder visible", async () => {
      await writeTranscript(agentDir, "sess-inplace", { title: "Ran here already" });
      const manager = await buildManager();

      expect(await manager.getAgentSessions(AGENT)).toEqual([]);

      const record = await manager.adoptSession(AGENT, "sess-inplace");
      expect(record).toMatchObject({ agentName: AGENT, sourceCwd: agentDir });

      const sessions = await manager.getAgentSessions(AGENT);
      expect(sessions.map((s) => s.sessionId)).toEqual(["sess-inplace"]);
      expect(sessions[0].origin).toBe("adopted");
    });

    it("rejects a traversal session id on both the adopt and the unadopt path", async () => {
      const manager = await buildManager();

      // Session ids reach these two methods straight from user input (CLI args,
      // HTTP bodies), and both of them turn one into a file path in the
      // adoption store.
      await expect(manager.adoptSession(AGENT, "../../escape")).rejects.toThrow(PathTraversalError);
      await expect(manager.unadoptSession(AGENT, "../../escape")).rejects.toThrow(
        PathTraversalError,
      );
      expect(await exists(getAdoptedSessionsDir(stateDir))).toBe(false);
    });

    it("will not let one agent release another agent's adoption", async () => {
      await writeTranscript(agentDir, "sess-theirs");
      await makeService().adoptSession("some-other-agent", "sess-theirs");
      const manager = await buildManager();

      expect(await manager.unadoptSession(AGENT, "sess-theirs")).toBe(false);
      expect(await getAdoption(stateDir, "sess-theirs")).toMatchObject({
        agentName: "some-other-agent",
      });
    });
  });
});
