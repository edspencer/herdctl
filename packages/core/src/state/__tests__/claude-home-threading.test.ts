/**
 * Regression tests for herdctl#423 gotcha 1: the Claude home must be a SINGLE
 * source of truth, threaded through every transcript path resolution.
 *
 * `SessionDiscoveryService` has always accepted an injectable `claudeHomePath`,
 * but it was honoured only by the directory-*listing* code paths. Everything
 * that resolved an individual transcript FILE went through
 * `getCliSessionDir`/`getCliSessionFile`, which hardcoded
 * `os.homedir()/.claude`. With any non-default home the list path and the
 * read path disagreed, so sessions **listed but opened empty**.
 *
 * These tests deliberately avoid the two things that made the existing suites
 * blind to the bug:
 *   - `session-discovery.test.ts` mocks `jsonl-parser.js`, so real path
 *     resolution never runs.
 *   - `session-control.test.ts` mocks `node:os` so `homedir()` IS the temp home,
 *     which masks the divergence entirely.
 *
 * So: NO `vi.mock("node:os")`, NO parser mock. The configured home is asserted
 * to differ from `os.homedir()/.claude`, a real transcript is written there,
 * and we assert the content actually comes back.
 */

import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetManager } from "../../fleet-manager/fleet-manager.js";
import {
  defaultClaudeHome,
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
} from "../../runner/runtime/cli-session-path.js";
import { getSessionInfo } from "../session.js";
import { SessionDiscoveryService } from "../session-discovery.js";
import { cliSessionFileExists, validateSessionWithFileCheck } from "../session-validation.js";

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/**
 * A realistic Claude Code CLI transcript: a summary entry, a user turn and an
 * assistant turn carrying `usage`. Parsed by the REAL jsonl parser.
 */
