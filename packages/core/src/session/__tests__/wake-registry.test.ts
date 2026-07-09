import { describe, expect, it, vi } from "vitest";
import type { SessionWakeEntry } from "../types.js";
import { type WakePersistence, WakeRegistry } from "../wake-registry.js";
import { RECURRING_WAKE_MAX_AGE_MS } from "../wake-store.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");
const resolveNextRun = (_s: string, from: Date) => new Date(from.getTime() + 5 * 60_000);

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

function entry(overrides: Partial<SessionWakeEntry> = {}): SessionWakeEntry {
  return {
    id: "c1",
    agent: "team/agent",
    sessionId: "sess-1",
    schedule: "*/5 * * * *",
    recurring: false,
    prompt: "WAKE",
    nextRunAt: new Date(NOW.getTime() - 1000).toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("WakeRegistry.reconcile", () => {
  it("captures pending crons into persistence", async () => {
    const persistence = memoryPersistence();
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire: vi.fn() });
    await registry.reconcile(
      "team/agent",
      "sess-1",
      [{ id: "c1", schedule: "*/5 * * * *", recurring: true, prompt: "go" }],
      NOW,
    );
    expect(persistence.entries).toHaveLength(1);
    expect(persistence.entries[0]).toMatchObject({ id: "c1", recurring: true });
  });

  it("prunes expired recurring wakes on reconcile", async () => {
    const aged = entry({
      id: "aged",
      recurring: true,
      createdAt: new Date(NOW.getTime() - RECURRING_WAKE_MAX_AGE_MS - 1).toISOString(),
    });
    const persistence = memoryPersistence([aged]);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire: vi.fn() });
    await registry.reconcile("team/agent", "sess-2", [], NOW);
    expect(persistence.entries).toEqual([]);
  });
});

describe("WakeRegistry.dispatchDue", () => {
  it("fires due wakes and drops one-shots afterward", async () => {
    const persistence = memoryPersistence([entry({ id: "one", recurring: false })]);
    const fire = vi.fn().mockResolvedValue(undefined);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire });
    const dispatched = await registry.dispatchDue(NOW);
    expect(dispatched.map((e) => e.id)).toEqual(["one"]);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(persistence.entries).toEqual([]);
  });

  it("advances recurring wakes to their next fire time", async () => {
    const persistence = memoryPersistence([entry({ id: "rec", recurring: true })]);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire: vi.fn() });
    await registry.dispatchDue(NOW);
    expect(persistence.entries).toHaveLength(1);
    expect(persistence.entries[0].nextRunAt).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
  });

  it("skips wakes whose session is currently live (gap 6)", async () => {
    const persistence = memoryPersistence([entry({ id: "live", sessionId: "sess-live" })]);
    const fire = vi.fn();
    const registry = new WakeRegistry({
      persistence,
      resolveNextRun,
      fire,
      isSessionLive: (id) => id === "sess-live",
    });
    const dispatched = await registry.dispatchDue(NOW);
    expect(dispatched).toEqual([]);
    expect(fire).not.toHaveBeenCalled();
    // Left in place, not dropped — the live session re-captures it.
    expect(persistence.entries).toHaveLength(1);
  });

  it("does not fire wakes that are not yet due", async () => {
    const persistence = memoryPersistence([
      entry({ id: "future", nextRunAt: new Date(NOW.getTime() + 60_000).toISOString() }),
    ]);
    const fire = vi.fn();
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire });
    expect(await registry.dispatchDue(NOW)).toEqual([]);
    expect(fire).not.toHaveBeenCalled();
  });

  it("respects the concurrency limit", async () => {
    const many = Array.from({ length: 6 }, (_, i) => entry({ id: `w${i}`, recurring: true }));
    const persistence = memoryPersistence(many);
    let inFlight = 0;
    let peak = 0;
    const fire = vi.fn().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire, concurrency: 2 });
    await registry.dispatchDue(NOW);
    expect(fire).toHaveBeenCalledTimes(6);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("swallows a fire error without wedging (recurring already advanced)", async () => {
    const persistence = memoryPersistence([entry({ id: "rec", recurring: true })]);
    const fire = vi.fn().mockRejectedValue(new Error("boom"));
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire });
    await expect(registry.dispatchDue(NOW)).resolves.toHaveLength(1);
    // Advanced despite the failed fire — it simply retries next cycle.
    expect(persistence.entries[0].nextRunAt).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
  });
});

describe("WakeRegistry.remove / forgetSession", () => {
  it("removes a single wake by id", async () => {
    const persistence = memoryPersistence([entry({ id: "a" }), entry({ id: "b" })]);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire: vi.fn() });
    await registry.remove("a");
    expect(persistence.entries.map((e) => e.id)).toEqual(["b"]);
  });

  it("forgets all wakes for a session", async () => {
    const persistence = memoryPersistence([
      entry({ id: "a", sessionId: "s1" }),
      entry({ id: "b", sessionId: "s2" }),
    ]);
    const registry = new WakeRegistry({ persistence, resolveNextRun, fire: vi.fn() });
    await registry.forgetSession("s1");
    expect(persistence.entries.map((e) => e.id)).toEqual(["b"]);
  });
});
