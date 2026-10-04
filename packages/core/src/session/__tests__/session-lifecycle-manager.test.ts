import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import type { InjectedMcpServerDef } from "../../runner/types.js";
import { FleetStateWakePersistence } from "../fleet-state-wake-persistence.js";
import {
  defaultResolveNextRun,
  SessionLifecycleManager,
  type SessionWakeChatOptions,
} from "../session-lifecycle-manager.js";
import type { SessionLifecycleSignal, SessionWakeEntry } from "../types.js";

function turnEndSignal(overrides: Partial<SessionLifecycleSignal> = {}): SessionLifecycleSignal {
  return {
    kind: "turn_end",
    sessionId: "sess-job-1",
    sessionCrons: [],
    backgroundTasks: [],
    ...overrides,
  };
}

const NOW = new Date("2026-07-09T12:00:00.000Z");
const resolveNextRun = (_s: string, from: Date) => new Date(from.getTime() + 5 * 60_000);

function fakeSession(): RuntimeSession {
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

function dueWake(overrides: Partial<SessionWakeEntry> = {}): SessionWakeEntry {
  return {
    id: "w1",
    agent: "team/agent",
    sessionId: "sess-1",
    schedule: "*/5 * * * *",
    recurring: false,
    prompt: "WAKE-CONTINUE",
    nextRunAt: new Date(NOW.getTime() - 1000).toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("SessionLifecycleManager", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "herdctl-slm-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("manage() returns a live managed handle tracked by the reaper", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const managed = slm.manage(fakeSession(), "team/agent");
    expect(managed.isLive()).toBe(true);
    await managed.handleSignal({
      kind: "activity",
      sessionId: "sess-1",
      sessionCrons: [],
      backgroundTasks: [],
    } satisfies SessionLifecycleSignal);
    expect(slm.reaper.isSessionLive("sess-1")).toBe(true);
  });

  it("fires a due wake by resuming-and-injecting through openChatSession", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake()]);
    const calls: Array<[string, SessionWakeChatOptions]> = [];
    const openChatSession = vi.fn(async (agent: string, opts: SessionWakeChatOptions) => {
      calls.push([agent, opts]);
      return fakeSession();
    });

    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });
    const dispatched = await slm.dispatchDue(NOW);

    expect(dispatched.map((e) => e.id)).toEqual(["w1"]);
    expect(calls).toEqual([
      ["team/agent", { resume: "sess-1", prompt: "WAKE-CONTINUE", manageLifecycle: true }],
    ]);
    // One-shot fired → removed from the durable set.
    expect(await new FleetStateWakePersistence({ stateDir }).load()).toEqual([]);
  });

  it("delegates the woken turn to a registered sessionWakeHandler", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w2" })]);
    const session = fakeSession();
    const openChatSession = vi.fn().mockResolvedValue(session);
    const handler = vi.fn().mockResolvedValue(undefined);

    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession,
      resolveNextRun,
      sessionWakeHandler: handler,
    });
    await slm.dispatchDue(NOW);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe(session);
    expect(handler.mock.calls[0][1]).toMatchObject({ id: "w2" });
  });

  it("setSessionWakeHandler swaps the consumer at runtime", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w3" })]);
    const openChatSession = vi.fn().mockResolvedValue(fakeSession());
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });

    const handler = vi.fn().mockResolvedValue(undefined);
    slm.setSessionWakeHandler(handler);
    await slm.dispatchDue(NOW);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // Regression: edspencer/herdctl#390 — the wake fire path dropped the
  // in-process injectedMcpServers, so a resumed autonomous turn lost its
  // `mcp__…__*` tools for the whole stretch. A registered resolver must re-supply
  // them into openChatSession on every wake fire.
  it("re-supplies injectedMcpServers into openChatSession via a registered resolver", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w-inj" })]);
    const injected: Record<string, InjectedMcpServerDef> = {
      "paddock-self": { name: "paddock-self", tools: [] },
    };
    const calls: Array<[string, SessionWakeChatOptions]> = [];
    const openChatSession = vi.fn(async (agent: string, opts: SessionWakeChatOptions) => {
      calls.push([agent, opts]);
      return fakeSession();
    });
    const resolveInjectedMcpServers = vi.fn((_entry: SessionWakeEntry) => injected);

    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession,
      resolveNextRun,
      resolveInjectedMcpServers,
    });
    await slm.dispatchDue(NOW);

    // The resolver was consulted with the fired entry...
    expect(resolveInjectedMcpServers).toHaveBeenCalledTimes(1);
    expect(resolveInjectedMcpServers.mock.calls[0][0]).toMatchObject({ id: "w-inj" });
    // ...and the resolved servers reached openChatSession unchanged.
    expect(calls).toHaveLength(1);
    expect(calls[0][1].injectedMcpServers).toBe(injected);
    expect(calls[0][1]).toMatchObject({
      resume: "sess-1",
      prompt: "WAKE-CONTINUE",
      manageLifecycle: true,
    });
  });

  it("fires without injection (no crash) when no resolver is registered", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w-noinj" })]);
    const calls: SessionWakeChatOptions[] = [];
    const openChatSession = vi.fn(async (_agent: string, opts: SessionWakeChatOptions) => {
      calls.push(opts);
      return fakeSession();
    });

    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });
    const dispatched = await slm.dispatchDue(NOW);

    expect(dispatched.map((e) => e.id)).toEqual(["w-noinj"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].injectedMcpServers).toBeUndefined();
  });

  it("setResolveInjectedMcpServers swaps the resolver at runtime", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w-swap" })]);
    const injected: Record<string, InjectedMcpServerDef> = {
      later: { name: "later", tools: [] },
    };
    const calls: SessionWakeChatOptions[] = [];
    const openChatSession = vi.fn(async (_agent: string, opts: SessionWakeChatOptions) => {
      calls.push(opts);
      return fakeSession();
    });
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });

    slm.setResolveInjectedMcpServers(() => injected);
    await slm.dispatchDue(NOW);

    expect(calls[0].injectedMcpServers).toBe(injected);
  });

  it("fires without injection when the resolver throws (does not wedge the wake)", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([dueWake({ id: "w-throw" })]);
    const calls: SessionWakeChatOptions[] = [];
    const openChatSession = vi.fn(async (_agent: string, opts: SessionWakeChatOptions) => {
      calls.push(opts);
      return fakeSession();
    });
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession,
      resolveNextRun,
      resolveInjectedMcpServers: () => {
        throw new Error("resolver boom");
      },
    });

    const dispatched = await slm.dispatchDue(NOW);

    // The wake still fired; injection was simply omitted.
    expect(dispatched.map((e) => e.id)).toEqual(["w-throw"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].injectedMcpServers).toBeUndefined();
  });

  it("does not fire wakes that are not yet due", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "future", nextRunAt: new Date(NOW.getTime() + 60_000).toISOString() }),
    ]);
    const openChatSession = vi.fn();
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });
    expect(await slm.dispatchDue(NOW)).toEqual([]);
    expect(openChatSession).not.toHaveBeenCalled();
  });
});

