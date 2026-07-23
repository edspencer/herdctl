import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import type { SDKMessage } from "../../runner/types.js";
import { buildLifecycleHooks, tapLifecycleStream } from "../session-hooks.js";
import { SessionReaper } from "../session-reaper.js";
import type { SessionLifecycleSignal, SessionWakeEntry } from "../types.js";
import { type WakePersistence, WakeRegistry } from "../wake-registry.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

// A fake timers helper is used in the #368 grace-reap tests; always restore real
// timers afterward so an early failure can't leak fake timers into later tests.
afterEach(() => {
  vi.useRealTimers();
});

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  for (const m of messages) yield m;
}

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
  return {
    reconcile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as WakeRegistry & {
    reconcile: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
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

  it("reaps a kept-alive session a grace window after background_tasks_changed empties (fire-and-forget)", async () => {
    vi.useFakeTimers();
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry: fakeRegistry(), onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(managed.isLive()).toBe(true);

    // Task set drained to empty — the reap is now DEFERRED (a re-invocation might
    // follow), not synchronous (#368).
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    expect(managed.isLive()).toBe(true);
    expect(onReap).not.toHaveBeenCalled();

    // No re-invocation ever arrives → the grace window elapses → reap.
    await vi.runAllTimersAsync();
    expect(onReap).toHaveBeenCalledWith({ agent: "team/agent", sessionId: "sess-1" });
    expect(managed.isLive()).toBe(false);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("does NOT reap when a re-invocation follows a completed background task (#368)", async () => {
    vi.useFakeTimers();
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry: fakeRegistry(), onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    // Turn ends with a background task live → keepAlive.
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    // Task completes → task set empties → grace reap armed (not fired).
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    expect(managed.isLive()).toBe(true);
    // The SDK re-invokes the parent with the task's result: the resumed turn's
    // first output arrives as `activity`, which must cancel the pending reap.
    await managed.handleSignal(signal({ kind: "activity" }));

    await vi.runAllTimersAsync();
    expect(onReap).not.toHaveBeenCalled();
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
  });

  it("a turn_end keepAlive supersedes a pending grace reap", async () => {
    vi.useFakeTimers();
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    // The re-invoked turn ends having launched fresh background work → keepAlive
    // again, cancelling the pending grace reap.
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));

    await vi.runAllTimersAsync();
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
  });

  it("a new background task cancels a pending grace reap", async () => {
    vi.useFakeTimers();
    const reaper = new SessionReaper({ registry: fakeRegistry() });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    // A fresh background task registers before the grace elapses → keep alive.
    await managed.handleSignal(
      signal({ kind: "background_tasks_changed", backgroundTasks: [TASK] }),
    );

    await vi.runAllTimersAsync();
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
  });

  it("integration: a completed background task's re-invocation survives (real hook + stream ordering, #368)", async () => {
    // Real timers with a short grace: assert the session is still live PAST the
    // window, so a regression (activity failing to cancel) would reap and fail.
    const reaper = new SessionReaper({ registry: fakeRegistry(), reinvocationGraceMs: 40 });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");
    const sink = (s: SessionLifecycleSignal) => void managed.handleSignal(s);

    // Turn 1 ends via the real Stop hook, a background task still live → keepAlive.
    const hooks = buildLifecycleHooks(sink);
    const stop = hooks!.Stop![0].hooks[0];
    await stop(
      {
        hook_event_name: "Stop",
        session_id: "sess-1",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/tmp",
        stop_hook_active: false,
        session_crons: [],
        background_tasks: [{ task_id: "t1", task_type: "shell", description: "gh pr checks loop" }],
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    await tick();
    expect(managed.isLive()).toBe(true);

    // Task completes and the SDK re-invokes: the real stream yields the empty
    // task-set change, then the resumed turn's first assistant message.
    const messages: SDKMessage[] = [
      {
        type: "system",
        subtype: "background_tasks_changed",
        session_id: "sess-1",
        tasks: [],
      } as unknown as SDKMessage,
      { type: "assistant", session_id: "sess-1" } as unknown as SDKMessage,
    ];
    for await (const _ of tapLifecycleStream(stream(messages), sink)) {
      /* drain */
    }

    // Wait well past the 40ms grace: the activity must have cancelled the reap.
    await new Promise((r) => setTimeout(r, 120));
    expect(managed.isLive()).toBe(true);
    expect(session.close).not.toHaveBeenCalled();
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

  it("retires a wake via the registry on a cron_deleted signal, without reaping", async () => {
    const registry = fakeRegistry();
    const onReap = vi.fn();
    const reaper = new SessionReaper({ registry, onReap });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    await managed.handleSignal(signal({ kind: "cron_deleted", deletedCronIds: ["c1", "c2"] }));

    expect(registry.remove).toHaveBeenCalledWith("c1");
    expect(registry.remove).toHaveBeenCalledWith("c2");
    // A CronDelete is mid-turn work, not a turn boundary — it must not reconcile
    // or reap the still-live session.
    expect(registry.reconcile).not.toHaveBeenCalled();
    expect(onReap).not.toHaveBeenCalled();
    expect(managed.isLive()).toBe(true);
    await tick();
    expect(session.close).not.toHaveBeenCalled();
  });

  it("keeps processing signals when a cron_deleted removal fails", async () => {
    const registry = {
      reconcile: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockRejectedValue(new Error("state io error")),
    } as unknown as WakeRegistry & { remove: ReturnType<typeof vi.fn> };
    const reaper = new SessionReaper({ registry });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    // The failed removal is swallowed (logged) and must not poison the queue.
    await managed.handleSignal(signal({ kind: "cron_deleted", deletedCronIds: ["c1"] }));
    expect(managed.isLive()).toBe(true);

    // A subsequent turn_end is still processed and reaps as usual.
    await managed.handleSignal(signal());
    expect(managed.isLive()).toBe(false);
    await tick();
    expect(session.close).toHaveBeenCalledTimes(1);
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
    vi.useFakeTimers();
    const registry = {
      reconcile: vi.fn().mockRejectedValueOnce(new Error("io")).mockResolvedValue(undefined),
    } as unknown as WakeRegistry;
    const reaper = new SessionReaper({ registry });
    const session = fakeSession();
    const managed = reaper.manage(session, "team/agent");

    // First turn_end keeps the session alive (its reconcile rejects but is caught).
    await managed.handleSignal(signal({ backgroundTasks: [TASK] }));
    expect(managed.isLive()).toBe(true);

    // A later signal must still be processed — the queue wasn't poisoned. The
    // drain-to-empty arms a grace reap that fires once the window elapses.
    await managed.handleSignal(signal({ kind: "background_tasks_changed", backgroundTasks: [] }));
    await vi.runAllTimersAsync();
    expect(managed.isLive()).toBe(false);
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});

/** In-memory persistence returning independent copies (like a real read). */
function memoryPersistence(initial: SessionWakeEntry[] = []): WakePersistence & {
  entries: SessionWakeEntry[];
} {
  let store = [...initial];
  return {
    get entries() {
      return store;
    },
    load: async () => store.map((e) => ({ ...e })),
    save: async (entries) => {
      store = entries.map((e) => ({ ...e }));
    },
  };
}

describe("CronDelete retires a recurring wake end-to-end (#409)", () => {
  it("recurring wake captured → resumed CronDelete → entry removed → no further fire", async () => {
    // A real WakeRegistry over in-memory persistence, driven through the real
    // Stop + PostToolUse hooks and the reaper — the full production path.
    const NOW = new Date("2026-07-23T12:00:00.000Z");
    // nextRunAt is in the past so the wake is immediately due once persisted.
    const resolveNextRun = () => new Date(NOW.getTime() - 1000);
    const persistence = memoryPersistence();
    const fire = vi.fn().mockResolvedValue(undefined);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire });
    const reaper = new SessionReaper({ registry });

    // Turn 1 (original): the agent creates a recurring cron; herdctl captures it
    // at the turn boundary. A fresh managed handle models each turn's process.
    const managed1 = reaper.manage(fakeSession(), "team/agent");
    const sink1 = (s: SessionLifecycleSignal) => managed1.handleSignal(s);
    const stop1 = buildLifecycleHooks(sink1)!.Stop![0].hooks[0];
    await stop1(
      {
        hook_event_name: "Stop",
        session_id: "sess-1",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/tmp",
        stop_hook_active: false,
        session_crons: [{ id: "c1", schedule: "*/17 * * * *", recurring: true, prompt: "poll" }],
        background_tasks: [],
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    await tick();
    expect(persistence.entries.map((e) => e.id)).toEqual(["c1"]);

    // Turn 2 (herdctl-resumed): the session-only cron is NOT re-armed, so its
    // Stop reports empty crons. The agent calls CronDelete(c1) mid-turn. Without
    // the PostToolUse wiring the recurring wake would survive (reconcile keeps it
    // on empty), and keep firing until the 7-day prune — the #409 bug.
    const managed2 = reaper.manage(fakeSession(), "team/agent");
    const sink2 = (s: SessionLifecycleSignal) => managed2.handleSignal(s);
    const built2 = buildLifecycleHooks(sink2)!;
    const postToolUse2 = built2.PostToolUse![0].hooks[0];
    const stop2 = built2.Stop![0].hooks[0];
    await postToolUse2(
      {
        hook_event_name: "PostToolUse",
        session_id: "sess-1",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/tmp",
        tool_name: "CronDelete",
        tool_input: { id: "c1" },
        tool_response: { id: "c1" },
        tool_use_id: "tu-1",
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    await tick();
    // The wake is gone.
    expect(persistence.entries).toEqual([]);

    // The turn ends with empty crons (resumed turn) — reconcile must not resurrect it.
    await stop2(
      {
        hook_event_name: "Stop",
        session_id: "sess-1",
        transcript_path: "/tmp/t.jsonl",
        cwd: "/tmp",
        stop_hook_active: false,
        session_crons: [],
        background_tasks: [],
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    await tick();
    expect(persistence.entries).toEqual([]);

    // No further fire: a scheduler tick past the old nextRunAt dispatches nothing.
    const dispatched = await registry.dispatchDue(new Date(NOW.getTime() + 20 * 60_000));
    expect(dispatched).toEqual([]);
    expect(fire).not.toHaveBeenCalled();
  });
});
