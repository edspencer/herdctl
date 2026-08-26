/**
 * vulpes-pack#148 — wiring session wakes into the job path.
 *
 * Before this, `RuntimeExecuteOptions.onLifecycleSignal` was documented
 * "ignored" by `execute()` and neither `JobControl.trigger()` nor
 * `ScheduleExecutor.executeSchedule()` fed it anywhere: a job that called
 * `ScheduleWakeup` completed and its wake evaporated. These exercise the
 * capture wiring end-to-end through a real `FleetManager` (so a real
 * `SessionLifecycleManager`/`WakeRegistry`/`FleetStateWakePersistence` is in
 * play) with a stubbed `RuntimeFactory.create()` that yields scripted
 * `SessionLifecycleSignal`s instead of talking to a real `claude` process.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeFactory } from "../../runner/index.js";
import type {
  RuntimeExecuteOptions,
  RuntimeInterface,
  RuntimeSession,
} from "../../runner/runtime/interface.js";
import { SDKRuntime } from "../../runner/runtime/sdk-runtime.js";
import type { SDKMessage } from "../../runner/types.js";
import type { TriggerInfo } from "../../scheduler/index.js";
import { FleetStateWakePersistence } from "../../session/fleet-state-wake-persistence.js";
import type { SessionWakeEntry } from "../../session/types.js";
import { getJob } from "../../state/index.js";
import { FleetManager } from "../fleet-manager.js";
import { ScheduleExecutor } from "../schedule-executor.js";

/** A stub runtime whose `execute()` is fully scripted by the test. */
function stubRuntime(
  handler: (options: RuntimeExecuteOptions) => AsyncGenerator<SDKMessage>,
): RuntimeInterface {
  return { execute: handler } as unknown as RuntimeInterface;
}

