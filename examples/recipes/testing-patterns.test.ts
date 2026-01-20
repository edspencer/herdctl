/**
 * Testing Patterns Example
 *
 * Demonstrates unit testing with mocked FleetManager and integration testing.
 *
 * Usage:
 *   npx vitest run examples/recipes/testing-patterns.test.ts
 *
 * Note: This file is designed to show testing patterns. To run it,
 * you'll need vitest installed and configured in your project.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  FleetStatus,
  AgentInfo,
  TriggerResult,
  FleetManagerOptions,
} from "@herdctl/core";

// =============================================================================
// Mock Setup
// =============================================================================

// Create a mock FleetManager class
function createMockFleetManager() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    getFleetStatus: vi.fn(),
    getAgentInfo: vi.fn(),
    getAgentInfoByName: vi.fn(),
    trigger: vi.fn(),
    cancelJob: vi.fn(),
    forkJob: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    state: {
      status: "initialized" as const,
      agentCount: 2,
      initializedAt: "2024-01-01T00:00:00Z",
      startedAt: null,
      stoppedAt: null,
      lastError: null,
    },
  };
}

// =============================================================================
// Example Application Code
// =============================================================================

// This is the code we want to test
class FleetService {
  private manager: ReturnType<typeof createMockFleetManager>;
  private isRunning = false;

  constructor(manager: ReturnType<typeof createMockFleetManager>) {
    this.manager = manager;
  }

  async start(): Promise<void> {
    await this.manager.initialize();
    await this.manager.start();
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    await this.manager.stop();
    this.isRunning = false;
  }

  async getStatus(): Promise<FleetStatus> {
    return this.manager.getFleetStatus();
  }

  async getAgents(): Promise<AgentInfo[]> {
    return this.manager.getAgentInfo();
  }

  async runAgent(name: string, prompt?: string): Promise<TriggerResult> {
    if (!this.isRunning) {
      throw new Error("Fleet not running");
    }
    return this.manager.trigger(name, undefined, { prompt });
  }

  async waitForJobCompletion(jobId: string, timeout = 30000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve(false);
      }, timeout);

      // In real code, this would subscribe to events
      // For testing, we simulate immediate completion
      clearTimeout(timeoutId);
      resolve(true);
    });
  }

  isFleetRunning(): boolean {
    return this.isRunning;
  }
}

// =============================================================================
// Unit Tests with Mocks
// =============================================================================

describe("FleetService", () => {
  let service: FleetService;
  let mockManager: ReturnType<typeof createMockFleetManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockFleetManager();
    service = new FleetService(mockManager);
  });

  describe("start", () => {
    it("should initialize and start the manager", async () => {
      await service.start();

      expect(mockManager.initialize).toHaveBeenCalledOnce();
      expect(mockManager.start).toHaveBeenCalledOnce();
      expect(service.isFleetRunning()).toBe(true);
    });

    it("should throw if initialization fails", async () => {
      mockManager.initialize.mockRejectedValueOnce(new Error("Config not found"));

      await expect(service.start()).rejects.toThrow("Config not found");
      expect(service.isFleetRunning()).toBe(false);
    });
  });

  describe("stop", () => {
    it("should stop the manager", async () => {
      await service.start();
      await service.stop();

      expect(mockManager.stop).toHaveBeenCalledOnce();
      expect(service.isFleetRunning()).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("should return fleet status", async () => {
      const mockStatus: FleetStatus = {
        state: "running",
        uptimeSeconds: 3600,
        initializedAt: "2024-01-01T00:00:00Z",
        startedAt: "2024-01-01T00:00:00Z",
        stoppedAt: null,
        lastError: null,
        counts: {
          totalAgents: 2,
          idleAgents: 1,
          runningAgents: 1,
          errorAgents: 0,
          totalSchedules: 4,
          runningSchedules: 1,
          runningJobs: 1,
        },
        scheduler: {
          status: "running",
          checkCount: 100,
          triggerCount: 5,
          lastCheckAt: "2024-01-01T01:00:00Z",
          checkIntervalMs: 5000,
        },
      };

      mockManager.getFleetStatus.mockResolvedValue(mockStatus);

      const status = await service.getStatus();

      expect(status.state).toBe("running");
      expect(status.counts.totalAgents).toBe(2);
      expect(status.counts.runningJobs).toBe(1);
    });
  });

  describe("getAgents", () => {
    it("should return list of agents", async () => {
      const mockAgents: AgentInfo[] = [
        {
          name: "agent-1",
          description: "First agent",
          status: "idle",
          currentJobId: null,
          lastJobId: "job-123",
          maxConcurrent: 2,
          runningCount: 0,
          errorMessage: null,
          scheduleCount: 2,
          schedules: [
            {
              name: "hourly",
              agentName: "agent-1",
              type: "interval",
              interval: "1h",
              status: "idle",
              lastRunAt: "2024-01-01T00:00:00Z",
              nextRunAt: "2024-01-01T01:00:00Z",
              lastError: null,
            },
          ],
        },
        {
          name: "agent-2",
          description: "Second agent",
          status: "running",
          currentJobId: "job-456",
          lastJobId: "job-456",
          maxConcurrent: 1,
          runningCount: 1,
          errorMessage: null,
          scheduleCount: 1,
          schedules: [],
        },
      ];

      mockManager.getAgentInfo.mockResolvedValue(mockAgents);

      const agents = await service.getAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe("agent-1");
      expect(agents[1].status).toBe("running");
    });
  });

  describe("runAgent", () => {
    it("should trigger agent with prompt", async () => {
      const mockResult: TriggerResult = {
        jobId: "job-789",
        agentName: "my-agent",
        scheduleName: null,
        startedAt: "2024-01-01T00:00:00Z",
        prompt: "Test prompt",
      };

      mockManager.trigger.mockResolvedValue(mockResult);

      await service.start();
      const result = await service.runAgent("my-agent", "Test prompt");

      expect(mockManager.trigger).toHaveBeenCalledWith("my-agent", undefined, {
        prompt: "Test prompt",
      });
      expect(result.jobId).toBe("job-789");
    });

    it("should throw if fleet not running", async () => {
      await expect(service.runAgent("my-agent")).rejects.toThrow("Fleet not running");
    });

    it("should trigger without prompt", async () => {
      const mockResult: TriggerResult = {
        jobId: "job-789",
        agentName: "my-agent",
        scheduleName: null,
        startedAt: "2024-01-01T00:00:00Z",
      };

      mockManager.trigger.mockResolvedValue(mockResult);

      await service.start();
      await service.runAgent("my-agent");

      expect(mockManager.trigger).toHaveBeenCalledWith("my-agent", undefined, {
        prompt: undefined,
      });
    });
  });
});

// =============================================================================
// Testing Event Handlers
// =============================================================================

describe("Event Handling", () => {
  it("should register event handlers", () => {
    const mockManager = createMockFleetManager();

    const onJobCreated = vi.fn();
    const onJobCompleted = vi.fn();
    const onJobFailed = vi.fn();

    mockManager.on("job:created", onJobCreated);
    mockManager.on("job:completed", onJobCompleted);
    mockManager.on("job:failed", onJobFailed);

    expect(mockManager.on).toHaveBeenCalledWith("job:created", onJobCreated);
    expect(mockManager.on).toHaveBeenCalledWith("job:completed", onJobCompleted);
    expect(mockManager.on).toHaveBeenCalledWith("job:failed", onJobFailed);
  });

  it("should handle job completion events", async () => {
    const completedJobs: string[] = [];

    // Simulate event emission
    const onJobCompleted = (payload: { job: { id: string }; durationSeconds: number }) => {
      completedJobs.push(payload.job.id);
    };

    // Simulate an event being fired
    onJobCompleted({ job: { id: "job-123" }, durationSeconds: 10 });
    onJobCompleted({ job: { id: "job-456" }, durationSeconds: 20 });

    expect(completedJobs).toEqual(["job-123", "job-456"]);
  });
});

// =============================================================================
// Testing Error Handling
// =============================================================================

describe("Error Handling", () => {
  it("should handle agent not found errors", async () => {
    const mockManager = createMockFleetManager();

    // Create an error that mimics AgentNotFoundError
    const error = new Error("Agent not found: unknown-agent") as Error & {
      code: string;
      agentName: string;
      availableAgents: string[];
    };
    error.code = "AGENT_NOT_FOUND";
    error.agentName = "unknown-agent";
    error.availableAgents = ["agent-1", "agent-2"];

    mockManager.trigger.mockRejectedValue(error);

    const service = new FleetService(mockManager);
    await service.start();

    await expect(service.runAgent("unknown-agent")).rejects.toThrow("Agent not found");
  });

  it("should handle concurrency limit errors", async () => {
    const mockManager = createMockFleetManager();

    const error = new Error("Agent at capacity") as Error & {
      code: string;
      currentJobs: number;
      limit: number;
    };
    error.code = "CONCURRENCY_LIMIT";
    error.currentJobs = 2;
    error.limit = 2;

    mockManager.trigger.mockRejectedValue(error);

    const service = new FleetService(mockManager);
    await service.start();

    await expect(service.runAgent("busy-agent")).rejects.toThrow("at capacity");
  });
});

// =============================================================================
// Testing Async Operations
// =============================================================================

describe("Async Operations", () => {
  it("should wait for job completion", async () => {
    const mockManager = createMockFleetManager();
    const service = new FleetService(mockManager);

    const result = await service.waitForJobCompletion("job-123", 1000);

    expect(result).toBe(true);
  });

  it("should timeout if job takes too long", async () => {
    const mockManager = createMockFleetManager();
    const service = new FleetService(mockManager);

    // Override to simulate timeout
    service.waitForJobCompletion = async (_jobId: string, timeout = 30000) => {
      return new Promise((resolve) => {
        setTimeout(() => resolve(false), timeout);
      });
    };

    const result = await service.waitForJobCompletion("slow-job", 10);

    expect(result).toBe(false);
  });
});

// =============================================================================
// Snapshot Testing for Status Output
// =============================================================================

describe("Status Formatting", () => {
  function formatStatus(status: FleetStatus): string {
    return [
      `State: ${status.state}`,
      `Agents: ${status.counts.totalAgents}`,
      `Running Jobs: ${status.counts.runningJobs}`,
      `Uptime: ${status.uptimeSeconds ?? "N/A"}s`,
    ].join("\n");
  }

  it("should format status correctly", () => {
    const status: FleetStatus = {
      state: "running",
      uptimeSeconds: 3600,
      initializedAt: "2024-01-01T00:00:00Z",
      startedAt: "2024-01-01T00:00:00Z",
      stoppedAt: null,
      lastError: null,
      counts: {
        totalAgents: 3,
        idleAgents: 2,
        runningAgents: 1,
        errorAgents: 0,
        totalSchedules: 5,
        runningSchedules: 1,
        runningJobs: 2,
      },
      scheduler: {
        status: "running",
        checkCount: 100,
        triggerCount: 5,
        lastCheckAt: "2024-01-01T01:00:00Z",
        checkIntervalMs: 5000,
      },
    };

    const formatted = formatStatus(status);

    expect(formatted).toMatchInlineSnapshot(`
      "State: running
      Agents: 3
      Running Jobs: 2
      Uptime: 3600s"
    `);
  });
});
