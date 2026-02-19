import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdir, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSchedule,
  buildSchedulePrompt,
  type RunScheduleOptions,
  type ScheduleRunnerLogger,
} from "../schedule-runner.js";
import type { ResolvedAgent, Schedule } from "../../config/index.js";
import type { ScheduleState } from "../../state/schemas/fleet-state.js";
import type { SDKMessage } from "../../runner/index.js";
import { RuntimeFactory } from "../../runner/index.js";
import type {
  WorkSourceManager,
  WorkItem,
  GetNextWorkItemResult,
  WorkResult,
} from "../../work-sources/index.js";
import { readFleetState } from "../../state/fleet-state.js";
import { getSessionInfo } from "../../state/index.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-schedule-runner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): ScheduleRunnerLogger & {
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
  overrides?: Partial<ResolvedAgent>
): ResolvedAgent {
  return {
    name,
    qualifiedName: name,
    fleetPath: [],
    configPath: `/fake/path/${name}.yaml`,
    ...overrides,
  } as ResolvedAgent;
}

// Helper to create a test schedule
function createTestSchedule(overrides?: Partial<Schedule>): Schedule {
  return {
    type: "interval",
    interval: "1h",
    prompt: "Default test prompt",
    ...overrides,
  } as Schedule;
}

// Helper to create a test schedule state
function createTestScheduleState(overrides?: Partial<ScheduleState>): ScheduleState {
  return {
    status: "idle",
    last_run_at: null,
    next_run_at: null,
    last_error: null,
    ...overrides,
  };
}

// Helper to create a test work item
function createTestWorkItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    id: "github:123",
    source: "github",
    externalId: "123",
    title: "Fix authentication bug",
    description: "Users are getting logged out unexpectedly",
    priority: "high",
    labels: ["bug", "auth"],
    metadata: {},
    url: "https://github.com/org/repo/issues/123",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  };
}

// Helper to create a mock runtime
function createMockRuntime(
  handler: (options: any) => AsyncIterableIterator<SDKMessage>
): any {
  return {
    execute: handler,
  };
}

// Helper to setup RuntimeFactory mock with messages
function setupRuntimeFactoryMock(
  messages: SDKMessage[] = []
): void {
  const mockRuntime = createMockRuntime(async function* (options) {
    // Emit init message with session_id
    yield {
      type: "system" as const,
      subtype: "init",
      session_id: "test-session-123",
    };

    // Emit any provided messages
    for (const message of messages) {
      yield message;
    }

    // Emit result message
    yield {
      type: "assistant" as const,
      content: "Task completed successfully",
    };
  });

  vi.spyOn(RuntimeFactory, 'create').mockReturnValue(mockRuntime);
}

// Helper to setup RuntimeFactory mock with custom handler
function setupRuntimeFactoryMockWithHandler(
  handler: (options: any) => AsyncIterableIterator<SDKMessage>
): void {
  const mockRuntime = createMockRuntime(handler);
  vi.spyOn(RuntimeFactory, 'create').mockReturnValue(mockRuntime);
}

// Helper to create a mock work source manager
function createMockWorkSourceManager(
  nextWorkResult?: GetNextWorkItemResult
): WorkSourceManager & {
  getNextWorkItemCalls: Array<{ agent: ResolvedAgent }>;
  reportOutcomeCalls: Array<{ taskId: string; result: WorkResult }>;
  releaseWorkItemCalls: Array<{ taskId: string; reason?: string }>;
} {
  const getNextWorkItemCalls: Array<{ agent: ResolvedAgent }> = [];
  const reportOutcomeCalls: Array<{ taskId: string; result: WorkResult }> = [];
  const releaseWorkItemCalls: Array<{ taskId: string; reason?: string }> = [];

  return {
    getNextWorkItemCalls,
    reportOutcomeCalls,
    releaseWorkItemCalls,
    getNextWorkItem: vi.fn(async (agent) => {
      getNextWorkItemCalls.push({ agent });
      return nextWorkResult ?? { item: null, claimed: false };
    }),
    reportOutcome: vi.fn(async (taskId, result) => {
      reportOutcomeCalls.push({ taskId, result });
    }),
    releaseWorkItem: vi.fn(async (taskId, options) => {
      releaseWorkItemCalls.push({ taskId, reason: options?.reason });
      return { success: true };
    }),
    getAdapter: vi.fn(async () => null),
    clearCache: vi.fn(),
  };
}