// vulpes-pack#148 — wiring session wakes into the job path. Before this,
// RuntimeExecuteOptions.onLifecycleSignal was documented "ignored" by
// execute() and neither job call site fed it anywhere: a job that called
// ScheduleWakeup completed and its wake evaporated. `trackJob` is the
// capture-only sink that closes that gap without a second reaper.
describe("SessionLifecycleManager.trackJob (vulpes-pack#148)", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "herdctl-slm-trackjob-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("persists a wake from an authoritative turn_end, keyed to the qualified agent name", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent");

    await tracker.onLifecycleSignal(
      turnEndSignal({
        sessionCrons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
      }),
    );

    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: "c1",
      agent: "team/agent",
      sessionId: "sess-job-1",
      prompt: "WAKE",
    });
  });

  // The test that matters most: pins the #459 hasSnapshot semantics on the job
  // path too. A turn_end fired without the CLI's background_tasks/session_crons
  // envelope must NOT reconcile — reading its empty arrays as authoritative
  // would silently delete a wake a PRIOR turn in the same job already captured.
  it("does not reconcile a turn_end with hasSnapshot: false — a captured wake survives", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent");

    await tracker.onLifecycleSignal(
      turnEndSignal({
        sessionCrons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
      }),
    );
    // A later turn_end in the same job fires without the envelope at all.
    await tracker.onLifecycleSignal(turnEndSignal({ sessionCrons: [], hasSnapshot: false }));

    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted.map((w) => w.id)).toEqual(["c1"]);
  });

  // Counter-check: an authoritative empty report (hasSnapshot undefined/true)
  // DOES reconcile — a retired one-shot is dropped as normal.
  it("reconciles an authoritative empty turn_end — a retired wake is dropped", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent");

    await tracker.onLifecycleSignal(
      turnEndSignal({
        sessionCrons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
      }),
    );
    await tracker.onLifecycleSignal(turnEndSignal({ sessionCrons: [] }));

    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted).toEqual([]);
  });

  it("removes a wake on a cron_deleted signal", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent");

    await tracker.onLifecycleSignal(
      turnEndSignal({
        sessionCrons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
      }),
    );
    await tracker.onLifecycleSignal({
      kind: "cron_deleted",
      sessionId: "sess-job-1",
      sessionCrons: [],
      backgroundTasks: [],
      deletedCronIds: ["c1"],
    });

    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted).toEqual([]);
  });

  it("ignores activity and background_tasks_changed signals (no registry write)", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const reconcileSpy = vi.spyOn(slm.registry, "reconcile");
    const tracker = slm.trackJob("team/agent");

    await tracker.onLifecycleSignal({
      kind: "activity",
      sessionId: "sess-job-1",
      sessionCrons: [],
      backgroundTasks: [],
    });
    await tracker.onLifecycleSignal({
      kind: "background_tasks_changed",
      sessionId: "sess-job-1",
      sessionCrons: [],
      backgroundTasks: [{ id: "t1", type: "shell", status: "running", description: "server" }],
    });

    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(await new FleetStateWakePersistence({ stateDir }).load()).toEqual([]);
  });

  it("marks a resumed job's session live: dispatchDue skips it, then fires it after release()", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-live", sessionId: "sess-job-1" }),
    ]);
    const openChatSession = vi.fn().mockResolvedValue(fakeSession());
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });

    const tracker = slm.trackJob("team/agent", "sess-job-1");
    expect(await slm.dispatchDue(NOW)).toEqual([]);
    expect(openChatSession).not.toHaveBeenCalled();

    tracker.release();
    const dispatched = await slm.dispatchDue(NOW);
    expect(dispatched.map((e) => e.id)).toEqual(["w-live"]);
  });

  it("marks a fresh job's session live off the first signal's sessionId", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-fresh", sessionId: "sess-new" }),
    ]);
    const openChatSession = vi.fn().mockResolvedValue(fakeSession());
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });

    // No resume target — trackJob doesn't know the session id yet, but a due
    // wake for a session it hasn't heard of must still fire normally.
    const tracker = slm.trackJob("team/agent");
    expect((await slm.dispatchDue(NOW)).map((e) => e.id)).toEqual(["w-fresh"]);

    // Re-seed the same wake (dispatchDue above consumed the one-shot) and have
    // the job's first signal arrive for "sess-new" — it should now be live.
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-fresh-2", sessionId: "sess-new" }),
    ]);
    await tracker.onLifecycleSignal({
      kind: "activity",
      sessionId: "sess-new",
      sessionCrons: [],
      backgroundTasks: [],
    });
    expect(await slm.dispatchDue(NOW)).toEqual([]);
    expect(openChatSession).toHaveBeenCalledTimes(1); // unchanged since the first dispatchDue above

    tracker.release();
    expect((await slm.dispatchDue(NOW)).map((e) => e.id)).toEqual(["w-fresh-2"]);
  });

  it("release() is idempotent and safe to call without any signal ever arriving", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent", "sess-job-1");
    tracker.release();
    expect(() => tracker.release()).not.toThrow();

    // The live mark is gone — a due wake for that session now fires normally.
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-after-release", sessionId: "sess-job-1" }),
    ]);
    const openChatSession = vi.fn().mockResolvedValue(fakeSession());
    const slm2 = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });
    expect((await slm2.dispatchDue(NOW)).map((e) => e.id)).toEqual(["w-after-release"]);
  });

  it("keeps a session live until every concurrent job tracking it has released (refcount)", async () => {
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-refcount", sessionId: "sess-shared" }),
    ]);
    const openChatSession = vi.fn().mockResolvedValue(fakeSession());
    const slm = new SessionLifecycleManager({ stateDir, openChatSession, resolveNextRun });

    // Two jobs concurrently resume the same session id (e.g. `dispatchDue`
    // firing a wake for it while a second job is already mid-flight against
    // it — see edspencer/herdctl#460).
    const trackerA = slm.trackJob("team/agent", "sess-shared");
    const trackerB = slm.trackJob("team/agent", "sess-shared");

    trackerA.release();
    // A `Set`-based live mark would have unpinned the session right here —
    // trackerB is still running against it.
    expect(await slm.dispatchDue(NOW)).toEqual([]);
    expect(openChatSession).not.toHaveBeenCalled();

    trackerB.release();
    const dispatched = await slm.dispatchDue(NOW);
    expect(dispatched.map((e) => e.id)).toEqual(["w-refcount"]);
  });

  it("a lifecycle signal that arrives after release() does not re-pin the session live or persist a wake", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn().mockResolvedValue(fakeSession()),
      resolveNextRun,
    });
    const tracker = slm.trackJob("team/agent"); // fresh job, learns its id off the first signal
    tracker.release(); // the job's own turn already completed before any signal arrived

    // A straggler signal (e.g. a deferred `emit()` microtask from a Stop hook
    // firing right as the job finished) must be a full no-op: it must neither
    // persist the wake it carries nor re-pin the session live — otherwise
    // nothing left holding this tracker will ever release it, and every
    // future dispatch for that session id silently stops firing.
    await tracker.onLifecycleSignal(
      turnEndSignal({
        sessionId: "sess-straggler",
        sessionCrons: [{ id: "c-straggler", schedule: "+60s", recurring: false, prompt: "WAKE" }],
      }),
    );
    expect(await new FleetStateWakePersistence({ stateDir }).load()).toEqual([]);

    // A wake for that same session id, seeded independently, must still fire
    // normally — the straggler must not have pinned it live.
    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-straggler", sessionId: "sess-straggler" }),
    ]);
    expect((await slm.dispatchDue(NOW)).map((e) => e.id)).toEqual(["w-straggler"]);
  });

  it("a rejecting registry.reconcile never propagates out of onLifecycleSignal", async () => {
    const slm = new SessionLifecycleManager({
      stateDir,
      openChatSession: vi.fn(),
      resolveNextRun,
    });
    vi.spyOn(slm.registry, "reconcile").mockRejectedValue(new Error("state io error"));
    const tracker = slm.trackJob("team/agent");

    await expect(
      tracker.onLifecycleSignal(
        turnEndSignal({
          sessionCrons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

// Regression: edspencer/herdctl#311 — the harness serializes a relative one-shot
// ScheduleWakeup as a wall-clock cron in the host's LOCAL timezone, so the wake
// must be resolved in that same timezone. Resolving it as UTC on a host behind
// UTC rolls the next fire time to tomorrow, so a "+60s" wake never fires today.
describe("defaultResolveNextRun (session wake tz)", () => {
  const originalTZ = process.env.TZ;

  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  });

  it("resolves a local-time one-shot cron to ~1 minute out, not ~24h, when host tz is behind UTC", () => {
    // Host tz America/New_York (UTC-4 in July). Real wall-clock 19:08 EDT ==
    // 23:08 UTC. A "+60s" ScheduleWakeup is serialized by the harness as the
    // local target minute/hour: "10 19 * * *" (19:10 EDT).
    process.env.TZ = "America/New_York";
    const now = new Date("2026-07-09T23:08:46.380Z"); // 19:08:46 EDT
    const schedule = "10 19 * * *"; // 19:10 local == 23:10 UTC

    const next = defaultResolveNextRun(schedule, now);

    // Correct: next fire is 19:10 EDT today == 23:10 UTC, ~74s out.
    expect(next.toISOString()).toBe("2026-07-09T23:10:00.000Z");
    const deltaMs = next.getTime() - now.getTime();
    expect(deltaMs).toBeGreaterThan(0);
    expect(deltaMs).toBeLessThan(5 * 60_000); // minutes out, not ~20h
  });

  it("resolves the same cron in UTC to ~24h out (documents the pre-fix behavior)", async () => {
    // Guard against a regression to UTC resolution: the old resolver treated the
    // local cron as UTC, so "10 19 * * *" from 23:08 UTC rolled to tomorrow.
    process.env.TZ = "UTC";
    const { getNextCronTrigger } = await import("../../scheduler/cron.js");
    const now = new Date("2026-07-09T23:08:46.380Z");
    const utcNext = getNextCronTrigger("10 19 * * *", now);
    expect(utcNext.toISOString()).toBe("2026-07-10T19:10:00.000Z"); // ~20h late — the bug
  });
});
