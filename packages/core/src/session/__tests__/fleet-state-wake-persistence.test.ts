import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFleetState, writeFleetState } from "../../state/fleet-state.js";
import { STATE_FILE_NAME } from "../../state/types.js";
import { FleetStateWakePersistence } from "../fleet-state-wake-persistence.js";
import type { SessionWakeEntry } from "../types.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");

function entry(overrides: Partial<SessionWakeEntry> = {}): SessionWakeEntry {
  return {
    id: "c1",
    agent: "team/agent",
    sessionId: "sess-1",
    schedule: "*/5 * * * *",
    recurring: true,
    prompt: "WAKE",
    nextRunAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("FleetStateWakePersistence", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "herdctl-wake-"));
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  it("returns an empty set when no state file exists", async () => {
    const persistence = new FleetStateWakePersistence({ stateDir });
    expect(await persistence.load()).toEqual([]);
  });

  it("round-trips wake entries through state.yaml keyed by id", async () => {
    const persistence = new FleetStateWakePersistence({ stateDir });
    const wakes = [entry({ id: "a" }), entry({ id: "b", sessionId: "sess-2" })];
    await persistence.save(wakes);

    const reloaded = await persistence.load();
    expect(reloaded.map((e) => e.id).sort()).toEqual(["a", "b"]);

    // Persisted as a keyed record under session_wakes.
    const raw = await readFile(join(stateDir, STATE_FILE_NAME), "utf8");
    expect(raw).toContain("session_wakes");
    expect(raw).toContain("a");
  });

  it("overwrites the previous set (save is a full replace)", async () => {
    const persistence = new FleetStateWakePersistence({ stateDir });
    await persistence.save([entry({ id: "a" }), entry({ id: "b" })]);
    await persistence.save([entry({ id: "c" })]);
    expect((await persistence.load()).map((e) => e.id)).toEqual(["c"]);
  });

  it("preserves unrelated fleet state when saving wakes", async () => {
    const stateFilePath = join(stateDir, STATE_FILE_NAME);
    await writeFleetState(stateFilePath, {
      fleet: { started_at: NOW.toISOString() },
      agents: { "team/agent": { status: "running", current_job: "job-1" } },
    });

    const persistence = new FleetStateWakePersistence({ stateDir });
    await persistence.save([entry({ id: "a" })]);

    const state = await readFleetState(stateFilePath);
    expect(state.fleet.started_at).toBe(NOW.toISOString());
    expect(state.agents["team/agent"].current_job).toBe("job-1");
    expect(Object.keys(state.session_wakes ?? {})).toEqual(["a"]);
  });
});