describe("buildSchedulePrompt", () => {
  describe("without work item", () => {
    it("returns schedule prompt when configured", () => {
      const schedule = createTestSchedule({ prompt: "Check for updates" });
      const result = buildSchedulePrompt(schedule);
      expect(result).toBe("Check for updates");
    });

    it("returns default prompt when no schedule prompt", () => {
      const schedule = createTestSchedule({ prompt: undefined });
      const result = buildSchedulePrompt(schedule);
      expect(result).toBe("Execute scheduled task.");
    });
  });

  describe("with work item", () => {
    it("combines schedule prompt and work item", () => {
      const schedule = createTestSchedule({ prompt: "Process this issue:" });
      const workItem = createTestWorkItem();

      const result = buildSchedulePrompt(schedule, workItem);

      expect(result).toContain("Process this issue:");
      expect(result).toContain("## Work Item: Fix authentication bug");
      expect(result).toContain("Users are getting logged out unexpectedly");
      expect(result).toContain("**Source:** github");
      expect(result).toContain("**Priority:** high");
      expect(result).toContain("**Labels:** bug, auth");
    });

    it("works with work item alone (no schedule prompt)", () => {
      const schedule = createTestSchedule({ prompt: undefined });
      const workItem = createTestWorkItem({
        title: "Add new feature",
        description: "Implement the widget",
      });

      const result = buildSchedulePrompt(schedule, workItem);

      expect(result).toContain("## Work Item: Add new feature");
      expect(result).toContain("Implement the widget");
      expect(result).not.toContain("undefined");
    });

    it("includes work item URL", () => {
      const schedule = createTestSchedule();
      const workItem = createTestWorkItem({
        url: "https://github.com/org/repo/issues/456",
      });

      const result = buildSchedulePrompt(schedule, workItem);

      expect(result).toContain("**URL:** https://github.com/org/repo/issues/456");
    });

    it("handles work item without labels", () => {
      const schedule = createTestSchedule();
      const workItem = createTestWorkItem({ labels: [] });

      const result = buildSchedulePrompt(schedule, workItem);

      expect(result).not.toContain("**Labels:**");
    });
  });
});

