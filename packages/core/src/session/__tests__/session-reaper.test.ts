import { describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import { SessionReaper } from "../session-reaper.js";
import type { SessionLifecycleSignal } from "../types.js";
import type { WakeRegistry } from "../wake-registry.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

function fakeSession(): RuntimeSession & { close: ReturnType<typeof vi.fn> } {
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

function fakeRegistry() {
  return { reconcile: vi.fn().mockResolvedValue(undefined) } as unknown as WakeRegistry & {
    reconcile: ReturnType<typeof vi.fn>;
  };
}

function signal(overrides: Partial<SessionLifecycleSignal> = {}): SessionLifecycleSignal {
  return {
    kind: "turn_end",
    sessionId: "sess-1",
    sessionCrons: [],
    backgroundTasks: [],
    ...overrides,
  };
}

const TASK = { id: "t1", type: "shell", status: "running", description: "server" };

describe("SessionReaper", () => {
  it("reaps an idle session: reconciles crons, fires onReap, closes", async () => {
    const registry = fakeRegistry();
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry, onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    const crons = [{ id: "c1", schedule: "35 13 * * *", recurring: false, prompt: "go" }];
    await managed.handleSignal(signal({ sessionCrons: crons }));

    expect(registry.reconcile).toHaveBeenCalledWith("team/agent", "sess-1", crons);
    expect(onReap).toHaveBeenCalledWith({ agent: "team/agent", sessionId: "sess-1" });
    expect(managed.isLive()).toBe(false);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a session alive while background tasks are running", async () => {
    const registry = fakeRegistry();
    const onKeepAlive = vi.fn();
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry, onKeepAlive, onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));

    expect(onKeepAlive).toHaveBeenCalledWith({
      agent: "team/agent",
      sessionId: "sess-1",
      tasks: [TASK],
    });
    expect(onReap).not.toHaveBeenCalled();
    expect(managed.isLive()).toBe(true);
    await tick();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("reaps a kept-alive session once background_tasks_changed reports empty", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(managed.isLive()).toBe(true);

    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    expect(managed.isLive()).toBe(false);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("ignores background_tasks_changed when the session was never kept alive", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    expect(managed.isLive()).toBe(true);
    await tick();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("does not reap mid-turn: activity clears the idle-waiting state", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    // Kept alive, then the consumer resumes the session (activity), then a task ends.
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    await managed.handleSignal(signal({ kind: "activity" }));
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));

    expect(managed.isLive()).toBe(true);
    await tick();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("tracks session liveness for the registry", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const managed = reaper.manage(fakeSession(), "team/agent");
    expect(reaper.isSessionLive("sess-1")).toBe(false);

    await managed.handleSignal(signal({ kind: "activity" }));
    expect(reaper.isSessionLive("sess-1")).toBe(true);

    await managed.handleSignal(signal());
    expect(reaper.isSessionLive("sess-1")).toBe(false);
  });

  it("ignores signals after the session has been reaped", async () => {
    const registry = fakeRegistry();
    const reaper = new SessionReaper({ registry });
    const managed = reaper.manage(fakeSession(), "team/agent");

    await managed.handleSignal(signal());
    registry.reconcile.mockClear();
    await managed.handleSignal(
      signal({ sessionCrons: [{ id: "x", schedule: "* * * * *", recurring: true, prompt: "p" }] }),
    );
    expect(registry.reconcile).not.toHaveBeenCalled();
  });

  it("detach stops management without reaping", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");
    await managed.handleSignal(signal({ kind: "activity" }));

    managed.detach();
    expect(managed.isLive()).toBe(false);
    expect(reaper.isSessionLive("sess-1")).toBe(false);
    await tick();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("exposes the resolved session id once learned", async () => {
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const managed = reaper.manage(fakeSession(), "team/agent");
    expect(managed.sessionId()).toBeUndefined();
    await managed.handleSignal(signal({ sessionId: "sess-42", kind: "activity" }));
    expect(managed.sessionId()).toBe("sess-42");
  });

  it("still closes the session when the onReap callback throws", async () => {
    const reaper = new SessionReaper({
      registry: fakeRegistry(),
      onReap: () => {
        throw new Error("consumer boom");
      },
    });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal());
    expect(managed.isLive()).toBe(false);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("reaps even when wake reconciliation fails", async () => {
    const registry = {
      reconcile: vi.fn().mockRejectedValue(new Error("state io error")),
    } as unknown as WakeRegistry;
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry, onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(
      signal({
        sessionCrons: [{ id: "c1", schedule: "* * * * *", recurring: false, prompt: "p" }],
      }),
    );
    expect(onReap).toHaveBeenCalledTimes(1);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("keeps processing signals after a failed reconcile (no queue wedge)", async () => {
    const registry = {
      reconcile: vi.fn().mockRejectedValueOnce(new Error("io")).mockResolvedValue(undefined),
    } as unknown as WakeRegistry;
    const reaper = new SessionReaper({ registry });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    // First turn_end keeps the session alive (its reconcile rejects but is caught).
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(managed.isLive()).toBe(true);

    // A later signal must still be processed — the queue wasn't poisoned.
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    expect(managed.isLive()).toBe(false);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
