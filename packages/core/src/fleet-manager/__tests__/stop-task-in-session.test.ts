/**
 * Tests for FleetManager.stopTaskInSession — stopping ONE background task in a
 * managed session, addressed by session id (edspencer/herdctl#449).
 *
 * These drive the REAL SessionLifecycleManager + SessionReaper the fleet builds
 * in initialize(), so what's covered is the actual wiring (a private
 * `sessionLifecycle` reached through a public method), not a stub of it. The
 * reaper-level contract is covered in session/__tests__/stop-task-in-session.test.ts.
 *
 * The case that matters most is the post-turn one. A consumer holds its
 * `RuntimeSession` for the duration of a turn and releases it when the result
 * lands, but background shells, sub-agents and monitors outlive that turn — so a
 * stop that is only reachable through the handle goes inert exactly over the
 * window where the user is watching something run and wants it stopped. Only the
 * reaper still holds the session there, which is why this is keyed by id.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import type { RuntimeSession } from "../../runner/runtime/interface.js";
import type { SessionLifecycleSignal } from "../../session/types.js";
import { SessionTaskControlUnsupportedError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** A background task, so the policy holds the session open and never reaps it. */
const TASK = { id: "t1", type: "shell", status: "running", description: "server" };

function fakeSession(): RuntimeSession & {
  close: ReturnType<typeof vi.fn>;
  stopTask: ReturnType<typeof vi.fn>;
} {
  async function* empty(): AsyncGenerator<never> {}
  return {
    messages: empty(),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    setModel: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/** The turn is producing output — a turn is in flight. */
function activitySignal(sessionId: string): SessionLifecycleSignal {
  return { kind: "activity", sessionId, sessionCrons: [], backgroundTasks: [TASK] };
}

/** The turn ENDED, and left live background work behind: the #449 gap-2 state. */
function turnEndKeepingAlive(sessionId: string): SessionLifecycleSignal {
  return { kind: "turn_end", sessionId, sessionCrons: [], backgroundTasks: [TASK] };
}

describe("FleetManager.stopTaskInSession()", () => {
  let tempDir: string;
  let configPath: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-stop-task-in-session-"));
    const configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(join(configDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "workspace"), { recursive: true });

    const yaml = await import("yaml");
    await writeFile(
      join(configDir, "agents", "keeper.yaml"),
      yaml.stringify({ name: "keeper", working_directory: join(tempDir, "workspace") }),
    );
    configPath = join(configDir, "herdctl.yaml");
    await writeFile(
      configPath,
      yaml.stringify({ version: 1, agents: [{ path: "./agents/keeper.yaml" }] }),
    );
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function createManager() {
    return new FleetManager({ configPath, stateDir, checkInterval: 10000, logger: silentLogger() });
  }

  async function initializedManager() {
    const manager = createManager();
    await manager.initialize();
    const lifecycle = manager.getSessionLifecycle();
    if (!lifecycle) throw new Error("expected a session lifecycle manager after initialize()");
    return { manager, lifecycle };
  }

  it("returns false before initialize(), when there is no lifecycle manager yet", async () => {
    await expect(createManager().stopTaskInSession("sess-1", "t1")).resolves.toBe(false);
  });

  it("stops a task in a session whose turn is still in flight", async () => {
    const { manager, lifecycle } = await initializedManager();
    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");
    await managed.handleSignal(activitySignal("sess-1"));

    await expect(manager.stopTaskInSession("sess-1", "t1")).resolves.toBe(true);
    expect(session.stopTask).toHaveBeenCalledWith("t1");
  });

  it("stops a task AFTER the turn ended — the gap this exists to close", async () => {
    const { manager, lifecycle } = await initializedManager();
    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");

    // A turn runs and then ends, leaving background work behind. This is where a
    // consumer releases its RuntimeSession: its turn is over and the result has
    // landed. Everything below reaches the task by session id ALONE — the handle
    // above is only ever read as a spy, never called through.
    await managed.handleSignal(activitySignal("sess-1"));
    await managed.handleSignal(turnEndKeepingAlive("sess-1"));

    // The policy is holding the session open solely for the background task, with
    // no timer and no backstop: nothing will reap it while the task runs.
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();

    await expect(manager.stopTaskInSession("sess-1", "t1")).resolves.toBe(true);
    expect(session.stopTask).toHaveBeenCalledTimes(1);
    expect(session.stopTask).toHaveBeenCalledWith("t1");

    // Stopping the task is not closing the session: the session survives, and the
    // SDK's own terminal task_notification is what ends the work.
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
    expect(session.interrupt).not.toHaveBeenCalled();
  });

  it("still stops a task across several post-turn signals (idempotent, repeatable)", async () => {
    const { manager, lifecycle } = await initializedManager();
    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");
    await managed.handleSignal(turnEndKeepingAlive("sess-1"));
    // A second background task appears while the session sits post-turn.
    await managed.handleSignal({
      kind: "background_tasks_changed",
      sessionId: "sess-1",
      sessionCrons: [],
      backgroundTasks: [TASK, { ...TASK, id: "t2" }],
    });

    await expect(manager.stopTaskInSession("sess-1", "t2")).resolves.toBe(true);
    // Stopping something that already finished is a success, not an error — the
    // CLI answers not_found/not_running that way and we add no liveness gate.
    await expect(manager.stopTaskInSession("sess-1", "t2")).resolves.toBe(true);
    expect(session.stopTask.mock.calls).toEqual([["t2"], ["t2"]]);
  });

  it("returns false for an unknown session id, and for one already reaped", async () => {
    const { manager, lifecycle } = await initializedManager();
    const session = fakeSession();
    await lifecycle.manage(session, "keeper").handleSignal(turnEndKeepingAlive("sess-1"));

    await expect(manager.stopTaskInSession("who-dis", "t1")).resolves.toBe(false);

    expect(manager.reapChatSession("sess-1")).toBe(true);
    await expect(manager.stopTaskInSession("sess-1", "t1")).resolves.toBe(false);
    expect(session.stopTask).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 5)); // close() is deferred a tick
  });

  it("rejects when the runtime refuses the stop (monitor_mcp: unsupported_type)", async () => {
    const { manager, lifecycle } = await initializedManager();
    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");
    await managed.handleSignal(turnEndKeepingAlive("sess-1"));
    session.stopTask.mockRejectedValue(new Error("unsupported_type"));

    // A false success is worse than an error: the consumer would render the task
    // as stopped while it keeps running.
    await expect(manager.stopTaskInSession("sess-1", "monitor-1")).rejects.toThrow(
      "unsupported_type",
    );

    // ...and the refusal leaves the fleet's reaper state untouched.
    expect(managed.isLive()).toBe(true);
    expect(manager.reapChatSession("sess-1")).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("rejects with SessionTaskControlUnsupportedError for a handle without stopTask", async () => {
    const { manager, lifecycle } = await initializedManager();
    const legacy = { ...fakeSession(), stopTask: undefined } as unknown as RuntimeSession;
    const managed = lifecycle.manage(legacy, "keeper");
    await managed.handleSignal(turnEndKeepingAlive("sess-1"));

    await expect(manager.stopTaskInSession("sess-1", "t1")).rejects.toBeInstanceOf(
      SessionTaskControlUnsupportedError,
    );
    expect(managed.isLive()).toBe(true);
  });
});
