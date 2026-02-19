import { describe, it, expect } from "vitest";
import type {
  WorkSourceManager,
  WorkSourceManagerFactory,
  GetNextWorkItemOptions,
  GetNextWorkItemResult,
  ReleaseWorkItemOptions,
  ReportOutcomeOptions,
  WorkItem,
  WorkResult,
  ClaimResult,
  ReleaseResult,
  WorkSourceAdapter,
} from "../index.js";
import type { ResolvedAgent } from "../../config/loader.js";

// =============================================================================
// Test fixtures
// =============================================================================

function createMockWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "github:123",
    source: "github",
    externalId: "123",
    title: "Test issue",
    description: "Test description",
    priority: "medium",
    labels: ["agent-ready"],
    metadata: {},
    url: "https://github.com/org/repo/issues/123",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  };
}

function createMockAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    fleetPath: [],
    qualifiedName: overrides.name ?? "test-agent",
    work_source: {
      type: "github",
      repo: "org/repo",
      labels: {
        ready: "agent-ready",
        in_progress: "agent-working",
      },
    },
    ...overrides,
  };
}

// =============================================================================
// GetNextWorkItemOptions tests
// =============================================================================

describe("GetNextWorkItemOptions", () => {
  it("supports additional label filtering", () => {
    const options: GetNextWorkItemOptions = {
      labels: ["bug", "high-priority"],
    };

    expect(options.labels).toEqual(["bug", "high-priority"]);
    expect(options.autoClaim).toBeUndefined();
  });

  it("supports autoClaim option", () => {
    const options: GetNextWorkItemOptions = {
      autoClaim: true,
    };

    expect(options.autoClaim).toBe(true);
  });

  it("supports disabling autoClaim", () => {
    const options: GetNextWorkItemOptions = {
      autoClaim: false,
    };

    expect(options.autoClaim).toBe(false);
  });

  it("supports custom fetch options", () => {
    const options: GetNextWorkItemOptions = {
      fetchOptions: {
        limit: 5,
        priority: ["critical", "high"],
      },
    };

    expect(options.fetchOptions?.limit).toBe(5);
    expect(options.fetchOptions?.priority).toEqual(["critical", "high"]);
  });

  it("supports all options together", () => {
    const options: GetNextWorkItemOptions = {
      labels: ["feature"],
      autoClaim: true,
      fetchOptions: {
        limit: 10,
        cursor: "abc123",
      },
    };

    expect(options.labels).toEqual(["feature"]);
    expect(options.autoClaim).toBe(true);
    expect(options.fetchOptions?.limit).toBe(10);
    expect(options.fetchOptions?.cursor).toBe("abc123");
  });

  it("allows empty options", () => {
    const options: GetNextWorkItemOptions = {};

    expect(options.labels).toBeUndefined();
    expect(options.autoClaim).toBeUndefined();
    expect(options.fetchOptions).toBeUndefined();
  });
});

// =============================================================================
// GetNextWorkItemResult tests
// =============================================================================

describe("GetNextWorkItemResult", () => {
  it("represents no work available", () => {
    const result: GetNextWorkItemResult = {
      item: null,
      claimed: false,
    };

    expect(result.item).toBeNull();
    expect(result.claimed).toBe(false);
    expect(result.claimResult).toBeUndefined();
  });

  it("represents work found and claimed", () => {
    const workItem = createMockWorkItem();
    const result: GetNextWorkItemResult = {
      item: workItem,
      claimed: true,
      claimResult: {
        success: true,
        workItem,
      },
    };

    expect(result.item).toBe(workItem);
    expect(result.claimed).toBe(true);
    expect(result.claimResult?.success).toBe(true);
  });

  it("represents work found but claim failed", () => {
    const workItem = createMockWorkItem();
    const result: GetNextWorkItemResult = {
      item: workItem,
      claimed: false,
      claimResult: {
        success: false,
        reason: "already_claimed",
        message: "Another agent claimed this issue first",
      },
    };

    expect(result.item).toBe(workItem);
    expect(result.claimed).toBe(false);
    expect(result.claimResult?.success).toBe(false);
    expect(result.claimResult?.reason).toBe("already_claimed");
  });

  it("represents work found without auto-claim", () => {
    const workItem = createMockWorkItem();
    const result: GetNextWorkItemResult = {
      item: workItem,
      claimed: false,
      // No claimResult when autoClaim is false
    };

    expect(result.item).toBe(workItem);
    expect(result.claimed).toBe(false);
    expect(result.claimResult).toBeUndefined();
  });
});

// =============================================================================
// ReleaseWorkItemOptions tests
// =============================================================================

