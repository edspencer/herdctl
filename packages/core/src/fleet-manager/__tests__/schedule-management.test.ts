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
import type { TriggerInfo } from "../../scheduler/index.js";
import { AgentNotFoundError, ScheduleMutationDisabledError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

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
