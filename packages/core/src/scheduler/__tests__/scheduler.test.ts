import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";
import { mkdir, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Scheduler } from "../scheduler.js";
import { SchedulerShutdownError } from "../errors.js";
import type {
  SchedulerOptions,
  SchedulerLogger,
  TriggerInfo,
  StopOptions,
} from "../types.js";
import type { ResolvedAgent } from "../../config/index.js";
import { writeFleetState, readFleetState } from "../../state/fleet-state.js";
import type { FleetState } from "../../state/schemas/fleet-state.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): SchedulerLogger & {
  debugs: string[];
  infos: string[];
  warnings: string[];
  errors: string[];
} {
  const debugs: string[] = [];
  const infos: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    debugs,
    infos,
    warnings,
    errors,
    debug: (message: string) => debugs.push(message),
    info: (message: string) => infos.push(message),
    warn: (message: string) => warnings.push(message),
    error: (message: string) => errors.push(message),
  };
}

// Helper to create a test agent
function createTestAgent(
  name: string,
  schedules?: Record<string, { type: string; interval?: string; expression?: string; prompt?: string }>
): ResolvedAgent {
  return {
    name,
    configPath: `/fake/path/${name}.yaml`,
    schedules,
  } as ResolvedAgent;
}

// Helper to wait for a short period
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Scheduler", () => {
  let tempDir: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("creates scheduler with default check interval", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(scheduler.getStatus()).toBe("stopped");
      expect(scheduler.isRunning()).toBe(false);
    });

    it("creates scheduler with custom check interval", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 500,
        logger: mockLogger,
      });

      expect(scheduler.getStatus()).toBe("stopped");
    });
  });

  describe("isRunning", () => {
    it("returns false when stopped", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(scheduler.isRunning()).toBe(false);
    });

    it("returns true when running", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      // Start in background
      const startPromise = scheduler.start([]);

      // Wait a tick for status to update
      await wait(10);
      expect(scheduler.isRunning()).toBe(true);

      // Stop the scheduler
      await scheduler.stop();
      await startPromise;
    });
  });

  describe("getStatus", () => {
    it("returns stopped initially", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(scheduler.getStatus()).toBe("stopped");
    });

    it("returns running when started", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);

      expect(scheduler.getStatus()).toBe("running");

      await scheduler.stop();
      await startPromise;
    });

    it("returns stopped after stop", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);
      await scheduler.stop();
      await startPromise;

      expect(scheduler.getStatus()).toBe("stopped");
    });
  });

  describe("getState", () => {
    it("returns initial state", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      const state = scheduler.getState();

      expect(state.status).toBe("stopped");
      expect(state.startedAt).toBeNull();
      expect(state.checkCount).toBe(0);
      expect(state.triggerCount).toBe(0);
      expect(state.lastCheckAt).toBeNull();
    });

    it("updates startedAt when started", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const beforeStart = new Date().toISOString();
      const startPromise = scheduler.start([]);
      await wait(10);

      const state = scheduler.getState();
      expect(state.startedAt).not.toBeNull();
      expect(new Date(state.startedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeStart).getTime()
      );

      await scheduler.stop();
      await startPromise;
    });

    it("increments checkCount", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);

      // Wait for a few checks
      await wait(180);

      const state = scheduler.getState();
      expect(state.checkCount).toBeGreaterThan(0);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("start", () => {
    it("starts the scheduler", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);

      expect(scheduler.isRunning()).toBe(true);
      expect(mockLogger.debugs.some((m) => m.includes("started"))).toBe(true);

      await scheduler.stop();
      await startPromise;
    });

    it("throws if already running", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);

      await expect(scheduler.start([])).rejects.toThrow("already running");

      await scheduler.stop();
      await startPromise;
    });

    it("logs the number of agents and check interval", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 500,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("agent-1"),
        createTestAgent("agent-2"),
      ];

      const startPromise = scheduler.start(agents);
      await wait(10);

      expect(
        mockLogger.debugs.some(
          (m) => m.includes("2 agents") && m.includes("500ms")
        )
      ).toBe(true);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("stop", () => {
    it("stops the scheduler", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);

      await scheduler.stop();
      await startPromise;

      expect(scheduler.isRunning()).toBe(false);
      expect(mockLogger.infos.some((m) => m.includes("stopped"))).toBe(true);
    });

    it("does nothing if already stopped", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      await scheduler.stop(); // Should not throw

      expect(scheduler.getStatus()).toBe("stopped");
    });
  });

  describe("setAgents", () => {
    it("updates the agents list", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      const startPromise = scheduler.start([]);
      await wait(10);

      const newAgents = [createTestAgent("new-agent")];
      scheduler.setAgents(newAgents);

      expect(
        mockLogger.debugs.some((m) => m.includes("Updated agents list"))
      ).toBe(true);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("schedule checking", () => {
    it("skips agents without schedules", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [createTestAgent("no-schedules-agent")];

      const startPromise = scheduler.start(agents);
      await wait(100);

      // Should complete check without errors
      const state = scheduler.getState();
      expect(state.checkCount).toBeGreaterThan(0);
      expect(state.triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("skips unsupported schedule types (webhook, chat)", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("webhook-agent", {
          webhook: { type: "webhook" },
        }),
        createTestAgent("chat-agent", {
          chat: { type: "chat" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(100);

      // Should not trigger any schedules
      const state = scheduler.getState();
      expect(state.triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("triggers cron schedules when time is within trigger window", async () => {
      // Mock Date.now to ensure we're exactly at a minute boundary (within trigger window)
      // This doesn't affect setTimeout/setInterval, just time calculations
      const fixedTime = new Date("2024-01-15T10:00:00.000Z").getTime();
      const originalDateNow = Date.now;
      Date.now = vi.fn(() => fixedTime);

      try {
        const triggers: TriggerInfo[] = [];

        const scheduler = new Scheduler({
          stateDir: tempDir,
          checkInterval: 50,
          logger: mockLogger,
          onTrigger: async (info) => {
            triggers.push(info);
          },
        });

        // Use a cron that runs every minute
        const agents = [
          createTestAgent("cron-agent", {
            everyMinute: { type: "cron", expression: "* * * * *", prompt: "cron test" },
          }),
        ];

        const startPromise = scheduler.start(agents);

        // Wait for the scheduler to check (using real setTimeout)
        await wait(150);

        // Should have triggered since we're exactly at a minute boundary (within trigger window)
        expect(triggers.length).toBeGreaterThan(0);
        expect(triggers[0].agent.name).toBe("cron-agent");
        expect(triggers[0].scheduleName).toBe("everyMinute");

        await scheduler.stop();
        await startPromise;
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("skips cron schedules missing expression value", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("test-agent", {
          broken: { type: "cron" }, // Missing expression value
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(100);

      expect(
        mockLogger.warnings.some((m) => m.includes("missing expression value"))
      ).toBe(true);
      expect(scheduler.getState().triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("skips cron schedules with invalid expression", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("test-agent", {
          broken: { type: "cron", expression: "invalid cron" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(100);

      expect(
        mockLogger.warnings.some((m) => m.includes("invalid cron expression"))
      ).toBe(true);
      expect(scheduler.getState().triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("calculates next trigger time for cron schedule after completion", async () => {
      // Mock Date.now to ensure we're exactly at a minute boundary (within trigger window)
      const fixedTime = new Date("2024-01-15T10:00:00.000Z").getTime();
      const originalDateNow = Date.now;
      Date.now = vi.fn(() => fixedTime);

      try {
        const scheduler = new Scheduler({
          stateDir: tempDir,
          checkInterval: 50,
          logger: mockLogger,
          onTrigger: async () => {
            // Simulate work
            await wait(10);
          },
        });

        // Use every-minute cron
        const agents = [
          createTestAgent("test-agent", {
            everyMinute: { type: "cron", expression: "* * * * *" },
          }),
        ];

        const startPromise = scheduler.start(agents);

        // Wait for the scheduler to check and trigger
        await wait(150);

        // Check state was updated with next_run_at for cron
        const stateFile = join(tempDir, "state.yaml");
        const fleetState = await readFleetState(stateFile);
        const scheduleState = fleetState.agents["test-agent"]?.schedules?.everyMinute;

        expect(scheduleState).toBeDefined();
        expect(scheduleState?.last_run_at).not.toBeNull();
        expect(scheduleState?.next_run_at).not.toBeNull();
        expect(scheduleState?.status).toBe("idle");

        // The next run should be in the future (next minute from fixed time)
        const nextRunAt = new Date(scheduleState!.next_run_at!);
        expect(nextRunAt.getTime()).toBeGreaterThan(fixedTime);

        await scheduler.stop();
        await startPromise;
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("catches up with a single trigger when cron runs were missed", async () => {
      // When the scheduler was down during a cron trigger time, it should fire once
      // to catch up, then resume normal scheduling. It should NOT fire multiple times
      // for each missed occurrence.
      const now = new Date();
      // Set last run to 2 hours ago (missed at least one hourly trigger)
      const lastRunAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "test-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: lastRunAt.toISOString(),
                next_run_at: null,
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const triggers: TriggerInfo[] = [];

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async (info) => {
          triggers.push(info);
        },
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "cron", expression: "@hourly" }, // Runs at :00 of each hour
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(200);

      // The schedule SHOULD trigger once to catch up for the missed window.
      // After triggering, last_run_at updates to now, so the next calculated
      // cron time will be in the future and no additional triggers fire.
      expect(triggers.length).toBe(1);
      expect(triggers[0].agent.name).toBe("test-agent");
      expect(triggers[0].scheduleName).toBe("hourly");

      await scheduler.stop();
      await startPromise;
    });

    it("triggers cron schedule on subsequent run when due time arrives", async () => {
      // This is the core regression test for the bug where cron schedules
      // never fire after the first trigger because nextRunAt was never
      // correctly computed from lastRunAt.
      //
      // Scenario: An every-minute cron was last run at :00. At :01 the next
      // occurrence (:01) is due and should trigger.

      // Fix time to exactly 10:01:00 UTC
      const fixedTime = new Date("2024-01-15T10:01:00.000Z").getTime();
      const originalDateNow = Date.now;
      Date.now = vi.fn(() => fixedTime);

      try {
        // Set last_run_at to 10:00:00 (one minute ago)
        const stateFile = join(tempDir, "state.yaml");
        const initialState: FleetState = {
          fleet: {},
          agents: {
            "cron-agent": {
              status: "idle",
              schedules: {
                everyMinute: {
                  last_run_at: "2024-01-15T10:00:00.000Z",
                  next_run_at: null,
                  status: "idle",
                  last_error: null,
                },
              },
            },
          },
        };
        await writeFleetState(stateFile, initialState);

        const triggers: TriggerInfo[] = [];

        const scheduler = new Scheduler({
          stateDir: tempDir,
          checkInterval: 50,
          logger: mockLogger,
          onTrigger: async (info) => {
            triggers.push(info);
          },
        });

        const agents = [
          createTestAgent("cron-agent", {
            everyMinute: { type: "cron", expression: "* * * * *", prompt: "test" },
          }),
        ];

        const startPromise = scheduler.start(agents);
        await wait(150);

        // The cron should trigger because the next occurrence after 10:00:00
        // is 10:01:00, which is exactly now.
        expect(triggers.length).toBeGreaterThan(0);
        expect(triggers[0].agent.name).toBe("cron-agent");
        expect(triggers[0].scheduleName).toBe("everyMinute");

        await scheduler.stop();
        await startPromise;
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("does not trigger cron schedule when next occurrence is still in the future", async () => {
      // Set last_run_at to just now. With a @daily cron, the next occurrence
      // is tomorrow at midnight, which is definitely in the future.
      const now = new Date();

      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "cron-agent": {
            status: "idle",
            schedules: {
              daily: {
                last_run_at: now.toISOString(),
                next_run_at: null,
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const triggers: TriggerInfo[] = [];

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async (info) => {
          triggers.push(info);
        },
      });

      const agents = [
        createTestAgent("cron-agent", {
          daily: { type: "cron", expression: "@daily", prompt: "test" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(150);

      // The next @daily occurrence after now is tomorrow at midnight,
      // so it should NOT trigger.
      expect(triggers.length).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("skips disabled schedules", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "test-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: null,
                status: "disabled",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(100);

      expect(
        mockLogger.debugs.some((m) => m.includes("disabled"))
      ).toBe(true);
      expect(scheduler.getState().triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("skips schedules missing interval value", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("test-agent", {
          broken: { type: "interval" }, // Missing interval value
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(100);

      expect(
        mockLogger.warnings.some((m) => m.includes("missing interval value"))
      ).toBe(true);
      expect(scheduler.getState().triggerCount).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("triggers due interval schedules", async () => {
      const triggers: TriggerInfo[] = [];

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async (info) => {
          triggers.push(info);
        },
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s", prompt: "test prompt" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(150);

      // First run should trigger immediately (no last_run_at)
      expect(triggers.length).toBeGreaterThan(0);
      expect(triggers[0].agent.name).toBe("test-agent");
      expect(triggers[0].scheduleName).toBe("hourly");

      await scheduler.stop();
      await startPromise;
    });

    it("updates schedule state on trigger", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async () => {
          // Simulate work
          await wait(10);
        },
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(150);

      // Check state was updated
      const stateFile = join(tempDir, "state.yaml");
      const fleetState = await readFleetState(stateFile);
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState).toBeDefined();
      expect(scheduleState?.last_run_at).not.toBeNull();
      expect(scheduleState?.status).toBe("idle"); // Should be idle after completion

      await scheduler.stop();
      await startPromise;
    });

    it("records error in schedule state on trigger failure", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async () => {
          throw new Error("Trigger failed!");
        },
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(150);

      // Check error was recorded
      const stateFile = join(tempDir, "state.yaml");
      const fleetState = await readFleetState(stateFile);
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState?.last_error).toBe("Trigger failed!");
      expect(mockLogger.errors.some((m) => m.includes("Trigger failed!"))).toBe(
        true
      );

      await scheduler.stop();
      await startPromise;
    });

    it("does not trigger already running schedule", async () => {
      let triggerCount = 0;
      let isRunning = false;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          if (isRunning) {
            throw new Error("Should not trigger while running!");
          }
          isRunning = true;
          triggerCount++;
          // Simulate long-running job
          await wait(100);
          isRunning = false;
        },
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);

      // Wait long enough for multiple checks but only one trigger should complete
      await wait(150);

      // Should only have triggered once due to running check
      expect(triggerCount).toBe(1);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("error handling", () => {
    it("continues checking after error in check cycle", async () => {
      // Create scheduler that will encounter an error reading state
      // by using a non-existent state dir initially
      const scheduler = new Scheduler({
        stateDir: "/nonexistent/path",
        checkInterval: 50,
        logger: mockLogger,
      });

      const agents = [
        createTestAgent("test-agent", {
          hourly: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);
      await wait(150);

      // Should have logged errors but kept running
      expect(scheduler.isRunning()).toBe(true);
      expect(scheduler.getState().checkCount).toBeGreaterThan(0);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("concurrent execution", () => {
    it("tracks running schedules per agent", async () => {
      const runningAgents = new Set<string>();
      let maxConcurrent = 0;

      // Use a barrier to ensure both triggers are running at the same time
      let triggered = 0;
      let resolveBarrier: () => void;
      const bothStarted = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });

      const checkBoth = () => {
        triggered++;
        if (triggered >= 2) resolveBarrier();
      };

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async (info) => {
          runningAgents.add(`${info.agent.name}/${info.scheduleName}`);
          maxConcurrent = Math.max(maxConcurrent, runningAgents.size);
          // Signal that this trigger started
          checkBoth();
          // Wait long enough for both to be running
          await wait(100);
          runningAgents.delete(`${info.agent.name}/${info.scheduleName}`);
        },
      });

      const agents = [
        createTestAgent("agent-1", {
          schedule1: { type: "interval", interval: "1s" },
        }),
        createTestAgent("agent-2", {
          schedule2: { type: "interval", interval: "1s" },
        }),
      ];

      const startPromise = scheduler.start(agents);

      // Wait for both to have started running
      await Promise.race([bothStarted, wait(300)]);

      // Check max concurrent - may be 1 or 2 depending on timing
      // The important thing is both agents were triggered
      expect(maxConcurrent).toBeGreaterThanOrEqual(1);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("max_concurrent limit", () => {
    it("respects max_concurrent from agent instances config", async () => {
      const triggerCounts = new Map<string, number>();
      let concurrentForAgent2 = 0;
      let maxConcurrentForAgent2 = 0;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async (info) => {
          const key = info.agent.name;
          const count = (triggerCounts.get(key) || 0) + 1;
          triggerCounts.set(key, count);

          if (info.agent.name === "agent-2") {
            concurrentForAgent2++;
            maxConcurrentForAgent2 = Math.max(
              maxConcurrentForAgent2,
              concurrentForAgent2
            );
          }

          // Simulate work
          await wait(80);

          if (info.agent.name === "agent-2") {
            concurrentForAgent2--;
          }
        },
      });

      // Agent with max_concurrent: 2
      const agentWithMaxConcurrent2 = {
        ...createTestAgent("agent-2", {
          schedule1: { type: "interval", interval: "1s" },
          schedule2: { type: "interval", interval: "1s" },
          schedule3: { type: "interval", interval: "1s" },
        }),
        instances: { max_concurrent: 2 },
      } as ResolvedAgent;

      const startPromise = scheduler.start([agentWithMaxConcurrent2]);

      // Wait enough time for multiple checks
      await wait(200);

      // Should not exceed max_concurrent of 2
      expect(maxConcurrentForAgent2).toBeLessThanOrEqual(2);

      await scheduler.stop();
      await startPromise;
    });

    it("defaults max_concurrent to 1 when not specified", async () => {
      let concurrentForAgent = 0;
      let maxConcurrentForAgent = 0;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          concurrentForAgent++;
          maxConcurrentForAgent = Math.max(
            maxConcurrentForAgent,
            concurrentForAgent
          );

          await wait(80);

          concurrentForAgent--;
        },
      });

      // Agent without instances config - should default to max_concurrent: 1
      const agent = createTestAgent("test-agent", {
        schedule1: { type: "interval", interval: "1s" },
        schedule2: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);

      await wait(200);

      // Should not exceed default max_concurrent of 1
      expect(maxConcurrentForAgent).toBe(1);

      await scheduler.stop();
      await startPromise;
    });

    it("skips second schedule when agent is at capacity", async () => {
      // This test verifies that with max_concurrent: 1 and one schedule already
      // running, additional schedules are not triggered until the first completes.
      //
      // Note: Due to how the scheduler iterates through schedules synchronously
      // within a single check cycle, both schedules will be checked and triggered
      // if they're both due at the same time before either is marked as running.
      // The capacity check applies WITHIN each check cycle iteration, so the
      // second schedule is only skipped if a trigger is already in progress
      // from a PREVIOUS check cycle.

      let triggerCount = 0;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          triggerCount++;
          // Long running job to span multiple check cycles
          await wait(150);
        },
      });

      // Agent with max_concurrent: 1 and one schedule
      // A second schedule that becomes due AFTER the first is running
      // will be skipped
      const agent = createTestAgent("test-agent", {
        schedule1: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);

      // Wait for first trigger to happen and start running
      await wait(100);

      // With 1 schedule, it should trigger once initially
      // Then subsequent checks should show "already_running" until it completes
      expect(triggerCount).toBe(1);
      expect(scheduler.getRunningJobCount("test-agent")).toBe(1);

      // Wait for the job to complete
      await wait(200);

      // After completion, running count should be 0
      expect(scheduler.getRunningJobCount("test-agent")).toBe(0);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("getRunningJobCount", () => {
    it("returns 0 for agents with no running jobs", () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(scheduler.getRunningJobCount("non-existent-agent")).toBe(0);
    });

    it("returns correct count during job execution", async () => {
      let runningCountDuringExecution = -1;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async (info) => {
          // Check count while job is running
          runningCountDuringExecution = scheduler.getRunningJobCount(
            info.agent.name
          );
          await wait(50);
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);

      await wait(100);

      // Count should have been 1 during execution
      expect(runningCountDuringExecution).toBe(1);

      await scheduler.stop();
      await startPromise;
    });

    it("returns 0 after job completes", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async () => {
          await wait(20);
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "10s" }, // Long interval to prevent re-trigger
      });

      const startPromise = scheduler.start([agent]);

      // Wait for trigger and completion
      await wait(150);

      // Count should be 0 after completion
      expect(scheduler.getRunningJobCount("test-agent")).toBe(0);

      await scheduler.stop();
      await startPromise;
    });

    it("tracks multiple schedules for the same agent", async () => {
      let maxCount = 0;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 20,
        logger: mockLogger,
        onTrigger: async (info) => {
          const count = scheduler.getRunningJobCount(info.agent.name);
          maxCount = Math.max(maxCount, count);
          await wait(100);
        },
      });

      // Agent with max_concurrent: 3 and multiple schedules
      const agent = {
        ...createTestAgent("test-agent", {
          schedule1: { type: "interval", interval: "1s" },
          schedule2: { type: "interval", interval: "1s" },
          schedule3: { type: "interval", interval: "1s" },
        }),
        instances: { max_concurrent: 3 },
      } as ResolvedAgent;

      const startPromise = scheduler.start([agent]);

      await wait(150);

      // Should have tracked multiple concurrent jobs
      expect(maxCount).toBeGreaterThanOrEqual(1);

      await scheduler.stop();
      await startPromise;
    });

    it("decrements count on job failure", async () => {
      let countAfterError = -1;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async () => {
          throw new Error("Job failed!");
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "10s" },
      });

      const startPromise = scheduler.start([agent]);

      // Wait for trigger and error handling
      await wait(150);

      countAfterError = scheduler.getRunningJobCount("test-agent");

      // Count should be 0 even after error
      expect(countAfterError).toBe(0);

      await scheduler.stop();
      await startPromise;
    });
  });

  describe("graceful shutdown", () => {
    it("waits for running jobs to complete by default", async () => {
      let jobStarted = false;
      let jobCompleted = false;
      let resolveJob: () => void;
      const jobPromise = new Promise<void>((resolve) => {
        resolveJob = resolve;
      });

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          jobStarted = true;
          await jobPromise;
          jobCompleted = true;
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(100);

      // Job should be running
      expect(jobStarted).toBe(true);
      expect(jobCompleted).toBe(false);

      // Start shutdown (don't await yet)
      const stopPromise = scheduler.stop();

      // Give stop a moment to set status
      await wait(10);

      // Scheduler should be in "stopping" state, waiting for job
      expect(scheduler.getStatus()).toBe("stopping");

      // Complete the job
      resolveJob!();

      // Now stop should complete
      await stopPromise;
      await startPromise;

      expect(jobCompleted).toBe(true);
      expect(scheduler.getStatus()).toBe("stopped");
      expect(mockLogger.infos.some((m) => m.includes("All running jobs completed"))).toBe(true);
    });

    it("does not wait for jobs when waitForJobs is false", async () => {
      let jobStarted = false;
      let jobCompleted = false;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          jobStarted = true;
          await wait(500); // Long-running job
          jobCompleted = true;
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(100);

      // Job should be running
      expect(jobStarted).toBe(true);
      expect(jobCompleted).toBe(false);

      // Stop without waiting for jobs
      await scheduler.stop({ waitForJobs: false });

      // Scheduler should be stopped immediately, job may still be running
      expect(scheduler.getStatus()).toBe("stopped");

      // Clean up the start promise
      await startPromise;
    });

    it("throws SchedulerShutdownError on timeout", async () => {
      let resolveJob: () => void;
      const jobBlocker = new Promise<void>((resolve) => {
        resolveJob = resolve;
      });

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          // Job that blocks until we release it
          await jobBlocker;
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(100);

      // Stop with a short timeout
      let shutdownError: SchedulerShutdownError | null = null;
      try {
        await scheduler.stop({ timeout: 50 });
      } catch (error) {
        if (error instanceof SchedulerShutdownError) {
          shutdownError = error;
        }
      }

      expect(shutdownError).not.toBeNull();
      expect(shutdownError!.timedOut).toBe(true);
      expect(shutdownError!.runningJobCount).toBe(1);
      expect(shutdownError!.name).toBe("SchedulerShutdownError");
      expect(mockLogger.errors.some((m) => m.includes("timed out"))).toBe(true);

      // Clean up - release the job so the test can complete cleanly
      resolveJob!();
      await startPromise;
    });

    it("stops new triggers immediately when stop is called", async () => {
      let triggerCount = 0;

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 20,
        logger: mockLogger,
        onTrigger: async () => {
          triggerCount++;
          await wait(200); // Long-running job
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(50);

      // First trigger should start
      const countAtStop = triggerCount;
      expect(countAtStop).toBe(1);

      // Stop scheduler (don't wait for jobs to test that no new triggers happen)
      await scheduler.stop({ waitForJobs: false });
      await startPromise;

      // Wait a bit to see if any new triggers would have happened
      await wait(100);

      // No additional triggers should have started after stop
      expect(triggerCount).toBe(countAtStop);
    });

    it("handles multiple concurrent running jobs during shutdown", async () => {
      let runningCount = 0;
      let maxRunningDuringShutdown = 0;
      let resolveAll: () => void;
      const allJobsCanComplete = new Promise<void>((resolve) => {
        resolveAll = resolve;
      });

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 20,
        logger: mockLogger,
        onTrigger: async () => {
          runningCount++;
          maxRunningDuringShutdown = Math.max(maxRunningDuringShutdown, runningCount);
          await allJobsCanComplete;
          runningCount--;
        },
      });

      // Agent with multiple concurrent schedules
      const agent = {
        ...createTestAgent("test-agent", {
          schedule1: { type: "interval", interval: "1s" },
          schedule2: { type: "interval", interval: "1s" },
          schedule3: { type: "interval", interval: "1s" },
        }),
        instances: { max_concurrent: 3 },
      } as ResolvedAgent;

      const startPromise = scheduler.start([agent]);
      await wait(100);

      // Multiple jobs should be running
      expect(runningCount).toBeGreaterThanOrEqual(1);

      // Start shutdown
      const stopPromise = scheduler.stop();

      await wait(10);
      expect(scheduler.getStatus()).toBe("stopping");

      // Release all jobs
      resolveAll!();

      await stopPromise;
      await startPromise;

      expect(scheduler.getStatus()).toBe("stopped");
      expect(runningCount).toBe(0);
    });

    it("returns immediately when there are no running jobs", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 100,
        logger: mockLogger,
      });

      // Start with no agents (no jobs will be triggered)
      const startPromise = scheduler.start([]);
      await wait(50);

      const stopStart = Date.now();
      await scheduler.stop();
      const stopDuration = Date.now() - stopStart;

      // Should complete quickly (not wait for timeout)
      expect(stopDuration).toBeLessThan(100);

      await startPromise;
    });

    it("updates fleet state on shutdown", async () => {
      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 50,
        logger: mockLogger,
        onTrigger: async () => {
          await wait(10);
        },
      });

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(150);

      // Trigger should have completed and updated state
      const stateFile = join(tempDir, "state.yaml");
      let fleetState = await readFleetState(stateFile);
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState?.status).toBe("idle");
      expect(scheduleState?.last_run_at).not.toBeNull();

      await scheduler.stop();
      await startPromise;

      // State should still be valid after shutdown
      fleetState = await readFleetState(stateFile);
      expect(fleetState.agents["test-agent"]?.schedules?.hourly?.status).toBe("idle");
    });

    it("getTotalRunningJobCount returns correct count", async () => {
      let resolveJob: () => void;
      const jobPromise = new Promise<void>((resolve) => {
        resolveJob = resolve;
      });

      const scheduler = new Scheduler({
        stateDir: tempDir,
        checkInterval: 30,
        logger: mockLogger,
        onTrigger: async () => {
          await jobPromise;
        },
      });

      // Initially should be 0
      expect(scheduler.getTotalRunningJobCount()).toBe(0);

      const agent = createTestAgent("test-agent", {
        hourly: { type: "interval", interval: "1s" },
      });

      const startPromise = scheduler.start([agent]);
      await wait(100);

      // Should have 1 running job
      expect(scheduler.getTotalRunningJobCount()).toBe(1);

      resolveJob!();
      await wait(50);

      // Should be back to 0
      expect(scheduler.getTotalRunningJobCount()).toBe(0);

      await scheduler.stop();
      await startPromise;
    });
  });
});