/** A minimal RuntimeSession, for `SDKRuntime.prototype.openSession` (the wake-fire path). */
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
    agent: "keeper",
    sessionId: "sess-1",
    schedule: "*/5 * * * *",
    recurring: false,
    prompt: "WAKE-CONTINUE",
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Fires `onLifecycleSignal` the way production actually does — fire-and-forget
 * on a deferred microtask (`SDKRuntime.execute()` never awaits the consumer,
 * and `session-hooks.ts`'s `emit()` defers via `Promise.resolve().then()`) —
 * rather than the earlier stub shape of `await options.onLifecycleSignal?.()`,
 * which pinned an ordering guarantee the real runtime doesn't provide. Tests
 * that need the signal to have landed call `flushMicrotasks()` afterward.
 */
function emitLifecycleSignal(
  options: RuntimeExecuteOptions,
  signal: Parameters<NonNullable<RuntimeExecuteOptions["onLifecycleSignal"]>>[0],
): void {
  void Promise.resolve().then(() => options.onLifecycleSignal?.(signal));
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("job-path session wake capture (vulpes-pack#148)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "herdctl-job-wake-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createConfig(config: object) {
    const configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify(config));
    return configPath;
  }

  async function createAgentConfig(name: string, config: object) {
    const agentDir = join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    const agentPath = join(agentDir, `${name}.yaml`);
    const yaml = await import("yaml");
    await writeFile(agentPath, yaml.stringify(config));
    return agentPath;
  }

  function createTestManager(configPath: string): FleetManager {
    return new FleetManager({
      configPath,
      stateDir,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  }

  it("persists a wake from a job's turn_end, and the job still completes normally (does not stay running)", async () => {
    await createAgentConfig("keeper", { name: "keeper" });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/keeper.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();

    vi.spyOn(RuntimeFactory, "create").mockReturnValue(
      stubRuntime(async function* (options) {
        yield { type: "system", subtype: "init", session_id: "sess-job-1" };
        emitLifecycleSignal(options, {
          kind: "turn_end",
          sessionId: "sess-job-1",
          sessionCrons: [{ id: "c1", schedule: "* * * * *", recurring: false, prompt: "WAKE" }],
          backgroundTasks: [],
        });
        yield { type: "assistant", content: "done" };
      }),
    );

    const result = await manager.trigger("keeper");
    expect(result.success).toBe(true);

    // Pins "the job does not stay running" — it reached `completed`, not some
    // wait-for-the-wake state.
    const jobsDir = join(stateDir, "jobs");
    const job = await getJob(jobsDir, result.jobId);
    expect(job?.status).toBe("completed");

    // The signal was deferred (fire-and-forget, as production delivers it) —
    // give its microtask a turn to land before reading the persisted wake.
    await flushMicrotasks();
    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: "c1", agent: "keeper", sessionId: "sess-job-1" });
  });

  it("marks a resumed job's session live: a due wake for it is skipped until the job finishes", async () => {
    await createAgentConfig("resumer", { name: "resumer" });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/resumer.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();

    await new FleetStateWakePersistence({ stateDir }).save([
      dueWake({ id: "w-live", agent: "resumer", sessionId: "sess-resume-1" }),
    ]);

    let releaseJob: () => void = () => {};
    const jobGate = new Promise<void>((resolve) => {
      releaseJob = resolve;
    });

    vi.spyOn(RuntimeFactory, "create").mockReturnValue(
      stubRuntime(async function* (options) {
        yield { type: "system", subtype: "init", session_id: "sess-resume-1" };
        await jobGate; // hold the job "mid-flight" until the test releases it
        yield { type: "assistant", content: "done" };
      }),
    );
    // The wake-fire path (`openChatSession`) instantiates `SDKRuntime` directly
    // (not via `RuntimeFactory.create`) — stub it too so the post-release
    // dispatch below doesn't spawn a real `claude` subprocess.
    vi.spyOn(SDKRuntime.prototype, "openSession").mockReturnValue(fakeSession());

    const triggerPromise = manager.trigger("resumer", undefined, { resume: "sess-resume-1" });
    // Let the job start (trackJob registers the live mark synchronously inside
    // trigger(), before executor.execute() is even awaited — but give the
    // stubbed runtime a tick to actually be invoked).
    await new Promise((r) => setTimeout(r, 20));

    const midFlight = await manager.getSessionLifecycle()!.dispatchDue(new Date());
    expect(midFlight).toEqual([]); // guarded: session is job-live

    releaseJob();
    const result = await triggerPromise;
    expect(result.success).toBe(true);

    const afterJob = await manager.getSessionLifecycle()!.dispatchDue(new Date());
    expect(afterJob.map((e) => e.id)).toEqual(["w-live"]);
  });

  it("no SessionLifecycleManager present → trigger behaves exactly as today, no throw", async () => {
    await createAgentConfig("bare", { name: "bare" });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/bare.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();
    // Simulate a fleet with no lifecycle manager wired (e.g. a lightweight
    // embedding context) — trackJob is then simply never called.
    vi.spyOn(manager, "getSessionLifecycle").mockReturnValue(null);

    vi.spyOn(RuntimeFactory, "create").mockReturnValue(
      stubRuntime(async function* (options) {
        yield { type: "system", subtype: "init", session_id: "sess-bare-1" };
        // A signal still arrives (SDKRuntime always calls it); with no
        // lifecycle manager there is simply no tracker to feed.
        emitLifecycleSignal(options, {
          kind: "turn_end",
          sessionId: "sess-bare-1",
          sessionCrons: [{ id: "c-bare", schedule: "* * * * *", recurring: false, prompt: "WAKE" }],
          backgroundTasks: [],
        });
        yield { type: "assistant", content: "done" };
      }),
    );

    const result = await manager.trigger("bare");
    expect(result.success).toBe(true);
    await flushMicrotasks();
    expect(await new FleetStateWakePersistence({ stateDir }).load()).toEqual([]);
  });

  it("the scheduled path (ScheduleExecutor) captures a wake the same way as a manual trigger", async () => {
    await createAgentConfig("scheduled-keeper", { name: "scheduled-keeper" });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/scheduled-keeper.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();

    vi.spyOn(RuntimeFactory, "create").mockReturnValue(
      stubRuntime(async function* (options) {
        yield { type: "system", subtype: "init", session_id: "sess-sched-1" };
        emitLifecycleSignal(options, {
          kind: "turn_end",
          sessionId: "sess-sched-1",
          sessionCrons: [
            { id: "c-sched", schedule: "* * * * *", recurring: false, prompt: "WAKE-SCHED" },
          ],
          backgroundTasks: [],
        });
        yield { type: "assistant", content: "done" };
      }),
    );

    const agent = manager.getConfig()!.agents.find((a) => a.qualifiedName === "scheduled-keeper")!;
    const executor = new ScheduleExecutor(manager);
    const info: TriggerInfo = {
      agent,
      scheduleName: "daily",
      schedule: {
        type: "interval",
        interval: "1h",
        prompt: "go",
        enabled: true,
        resume_session: false,
      },
      scheduleState: { status: "idle", last_run_at: null, next_run_at: null, last_error: null },
    };
    await executor.executeSchedule(info);

    await flushMicrotasks();
    const persisted = await new FleetStateWakePersistence({ stateDir }).load();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: "c-sched",
      agent: "scheduled-keeper",
      sessionId: "sess-sched-1",
    });
  });

  it("restart survival: a wake persisted by a job is picked up by a freshly constructed manager over the same stateDir", async () => {
    await createAgentConfig("keeper2", { name: "keeper2" });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/keeper2.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();

    vi.spyOn(RuntimeFactory, "create").mockReturnValue(
      stubRuntime(async function* (options) {
        yield { type: "system", subtype: "init", session_id: "sess-restart-1" };
        emitLifecycleSignal(options, {
          kind: "turn_end",
          sessionId: "sess-restart-1",
          sessionCrons: [
            { id: "c-restart", schedule: "* * * * *", recurring: false, prompt: "WAKE-AGAIN" },
          ],
          backgroundTasks: [],
        });
        yield { type: "assistant", content: "done" };
      }),
    );
    await manager.trigger("keeper2");
    await flushMicrotasks();

    // Force the persisted wake overdue, then simulate a daemon restart: a
    // brand-new FleetManager instance over the identical stateDir.
    const persistence = new FleetStateWakePersistence({ stateDir });
    const wakes = await persistence.load();
    await persistence.save(
      wakes.map((w) => ({ ...w, nextRunAt: new Date(Date.now() - 1000).toISOString() })),
    );

    const restarted = createTestManager(configPath);
    await restarted.initialize();
    vi.spyOn(RuntimeFactory, "create").mockReturnValue(stubRuntime(async function* () {}));
    vi.spyOn(SDKRuntime.prototype, "openSession").mockReturnValue(fakeSession());

    const dispatched = await restarted.getSessionLifecycle()!.dispatchDue(new Date());
    expect(dispatched.map((e) => e.id)).toEqual(["c-restart"]);
  });
});
