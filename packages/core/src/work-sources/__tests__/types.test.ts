import { describe, expect, it } from "vitest";
import type {
  ClaimFailureReason,
  ClaimResult,
  FetchOptions,
  FetchResult,
  ReleaseOptions,
  ReleaseResult,
  WorkItem,
  WorkItemPriority,
  WorkOutcome,
  WorkResult,
  WorkSourceAdapter,
} from "../index.js";

// =============================================================================
// WorkItem type tests
// =============================================================================

describe("WorkItem", () => {
  it("captures all required fields", () => {
    const workItem: WorkItem = {
      id: "github-123",
      source: "github",
      externalId: "123",
      title: "Fix authentication bug",
      description: "Users are being logged out unexpectedly",
      priority: "high",
      labels: ["bug", "auth"],
      metadata: { milestone: "v1.0" },
      url: "https://github.com/org/repo/issues/123",
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-02"),
    };

    expect(workItem.id).toBe("github-123");
    expect(workItem.source).toBe("github");
    expect(workItem.externalId).toBe("123");
    expect(workItem.title).toBe("Fix authentication bug");
    expect(workItem.description).toBe("Users are being logged out unexpectedly");
    expect(workItem.priority).toBe("high");
    expect(workItem.labels).toEqual(["bug", "auth"]);
    expect(workItem.metadata).toEqual({ milestone: "v1.0" });
    expect(workItem.url).toBe("https://github.com/org/repo/issues/123");
    expect(workItem.createdAt).toEqual(new Date("2024-01-01"));
    expect(workItem.updatedAt).toEqual(new Date("2024-01-02"));
  });

  it("supports all priority levels", () => {
    const priorities: WorkItemPriority[] = ["critical", "high", "medium", "low"];
    priorities.forEach((priority) => {
      const workItem: WorkItem = {
        id: "test-1",
        source: "test",
        externalId: "1",
        title: "Test",
        description: "Test description",
        priority,
        labels: [],
        metadata: {},
        url: "https://example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(workItem.priority).toBe(priority);
    });
  });

  it("supports empty labels array", () => {
    const workItem: WorkItem = {
      id: "test-1",
      source: "test",
      externalId: "1",
      title: "Test",
      description: "",
      priority: "low",
      labels: [],
      metadata: {},
      url: "https://example.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(workItem.labels).toEqual([]);
  });

  it("supports complex metadata", () => {
    const workItem: WorkItem = {
      id: "linear-abc",
      source: "linear",
      externalId: "abc",
      title: "Implement feature",
      description: "Feature description",
      priority: "medium",
      labels: ["feature"],
      metadata: {
        project: { id: "proj-1", name: "Main Project" },
        cycle: { number: 5, name: "Sprint 5" },
        estimate: 3,
        assignees: ["user1", "user2"],
      },
      url: "https://linear.app/team/issue/abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(workItem.metadata.project).toEqual({ id: "proj-1", name: "Main Project" });
    expect(workItem.metadata.estimate).toBe(3);
  });
});

// =============================================================================
// FetchOptions and FetchResult type tests
// =============================================================================

describe("FetchOptions", () => {
  it("supports filtering by labels", () => {
    const options: FetchOptions = {
      labels: ["agent-ready", "bug"],
    };
    expect(options.labels).toEqual(["agent-ready", "bug"]);
  });

  it("supports filtering by priority", () => {
    const options: FetchOptions = {
      priority: ["critical", "high"],
    };
    expect(options.priority).toEqual(["critical", "high"]);
  });

  it("supports pagination with limit and cursor", () => {
    const options: FetchOptions = {
      limit: 10,
      cursor: "eyJwYWdlIjogMn0=",
    };
    expect(options.limit).toBe(10);
    expect(options.cursor).toBe("eyJwYWdlIjogMn0=");
  });

  it("supports includeClaimed option", () => {
    const options: FetchOptions = {
      includeClaimed: true,
    };
    expect(options.includeClaimed).toBe(true);
  });

  it("supports all options together", () => {
    const options: FetchOptions = {
      labels: ["ready"],
      priority: ["high", "medium"],
      limit: 25,
      cursor: "abc123",
      includeClaimed: false,
    };
    expect(options.labels).toEqual(["ready"]);
    expect(options.priority).toEqual(["high", "medium"]);
    expect(options.limit).toBe(25);
    expect(options.cursor).toBe("abc123");
    expect(options.includeClaimed).toBe(false);
  });

  it("allows empty options object", () => {
    const options: FetchOptions = {};
    expect(options.labels).toBeUndefined();
    expect(options.priority).toBeUndefined();
    expect(options.limit).toBeUndefined();
    expect(options.cursor).toBeUndefined();
  });
});

describe("FetchResult", () => {
  it("returns items with pagination info", () => {
    const workItem: WorkItem = {
      id: "github-1",
      source: "github",
      externalId: "1",
      title: "Test issue",
      description: "Description",
      priority: "medium",
      labels: [],
      metadata: {},
      url: "https://github.com/test",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result: FetchResult = {
      items: [workItem],
      nextCursor: "next-page-cursor",
      totalCount: 100,
    };

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("next-page-cursor");
    expect(result.totalCount).toBe(100);
  });

  it("handles last page with no next cursor", () => {
    const result: FetchResult = {
      items: [],
      nextCursor: undefined,
    };
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
  });

  it("totalCount is optional", () => {
    const result: FetchResult = {
      items: [],
    };
    expect(result.totalCount).toBeUndefined();
  });
});

// =============================================================================
// ClaimResult type tests
// =============================================================================

describe("ClaimResult", () => {
  it("represents successful claim with work item", () => {
    const workItem: WorkItem = {
      id: "github-123",
      source: "github",
      externalId: "123",
      title: "Claimed issue",
      description: "Description",
      priority: "high",
      labels: ["in-progress"],
      metadata: {},
      url: "https://github.com/test",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result: ClaimResult = {
      success: true,
      workItem,
    };

    expect(result.success).toBe(true);
    expect(result.workItem).toBe(workItem);
    expect(result.reason).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it("represents failed claim with reason", () => {
    const result: ClaimResult = {
      success: false,
      reason: "already_claimed",
      message: "This issue is already being worked on by another agent",
    };

    expect(result.success).toBe(false);
    expect(result.workItem).toBeUndefined();
    expect(result.reason).toBe("already_claimed");
    expect(result.message).toBe("This issue is already being worked on by another agent");
  });

  it("supports all failure reasons", () => {
    const reasons: ClaimFailureReason[] = [
      "already_claimed",
      "not_found",
      "permission_denied",
      "source_error",
      "invalid_state",
    ];

    reasons.forEach((reason) => {
      const result: ClaimResult = {
        success: false,
        reason,
      };
      expect(result.reason).toBe(reason);
    });
  });
});

// =============================================================================
// WorkResult type tests
// =============================================================================

describe("WorkResult", () => {
  it("represents successful completion", () => {
    const result: WorkResult = {
      outcome: "success",
      summary: "Fixed the authentication bug by updating the session timeout logic",
      details: "Updated SessionManager.ts to handle edge cases in token refresh",
      artifacts: ["src/SessionManager.ts", "tests/SessionManager.test.ts"],
    };

    expect(result.outcome).toBe("success");
    expect(result.summary).toContain("Fixed");
    expect(result.details).toContain("SessionManager");
    expect(result.artifacts).toHaveLength(2);
    expect(result.error).toBeUndefined();
  });

  it("represents failed completion", () => {
    const result: WorkResult = {
      outcome: "failure",
      summary: "Unable to reproduce the bug",
      error: "Could not find the reported behavior in the codebase",
    };

    expect(result.outcome).toBe("failure");
    expect(result.summary).toBe("Unable to reproduce the bug");
    expect(result.error).toBe("Could not find the reported behavior in the codebase");
  });

  it("represents partial completion", () => {
    const result: WorkResult = {
      outcome: "partial",
      summary: "Implemented core feature but tests are failing",
      details: "Feature implementation complete, but 3 tests need review",
      error: "Test failures in integration tests",
    };

    expect(result.outcome).toBe("partial");
    expect(result.error).toBeDefined();
  });

  it("supports all outcome types", () => {
    const outcomes: WorkOutcome[] = ["success", "failure", "partial"];
    outcomes.forEach((outcome) => {
      const result: WorkResult = {
        outcome,
        summary: "Test summary",
      };
      expect(result.outcome).toBe(outcome);
    });
  });

  it("has optional details and artifacts", () => {
    const result: WorkResult = {
      outcome: "success",
      summary: "Quick fix",
    };

    expect(result.details).toBeUndefined();
    expect(result.artifacts).toBeUndefined();
  });
});

// =============================================================================
// ReleaseOptions and ReleaseResult type tests
// =============================================================================

describe("ReleaseOptions", () => {
  it("supports reason and comment options", () => {
    const options: ReleaseOptions = {
      reason: "Agent timeout",
      addComment: true,
    };

    expect(options.reason).toBe("Agent timeout");
    expect(options.addComment).toBe(true);
  });

  it("allows empty options", () => {
    const options: ReleaseOptions = {};
    expect(options.reason).toBeUndefined();
    expect(options.addComment).toBeUndefined();
  });
});

describe("ReleaseResult", () => {
  it("represents successful release", () => {
    const result: ReleaseResult = {
      success: true,
    };

    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("represents failed release", () => {
    const result: ReleaseResult = {
      success: false,
      message: "Work item was already completed by another agent",
    };

    expect(result.success).toBe(false);
    expect(result.message).toBe("Work item was already completed by another agent");
  });
});

// =============================================================================
// WorkSource interface tests
// =============================================================================

describe("WorkSourceAdapter interface", () => {
  it("defines required interface shape", () => {
    // This test verifies the interface contract at compile time
    // and provides a reference implementation for documentation
    const mockWorkSource: WorkSourceAdapter = {
      type: "mock",

      async fetchAvailableWork(_options?: FetchOptions): Promise<FetchResult> {
        return { items: [] };
      },

      async claimWork(_workItemId: string): Promise<ClaimResult> {
        return { success: true };
      },

      async completeWork(_workItemId: string, _result: WorkResult): Promise<void> {
        // Implementation would update external system
      },

      async releaseWork(_workItemId: string, _options?: ReleaseOptions): Promise<ReleaseResult> {
        return { success: true };
      },

      async getWork(_workItemId: string): Promise<WorkItem | undefined> {
        return undefined;
      },
    };

    expect(mockWorkSource.type).toBe("mock");
    expect(typeof mockWorkSource.fetchAvailableWork).toBe("function");
    expect(typeof mockWorkSource.claimWork).toBe("function");
    expect(typeof mockWorkSource.completeWork).toBe("function");
    expect(typeof mockWorkSource.releaseWork).toBe("function");
    expect(typeof mockWorkSource.getWork).toBe("function");
  });

  it("supports async workflow operations", async () => {
    // Simulates a full workflow using the interface
    const mockItem: WorkItem = {
      id: "mock-1",
      source: "mock",
      externalId: "1",
      title: "Test task",
      description: "A test task",
      priority: "medium",
      labels: [],
      metadata: {},
      url: "https://example.com/1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockWorkSource: WorkSourceAdapter = {
      type: "mock",
      async fetchAvailableWork() {
        return { items: [mockItem] };
      },
      async claimWork(_id: string) {
        return { success: true, workItem: mockItem };
      },
      async completeWork() {},
      async releaseWork() {
        return { success: true };
      },
      async getWork(id: string) {
        return id === mockItem.id ? mockItem : undefined;
      },
    };

    // Fetch
    const fetchResult = await mockWorkSource.fetchAvailableWork();
    expect(fetchResult.items).toHaveLength(1);

    // Claim
    const claimResult = await mockWorkSource.claimWork(fetchResult.items[0].id);
    expect(claimResult.success).toBe(true);

    // Complete
    await mockWorkSource.completeWork(mockItem.id, {
      outcome: "success",
      summary: "Done",
    });

    // Get
    const retrieved = await mockWorkSource.getWork(mockItem.id);
    expect(retrieved).toBe(mockItem);
  });
});
