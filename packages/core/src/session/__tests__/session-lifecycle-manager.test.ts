import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSession } from "../../runner/runtime/interface.js";
import { FleetStateWakePersistence } from "../fleet-state-wake-persistence.js";
import {
  defaultResolveNextRun,
  SessionLifecycleManager,
  type SessionWakeChatOptions,
} from "../session-lifecycle-manager.js";
import type { SessionLifecycleSignal, SessionWakeEntry } from "../types.js";

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