function transcript(workingDirectory: string): string {
  return `${[
    { type: "summary", summary: "Threading the Claude home" },
    {
      type: "user",
      uuid: "u-1",
      sessionId: SESSION_ID,
      cwd: workingDirectory,
      timestamp: "2026-08-01T10:00:00.000Z",
      gitBranch: "main",
      version: "2.1.0",
      message: { role: "user", content: "hello from a terminal session" },
    },
    {
      type: "assistant",
      uuid: "a-1",
      sessionId: SESSION_ID,
      cwd: workingDirectory,
      timestamp: "2026-08-01T10:00:05.000Z",
      message: {
        id: "msg_home_threading_1",
        role: "assistant",
        content: [{ type: "text", text: "hi from the alternate home" }],
        usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5 },
      },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
}

describe("Claude home is a single source of truth (herdctl#423)", () => {
  let tempRoot: string;
  /** The alternate Claude home — deliberately NOT `os.homedir()/.claude`. */
  let claudeHome: string;
  let stateDir: string;
  /**
   * A NON-temp-looking working directory. It never has to exist on disk (only
   * its *encoding* matters), but it must not start with `/tmp` or `os.tmpdir()`
   * or `getAllSessions` filters it out as a scratch dir.
   */
  let workDir: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-home-threading-"));
    claudeHome = path.join(tempRoot, "alt-claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    workDir = `/srv/herdctl423/${path.basename(tempRoot).replace(/[^A-Za-z0-9]/g, "")}`;
    await mkdir(stateDir, { recursive: true });

    const sessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, `${SESSION_ID}.jsonl`), transcript(workDir));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("the fixture really uses a non-default home (guards the test itself)", () => {
    // If this ever fails the rest of the suite proves nothing: the bug is masked
    // precisely when the configured home equals ~/.claude.
    expect(claudeHome).not.toBe(defaultClaudeHome());
    expect(claudeHome.startsWith(os.homedir())).toBe(false);
  });

  describe("cli-session-path helpers", () => {
    it("resolves against an explicit claude home", () => {
      expect(getCliSessionDir(workDir, claudeHome)).toBe(
        path.join(claudeHome, "projects", encodePathForCli(workDir)),
      );
      expect(getCliSessionFile(workDir, SESSION_ID, claudeHome)).toBe(
        path.join(claudeHome, "projects", encodePathForCli(workDir), `${SESSION_ID}.jsonl`),
      );
    });

    it("preserves the ~/.claude default when the home is omitted", () => {
      expect(getCliSessionDir(workDir)).toBe(
        path.join(os.homedir(), ".claude", "projects", encodePathForCli(workDir)),
      );
      expect(getCliSessionFile(workDir, SESSION_ID)).toBe(
        path.join(
          os.homedir(),
          ".claude",
          "projects",
          encodePathForCli(workDir),
          `${SESSION_ID}.jsonl`,
        ),
      );
      expect(defaultClaudeHome()).toBe(path.join(os.homedir(), ".claude"));
    });

    it("still rejects a traversing session id when a home is supplied", () => {
      expect(() => getCliSessionFile(workDir, "../etc/passwd", claudeHome)).toThrow(
        "Invalid session ID",
      );
    });
  });

  describe("SessionDiscoveryService", () => {
    function makeService() {
      return new SessionDiscoveryService({ stateDir, claudeHomePath: claudeHome });
    }

    it("exposes the resolved home", () => {
      expect(makeService().getClaudeHomePath()).toBe(claudeHome);
      // And still defaults when omitted.
      expect(new SessionDiscoveryService({ stateDir }).getClaudeHomePath()).toBe(
        path.join(os.homedir(), ".claude"),
      );
    });

    it("getSessionMessages returns the transcript content, not an empty list", async () => {
      const messages = await makeService().getSessionMessages(workDir, SESSION_ID);

      // THE regression: before the fix this resolved to ~/.claude/... which does
      // not exist, so the parser returned [] — the "lists but opens empty" bug.
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(messages[0].content).toContain("hello from a terminal session");
      expect(messages[1].content).toContain("hi from the alternate home");
    });

    it("getSessionMetadata reads the real transcript", async () => {
      const metadata = await makeService().getSessionMetadata(workDir, SESSION_ID);

      expect(metadata.sessionId).toBe(SESSION_ID);
      expect(metadata.messageCount).toBe(2);
      expect(metadata.summary).toBe("Threading the Claude home");
      expect(metadata.gitBranch).toBe("main");
      expect(metadata.firstMessagePreview).toContain("hello from a terminal session");
    });

    it("getSessionUsage reads the real transcript", async () => {
      const usage = await makeService().getSessionUsage(workDir, SESSION_ID);

      expect(usage.hasData).toBe(true);
      expect(usage.turnCount).toBe(1);
      expect(usage.inputTokens).toBe(125); // 100 + 20 cache-creation + 5 cache-read
    });

    it("the listing path and the read path agree (no list-but-empty divergence)", async () => {
      const service = makeService();

      const groups = await service.getAllSessions([
        { name: "keeper", workingDirectory: workDir, dockerEnabled: false },
      ]);

      const listed = groups.flatMap((g) => g.sessions).find((s) => s.sessionId === SESSION_ID);
      expect(listed).toBeDefined();
      // Enrichment (auto-name / preview) also resolves the transcript file, so a
      // divergent home silently degrades these to undefined.
      expect(listed?.autoName).toBe("Threading the Claude home");
      expect(listed?.preview).toContain("hello from a terminal session");

      // ...and the session the listing advertised actually opens.
      const messages = await service.getSessionMessages(
        listed?.workingDirectory ?? workDir,
        SESSION_ID,
      );
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("cliSessionFileExists", () => {
    it("finds the transcript under the supplied home and misses under the default", async () => {
      expect(await cliSessionFileExists(workDir, SESSION_ID, claudeHome)).toBe(true);
      // Sanity: nothing was written to the real ~/.claude, so the un-threaded
      // call must NOT find it. This is what made the old behaviour wrong.
      expect(await cliSessionFileExists(workDir, SESSION_ID)).toBe(false);
    });
  });

  /**
   * The resume-fallback path: before a run resumes an agent's stored session,
   * `getSessionInfo(..., { runtime: "cli", timeout })` asks
   * `validateSessionWithFileCheck` whether the transcript is still on disk.
   *
   * `validateSessionWithFileCheck` accepts a `claudeHomePath`, but `SessionOptions`
   * had no way to carry one, so `getSessionInfo` always passed `{ sessionsDir }`.
   * Under a non-default home the check looked in `~/.claude`, found nothing, and
   * declared a perfectly good session `file_not_found` — which does not merely
   * skip the resume, it DELETES the session pointer as "stale".
   */
  describe("getSessionInfo resume-fallback validation (CLI runtime)", () => {
    const AGENT = "keeper";
    let sessionsDir: string;
    let pointerFile: string;

    /** Silences the "clearing stale session" warning this path emits. */
    const silent = { warn: () => {} };

    beforeEach(async () => {
      sessionsDir = path.join(stateDir, "sessions");
      pointerFile = path.join(sessionsDir, `${AGENT}.json`);
      await mkdir(sessionsDir, { recursive: true });
      const now = new Date().toISOString();
      await writeFile(
        pointerFile,
        JSON.stringify({
          agent_name: AGENT,
          session_id: SESSION_ID,
          created_at: now,
          last_used_at: now,
          job_count: 1,
          mode: "autonomous",
          working_directory: workDir,
          runtime_type: "cli",
          docker_enabled: false,
        }),
      );
    });

    it("validateSessionWithFileCheck honours the supplied home", async () => {
      const session = await getSessionInfo(sessionsDir, AGENT);
      expect(session).not.toBeNull();

      await expect(
        validateSessionWithFileCheck(session, "24h", { sessionsDir, claudeHomePath: claudeHome }),
      ).resolves.toMatchObject({ valid: true });

      // Control: the same session, resolved against the default home, is "missing".
      await expect(
        validateSessionWithFileCheck(session, "24h", { sessionsDir }),
      ).resolves.toMatchObject({ valid: false, reason: "file_not_found" });
    });

    it("sees the transcript in the configured home and keeps the session", async () => {
      const session = await getSessionInfo(sessionsDir, AGENT, {
        timeout: "24h",
        runtime: "cli",
        claudeHomePath: claudeHome,
        logger: silent,
      });

      // THE regression: without the home threaded through `SessionOptions` this
      // returned null, and a valid CLI session silently became un-resumable.
      expect(session?.session_id).toBe(SESSION_ID);
      // ...and the pointer survives.
      await expect(access(pointerFile)).resolves.toBeUndefined();
    });

    it("reports the session missing (and clears it) when no home is threaded", async () => {
      // The control that proves the assertion above came from the alternate home:
      // nothing was ever written to the real `~/.claude`.
      const session = await getSessionInfo(sessionsDir, AGENT, {
        timeout: "24h",
        runtime: "cli",
        logger: silent,
      });

      expect(session).toBeNull();
      // The destructive half of the bug: the pointer is deleted as "stale".
      await expect(access(pointerFile)).rejects.toThrow();
    });

    it("leaves the SDK runtime untouched (no file check at all)", async () => {
      // Guards against "fixing" this by making the file check unconditional.
      const session = await getSessionInfo(sessionsDir, AGENT, {
        timeout: "24h",
        runtime: "sdk",
        logger: silent,
      });

      expect(session?.session_id).toBe(SESSION_ID);
    });
  });

  describe("FleetManager", () => {
    const silentLogger = () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    async function buildManager() {
      const configDir = path.join(tempRoot, "config");
      const agentDir = path.join(configDir, "agents");
      await mkdir(agentDir, { recursive: true });
      const yaml = await import("yaml");
      await writeFile(
        path.join(agentDir, "keeper.yaml"),
        yaml.stringify({ name: "keeper", working_directory: workDir }),
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

    it("exposes the resolved home and defaults to ~/.claude", () => {
      const withHome = new FleetManager({
        stateDir,
        claudeHomePath: claudeHome,
        logger: silentLogger(),
      });
      expect(withHome.getClaudeHomePath()).toBe(claudeHome);

      const withoutHome = new FleetManager({ stateDir, logger: silentLogger() });
      expect(withoutHome.getClaudeHomePath()).toBe(path.join(os.homedir(), ".claude"));
    });

    it("deleteSession removes the transcript from the configured home", async () => {
      const manager = await buildManager();

      const sessionFile = getCliSessionFile(workDir, SESSION_ID, claudeHome);
      expect(await cliSessionFileExists(workDir, SESSION_ID, claudeHome)).toBe(true);

      // Before the fix this computed ~/.claude/... , found nothing, and reported
      // `false` while leaving the real transcript in place.
      const removed = await manager.deleteSession("keeper", SESSION_ID);
      expect(removed).toBe(true);
      expect(await cliSessionFileExists(workDir, SESSION_ID, claudeHome)).toBe(false);
      expect(sessionFile.startsWith(claudeHome)).toBe(true);
    });
  });
});
