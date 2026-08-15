/**
 * Tests for SessionReaper.stopTaskInSession — the session-id-keyed door onto a
 * live session's per-task control request (gap 2 of edspencer/herdctl#449).
 *
 * The reaper is the only thing that holds a session across the gap between "the
 * turn ended" and "its background work finished", so it is the only place a stop
 * can be addressed by session id. These cover the contract: `false` means
 * exactly "no live session with this id", a refusal propagates, and neither a
 * refusal nor an unsupported handle disturbs the reap decision.
 */

import { describe, expect, it, vi } from "vitest";
import { SessionTaskControlUnsupportedError } from "../../fleet-manager/errors.js";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import { SessionReaper } from "../session-reaper.js";
import type { SessionLifecycleSignal } from "../types.js";
import type { WakeRegistry } from "../wake-registry.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

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

function fakeRegistry() {
  return {
    reconcile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as WakeRegistry;
}

const TASK = { id: "t1", type: "shell", status: "running", description: "server" };

/** A `turn_end` carrying live background work: the turn is over, the tasks are not. */
function turnEndKeepingAlive(sessionId = "sess-1"): SessionLifecycleSignal {
  return { kind: "turn_end", sessionId, sessionCrons: [], backgroundTasks: [TASK] };
}

describe("SessionReaper.stopTaskInSession()", () => {
  it("resolves the live session by id and forwards the task id", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/keeper");
    await managed.handleSignal(turnEndKeepingAlive());

    await expect(reaper.stopTaskInSession("sess-1", "t1")).resolves.toBe(true);
    expect(session.stopTask).toHaveBeenCalledWith("t1");
  });

  it("returns false for an unknown session id, without touching any session", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    await reaper.manage(session, "team/keeper").handleSignal(turnEndKeepingAlive());

    await expect(reaper.stopTaskInSession("who-dis", "t1")).resolves.toBe(false);
    expect(session.stopTask).not.toHaveBeenCalled();
  });

  it("returns false once the session has been reaped", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/keeper");
    await managed.handleSignal(turnEndKeepingAlive());

    expect(reaper.forceReap("sess-1")).toBe(true);
    expect(managed.isLive()).toBe(false);

    await expect(reaper.stopTaskInSession("sess-1", "t1")).resolves.toBe(false);
    expect(session.stopTask).not.toHaveBeenCalled();
    await tick();
  });

  it("returns false for a detached session (the consumer took over the lifetime)", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/keeper");
    await managed.handleSignal(turnEndKeepingAlive());
    managed.detach();

    await expect(reaper.stopTaskInSession("sess-1", "t1")).resolves.toBe(false);
    expect(session.stopTask).not.toHaveBeenCalled();
  });

  it("addresses the right session when several are live at once", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const a = fakeSession();
    const b = fakeSession();
    await reaper.manage(a, "team/a").handleSignal(turnEndKeepingAlive("sess-a"));
    await reaper.manage(b, "team/b").handleSignal(turnEndKeepingAlive("sess-b"));

    await expect(reaper.stopTaskInSession("sess-b", "t1")).resolves.toBe(true);
    expect(b.stopTask).toHaveBeenCalledWith("t1");
    expect(a.stopTask).not.toHaveBeenCalled();
  });

  it("propagates a monitor_mcp refusal and leaves the session live and reapable", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/keeper");
    await managed.handleSignal(turnEndKeepingAlive());
    session.stopTask.mockRejectedValue(new Error("unsupported_type"));

    await expect(reaper.stopTaskInSession("sess-1", "monitor-1")).rejects.toThrow(
      "unsupported_type",
    );

    // A refusal is the runtime's answer, not a reaper state transition: the
    // session must survive it intact, and the ordinary reap must still work.
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
    expect(reaper.isSessionLive("sess-1")).toBe(true);
    expect(reaper.forceReap("sess-1")).toBe(true);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("throws SessionTaskControlUnsupportedError when the handle has no stopTask", async () => {
    // Unreachable in-tree — `stopTask` is required on RuntimeSession and only the
    // SDK runtime opens sessions — but the handle is a structural object from an
    // arbitrary caller, so an older or foreign one can still turn up. Fail loudly:
    // resolving would report a still-running task as stopped.
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const legacy = { ...session, stopTask: undefined } as unknown as RuntimeSession;
    const managed = reaper.manage(legacy, "team/keeper");
    await managed.handleSignal(turnEndKeepingAlive());

    await expect(reaper.stopTaskInSession("sess-1", "t1")).rejects.toBeInstanceOf(
      SessionTaskControlUnsupportedError,
    );
    expect(managed.isLive()).toBe(true);
    expect(reaper.isSessionLive("sess-1")).toBe(true);
  });

  it("does not pre-check task liveness — an unknown task id is still forwarded", async () => {
    // The CLI converts not_found/not_running into a success, so a task that
    // finished a millisecond ago stops cleanly. A liveness gate here would only
    // reintroduce that race.
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    await reaper.manage(session, "team/keeper").handleSignal(turnEndKeepingAlive());

    await expect(reaper.stopTaskInSession("sess-1", "a-task-nobody-reported")).resolves.toBe(true);
    expect(session.stopTask).toHaveBeenCalledWith("a-task-nobody-reported");
  });
});
