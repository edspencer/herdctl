import { describe, expect, it } from "vitest";
import type { SessionCronSummary, SessionWakeEntry } from "../types.js";
import {
  advanceWake,
  findDueWakes,
  isExpired,
  pruneExpiredWakes,
  RECURRING_WAKE_MAX_AGE_MS,
  reconcileSessionWakes,
  removeSessionWakes,
  removeWake,
} from "../wake-store.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");

/** Deterministic resolver: next run is always 5 minutes after `from`. */
const resolveNextRun = (_schedule: string, from: Date) => new Date(from.getTime() + 5 * 60_000);

function cron(overrides: Partial<SessionCronSummary> = {}): SessionCronSummary {
  return { id: "c1", schedule: "35 13 * * *", recurring: false, prompt: "WAKE", ...overrides };
}

function entry(overrides: Partial<SessionWakeEntry> = {}): SessionWakeEntry {
  return {
    id: "c1",
    agent: "team/agent",
    sessionId: "sess-1",
    schedule: "35 13 * * *",
    recurring: false,
    prompt: "WAKE",
    nextRunAt: new Date(NOW.getTime() + 60_000).toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("reconcileSessionWakes", () => {
  it("captures a new cron with a resolved absolute nextRunAt", () => {
    const result = reconcileSessionWakes({
      existing: [],
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [cron()],
      now: NOW,
      resolveNextRun,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "c1",
      agent: "team/agent",
      sessionId: "sess-1",
      recurring: false,
      prompt: "WAKE",
      nextRunAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
      createdAt: NOW.toISOString(),
    });
  });

  it("keeps a known id unchanged (does not reset the cycle)", () => {
    const existing = [entry({ id: "c1", nextRunAt: "2026-07-09T13:35:00.000Z" })];
    const result = reconcileSessionWakes({
      existing,
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [cron({ id: "c1", prompt: "changed" })],
      now: NOW,
      resolveNextRun,
    });
    expect(result).toHaveLength(1);
    // Preserved verbatim — including the original prompt and nextRunAt.
    expect(result[0]).toEqual(existing[0]);
  });

  it("drops a one-shot that is no longer reported (fired or cancelled)", () => {
    const existing = [entry({ id: "one", recurring: false })];
    const result = reconcileSessionWakes({
      existing,
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [],
      now: NOW,
      resolveNextRun,
    });
    expect(result).toEqual([]);
  });

  it("keeps a recurring wake even when a resumed turn reports it empty (gap 4)", () => {
    const existing = [entry({ id: "rec", recurring: true })];
    const result = reconcileSessionWakes({
      existing,
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [],
      now: NOW,
      resolveNextRun,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rec");
  });

  it("leaves other sessions' wakes untouched", () => {
    const mine = entry({ id: "mine", sessionId: "sess-1", recurring: false });
    const other = entry({ id: "other", sessionId: "sess-2", recurring: false });
    const result = reconcileSessionWakes({
      existing: [mine, other],
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [],
      now: NOW,
      resolveNextRun,
    });
    expect(result.map((e) => e.id)).toEqual(["other"]);
  });

  it("adds new and drops stale one-shots in one pass", () => {
    const stale = entry({ id: "stale", recurring: false });
    const result = reconcileSessionWakes({
      existing: [stale],
      agent: "team/agent",
      sessionId: "sess-1",
      sessionCrons: [cron({ id: "fresh" })],
      now: NOW,
      resolveNextRun,
    });
    expect(result.map((e) => e.id).sort()).toEqual(["fresh"]);
  });
});

describe("advanceWake", () => {
  it("returns null for a one-shot (fire once)", () => {
    expect(advanceWake(entry({ recurring: false }), NOW, resolveNextRun)).toBeNull();
  });

  it("advances a recurring wake to its next fire time", () => {
    const advanced = advanceWake(entry({ recurring: true }), NOW, resolveNextRun);
    expect(advanced?.nextRunAt).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());
  });

  it("returns null for a recurring wake past its 7-day lifetime", () => {
    const old = entry({
      recurring: true,
      createdAt: new Date(NOW.getTime() - RECURRING_WAKE_MAX_AGE_MS - 1000).toISOString(),
    });
    expect(advanceWake(old, NOW, resolveNextRun)).toBeNull();
  });
});

describe("isExpired / pruneExpiredWakes", () => {
  it("one-shots never expire on age", () => {
    const old = entry({
      recurring: false,
      createdAt: new Date(NOW.getTime() - RECURRING_WAKE_MAX_AGE_MS * 2).toISOString(),
    });
    expect(isExpired(old, NOW)).toBe(false);
  });

  it("prunes only aged recurring wakes", () => {
    const fresh = entry({ id: "fresh", recurring: true, createdAt: NOW.toISOString() });
    const aged = entry({
      id: "aged",
      recurring: true,
      createdAt: new Date(NOW.getTime() - RECURRING_WAKE_MAX_AGE_MS - 1).toISOString(),
    });
    const result = pruneExpiredWakes([fresh, aged], NOW);
    expect(result.map((e) => e.id)).toEqual(["fresh"]);
  });
});

describe("removeWake / removeSessionWakes / findDueWakes", () => {
  it("removes a wake by id", () => {
    expect(removeWake([entry({ id: "a" }), entry({ id: "b" })], "a").map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("removes all wakes for a session", () => {
    const a = entry({ id: "a", sessionId: "sess-1" });
    const b = entry({ id: "b", sessionId: "sess-2" });
    expect(removeSessionWakes([a, b], "sess-1").map((e) => e.id)).toEqual(["b"]);
  });

  it("finds wakes due at or before now", () => {
    const due = entry({ id: "due", nextRunAt: new Date(NOW.getTime() - 1).toISOString() });
    const exact = entry({ id: "exact", nextRunAt: NOW.toISOString() });
    const future = entry({ id: "future", nextRunAt: new Date(NOW.getTime() + 1).toISOString() });
    expect(
      findDueWakes([due, exact, future], NOW)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["due", "exact"]);
  });
});