describe("ReleaseWorkItemOptions", () => {
  it("requires agent for adapter resolution", () => {
    const agent = createMockAgent();
    const options: ReleaseWorkItemOptions = {
      agent,
    };

    expect(options.agent).toBe(agent);
  });

  it("supports reason for release", () => {
    const agent = createMockAgent();
    const options: ReleaseWorkItemOptions = {
      agent,
      reason: "Job timed out after 30 minutes",
    };

    expect(options.reason).toBe("Job timed out after 30 minutes");
  });

  it("supports addComment option", () => {
    const agent = createMockAgent();
    const options: ReleaseWorkItemOptions = {
      agent,
      reason: "Unexpected error",
      addComment: true,
    };

    expect(options.addComment).toBe(true);
  });

  it("supports all options together", () => {
    const agent = createMockAgent();
    const options: ReleaseWorkItemOptions = {
      agent,
      reason: "Agent shutting down",
      addComment: true,
    };

    expect(options.agent.name).toBe("test-agent");
    expect(options.reason).toBe("Agent shutting down");
    expect(options.addComment).toBe(true);
  });
});

// =============================================================================
// ReportOutcomeOptions tests
// =============================================================================

describe("ReportOutcomeOptions", () => {
  it("requires agent for adapter resolution", () => {
    const agent = createMockAgent();
    const options: ReportOutcomeOptions = {
      agent,
    };

    expect(options.agent).toBe(agent);
    expect(options.agent.name).toBe("test-agent");
  });
});

// =============================================================================
// WorkSourceManager interface tests
// =============================================================================