describe("runSchedule", () => {
  let tempDir: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Create jobs and sessions directories for job executor
    await mkdir(join(tempDir, "jobs"), { recursive: true });
    await mkdir(join(tempDir, "sessions"), { recursive: true });
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("basic execution", () => {
    it("executes a schedule successfully", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({ prompt: "Do the thing" });

      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.jobId).toBeDefined();
      expect(result.sessionId).toBe("test-session-123");
      expect(result.processedWorkItem).toBe(false);
      expect(result.workItem).toBeUndefined();
    });

    it("updates schedule state to running during execution", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule();

      // Track state during execution
      let stateWhileRunning: ScheduleState | undefined;

      // Setup RuntimeFactory mock with custom handler
      setupRuntimeFactoryMockWithHandler(async function* (options) {
        // Read state during execution
        const fleetState = await readFleetState(join(tempDir, "state.yaml"));
        stateWhileRunning = fleetState.agents["test-agent"]?.schedules?.hourly;

        yield { type: "system" as const, subtype: "init", session_id: "test" };
        yield { type: "assistant" as const, content: "Done" };
      });

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(stateWhileRunning?.status).toBe("running");
    });

    it("updates schedule state with last_run_at after completion", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({ interval: "1h" });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const beforeRun = new Date();

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      const fleetState = await readFleetState(join(tempDir, "state.yaml"));
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState?.status).toBe("idle");
      expect(scheduleState?.last_run_at).toBeDefined();
      expect(new Date(scheduleState!.last_run_at!).getTime()).toBeGreaterThanOrEqual(
        beforeRun.getTime()
      );
    });

    it("calculates next_run_at based on interval", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({ interval: "1h" });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      const fleetState = await readFleetState(join(tempDir, "state.yaml"));
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState?.next_run_at).toBeDefined();

      // Next run should be approximately 1 hour from now
      const nextRun = new Date(scheduleState!.next_run_at!);
      const now = new Date();
      const diffMs = nextRun.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThan(0.9);
      expect(diffHours).toBeLessThan(1.1);
    });

    it("passes correct trigger type and schedule name to executor", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule();

      // We can't easily inspect what was passed to the executor,
      // but we can verify the job was created correctly by checking logs
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "my-schedule",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(mockLogger.infos.some((m) => m.includes("my-schedule"))).toBe(true);
    });
  });

  describe("with work source", () => {
    it("fetches work item when schedule has work_source", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        prompt: "Process issue:",
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.processedWorkItem).toBe(true);
      expect(result.workItem).toBe(workItem);
      expect(workSourceManager.getNextWorkItemCalls).toHaveLength(1);
    });

    it("reports outcome to work source after successful execution", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      expect(workSourceManager.reportOutcomeCalls).toHaveLength(1);
      expect(workSourceManager.reportOutcomeCalls[0].taskId).toBe(workItem.id);
      expect(workSourceManager.reportOutcomeCalls[0].result.outcome).toBe("success");
    });

    it("reports failure outcome when job fails", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });

      // Setup RuntimeFactory mock with error handler
      setupRuntimeFactoryMockWithHandler(async function* (options) {
        yield { type: "system" as const, subtype: "init", session_id: "test" };
        yield { type: "error" as const, message: "API error", code: "API_ERROR" };
      });

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      expect(workSourceManager.reportOutcomeCalls).toHaveLength(1);
      expect(workSourceManager.reportOutcomeCalls[0].result.outcome).toBe("failure");
    });

    it("continues when no work is available", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workSourceManager = createMockWorkSourceManager({
        item: null,
        claimed: false,
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      // Still runs with schedule prompt, just no work item
      expect(result.success).toBe(true);
      expect(result.processedWorkItem).toBe(false);
      expect(result.workItem).toBeUndefined();
      expect(workSourceManager.reportOutcomeCalls).toHaveLength(0);
    });

    it("handles claim failure gracefully", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: false,
        claimResult: { success: false, reason: "already_claimed" },
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      // Should still run, just without work item
      expect(result.success).toBe(true);
      expect(result.processedWorkItem).toBe(false);
      expect(mockLogger.warnings.some((m) => m.includes("claim failed"))).toBe(true);
    });

    it("skips work source when no manager provided", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        prompt: "Test",
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        // No workSourceManager provided
        logger: mockLogger,
      });

      expect(result.success).toBe(true);
      expect(result.processedWorkItem).toBe(false);
    });
  });

  describe("error handling", () => {
    it("reports failure outcome when SDK throws", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });

      // Setup RuntimeFactory mock that throws - JobExecutor catches this and returns failed result
      setupRuntimeFactoryMockWithHandler(async function* (options) {
        throw new Error("Unexpected SDK failure");
      });

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      // JobExecutor catches SDK errors and returns failed result
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Work outcome should still be reported as failure
      expect(workSourceManager.reportOutcomeCalls).toHaveLength(1);
      expect(workSourceManager.reportOutcomeCalls[0].result.outcome).toBe("failure");
    });

    it("records error in schedule state on SDK failure", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule();

      // Setup RuntimeFactory mock that throws - JobExecutor catches this
      setupRuntimeFactoryMockWithHandler(async function* (options) {
        throw new Error("Execution failed");
      });

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(result.success).toBe(false);

      const fleetState = await readFleetState(join(tempDir, "state.yaml"));
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      expect(scheduleState?.status).toBe("idle");
      // Error message contains the original error but may be wrapped
      expect(scheduleState?.last_error).toContain("Execution failed");
    });

    it("still calculates next_run_at on SDK failure", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({ interval: "30m" });

      // Setup RuntimeFactory mock that throws
      setupRuntimeFactoryMockWithHandler(async function* (options) {
        throw new Error("Execution failed");
      });

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(result.success).toBe(false);

      const fleetState = await readFleetState(join(tempDir, "state.yaml"));
      const scheduleState = fleetState.agents["test-agent"]?.schedules?.hourly;

      // Should still have calculated next_run_at
      expect(scheduleState?.next_run_at).toBeDefined();
    });

    it("continues if reporting outcome fails", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });

      // Make reportOutcome throw
      (workSourceManager.reportOutcome as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Report failed")
      );

      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      const result = await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      // Should still succeed overall
      expect(result.success).toBe(true);
      expect(mockLogger.errors.some((m) => m.includes("Report failed"))).toBe(true);
    });
  });

  describe("logging", () => {
    it("logs schedule start", async () => {
      const agent = createTestAgent("my-agent");
      const schedule = createTestSchedule();
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "my-schedule",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(
        mockLogger.infos.some(
          (m) => m.includes("Running") && m.includes("my-agent/my-schedule")
        )
      ).toBe(true);
    });

    it("logs schedule completion", async () => {
      const agent = createTestAgent("my-agent");
      const schedule = createTestSchedule();
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "my-schedule",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        logger: mockLogger,
      });

      expect(
        mockLogger.infos.some(
          (m) => m.includes("Completed") && m.includes("my-agent/my-schedule")
        )
      ).toBe(true);
    });

    it("logs work item claim", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem({ title: "Important task" });
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      expect(
        mockLogger.infos.some(
          (m) => m.includes("Claimed") && m.includes("Important task")
        )
      ).toBe(true);
    });

    it("logs outcome reporting", async () => {
      const agent = createTestAgent("test-agent");
      const schedule = createTestSchedule({
        work_source: { type: "github", repo: "org/repo" } as const,
      });
      const workItem = createTestWorkItem();
      const workSourceManager = createMockWorkSourceManager({
        item: workItem,
        claimed: true,
        claimResult: { success: true, workItem },
      });
      // Setup RuntimeFactory mock
      setupRuntimeFactoryMock();

      await runSchedule({
        agent,
        scheduleName: "hourly",
        schedule,
        scheduleState: createTestScheduleState(),
        stateDir: tempDir,
        workSourceManager,
        logger: mockLogger,
      });

      expect(
        mockLogger.infos.some(
          (m) => m.includes("Reported outcome") && m.includes(workItem.id)
        )
      ).toBe(true);
    });
  });
});
