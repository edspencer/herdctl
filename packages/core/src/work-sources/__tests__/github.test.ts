import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateBackoffDelay,
  createGitHubAdapter,
  extractRateLimitInfo,
  GitHubAPIError,
  GitHubAuthError,
  type GitHubIssue,
  GitHubWorkSourceAdapter,
  type GitHubWorkSourceConfig,
  isRateLimitResponse,
  type RetryOptions,
} from "../adapters/github.js";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock GitHub issue
 */
function createMockIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: "Test Issue",
    body: "Test issue body",
    html_url: "https://github.com/owner/repo/issues/1",
    state: "open",
    labels: [{ name: "ready" }],
    created_at: "2024-01-15T10:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    assignee: null,
    assignees: [],
    milestone: null,
    user: { login: "testuser" },
    ...overrides,
  };
}

/**
 * Create a default adapter config
 */
function createConfig(overrides: Partial<GitHubWorkSourceConfig> = {}): GitHubWorkSourceConfig {
  return {
    type: "github",
    owner: "testowner",
    repo: "testrepo",
    token: "test-token",
    ...overrides,
  };
}

/**
 * Mock fetch response helper
 */
function mockFetchResponse(
  data: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
) {
  const { status = 200, headers = {} } = options;
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  } as Response);
}

/**
 * Helper to get a mock call safely with type assertions
 */
interface MockCallInfo {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

function getMockCall(mockFetch: ReturnType<typeof vi.fn>, index: number): MockCallInfo {
  const call = mockFetch.mock.calls[index];
  if (!call) {
    throw new Error(`Mock call at index ${index} not found`);
  }
  const [url, init] = call as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method ?? "GET",
    body: typeof init?.body === "string" ? init.body : undefined,
    headers: (init?.headers as Record<string, string>) ?? {},
  };
}

// =============================================================================
// Test Setup
// =============================================================================

