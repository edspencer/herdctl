/**
 * Tests for the scheduler host-execution seam (edspencer/herdctl#375) and
 * runtime add/remove of a single schedule + mutation gate (edspencer/herdctl#376).
 *
 * Covers:
 * - setScheduleTriggerHandler: a fired schedule routes to the host handler when
 *   one is registered, and falls back to the headless executor when it is not.
 * - setAgentSchedule: arms a new schedule on an already-registered agent at
 *   runtime (the scheduler picks it up from live config).
 * - removeAgentSchedule: prunes persisted state so a re-added name does not
 *   inherit stale last_run_at / disabled status.
 * - the allowScheduleMutation gate blocks setAgentSchedule/removeAgentSchedule
 *   when disabled (the default), while leaving enable/disable ungated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during headless execution.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAgent } from "../../config/index.js";
import type { TriggerInfo } from "../../scheduler/index.js";
import { AgentNotFoundError, ScheduleMutationDisabledError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

/** Poll `predicate` until true or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("FleetManager schedule seam + runtime mutation", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-sched-mgmt-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
    // Deterministic empty fleet; agents are registered programmatically per test.
    configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify({ version: 1, agents: [] }));
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function createManager(opts?: { allowScheduleMutation?: boolean; checkInterval?: number }) {
    return new FleetManager({
      configPath,
      stateDir,
      checkInterval: opts?.checkInterval ?? 20,
      logger: silentLogger(),
      allowScheduleMutation: opts?.allowScheduleMutation,
    });
  }

  // ===========================================================================
  // D1 — setScheduleTriggerHandler (host-execution seam)
  // ===========================================================================

  describe("setScheduleTriggerHandler()", () => {
    it("routes a fired schedule to the host handler instead of the headless executor", async () => {
      const manager = createManager();
      await manager.initialize();

      // schedule:triggered is emitted only by the headless ScheduleExecutor path,
      // so it doubles as a probe for whether the fallback ran.
      const headlessProbe = vi.fn();
      manager.on("schedule:triggered", headlessProbe);

      const handler = vi.fn(async (_info: TriggerInfo) => {});
      manager.setScheduleTriggerHandler(handler);

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      const info = handler.mock.calls[0][0];
      expect(info.scheduleName).toBe("tick");
      expect(info.agent.qualifiedName).toBe("sched-agent");

      // The headless executor must NOT have run when a handler owns execution.
      expect(headlessProbe).not.toHaveBeenCalled();
    });

    it("falls back to the headless executor when no handler is registered", async () => {
      const manager = createManager();
      await manager.initialize();

      const headlessProbe = vi.fn();
      manager.on("schedule:triggered", headlessProbe);

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.stop();

      // Headless path ran: it emits schedule:triggered before executing the job.
      expect(headlessProbe).toHaveBeenCalled();
      expect(headlessProbe.mock.calls[0][0].scheduleName).toBe("tick");
    });

    it("clearing the handler (undefined) restores headless execution", async () => {
      const manager = createManager();
      await manager.initialize();

      const handler = vi.fn(async () => {});
      manager.setScheduleTriggerHandler(handler);
      manager.setScheduleTriggerHandler(undefined);

      const headlessProbe = vi.fn();
      manager.on("schedule:triggered", headlessProbe);

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.stop();

      expect(handler).not.toHaveBeenCalled();
      expect(headlessProbe).toHaveBeenCalled();
    });

    it("routes a forced/immediate trigger through the host handler, not the headless path", async () => {
      const manager = createManager();
      await manager.initialize();

      const headlessProbe = vi.fn();
      manager.on("schedule:triggered", headlessProbe);
      const handler = vi.fn(async (_info: TriggerInfo) => {});
      manager.setScheduleTriggerHandler(handler);

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { now: { type: "interval", interval: "1h" } },
      });

      // Drive a forced trigger straight through the scheduler seam — the single
      // entry point every scheduler-fired trigger funnels through (a due poll,
      // a catch-up fire, or a "trigger now") — rather than waiting for the poll
      // loop. This asserts forced triggers use the seam, not just polled ones.
      const agent = (manager as unknown as { config: { agents: ResolvedAgent[] } }).config
        .agents[0];
      const info: TriggerInfo = {
        agent,
        scheduleName: "now",
        schedule: agent.schedules?.now as TriggerInfo["schedule"],
        scheduleState: { last_run_at: null, next_run_at: null, status: "idle", last_error: null },
      };
      await (
        manager as unknown as { handleScheduleTrigger(i: TriggerInfo): Promise<void> }
      ).handleScheduleTrigger(info);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].scheduleName).toBe("now");
      expect(headlessProbe).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // D2 — setAgentSchedule (runtime add)
  // ===========================================================================

  describe("setAgentSchedule()", () => {
    it("arms a new schedule on an existing agent so the scheduler fires it", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();

      const handler = vi.fn(async (_info: TriggerInfo) => {});
      manager.setScheduleTriggerHandler(handler);

      await manager.addAgent({ name: "sched-agent", working_directory: tempDir, max_turns: 1 });
      await manager.start();

      // No schedules yet → nothing fires.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(handler).not.toHaveBeenCalled();

      const info = await manager.setAgentSchedule("sched-agent", "tick", {
        type: "interval",
        interval: "1h",
      });
      expect(info.name).toBe("tick");
      expect(info.type).toBe("interval");

      // The live agent config now carries the schedule, so it arms and fires.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].scheduleName).toBe("tick");

      // Also visible via the schedule query surface.
      const all = await manager.getSchedules();
      expect(all.map((s) => s.name)).toContain("tick");
    });

    it("validates the schedule against ScheduleSchema", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();
      await manager.addAgent({ name: "sched-agent", working_directory: tempDir });

      await expect(
        // `type` is required; an empty object fails schema validation.
        manager.setAgentSchedule("sched-agent", "bad", {} as never),
      ).rejects.toThrow(/Invalid schedule configuration/);
    });

    it("throws AgentNotFoundError for an unknown agent", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();

      await expect(
        manager.setAgentSchedule("nope", "tick", { type: "interval", interval: "1h" }),
      ).rejects.toBeInstanceOf(AgentNotFoundError);
    });

    it("re-arming a previously disabled schedule clears the disabled state so it fires again", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();

      const handler = vi.fn(async (_info: TriggerInfo) => {});
      manager.setScheduleTriggerHandler(handler);

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      // Persist a disabled status for the schedule.
      const disabled = await manager.disableSchedule("sched-agent", "tick");
      expect(disabled.status).toBe("disabled");

      // Re-setting the same schedule must normalize the lingering disabled state
      // — config-only mutation would leave it disabled and it would never fire.
      const info = await manager.setAgentSchedule("sched-agent", "tick", {
        type: "interval",
        interval: "1h",
      });
      expect(info.status).toBe("idle");

      await manager.start();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await manager.stop();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].scheduleName).toBe("tick");
    });
  });

  // ===========================================================================
  // D2 — removeAgentSchedule (runtime remove + state prune)
  // ===========================================================================

  describe("removeAgentSchedule()", () => {
    it("removes the schedule from config and the query surface", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();
      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      expect((await manager.getSchedules()).map((s) => s.name)).toContain("tick");

      const removed = await manager.removeAgentSchedule("sched-agent", "tick");
      expect(removed).toBe(true);
      expect((await manager.getSchedules()).map((s) => s.name)).not.toContain("tick");
    });

    it("returns false when the agent has no such schedule", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();
      await manager.addAgent({ name: "sched-agent", working_directory: tempDir });

      expect(await manager.removeAgentSchedule("sched-agent", "ghost")).toBe(false);
    });

    it("prunes persisted state so a re-added name does not inherit stale status", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();
      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      // Persist a `disabled` status (+ implicitly a state entry) for the schedule.
      const disabled = await manager.disableSchedule("sched-agent", "tick");
      expect(disabled.status).toBe("disabled");

      // Remove it (prunes persisted state) then re-add the same name.
      await manager.removeAgentSchedule("sched-agent", "tick");
      await manager.setAgentSchedule("sched-agent", "tick", {
        type: "interval",
        interval: "1h",
      });

      // Without the prune, this would still read `disabled` from stale state.
      const reAdded = await manager.getSchedule("sched-agent", "tick");
      expect(reAdded.status).toBe("idle");
      expect(reAdded.lastRunAt).toBeNull();
    });

    it("remove+re-add while a handler run is in flight: no double-execution, no resurrected state", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();

      let inFlight = 0;
      let maxInFlight = 0;
      let calls = 0;
      let releaseFirstRun: () => void = () => {};
      const firstRunGate = new Promise<void>((resolve) => {
        releaseFirstRun = resolve;
      });

      manager.setScheduleTriggerHandler(async () => {
        calls += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Hold only the first run open; it stays "in flight" across the mutation.
        if (calls === 1) await firstRunGate;
        inFlight -= 1;
      });

      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        max_turns: 1,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });
      await manager.start();

      // Wait until the first run is actually in flight (handler entered + gated).
      await waitFor(() => calls === 1);

      // While that run is still executing, remove and immediately re-add the
      // same name. Removal must not resurrect deleted state, and the retained
      // running-set entry must prevent a second concurrent fire of the re-add.
      await manager.removeAgentSchedule("sched-agent", "tick");
      await manager.setAgentSchedule("sched-agent", "tick", {
        type: "interval",
        interval: "1h",
      });

      // Let the in-flight run finish, then settle.
      releaseFirstRun();
      await new Promise((resolve) => setTimeout(resolve, 120));
      await manager.stop();

      // No point had two concurrent executions of the schedule.
      expect(maxInFlight).toBe(1);

      // The re-added schedule's persisted state is clean, not a resurrected
      // disabled/errored entry.
      const reAdded = await manager.getSchedule("sched-agent", "tick");
      expect(reAdded.status).not.toBe("disabled");
      expect(reAdded.lastError).toBeNull();
    });
  });

  // ===========================================================================
  // D2 — mutation gate
  // ===========================================================================

  describe("allowScheduleMutation gate", () => {
    it("blocks setAgentSchedule when mutation is disabled (the default)", async () => {
      const manager = createManager(); // allowScheduleMutation defaults to false
      await manager.initialize();
      await manager.addAgent({ name: "sched-agent", working_directory: tempDir });

      await expect(
        manager.setAgentSchedule("sched-agent", "tick", { type: "interval", interval: "1h" }),
      ).rejects.toBeInstanceOf(ScheduleMutationDisabledError);

      // The schedule was not added.
      expect((await manager.getSchedules()).map((s) => s.name)).not.toContain("tick");
    });

    it("blocks removeAgentSchedule when mutation is disabled", async () => {
      const manager = createManager();
      await manager.initialize();
      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      await expect(manager.removeAgentSchedule("sched-agent", "tick")).rejects.toBeInstanceOf(
        ScheduleMutationDisabledError,
      );

      // The schedule survives the blocked removal.
      expect((await manager.getSchedules()).map((s) => s.name)).toContain("tick");
    });

    it("leaves enable/disable ungated even when mutation is disabled", async () => {
      const manager = createManager();
      await manager.initialize();
      await manager.addAgent({
        name: "sched-agent",
        working_directory: tempDir,
        schedules: { tick: { type: "interval", interval: "1h" } },
      });

      await expect(manager.disableSchedule("sched-agent", "tick")).resolves.toMatchObject({
        status: "disabled",
      });
      await expect(manager.enableSchedule("sched-agent", "tick")).resolves.toMatchObject({
        status: "idle",
      });
    });

    it("allows mutation when the deployment opts in", async () => {
      const manager = createManager({ allowScheduleMutation: true });
      await manager.initialize();
      await manager.addAgent({ name: "sched-agent", working_directory: tempDir });

      await expect(
        manager.setAgentSchedule("sched-agent", "tick", { type: "interval", interval: "1h" }),
      ).resolves.toMatchObject({ name: "tick" });
    });
  });
});
