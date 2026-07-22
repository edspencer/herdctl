/**
 * Tests for the #403 resume-collision guard in FleetManager.openChatSession():
 *
 *   The SessionReaper deliberately keeps a session's `claude` subprocess alive
 *   across the turn boundary while it holds background work (keepAlive) or during
 *   the re-invocation grace. A resume issued in that window must NOT spawn a
 *   second `claude` on the same session id — two processes resuming one session
 *   collide and the SDK interrupts the in-flight turn. openChatSession therefore
 *   defers the resume until the reaper reaps the session, then spawns exactly
 *   once. A fresh (non-resume) session is never deferred.
 *
 * The Claude SDK's `query` is mocked so no real subprocess is spawned; asserting
 * how many times it was called is how we observe "did/didn't spawn".
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import type { SessionLifecycleSignal } from "../../session/types.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const tick = () => new Promise((r) => setTimeout(r, 10));

/** A background task, so a turn_end carrying it decides `keepAlive`. */
const TASK = { id: "t1", type: "shell", status: "running", description: "server" };

/**
 * A fake managed RuntimeSession for the reaper to hold — only the members the
 * reaper touches (close) need to behave; the rest are inert.
 */
function fakeManagedSession(): RuntimeSession {
  async function* empty(): AsyncGenerator<never> {}
  return {
    messages: empty(),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    setModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function signal(overrides: Partial<SessionLifecycleSignal> = {}): SessionLifecycleSignal {
  return {
    kind: "turn_end",
    sessionId: "sess-live",
    sessionCrons: [],
    backgroundTasks: [],
    ...overrides,
  };
}

/**
 * A fake SDK Query for the resumed session that openChatSession returns. Only
 * the members openSession() / RuntimeSession.close() touch are provided.
 */
function fakeChatQuery() {
  const returnSpy = vi.fn().mockResolvedValue(undefined);
  const q = {
    [Symbol.asyncIterator]: async function* () {},
    supportedCommands: vi.fn().mockResolvedValue([]),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    return: returnSpy,
  };
  return { q, returnSpy };
}

describe("FleetManager.openChatSession() — #403 resume collision guard", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;
  let workDir: string;

  beforeEach(async () => {
    vi.mocked(query).mockReset();
    tempDir = await mkdtemp(join(tmpdir(), "fleet-resume-collision-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    workDir = join(tempDir, "workspace");
    await mkdir(configDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function buildManagerWithAgent() {
    const yaml = await import("yaml");
    const agentDir = join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "keeper.yaml"),
      yaml.stringify({ name: "keeper", working_directory: workDir }),
    );
    const configPath = join(configDir, "herdctl.yaml");
    await writeFile(
      configPath,
      yaml.stringify({ version: 1, agents: [{ path: "./agents/keeper.yaml" }] }),
    );
    const manager = new FleetManager({
      configPath,
      stateDir,
      checkInterval: 10000,
      logger: silentLogger(),
    });
    await manager.initialize();
    return manager;
  }

  it("defers a resume off a still-live session, then spawns exactly once after reap", async () => {
    const manager = await buildManagerWithAgent();
    const reaper = manager.getSessionLifecycle()?.reaper;
    if (!reaper) throw new Error("expected a session-lifecycle reaper");

    // Make sess-live live per the reaper: turn ends with a background task → keepAlive.
    const managed = reaper.manage(fakeManagedSession(), "keeper");
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(reaper.isSessionLive("sess-live")).toBe(true);

    const { q } = fakeChatQuery();
    vi.mocked(query).mockReturnValue(q as never);

    // Resume the live session — the guard must defer, spawning no second `claude`.
    const opening = manager.openChatSession("keeper", { resume: "sess-live" });
    await tick();
    expect(vi.mocked(query)).not.toHaveBeenCalled();

    // The reaper releases the session (its turn goes idle, no background work).
    await managed.handleSignal(signal({ backgroundTasks: [] }));
    expect(reaper.isSessionLive("sess-live")).toBe(false);

    // The deferred resume now proceeds — exactly one spawn.
    const session = await opening;
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);

    await session.close();
    await manager.stop();
  });

  it("does not defer a fresh (non-resume) session: spawns immediately even while another session is live", async () => {
    const manager = await buildManagerWithAgent();
    const reaper = manager.getSessionLifecycle()?.reaper;
    if (!reaper) throw new Error("expected a session-lifecycle reaper");

    // Some unrelated session is live; a brand-new session can't collide with it.
    const managed = reaper.manage(fakeManagedSession(), "keeper");
    await managed.handleSignal(signal({ sessionId: "sess-other", backgroundTasks: [TASK] }));
    expect(reaper.isSessionLive("sess-other")).toBe(true);

    const { q } = fakeChatQuery();
    vi.mocked(query).mockReturnValue(q as never);

    // resume: null → explicitly fresh, no fallback lookup, no deferral.
    const session = await manager.openChatSession("keeper", { resume: null });
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);

    await session.close();
    await managed.handleSignal(signal({ sessionId: "sess-other", backgroundTasks: [] }));
    await manager.stop();
  });

  it("spawns anyway once the defer ceiling elapses for a never-reaped session", async () => {
    const manager = await buildManagerWithAgent();
    const reaper = manager.getSessionLifecycle()?.reaper;
    if (!reaper) throw new Error("expected a session-lifecycle reaper");

    // Keep the session live and never reap it.
    const managed = reaper.manage(fakeManagedSession(), "keeper");
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(reaper.isSessionLive("sess-live")).toBe(true);

    const { q } = fakeChatQuery();
    vi.mocked(query).mockReturnValue(q as never);

    // A short ceiling: the resume waits, the session stays live, then spawns anyway.
    const session = await manager.openChatSession("keeper", {
      resume: "sess-live",
      resumeDeferTimeoutMs: 30,
    });
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
    expect(reaper.isSessionLive("sess-live")).toBe(true);

    await session.close();
    await managed.handleSignal(signal({ backgroundTasks: [] }));
    await manager.stop();
  });
});