describe("GitHubWorkSourceAdapter", () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn<typeof global.fetch>>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn<typeof global.fetch>();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe("constructor", () => {
    it("uses default labels when not configured", () => {
      const adapter = new GitHubWorkSourceAdapter(createConfig());
      expect(adapter.type).toBe("github");
    });

    it("uses custom labels when configured", () => {
      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          labels: {
            ready: "custom-ready",
            in_progress: "custom-wip",
          },
        }),
      );
      expect(adapter.type).toBe("github");
    });

    it("uses default exclude_labels when not configured", () => {
      const adapter = new GitHubWorkSourceAdapter(createConfig());
      // Default exclude_labels are ["blocked", "wip"]
      expect(adapter.type).toBe("github");
    });

    it("uses custom exclude_labels when configured", () => {
      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          exclude_labels: ["on-hold", "needs-review"],
        }),
      );
      expect(adapter.type).toBe("github");
    });
  });

  // ===========================================================================
  // fetchAvailableWork Tests
  // ===========================================================================

  describe("fetchAvailableWork", () => {
    it("fetches issues with the ready label", async () => {
      const mockIssues = [createMockIssue({ number: 1 }), createMockIssue({ number: 2 })];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/testowner/testrepo/issues"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result.items).toHaveLength(2);
    });

    it("filters by ready label in query params", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork();

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("labels=ready");
    });

    it("uses custom ready label", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          labels: { ready: "agent-ready" },
        }),
      );
      await adapter.fetchAvailableWork();

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("labels=agent-ready");
    });

    it("sorts by creation date ascending (oldest first)", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork();

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("sort=created");
      expect(callUrl).toContain("direction=asc");
    });

    it("excludes issues with exclude_labels", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }] }),
        createMockIssue({ number: 2, labels: [{ name: "ready" }, { name: "blocked" }] }),
        createMockIssue({ number: 3, labels: [{ name: "ready" }, { name: "wip" }] }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      // Only issue 1 should be returned (2 has blocked, 3 has wip)
      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalId).toBe("1");
    });

    it("excludes issues with custom exclude_labels", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }] }),
        createMockIssue({ number: 2, labels: [{ name: "ready" }, { name: "on-hold" }] }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          exclude_labels: ["on-hold"],
        }),
      );
      const result = await adapter.fetchAvailableWork();

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalId).toBe("1");
    });

    it("excludes issues with in_progress label by default", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }] }),
        createMockIssue({
          number: 2,
          labels: [{ name: "ready" }, { name: "agent-working" }],
        }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalId).toBe("1");
    });

    it("includes claimed issues when includeClaimed is true", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }] }),
        createMockIssue({
          number: 2,
          labels: [{ name: "ready" }, { name: "agent-working" }],
        }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork({ includeClaimed: true });

      expect(result.items).toHaveLength(2);
    });

    it("applies additional label filters", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }, { name: "bug" }] }),
        createMockIssue({ number: 2, labels: [{ name: "ready" }, { name: "feature" }] }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork({ labels: ["bug"] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalId).toBe("1");
    });

    it("supports pagination with limit", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork({ limit: 10 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("per_page=10");
    });

    it("caps limit at 100 (GitHub API max)", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork({ limit: 200 });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("per_page=100");
    });

    it("supports pagination with cursor", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork({ cursor: "2" });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("page=2");
    });

    it("extracts nextCursor from Link header", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse([createMockIssue()], {
          headers: {
            Link: '<https://api.github.com/repos/owner/repo/issues?page=2>; rel="next", <https://api.github.com/repos/owner/repo/issues?page=5>; rel="last"',
          },
        }),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.nextCursor).toBe("2");
    });

    it("returns undefined nextCursor when no more pages", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([createMockIssue()]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.nextCursor).toBeUndefined();
    });

    it("filters by priority when specified", async () => {
      const mockIssues = [
        createMockIssue({ number: 1, labels: [{ name: "ready" }, { name: "critical" }] }),
        createMockIssue({ number: 2, labels: [{ name: "ready" }] }),
        createMockIssue({ number: 3, labels: [{ name: "ready" }, { name: "low" }] }),
      ];
      mockFetch.mockReturnValue(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork({ priority: ["critical", "high"] });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].externalId).toBe("1");
    });

    it("maps issue to WorkItem correctly", async () => {
      const mockIssue = createMockIssue({
        number: 42,
        title: "Fix bug in login",
        body: "The login form is broken",
        html_url: "https://github.com/owner/repo/issues/42",
        labels: [{ name: "ready" }, { name: "bug" }, { name: "high" }],
        assignee: { login: "dev1" },
        assignees: [{ login: "dev1" }, { login: "dev2" }],
        milestone: { title: "v1.0", number: 1 },
        user: { login: "reporter" },
        created_at: "2024-01-10T09:00:00Z",
        updated_at: "2024-01-12T14:30:00Z",
      });
      mockFetch.mockReturnValue(mockFetchResponse([mockIssue]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.id).toBe("github-42");
      expect(item.source).toBe("github");
      expect(item.externalId).toBe("42");
      expect(item.title).toBe("Fix bug in login");
      expect(item.description).toBe("The login form is broken");
      expect(item.priority).toBe("high");
      expect(item.labels).toEqual(["ready", "bug", "high"]);
      expect(item.url).toBe("https://github.com/owner/repo/issues/42");
      expect(item.metadata).toEqual({
        state: "open",
        assignee: "dev1",
        assignees: ["dev1", "dev2"],
        milestone: { title: "v1.0", number: 1 },
        author: "reporter",
      });
      expect(item.createdAt).toEqual(new Date("2024-01-10T09:00:00Z"));
      expect(item.updatedAt).toEqual(new Date("2024-01-12T14:30:00Z"));
    });

    it("handles null body in issue", async () => {
      const mockIssue = createMockIssue({ body: null });
      mockFetch.mockReturnValue(mockFetchResponse([mockIssue]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.items[0].description).toBe("");
    });

    it("throws GitHubAPIError when missing owner/repo config", async () => {
      const adapter = new GitHubWorkSourceAdapter({ type: "github" });

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      await expect(adapter.fetchAvailableWork()).rejects.toThrow(
        "GitHub adapter requires 'owner' and 'repo' configuration",
      );
    });

    it("throws GitHubAPIError on API error", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
    });

    it("handles network errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Disable retries to test immediate error handling
      const adapter = new GitHubWorkSourceAdapter(createConfig({ retry: { maxRetries: 0 } }));

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      await expect(adapter.fetchAvailableWork()).rejects.toThrow("Network error");
    });
  });

  // ===========================================================================
  // Priority Inference Tests
  // ===========================================================================

  describe("priority inference", () => {
    it.each([
      [["critical"], "critical"],
      [["p0"], "critical"],
      [["urgent"], "critical"],
      [["high"], "high"],
      [["p1"], "high"],
      [["important"], "high"],
      [["low"], "low"],
      [["p3"], "low"],
      [["enhancement"], "medium"],
      [[], "medium"],
    ])("infers priority %s as %s", async (labels, expectedPriority) => {
      const mockIssue = createMockIssue({
        labels: [{ name: "ready" }, ...labels.map((name) => ({ name }))],
      });
      mockFetch.mockReturnValue(mockFetchResponse([mockIssue]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.items[0].priority).toBe(expectedPriority);
    });

    it("handles case-insensitive priority labels", async () => {
      const mockIssue = createMockIssue({
        labels: [{ name: "ready" }, { name: "CRITICAL" }],
      });
      mockFetch.mockReturnValue(mockFetchResponse([mockIssue]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.fetchAvailableWork();

      expect(result.items[0].priority).toBe("critical");
    });
  });

  // ===========================================================================
  // claimWork Tests
  // ===========================================================================

  describe("claimWork", () => {
    it("adds in_progress label and removes ready label", async () => {
      const mockIssue = createMockIssue({
        number: 5,
        labels: [{ name: "ready" }],
      });
      const updatedIssue = createMockIssue({
        number: 5,
        labels: [{ name: "agent-working" }],
      });

      mockFetch
        .mockReturnValueOnce(mockFetchResponse(mockIssue)) // GET issue
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 200 })) // POST labels
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE ready label
        .mockReturnValueOnce(mockFetchResponse(updatedIssue)); // GET updated issue

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-5");

      expect(result.success).toBe(true);
      expect(result.workItem).toBeDefined();
      expect(result.workItem?.id).toBe("github-5");

      // Verify the API calls
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // Check POST to add label
      const addLabelCall = getMockCall(mockFetch, 1);
      expect(addLabelCall.url).toContain("/issues/5/labels");
      expect(addLabelCall.method).toBe("POST");
      expect(JSON.parse(addLabelCall.body!)).toEqual({
        labels: ["agent-working"],
      });

      // Check DELETE to remove ready label
      const removeLabelCall = getMockCall(mockFetch, 2);
      expect(removeLabelCall.url).toContain("/issues/5/labels/ready");
      expect(removeLabelCall.method).toBe("DELETE");
    });

    it("returns already_claimed when issue has in_progress label", async () => {
      const mockIssue = createMockIssue({
        number: 5,
        labels: [{ name: "ready" }, { name: "agent-working" }],
      });
      mockFetch.mockReturnValueOnce(mockFetchResponse(mockIssue));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-5");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("already_claimed");
      expect(result.message).toContain("already claimed");
    });

    it("returns invalid_state when issue is closed", async () => {
      const mockIssue = createMockIssue({
        number: 5,
        state: "closed",
      });
      mockFetch.mockReturnValueOnce(mockFetchResponse(mockIssue));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-5");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("invalid_state");
      expect(result.message).toContain("closed");
    });

    it("returns not_found when issue does not exist", async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-999");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("returns permission_denied on 403 error", async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ message: "Forbidden" }, { status: 403 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-5");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("permission_denied");
    });

    it("returns source_error on other API errors", async () => {
      mockFetch.mockReturnValueOnce(
        mockFetchResponse({ message: "Server Error" }, { status: 500 }),
      );

      // Disable retries to test immediate error handling
      const adapter = new GitHubWorkSourceAdapter(createConfig({ retry: { maxRetries: 0 } }));
      const result = await adapter.claimWork("github-5");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("source_error");
    });

    it("throws on invalid work item ID format", async () => {
      const adapter = new GitHubWorkSourceAdapter(createConfig());

      await expect(adapter.claimWork("invalid-id")).rejects.toThrow(GitHubAPIError);
      await expect(adapter.claimWork("invalid-id")).rejects.toThrow(
        'Invalid work item ID format: "invalid-id"',
      );
    });

    it("uses custom in_progress label", async () => {
      const mockIssue = createMockIssue({ number: 5 });
      const updatedIssue = createMockIssue({ number: 5 });

      mockFetch
        .mockReturnValueOnce(mockFetchResponse(mockIssue))
        .mockReturnValueOnce(mockFetchResponse(undefined))
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockReturnValueOnce(mockFetchResponse(updatedIssue));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          labels: { in_progress: "custom-wip" },
        }),
      );
      await adapter.claimWork("github-5");

      const addLabelCall = getMockCall(mockFetch, 1);
      expect(JSON.parse(addLabelCall.body!)).toEqual({
        labels: ["custom-wip"],
      });
    });
  });

  // ===========================================================================
  // completeWork Tests
  // ===========================================================================

  describe("completeWork", () => {
    it("posts comment and closes issue on success outcome", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 })) // POST comment
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE label
        .mockReturnValueOnce(mockFetchResponse({})); // PATCH issue

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "success",
        summary: "Fixed the bug",
      });

      // Verify comment was posted
      const commentCall = getMockCall(mockFetch, 0);
      expect(commentCall.url).toContain("/issues/5/comments");
      expect(commentCall.method).toBe("POST");
      const commentBody = JSON.parse(commentCall.body!).body;
      expect(commentBody).toContain("✅");
      expect(commentBody).toContain("success");
      expect(commentBody).toContain("Fixed the bug");

      // Verify issue was closed
      const closeCall = getMockCall(mockFetch, 2);
      expect(closeCall.url).toContain("/issues/5");
      expect(closeCall.method).toBe("PATCH");
      expect(JSON.parse(closeCall.body!)).toEqual({
        state: "closed",
        state_reason: "completed",
      });
    });

    it("posts comment but does not close on failure outcome", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 })) // POST comment
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })); // DELETE label

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "failure",
        summary: "Could not fix the bug",
        error: "Compilation error",
      });

      // Should only have 2 calls (comment + delete label), no close
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const failureCommentCall = getMockCall(mockFetch, 0);
      const failureCommentBody = JSON.parse(failureCommentCall.body!).body;
      expect(failureCommentBody).toContain("❌");
      expect(failureCommentBody).toContain("failure");
      expect(failureCommentBody).toContain("Compilation error");
    });

    it("posts comment but does not close on partial outcome", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 }))
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "partial",
        summary: "Partially completed",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const partialCommentCall = getMockCall(mockFetch, 0);
      const partialCommentBody = JSON.parse(partialCommentCall.body!).body;
      expect(partialCommentBody).toContain("⚠️");
      expect(partialCommentBody).toContain("partial");
    });

    it("includes details in comment when provided", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 }))
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockReturnValueOnce(mockFetchResponse({}));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "success",
        summary: "Fixed the bug",
        details: "Changed the validation logic in login.ts",
      });

      const detailsCommentCall = getMockCall(mockFetch, 0);
      const detailsCommentBody = JSON.parse(detailsCommentCall.body!).body;
      expect(detailsCommentBody).toContain("### Details");
      expect(detailsCommentBody).toContain("Changed the validation logic");
    });

    it("includes artifacts in comment when provided", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 }))
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockReturnValueOnce(mockFetchResponse({}));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "success",
        summary: "Created files",
        artifacts: ["src/new-file.ts", "tests/new-file.test.ts"],
      });

      const artifactsCommentCall = getMockCall(mockFetch, 0);
      const artifactsCommentBody = JSON.parse(artifactsCommentCall.body!).body;
      expect(artifactsCommentBody).toContain("### Artifacts");
      expect(artifactsCommentBody).toContain("src/new-file.ts");
      expect(artifactsCommentBody).toContain("tests/new-file.test.ts");
    });

    it("removes in_progress label", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 }))
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockReturnValueOnce(mockFetchResponse({}));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.completeWork("github-5", {
        outcome: "success",
        summary: "Done",
      });

      const deleteCall = getMockCall(mockFetch, 1);
      expect(deleteCall.url).toContain("/labels/agent-working");
      expect(deleteCall.method).toBe("DELETE");
    });
  });

  // ===========================================================================
  // releaseWork Tests
  // ===========================================================================

  describe("releaseWork", () => {
    it("removes in_progress label and adds ready label", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE in_progress
        .mockReturnValueOnce(mockFetchResponse([{ name: "ready" }])); // POST ready

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.releaseWork("github-5");

      expect(result.success).toBe(true);

      // Verify DELETE call
      const deleteCall = getMockCall(mockFetch, 0);
      expect(deleteCall.url).toContain("/labels/agent-working");
      expect(deleteCall.method).toBe("DELETE");

      // Verify POST call
      const postCall = getMockCall(mockFetch, 1);
      expect(postCall.url).toContain("/issues/5/labels");
      expect(postCall.method).toBe("POST");
      expect(JSON.parse(postCall.body!)).toEqual({ labels: ["ready"] });
    });

    it("adds comment when addComment is true", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse({ id: 1 })) // POST comment
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE label
        .mockReturnValueOnce(mockFetchResponse([{ name: "ready" }])); // POST ready

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.releaseWork("github-5", {
        addComment: true,
        reason: "Agent timed out",
      });

      expect(result.success).toBe(true);

      const releaseCommentCall = getMockCall(mockFetch, 0);
      expect(releaseCommentCall.url).toContain("/issues/5/comments");
      const releaseCommentBody = JSON.parse(releaseCommentCall.body!).body;
      expect(releaseCommentBody).toContain("Work Released");
      expect(releaseCommentBody).toContain("Agent timed out");
    });

    it("does not add comment when addComment is false", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockReturnValueOnce(mockFetchResponse([{ name: "ready" }]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.releaseWork("github-5", {
        addComment: false,
        reason: "Agent timed out",
      });

      // Should only have 2 calls (delete label + add label)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const noCommentCall = getMockCall(mockFetch, 0);
      expect(noCommentCall.url).toContain("/labels/");
    });

    it("returns failure on API error", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 }))
        .mockRejectedValueOnce(new Error("Network error"));

      // Disable retries to test immediate error handling
      const adapter = new GitHubWorkSourceAdapter(createConfig({ retry: { maxRetries: 0 } }));
      const result = await adapter.releaseWork("github-5");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Network error");
    });

    it("respects cleanup_on_failure: true (default)", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE in_progress
        .mockReturnValueOnce(mockFetchResponse([{ name: "ready" }])); // POST ready

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.releaseWork("github-5");

      expect(result.success).toBe(true);

      // Should have 2 calls: DELETE in_progress + POST ready
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const postCall = getMockCall(mockFetch, 1);
      expect(postCall.url).toContain("/issues/5/labels");
      expect(postCall.method).toBe("POST");
      expect(JSON.parse(postCall.body!)).toEqual({ labels: ["ready"] });
    });

    it("respects cleanup_on_failure: false (skips re-adding ready label)", async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })); // DELETE in_progress

      const adapter = new GitHubWorkSourceAdapter(createConfig({ cleanup_on_failure: false }));
      const result = await adapter.releaseWork("github-5");

      expect(result.success).toBe(true);

      // Should only have 1 call: DELETE in_progress (no POST ready)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const deleteCall = getMockCall(mockFetch, 0);
      expect(deleteCall.url).toContain("/labels/agent-working");
      expect(deleteCall.method).toBe("DELETE");
    });

    it("respects cleanup_on_failure: true when explicitly set", async () => {
      mockFetch
        .mockReturnValueOnce(mockFetchResponse(undefined, { status: 204 })) // DELETE in_progress
        .mockReturnValueOnce(mockFetchResponse([{ name: "ready" }])); // POST ready

      const adapter = new GitHubWorkSourceAdapter(createConfig({ cleanup_on_failure: true }));
      const result = await adapter.releaseWork("github-5");

      expect(result.success).toBe(true);

      // Should have 2 calls: DELETE in_progress + POST ready
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // getWork Tests
  // ===========================================================================

  describe("getWork", () => {
    it("fetches and returns work item", async () => {
      const mockIssue = createMockIssue({
        number: 10,
        title: "Test Issue",
      });
      mockFetch.mockReturnValueOnce(mockFetchResponse(mockIssue));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.getWork("github-10");

      expect(result).toBeDefined();
      expect(result?.id).toBe("github-10");
      expect(result?.title).toBe("Test Issue");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/repos/testowner/testrepo/issues/10"),
        expect.any(Object),
      );
    });

    it("returns undefined when issue not found", async () => {
      mockFetch.mockReturnValueOnce(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.getWork("github-999");

      expect(result).toBeUndefined();
    });

    it("throws on other API errors", async () => {
      mockFetch.mockReturnValueOnce(
        mockFetchResponse({ message: "Server Error" }, { status: 500 }),
      );

      // Disable retries to test immediate error handling
      const adapter = new GitHubWorkSourceAdapter(createConfig({ retry: { maxRetries: 0 } }));

      await expect(adapter.getWork("github-5")).rejects.toThrow(GitHubAPIError);
    });
  });

  // ===========================================================================
  // GitHubAPIError Tests
  // ===========================================================================

  describe("GitHubAPIError", () => {
    it("has correct name and properties", () => {
      const error = new GitHubAPIError("Test error", {
        statusCode: 404,
        endpoint: "/repos/test",
      });

      expect(error.name).toBe("GitHubAPIError");
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(404);
      expect(error.endpoint).toBe("/repos/test");
    });

    it("preserves cause", () => {
      const cause = new Error("Original error");
      const error = new GitHubAPIError("Wrapped error", { cause });

      expect(error.cause).toBe(cause);
    });
  });

  // ===========================================================================
  // createGitHubAdapter Factory Tests
  // ===========================================================================

  describe("createGitHubAdapter", () => {
    it("creates a GitHubWorkSourceAdapter instance", () => {
      const adapter = createGitHubAdapter(createConfig());

      expect(adapter).toBeInstanceOf(GitHubWorkSourceAdapter);
      expect(adapter.type).toBe("github");
    });

    it("passes config to adapter", () => {
      const adapter = createGitHubAdapter(
        createConfig({
          owner: "myorg",
          repo: "myrepo",
        }),
      );

      expect(adapter.type).toBe("github");
    });
  });

  // ===========================================================================
  // Token Handling Tests
  // ===========================================================================

  describe("token handling", () => {
    it("uses token from config", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig({ token: "config-token" }));
      await adapter.fetchAvailableWork();

      const tokenCall = getMockCall(mockFetch, 0);
      expect(tokenCall.headers.Authorization).toBe("Bearer config-token");
    });

    it("uses GITHUB_TOKEN env var when no config token", async () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = "env-token";

      try {
        mockFetch.mockReturnValue(mockFetchResponse([]));

        const adapter = new GitHubWorkSourceAdapter(createConfig({ token: undefined }));
        await adapter.fetchAvailableWork();

        const envTokenCall = getMockCall(mockFetch, 0);
        expect(envTokenCall.headers.Authorization).toBe("Bearer env-token");
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });

    it("makes unauthenticated request when no token available", async () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      try {
        mockFetch.mockReturnValue(mockFetchResponse([]));

        const adapter = new GitHubWorkSourceAdapter(createConfig({ token: undefined }));
        await adapter.fetchAvailableWork();

        const noTokenCall = getMockCall(mockFetch, 0);
        expect(noTokenCall.headers.Authorization).toBeUndefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        }
      }
    });
  });

  // ===========================================================================
  // Custom API Base URL Tests
  // ===========================================================================

  describe("custom API base URL", () => {
    it("uses default api.github.com when not configured", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork();

      const defaultUrlCall = getMockCall(mockFetch, 0);
      expect(defaultUrlCall.url.startsWith("https://api.github.com")).toBe(true);
    });

    it("uses custom API base URL for GitHub Enterprise", async () => {
      mockFetch.mockReturnValue(mockFetchResponse([]));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          apiBaseUrl: "https://github.mycompany.com/api/v3",
        }),
      );
      await adapter.fetchAvailableWork();

      const customUrlCall = getMockCall(mockFetch, 0);
      expect(customUrlCall.url.startsWith("https://github.mycompany.com/api/v3")).toBe(true);
    });
  });

  // ===========================================================================
  // Rate Limit Handling Tests
  // ===========================================================================

  describe("rate limit handling", () => {
    it("extracts rate limit info from response headers", async () => {
      const mockIssues = [createMockIssue()];
      mockFetch.mockReturnValue(
        mockFetchResponse(mockIssues, {
          headers: {
            "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "4999",
            "X-RateLimit-Reset": "1700000000",
            "X-RateLimit-Resource": "core",
          },
        }),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.fetchAvailableWork();

      expect(adapter.lastRateLimitInfo).toEqual({
        limit: 5000,
        remaining: 4999,
        reset: 1700000000,
        resource: "core",
      });
    });

    it("triggers rate limit warning when remaining is below threshold", async () => {
      const warningCallback = vi.fn();
      const mockIssues = [createMockIssue()];
      mockFetch.mockReturnValue(
        mockFetchResponse(mockIssues, {
          headers: {
            "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "50",
            "X-RateLimit-Reset": "1700000000",
            "X-RateLimit-Resource": "core",
          },
        }),
      );

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          rateLimitWarning: {
            warningThreshold: 100,
            onWarning: warningCallback,
          },
        }),
      );
      await adapter.fetchAvailableWork();

      expect(warningCallback).toHaveBeenCalledWith({
        limit: 5000,
        remaining: 50,
        reset: 1700000000,
        resource: "core",
      });
    });

    it("does not trigger warning when remaining is above threshold", async () => {
      const warningCallback = vi.fn();
      const mockIssues = [createMockIssue()];
      mockFetch.mockReturnValue(
        mockFetchResponse(mockIssues, {
          headers: {
            "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "150",
            "X-RateLimit-Reset": "1700000000",
            "X-RateLimit-Resource": "core",
          },
        }),
      );

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          rateLimitWarning: {
            warningThreshold: 100,
            onWarning: warningCallback,
          },
        }),
      );
      await adapter.fetchAvailableWork();

      expect(warningCallback).not.toHaveBeenCalled();
    });

    it("detects rate limit error from 403 with remaining=0", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "X-RateLimit-Limit": "5000",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": "1700000000",
              "X-RateLimit-Resource": "core",
            },
          },
        ),
      );

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: { maxRetries: 0 }, // Disable retries for this test
        }),
      );

      try {
        await adapter.fetchAvailableWork();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAPIError);
        const apiError = error as GitHubAPIError;
        expect(apiError.isRateLimitError).toBe(true);
        expect(apiError.statusCode).toBe(403);
        expect(apiError.rateLimitInfo).toEqual({
          limit: 5000,
          remaining: 0,
          reset: 1700000000,
          resource: "core",
        });
      }
    });

    it("detects rate limit error from 429 status", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse({ message: "Too Many Requests" }, { status: 429 }),
      );

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: { maxRetries: 0 },
        }),
      );

      try {
        await adapter.fetchAvailableWork();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAPIError);
        const apiError = error as GitHubAPIError;
        expect(apiError.isRateLimitError).toBe(true);
        expect(apiError.statusCode).toBe(429);
      }
    });
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe("retry logic", () => {
    it("retries on rate limit error with exponential backoff", async () => {
      const mockIssues = [createMockIssue()];

      // First call fails with rate limit, second succeeds
      mockFetch
        .mockReturnValueOnce(
          mockFetchResponse(
            { message: "Rate limit exceeded" },
            {
              status: 403,
              headers: {
                "X-RateLimit-Limit": "5000",
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1),
              },
            },
          ),
        )
        .mockReturnValueOnce(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: {
            maxRetries: 1,
            baseDelayMs: 10, // Short delay for tests
            maxDelayMs: 100,
          },
        }),
      );

      const result = await adapter.fetchAvailableWork();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it("retries on network errors", async () => {
      const mockIssues = [createMockIssue()];

      // First call fails with network error, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error("Network connection failed"))
        .mockReturnValueOnce(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: {
            maxRetries: 1,
            baseDelayMs: 10,
          },
        }),
      );

      const result = await adapter.fetchAvailableWork();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it("retries on 5xx server errors", async () => {
      const mockIssues = [createMockIssue()];

      mockFetch
        .mockReturnValueOnce(
          mockFetchResponse({ message: "Internal Server Error" }, { status: 500 }),
        )
        .mockReturnValueOnce(mockFetchResponse(mockIssues));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: {
            maxRetries: 1,
            baseDelayMs: 10,
          },
        }),
      );

      const result = await adapter.fetchAvailableWork();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it("does not retry on 404 errors", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: { maxRetries: 3, baseDelayMs: 10 },
        }),
      );

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 401 unauthorized errors", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Bad credentials" }, { status: 401 }));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: { maxRetries: 3, baseDelayMs: 10 },
        }),
      );

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("gives up after max retries", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Server Error" }, { status: 500 }));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: {
            maxRetries: 2,
            baseDelayMs: 10,
          },
        }),
      );

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      // Initial attempt + 2 retries = 3 total calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("respects custom retry configuration", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Server Error" }, { status: 500 }));

      const adapter = new GitHubWorkSourceAdapter(
        createConfig({
          retry: {
            maxRetries: 5,
            baseDelayMs: 5,
          },
        }),
      );

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
      expect(mockFetch).toHaveBeenCalledTimes(6); // 1 + 5 retries
    });
  });

  // ===========================================================================
  // 404 Error Handling Tests
  // ===========================================================================

  describe("404 error handling", () => {
    it("handles 404 gracefully in getWork (returns undefined)", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.getWork("github-999");

      expect(result).toBeUndefined();
    });

    it("handles 404 gracefully in claimWork (returns not_found)", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.claimWork("github-999");

      expect(result.success).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("throws 404 in fetchAvailableWork (indicates config error)", async () => {
      mockFetch.mockReturnValue(mockFetchResponse({ message: "Not Found" }, { status: 404 }));

      const adapter = new GitHubWorkSourceAdapter(createConfig());

      await expect(adapter.fetchAvailableWork()).rejects.toThrow(GitHubAPIError);
    });
  });

  // ===========================================================================
  // PAT Validation Tests
  // ===========================================================================

  describe("validateToken", () => {
    it("validates token with required scopes", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse(
          { login: "testuser" },
          {
            headers: {
              "X-OAuth-Scopes": "repo, user",
              "X-RateLimit-Limit": "5000",
              "X-RateLimit-Remaining": "4999",
              "X-RateLimit-Reset": "1700000000",
            },
          },
        ),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      const result = await adapter.validateToken();

      expect(result.valid).toBe(true);
      expect(result.scopes).toContain("repo");
    });

    it("throws GitHubAuthError when required scopes are missing", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse(
          { login: "testuser" },
          {
            headers: {
              "X-OAuth-Scopes": "user, read:org",
              "X-RateLimit-Limit": "5000",
              "X-RateLimit-Remaining": "4999",
              "X-RateLimit-Reset": "1700000000",
            },
          },
        ),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());

      try {
        await adapter.validateToken();
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubAuthError);
        const authError = error as GitHubAuthError;
        expect(authError.missingScopes).toContain("repo");
        expect(authError.foundScopes).toContain("user");
      }
    });

    it("throws GitHubAuthError when token is missing", async () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      try {
        const adapter = new GitHubWorkSourceAdapter(createConfig({ token: undefined }));

        await expect(adapter.validateToken()).rejects.toThrow(GitHubAuthError);
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        }
      }
    });

    it("throws GitHubAuthError on 401 unauthorized", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse(
          { message: "Bad credentials" },
          {
            status: 401,
            headers: {
              "X-OAuth-Scopes": "",
            },
          },
        ),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());

      await expect(adapter.validateToken()).rejects.toThrow(GitHubAuthError);
    });

    it("updates rate limit info during validation", async () => {
      mockFetch.mockReturnValue(
        mockFetchResponse(
          { login: "testuser" },
          {
            headers: {
              "X-OAuth-Scopes": "repo",
              "X-RateLimit-Limit": "5000",
              "X-RateLimit-Remaining": "4500",
              "X-RateLimit-Reset": "1700000000",
            },
          },
        ),
      );

      const adapter = new GitHubWorkSourceAdapter(createConfig());
      await adapter.validateToken();

      expect(adapter.lastRateLimitInfo?.remaining).toBe(4500);
    });
  });

  // ===========================================================================
  // GitHubAPIError Enhanced Tests
  // ===========================================================================

  describe("GitHubAPIError enhanced features", () => {
    it("isRetryable returns true for rate limit errors", () => {
      const error = new GitHubAPIError("Rate limited", {
        statusCode: 403,
        isRateLimitError: true,
      });

      expect(error.isRetryable()).toBe(true);
    });

    it("isRetryable returns true for network errors (no status code)", () => {
      const error = new GitHubAPIError("Network error");

      expect(error.isRetryable()).toBe(true);
    });

    it("isRetryable returns true for 5xx errors", () => {
      const error500 = new GitHubAPIError("Server error", { statusCode: 500 });
      const error502 = new GitHubAPIError("Bad gateway", { statusCode: 502 });
      const error503 = new GitHubAPIError("Service unavailable", { statusCode: 503 });

      expect(error500.isRetryable()).toBe(true);
      expect(error502.isRetryable()).toBe(true);
      expect(error503.isRetryable()).toBe(true);
    });

    it("isRetryable returns false for 4xx errors (except rate limit)", () => {
      const error401 = new GitHubAPIError("Unauthorized", { statusCode: 401 });
      const error403 = new GitHubAPIError("Forbidden", {
        statusCode: 403,
        isRateLimitError: false,
      });
      const error404 = new GitHubAPIError("Not found", { statusCode: 404 });

      expect(error401.isRetryable()).toBe(false);
      expect(error403.isRetryable()).toBe(false);
      expect(error404.isRetryable()).toBe(false);
    });

    it("isNotFound returns true for 404 errors", () => {
      const error = new GitHubAPIError("Not found", { statusCode: 404 });

      expect(error.isNotFound()).toBe(true);
    });

    it("isPermissionDenied returns true for 403 without rate limit", () => {
      const error = new GitHubAPIError("Forbidden", { statusCode: 403, isRateLimitError: false });

      expect(error.isPermissionDenied()).toBe(true);
    });

    it("isPermissionDenied returns false for rate limit 403", () => {
      const error = new GitHubAPIError("Rate limited", { statusCode: 403, isRateLimitError: true });

      expect(error.isPermissionDenied()).toBe(false);
    });

    it("getTimeUntilReset returns time in ms", () => {
      const futureReset = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now
      const error = new GitHubAPIError("Rate limited", {
        statusCode: 403,
        isRateLimitError: true,
        rateLimitInfo: {
          limit: 5000,
          remaining: 0,
          reset: futureReset,
          resource: "core",
        },
      });

      const timeUntilReset = error.getTimeUntilReset();
      expect(timeUntilReset).toBeDefined();
      expect(timeUntilReset).toBeGreaterThan(50000); // Should be close to 60000
      expect(timeUntilReset).toBeLessThanOrEqual(60000);
    });

    it("rateLimitResetAt is set correctly", () => {
      const resetTimestamp = 1700000000;
      const error = new GitHubAPIError("Rate limited", {
        rateLimitInfo: {
          limit: 5000,
          remaining: 0,
          reset: resetTimestamp,
          resource: "core",
        },
      });

      expect(error.rateLimitResetAt).toEqual(new Date(resetTimestamp * 1000));
    });
  });

  // ===========================================================================
  // GitHubAuthError Tests
  // ===========================================================================

  describe("GitHubAuthError", () => {
    it("calculates missing scopes correctly", () => {
      const error = new GitHubAuthError("Missing scopes", {
        foundScopes: ["user", "read:org"],
        requiredScopes: ["repo", "user"],
      });

      expect(error.missingScopes).toEqual(["repo"]);
      expect(error.foundScopes).toEqual(["user", "read:org"]);
      expect(error.requiredScopes).toEqual(["repo", "user"]);
    });

    it("has correct name", () => {
      const error = new GitHubAuthError("Test", {
        foundScopes: [],
        requiredScopes: ["repo"],
      });

      expect(error.name).toBe("GitHubAuthError");
    });
  });

  // ===========================================================================
  // Utility Function Tests
  // ===========================================================================

  describe("extractRateLimitInfo", () => {
    it("extracts all rate limit headers", () => {
      const headers = new Headers({
        "X-RateLimit-Limit": "5000",
        "X-RateLimit-Remaining": "4999",
        "X-RateLimit-Reset": "1700000000",
        "X-RateLimit-Resource": "core",
      });

      const info = extractRateLimitInfo(headers);

      expect(info).toEqual({
        limit: 5000,
        remaining: 4999,
        reset: 1700000000,
        resource: "core",
      });
    });

    it("returns undefined when headers are missing", () => {
      const headers = new Headers();

      const info = extractRateLimitInfo(headers);

      expect(info).toBeUndefined();
    });

    it("defaults resource to core when not provided", () => {
      const headers = new Headers({
        "X-RateLimit-Limit": "5000",
        "X-RateLimit-Remaining": "4999",
        "X-RateLimit-Reset": "1700000000",
      });

      const info = extractRateLimitInfo(headers);

      expect(info?.resource).toBe("core");
    });
  });

  describe("isRateLimitResponse", () => {
    it("returns true for 403 with remaining=0", () => {
      const response = {
        status: 403,
        headers: {
          get: (name: string) => (name === "X-RateLimit-Remaining" ? "0" : null),
        },
      } as unknown as Response;

      expect(isRateLimitResponse(response)).toBe(true);
    });

    it("returns true for 429 status", () => {
      const response = {
        status: 429,
        headers: {
          get: () => null,
        },
      } as unknown as Response;

      expect(isRateLimitResponse(response)).toBe(true);
    });

    it("returns false for 403 with remaining > 0", () => {
      const response = {
        status: 403,
        headers: {
          get: (name: string) => (name === "X-RateLimit-Remaining" ? "100" : null),
        },
      } as unknown as Response;

      expect(isRateLimitResponse(response)).toBe(false);
    });

    it("returns false for non-403/429 status", () => {
      const response = {
        status: 404,
        headers: {
          get: () => null,
        },
      } as unknown as Response;

      expect(isRateLimitResponse(response)).toBe(false);
    });
  });

  describe("calculateBackoffDelay", () => {
    const options: Required<RetryOptions> = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitterFactor: 0,
    };

    it("calculates exponential backoff", () => {
      expect(calculateBackoffDelay(0, options)).toBe(1000);
      expect(calculateBackoffDelay(1, options)).toBe(2000);
      expect(calculateBackoffDelay(2, options)).toBe(4000);
      expect(calculateBackoffDelay(3, options)).toBe(8000);
    });

    it("respects max delay", () => {
      const smallMaxOptions = { ...options, maxDelayMs: 3000 };

      expect(calculateBackoffDelay(0, smallMaxOptions)).toBe(1000);
      expect(calculateBackoffDelay(1, smallMaxOptions)).toBe(2000);
      expect(calculateBackoffDelay(2, smallMaxOptions)).toBe(3000); // Capped
      expect(calculateBackoffDelay(3, smallMaxOptions)).toBe(3000); // Still capped
    });

    it("uses rate limit reset time when provided", () => {
      const resetMs = 5000;
      const delay = calculateBackoffDelay(0, options, resetMs);

      // Should be resetMs + 1000 buffer
      expect(delay).toBe(6000);
    });

    it("caps rate limit reset delay at maxDelayMs", () => {
      const resetMs = 60000; // 60 seconds
      const delay = calculateBackoffDelay(0, options, resetMs);

      expect(delay).toBe(30000); // maxDelayMs
    });

    it("adds jitter when jitterFactor > 0", () => {
      const jitterOptions = { ...options, jitterFactor: 0.1 };

      // Run multiple times to verify jitter adds variance
      const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(0, jitterOptions));

      // Base delay is 1000, with 10% jitter range is 1000-1100
      expect(Math.min(...delays)).toBeGreaterThanOrEqual(1000);
      expect(Math.max(...delays)).toBeLessThanOrEqual(1100);

      // Should have some variance (not all the same)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });
});