describe("WorkSourceManager interface", () => {
  it("defines required interface shape", () => {
    // This test verifies the interface contract at compile time
    // by creating a mock implementation that satisfies all methods
    const mockManager: WorkSourceManager = {
      async getNextWorkItem(
        agent: ResolvedAgent,
        options?: GetNextWorkItemOptions
      ): Promise<GetNextWorkItemResult> {
        return { item: null, claimed: false };
      },

      async reportOutcome(
        taskId: string,
        result: WorkResult,
        options: ReportOutcomeOptions
      ): Promise<void> {
        // Implementation would update external system
      },

      async releaseWorkItem(
        taskId: string,
        options: ReleaseWorkItemOptions
      ): Promise<ReleaseResult> {
        return { success: true };
      },

      async getAdapter(agent: ResolvedAgent): Promise<WorkSourceAdapter | null> {
        return null;
      },

      clearCache(): void {
        // Implementation would clear adapter cache
      },
    };

    // Verify all methods exist and have correct signatures
    expect(typeof mockManager.getNextWorkItem).toBe("function");
    expect(typeof mockManager.reportOutcome).toBe("function");
    expect(typeof mockManager.releaseWorkItem).toBe("function");
    expect(typeof mockManager.getAdapter).toBe("function");
    expect(typeof mockManager.clearCache).toBe("function");
  });

  it("supports complete scheduler workflow", async () => {
    const mockWorkItem = createMockWorkItem();
    const agent = createMockAgent();

    // Mock adapter for testing
    const mockAdapter: WorkSourceAdapter = {
      type: "github",
      async fetchAvailableWork() {
        return { items: [mockWorkItem] };
      },
      async claimWork(id) {
        return { success: true, workItem: mockWorkItem };
      },
      async completeWork() {},
      async releaseWork() {
        return { success: true };
      },
      async getWork(id) {
        return id === mockWorkItem.id ? mockWorkItem : undefined;
      },
    };

    // Mock manager with state tracking
    let completedTasks: string[] = [];
    let releasedTasks: string[] = [];

    const mockManager: WorkSourceManager = {
      async getNextWorkItem(agentArg, options) {
        if (!agentArg.work_source) {
          return { item: null, claimed: false };
        }

        const fetchResult = await mockAdapter.fetchAvailableWork();
        const item = fetchResult.items[0] ?? null;

        if (!item) {
          return { item: null, claimed: false };
        }

        // Auto-claim by default
        if (options?.autoClaim !== false) {
          const claimResult = await mockAdapter.claimWork(item.id);
          return { item, claimed: claimResult.success, claimResult };
        }

        return { item, claimed: false };
      },

      async reportOutcome(taskId, result, options) {
        completedTasks.push(taskId);
        await mockAdapter.completeWork(taskId, result);
      },

      async releaseWorkItem(taskId, options) {
        releasedTasks.push(taskId);
        return mockAdapter.releaseWork(taskId, options);
      },

      async getAdapter(agentArg) {
        return agentArg.work_source ? mockAdapter : null;
      },

      clearCache() {
        completedTasks = [];
        releasedTasks = [];
      },
    };

    // Step 1: Get next work item (auto-claimed)
    const { item, claimed, claimResult } =
      await mockManager.getNextWorkItem(agent);

    expect(item).not.toBeNull();
    expect(item?.id).toBe("github:123");
    expect(claimed).toBe(true);
    expect(claimResult?.success).toBe(true);

    // Step 2: Report successful outcome
    await mockManager.reportOutcome(
      item!.id,
      {
        outcome: "success",
        summary: "Fixed the issue",
        details: "Updated validation logic",
      },
      { agent }
    );

    expect(completedTasks).toContain(item!.id);

    // Step 3: Verify adapter access
    const adapter = await mockManager.getAdapter(agent);
    expect(adapter).toBe(mockAdapter);
    expect(adapter?.type).toBe("github");

    // Step 4: Clear cache
    mockManager.clearCache();
    expect(completedTasks).toHaveLength(0);
  });

  it("handles agent without work source", async () => {
    const agentWithoutWorkSource = createMockAgent({ work_source: undefined });

    const mockManager: WorkSourceManager = {
      async getNextWorkItem(agent) {
        if (!agent.work_source) {
          return { item: null, claimed: false };
        }
        return { item: createMockWorkItem(), claimed: true };
      },
      async reportOutcome() {},
      async releaseWorkItem() {
        return { success: true };
      },
      async getAdapter(agent) {
        return agent.work_source ? ({} as WorkSourceAdapter) : null;
      },
      clearCache() {},
    };

    const result = await mockManager.getNextWorkItem(agentWithoutWorkSource);
    expect(result.item).toBeNull();
    expect(result.claimed).toBe(false);

    const adapter = await mockManager.getAdapter(agentWithoutWorkSource);
    expect(adapter).toBeNull();
  });

  it("handles claim race condition", async () => {
    const mockWorkItem = createMockWorkItem();
    const agent = createMockAgent();

    // Simulate another agent claiming first
    const mockManager: WorkSourceManager = {
      async getNextWorkItem(agentArg, options) {
        // Item found but claim fails
        return {
          item: mockWorkItem,
          claimed: false,
          claimResult: {
            success: false,
            reason: "already_claimed",
            message: "Work item was claimed by another agent",
          },
        };
      },
      async reportOutcome() {},
      async releaseWorkItem() {
        return { success: true };
      },
      async getAdapter() {
        return null;
      },
      clearCache() {},
    };

    const result = await mockManager.getNextWorkItem(agent);

    expect(result.item).not.toBeNull();
    expect(result.claimed).toBe(false);
    expect(result.claimResult?.success).toBe(false);
    expect(result.claimResult?.reason).toBe("already_claimed");
  });

  it("supports release on error", async () => {
    const mockWorkItem = createMockWorkItem();
    const agent = createMockAgent();
    const releasedWith: { taskId: string; reason?: string }[] = [];

    const mockManager: WorkSourceManager = {
      async getNextWorkItem() {
        return { item: mockWorkItem, claimed: true };
      },
      async reportOutcome() {},
      async releaseWorkItem(taskId, options) {
        releasedWith.push({ taskId, reason: options.reason });
        return { success: true };
      },
      async getAdapter() {
        return null;
      },
      clearCache() {},
    };

    // Simulate error during job execution
    const { item } = await mockManager.getNextWorkItem(agent);

    try {
      throw new Error("Job failed unexpectedly");
    } catch (error) {
      await mockManager.releaseWorkItem(item!.id, {
        agent,
        reason: `Error: ${(error as Error).message}`,
        addComment: true,
      });
    }

    expect(releasedWith).toHaveLength(1);
    expect(releasedWith[0].taskId).toBe("github:123");
    expect(releasedWith[0].reason).toBe("Error: Job failed unexpectedly");
  });
});

// =============================================================================
// WorkSourceManagerFactory tests
// =============================================================================

describe("WorkSourceManagerFactory", () => {
  it("defines factory function type", () => {
    // The factory type creates WorkSourceManager instances
    const mockFactory: WorkSourceManagerFactory = () => {
      const manager: WorkSourceManager = {
        async getNextWorkItem() {
          return { item: null, claimed: false };
        },
        async reportOutcome() {},
        async releaseWorkItem() {
          return { success: true };
        },
        async getAdapter() {
          return null;
        },
        clearCache() {},
      };
      return manager;
    };

    const manager = mockFactory();
    expect(typeof manager.getNextWorkItem).toBe("function");
    expect(typeof manager.reportOutcome).toBe("function");
  });
});
