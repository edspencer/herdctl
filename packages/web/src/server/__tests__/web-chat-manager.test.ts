/**
 * WebChatManager tests
 *
 * Tests the refactored WebChatManager which delegates read operations to
 * SessionDiscoveryService from @herdctl/core and uses SessionMetadataStore
 * for custom names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Mock Setup
// =============================================================================

// Store for mock instances - set before each test
const mockStore: {
  metadataStore: any;
  sessionManager: any;
} = {
  metadataStore: null,
  sessionManager: null,
};

// Mock @herdctl/core
vi.mock("@herdctl/core", async () => {
  const actual = await vi.importActual("@herdctl/core");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    SessionDiscoveryService: vi.fn(),
    // biome-ignore lint/complexity/useArrowFunction: must use regular function for constructor mock
    SessionMetadataStore: vi.fn().mockImplementation(function () {
      return mockStore.metadataStore;
    }),
  };
});

// Mock @herdctl/chat
vi.mock("@herdctl/chat", async () => {
  const actual = await vi.importActual("@herdctl/chat");
  return {
    ...actual,
    // biome-ignore lint/complexity/useArrowFunction: must use regular function for constructor mock
    ChatSessionManager: vi.fn().mockImplementation(function () {
      return mockStore.sessionManager;
    }),
    extractMessageContent: vi.fn((msg) => {
      // Simple implementation for testing
      const content = msg?.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" && typeof block.text === "string") {
            return block.text;
          }
        }
      }
      return null;
    }),
  };
});

import { ChatSessionManager } from "@herdctl/chat";
// Import after mocks are set up
import type { DirectoryGroup, DiscoveredSession } from "@herdctl/core";
import { WebChatManager } from "../chat/web-chat-manager.js";

// =============================================================================
// Mock Factories
// =============================================================================

function createMockFleetManager(agents: any[] = [createMockAgent()]) {
  return {
    getAgents: vi.fn(() => agents),
    getAgentInfoByName: vi.fn(async (name: string) => {
      const agent = agents.find((a) => a.qualifiedName === name || a.name === name);
      return agent ?? null;
    }),
    trigger: vi.fn(async (_agentName, _scheduleName, options) => {
      // Simulate calling onMessage for streaming
      if (options?.onMessage) {
        await options.onMessage({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello world" }] },
        });
      }
      return {
        jobId: "job-123",
        agentName: _agentName,
        scheduleName: null,
        startedAt: new Date().toISOString(),
        success: true,
        sessionId: "sdk-session-abc",
      };
    }),
  } as any;
}

function createMockAgent(overrides: Partial<any> = {}) {
  return {
    name: "test-agent",
    qualifiedName: "test-agent",
    working_directory: "/home/user/project",
    docker: { enabled: false },
    ...overrides,
  };
}

function createMockDiscoveredSession(
  overrides: Partial<DiscoveredSession> = {},
): DiscoveredSession {
  return {
    sessionId: "s1",
    workingDirectory: "/home/user/project",
    mtime: "2024-01-01T00:00:00Z",
    origin: "web",
    agentName: "test-agent",
    resumable: true,
    customName: undefined,
    autoName: undefined,
    preview: undefined,
    ...overrides,
  };
}

function createMockDiscoveryService() {
  return {
    getAgentSessions: vi.fn(async () => [createMockDiscoveredSession()]),
    getAllSessions: vi.fn(async () => [
      {
        workingDirectory: "/home/user/project",
        encodedPath: "-home-user-project",
        agentName: "test-agent",
        sessionCount: 1,
        sessions: [createMockDiscoveredSession()],
      },
    ]),
    getSessionMessages: vi.fn(async () => [
      { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
      { role: "assistant", content: "Hi there", timestamp: "2024-01-01T00:00:01Z" },
    ]),
    getSessionUsage: vi.fn(async () => ({
      inputTokens: 1000,
      turnCount: 5,
      hasData: true,
    })),
  } as any;
}

function createMockMetadataStore() {
  return {
    setCustomName: vi.fn(),
    getCustomName: vi.fn(),
    removeCustomName: vi.fn(),
  };
}

function createMockSessionManager() {
  return {
    setSession: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
  };
}

/**
 * Create a minimal WebConfig for testing
 * Uses `as any` because we only need to test the fields that WebChatManager uses
 */
function createMockWebConfig(overrides: { tool_results?: boolean } = {}) {
  return {
    tool_results: overrides.tool_results ?? true,
    // Other required fields from the schema (not used by WebChatManager)
    host: "localhost",
    enabled: true,
    port: 3232,
    session_expiry_hours: 24,
    open_browser: false,
    message_grouping: "separate" as const,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("WebChatManager", () => {
  let manager: WebChatManager;
  let mockFleetManager: ReturnType<typeof createMockFleetManager>;
  let mockDiscoveryService: ReturnType<typeof createMockDiscoveryService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mock instances that will be used by the mocked constructors
    mockStore.metadataStore = createMockMetadataStore();
    mockStore.sessionManager = createMockSessionManager();

    manager = new WebChatManager();
    mockFleetManager = createMockFleetManager();
    mockDiscoveryService = createMockDiscoveryService();
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe("initialization", () => {
    it("stores fleetManager, stateDir, config, and discoveryService", () => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );

      // Verify initialization occurred by checking we can call methods
      expect(() => manager.listSessions("test-agent")).not.toThrow();
    });

    it("creates ChatSessionManager per agent", () => {
      const agents = [
        createMockAgent({ qualifiedName: "agent-1" }),
        createMockAgent({ qualifiedName: "agent-2" }),
      ];
      const fleetManager = createMockFleetManager(agents);

      manager.initialize(fleetManager, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      // ChatSessionManager should be called twice, once per agent
      expect(ChatSessionManager).toHaveBeenCalledTimes(2);
      expect(ChatSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "web",
          agentName: "agent-1",
          stateDir: "/state/dir",
        }),
      );
      expect(ChatSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: "web",
          agentName: "agent-2",
          stateDir: "/state/dir",
        }),
      );
    });

    it("does not reinitialize if already initialized", () => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
      const callCount = (ChatSessionManager as any).mock.calls.length;

      // Call initialize again
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );

      // ChatSessionManager should not be called again
      expect(ChatSessionManager).toHaveBeenCalledTimes(callCount);
    });

    it("throws when calling methods before initialize()", async () => {
      const uninitializedManager = new WebChatManager();

      await expect(uninitializedManager.listSessions("test-agent")).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(uninitializedManager.listAllRecentSessions()).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(uninitializedManager.getAllSessionGroups()).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(uninitializedManager.getSessionMessages("agent", "session")).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(uninitializedManager.getSessionUsage("agent", "session")).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(uninitializedManager.renameSession("agent", "session", "name")).rejects.toThrow(
        "WebChatManager not initialized",
      );
      await expect(
        uninitializedManager.sendMessage("agent", null, "message", vi.fn()),
      ).rejects.toThrow("WebChatManager not initialized");
    });
  });

  // ===========================================================================
  // listSessions Tests
  // ===========================================================================

  describe("listSessions(agentName)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to discoveryService.getAgentSessions() with correct params", async () => {
      const sessions = await manager.listSessions("test-agent");

      expect(mockDiscoveryService.getAgentSessions).toHaveBeenCalledWith(
        "test-agent",
        "/home/user/project",
        false,
        { limit: undefined },
      );
      expect(sessions).toEqual([createMockDiscoveredSession()]);
    });

    it("resolves agent working directory from fleetManager.getAgents()", async () => {
      const customAgent = createMockAgent({
        qualifiedName: "custom-agent",
        working_directory: "/custom/path",
        docker: { enabled: true },
      });
      const fm = createMockFleetManager([customAgent]);
      const mgr = new WebChatManager();
      mgr.initialize(fm, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      await mgr.listSessions("custom-agent");

      expect(mockDiscoveryService.getAgentSessions).toHaveBeenCalledWith(
        "custom-agent",
        "/custom/path",
        true,
        { limit: undefined },
      );
    });

    it("returns the discovery service result directly", async () => {
      const expectedSessions = [
        createMockDiscoveredSession({ sessionId: "s1" }),
        createMockDiscoveredSession({ sessionId: "s2" }),
      ];
      mockDiscoveryService.getAgentSessions.mockResolvedValue(expectedSessions);

      const result = await manager.listSessions("test-agent");

      expect(result).toEqual(expectedSessions);
    });

    it("throws when agent is not found", async () => {
      await expect(manager.listSessions("nonexistent-agent")).rejects.toThrow(
        "Agent not found: nonexistent-agent",
      );
    });
  });

  // ===========================================================================
  // listAllRecentSessions Tests
  // ===========================================================================

  describe("listAllRecentSessions(limit)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to discoveryService.getAllSessions() with all agents", async () => {
      await manager.listAllRecentSessions();

      expect(mockDiscoveryService.getAllSessions).toHaveBeenCalledWith(
        [
          {
            name: "test-agent",
            workingDirectory: "/home/user/project",
            dockerEnabled: false,
          },
        ],
        { limit: 100 },
      );
    });

    it("flattens sessions from all groups", async () => {
      mockDiscoveryService.getAllSessions.mockResolvedValue([
        {
          workingDirectory: "/project1",
          sessions: [
            createMockDiscoveredSession({ sessionId: "s1", mtime: "2024-01-03T00:00:00Z" }),
          ],
        },
        {
          workingDirectory: "/project2",
          sessions: [
            createMockDiscoveredSession({ sessionId: "s2", mtime: "2024-01-02T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s3", mtime: "2024-01-01T00:00:00Z" }),
          ],
        },
      ]);

      const result = await manager.listAllRecentSessions();

      expect(result).toHaveLength(3);
    });

    it("sorts by mtime descending", async () => {
      mockDiscoveryService.getAllSessions.mockResolvedValue([
        {
          workingDirectory: "/project1",
          sessions: [
            createMockDiscoveredSession({ sessionId: "s3", mtime: "2024-01-01T00:00:00Z" }),
          ],
        },
        {
          workingDirectory: "/project2",
          sessions: [
            createMockDiscoveredSession({ sessionId: "s1", mtime: "2024-01-03T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s2", mtime: "2024-01-02T00:00:00Z" }),
          ],
        },
      ]);

      const result = await manager.listAllRecentSessions();

      expect(result[0].sessionId).toBe("s1");
      expect(result[1].sessionId).toBe("s2");
      expect(result[2].sessionId).toBe("s3");
    });

    it("respects limit parameter", async () => {
      mockDiscoveryService.getAllSessions.mockResolvedValue([
        {
          workingDirectory: "/project",
          sessions: [
            createMockDiscoveredSession({ sessionId: "s1", mtime: "2024-01-05T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s2", mtime: "2024-01-04T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s3", mtime: "2024-01-03T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s4", mtime: "2024-01-02T00:00:00Z" }),
            createMockDiscoveredSession({ sessionId: "s5", mtime: "2024-01-01T00:00:00Z" }),
          ],
        },
      ]);

      const result = await manager.listAllRecentSessions(2);

      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe("s1");
      expect(result[1].sessionId).toBe("s2");
    });

    it("uses default limit of 100", async () => {
      // Create 150 sessions
      const sessions = Array.from({ length: 150 }, (_, i) =>
        createMockDiscoveredSession({
          sessionId: `s${i}`,
          mtime: new Date(2024, 0, 150 - i).toISOString(),
        }),
      );
      mockDiscoveryService.getAllSessions.mockResolvedValue([
        { workingDirectory: "/project", sessions },
      ]);

      const result = await manager.listAllRecentSessions();

      expect(result).toHaveLength(100);
    });
  });

  // ===========================================================================
  // getAllSessionGroups Tests
  // ===========================================================================

  describe("getAllSessionGroups()", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to discoveryService.getAllSessions() with all agents", async () => {
      await manager.getAllSessionGroups();

      expect(mockDiscoveryService.getAllSessions).toHaveBeenCalledWith([
        {
          name: "test-agent",
          workingDirectory: "/home/user/project",
          dockerEnabled: false,
        },
      ]);
    });

    it("returns groups directly", async () => {
      const expectedGroups: DirectoryGroup[] = [
        {
          workingDirectory: "/project1",
          encodedPath: "-project1",
          agentName: "agent1",
          sessionCount: 2,
          sessions: [
            createMockDiscoveredSession({ sessionId: "s1" }),
            createMockDiscoveredSession({ sessionId: "s2" }),
          ],
        },
        {
          workingDirectory: "/project2",
          encodedPath: "-project2",
          agentName: "agent2",
          sessionCount: 1,
          sessions: [createMockDiscoveredSession({ sessionId: "s3" })],
        },
      ];
      mockDiscoveryService.getAllSessions.mockResolvedValue(expectedGroups);

      const result = await manager.getAllSessionGroups();

      expect(result).toEqual(expectedGroups);
    });
  });

  // ===========================================================================
  // getSessionMessages Tests
  // ===========================================================================

  describe("getSessionMessages(agentName, sessionId)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to discoveryService.getSessionMessages()", async () => {
      await manager.getSessionMessages("test-agent", "session-123");

      expect(mockDiscoveryService.getSessionMessages).toHaveBeenCalledWith(
        "/home/user/project",
        "session-123",
      );
    });

    it("transforms core ChatMessage to web ChatMessage", async () => {
      mockDiscoveryService.getSessionMessages.mockResolvedValue([
        { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
        {
          role: "assistant",
          content: "Hi there",
          timestamp: "2024-01-01T00:00:01Z",
        },
        {
          role: "tool",
          content: "Tool output",
          timestamp: "2024-01-01T00:00:02Z",
          toolCall: {
            toolName: "Bash",
            inputSummary: "ls -la",
            output: "file1\nfile2",
            isError: false,
            durationMs: 100,
          },
        },
      ]);

      const result = await manager.getSessionMessages("test-agent", "session-123");

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        role: "user",
        content: "Hello",
        timestamp: "2024-01-01T00:00:00Z",
      });
      expect(result[2].toolCall).toEqual({
        toolName: "Bash",
        inputSummary: "ls -la",
        output: "file1\nfile2",
        isError: false,
        durationMs: 100,
      });
    });
  });

  // ===========================================================================
  // getSessionUsage Tests
  // ===========================================================================

  describe("getSessionUsage(agentName, sessionId)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to discoveryService.getSessionUsage()", async () => {
      await manager.getSessionUsage("test-agent", "session-123");

      expect(mockDiscoveryService.getSessionUsage).toHaveBeenCalledWith(
        "/home/user/project",
        "session-123",
      );
    });

    it("maps core SessionUsage to web SessionUsage format", async () => {
      mockDiscoveryService.getSessionUsage.mockResolvedValue({
        inputTokens: 2500,
        turnCount: 10,
        hasData: true,
      });

      const result = await manager.getSessionUsage("test-agent", "session-123");

      expect(result).toEqual({
        inputTokens: 2500,
        turnCount: 10,
        hasData: true,
      });
    });

    it("handles sessions with no usage data", async () => {
      mockDiscoveryService.getSessionUsage.mockResolvedValue({
        inputTokens: 0,
        turnCount: 0,
        hasData: false,
      });

      const result = await manager.getSessionUsage("test-agent", "session-123");

      expect(result).toEqual({
        inputTokens: 0,
        turnCount: 0,
        hasData: false,
      });
    });
  });

  // ===========================================================================
  // renameSession Tests
  // ===========================================================================

  describe("renameSession(agentName, sessionId, name)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("delegates to metadataStore.setCustomName()", async () => {
      await manager.renameSession("test-agent", "session-123", "My Feature Work");

      expect(mockStore.metadataStore.setCustomName).toHaveBeenCalledWith(
        "test-agent",
        "session-123",
        "My Feature Work",
      );
    });

    it("handles empty name", async () => {
      await manager.renameSession("test-agent", "session-123", "");

      expect(mockStore.metadataStore.setCustomName).toHaveBeenCalledWith(
        "test-agent",
        "session-123",
        "",
      );
    });
  });

  // ===========================================================================
  // sendMessage Tests - New Chat
  // ===========================================================================

  describe("sendMessage - new chat (sessionId = null)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("calls fleetManager.trigger() with resume: null", async () => {
      const onChunk = vi.fn();

      await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(mockFleetManager.trigger).toHaveBeenCalledWith(
        "test-agent",
        undefined,
        expect.objectContaining({
          triggerType: "web",
          prompt: "Hello",
          resume: null,
        }),
      );
    });

    it("returns SDK session ID from result", async () => {
      const onChunk = vi.fn();

      const result = await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(result.sessionId).toBe("sdk-session-abc");
      expect(result.success).toBe(true);
      expect(result.jobId).toBe("job-123");
    });

    it("writes to ChatSessionManager for attribution", async () => {
      const onChunk = vi.fn();

      await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(mockStore.sessionManager.setSession).toHaveBeenCalledWith(
        "sdk-session-abc",
        "sdk-session-abc",
      );
    });
  });

  // ===========================================================================
  // sendMessage Tests - Resume
  // ===========================================================================

  describe("sendMessage - resume (sessionId provided)", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("calls fleetManager.trigger() with resume: sessionId", async () => {
      const onChunk = vi.fn();

      await manager.sendMessage("test-agent", "existing-session-id", "Continue", onChunk);

      expect(mockFleetManager.trigger).toHaveBeenCalledWith(
        "test-agent",
        undefined,
        expect.objectContaining({
          triggerType: "web",
          prompt: "Continue",
          resume: "existing-session-id",
        }),
      );
    });

    it("streams chunks via onChunk callback", async () => {
      const chunks: string[] = [];
      const onChunk = vi.fn((chunk: string) => {
        chunks.push(chunk);
      });

      await manager.sendMessage("test-agent", "session-id", "Hello", onChunk);

      expect(onChunk).toHaveBeenCalledWith("Hello world");
      expect(chunks).toContain("Hello world");
    });

    it("returns result with sessionId", async () => {
      const onChunk = vi.fn();

      const result = await manager.sendMessage(
        "test-agent",
        "existing-session-id",
        "Continue",
        onChunk,
      );

      expect(result.sessionId).toBe("sdk-session-abc");
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // sendMessage Tests - Streaming Callbacks
  // ===========================================================================

  describe("sendMessage - streaming callbacks", () => {
    beforeEach(() => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );
    });

    it("onChunk called for assistant text", async () => {
      const onChunk = vi.fn();

      mockFleetManager.trigger.mockImplementation(
        async (_agent: string, _schedule: string | undefined, options: any) => {
          if (options?.onMessage) {
            await options.onMessage({
              type: "assistant",
              message: { content: [{ type: "text", text: "First chunk" }] },
            });
            await options.onMessage({
              type: "assistant",
              message: { content: [{ type: "text", text: "Second chunk" }] },
            });
          }
          return {
            jobId: "job-123",
            success: true,
            sessionId: "sdk-session-abc",
          };
        },
      );

      await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, "First chunk");
      expect(onChunk).toHaveBeenNthCalledWith(2, "Second chunk");
    });

    it("onToolCall called for tool results (if enabled)", async () => {
      const onChunk = vi.fn();
      const onToolCall = vi.fn();

      mockFleetManager.trigger.mockImplementation(
        async (_agent: string, _schedule: string | undefined, options: any) => {
          if (options?.onMessage) {
            // First, send tool_use in assistant message
            await options.onMessage({
              type: "assistant",
              message: {
                content: [
                  { type: "text", text: "Let me check" },
                  { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
                ],
              },
            });
            // Then, send tool_result in user message
            await options.onMessage({
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "tool-1",
                    content: "file1\nfile2",
                    is_error: false,
                  },
                ],
              },
            });
          }
          return {
            jobId: "job-123",
            success: true,
            sessionId: "sdk-session-abc",
          };
        },
      );

      await manager.sendMessage("test-agent", null, "Hello", onChunk, onToolCall);

      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "Bash",
          output: "file1\nfile2",
          isError: false,
        }),
      );
    });

    it("onBoundary called between assistant turns", async () => {
      const onChunk = vi.fn();
      const onToolCall = vi.fn();
      const onBoundary = vi.fn();

      mockFleetManager.trigger.mockImplementation(
        async (_agent: string, _schedule: string | undefined, options: any) => {
          if (options?.onMessage) {
            // First assistant turn
            await options.onMessage({
              type: "assistant",
              message: { content: [{ type: "text", text: "First response" }] },
            });
            // Second assistant turn (after tool use, etc.)
            await options.onMessage({
              type: "assistant",
              message: { content: [{ type: "text", text: "Second response" }] },
            });
          }
          return {
            jobId: "job-123",
            success: true,
            sessionId: "sdk-session-abc",
          };
        },
      );

      await manager.sendMessage("test-agent", null, "Hello", onChunk, onToolCall, onBoundary);

      // onBoundary should be called before the second assistant message
      expect(onBoundary).toHaveBeenCalledTimes(1);
    });

    it("does not call onToolCall when tool_results disabled", async () => {
      // Re-initialize with tool_results disabled
      const mgr = new WebChatManager();
      mgr.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig({ tool_results: false }),
        mockDiscoveryService,
      );

      const onChunk = vi.fn();
      const onToolCall = vi.fn();

      mockFleetManager.trigger.mockImplementation(
        async (_agent: string, _schedule: string | undefined, options: any) => {
          if (options?.onMessage) {
            await options.onMessage({
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "tool-1",
                    content: "file1\nfile2",
                    is_error: false,
                  },
                ],
              },
            });
          }
          return {
            jobId: "job-123",
            success: true,
            sessionId: "sdk-session-abc",
          };
        },
      );

      await mgr.sendMessage("test-agent", null, "Hello", onChunk, onToolCall);

      // onToolCall should not be called when tool_results is false
      expect(onToolCall).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // sendMessage Tests - Error Handling
  // ===========================================================================

  describe("sendMessage - error handling", () => {
    it("returns error when FleetManager not available", async () => {
      // Create a manager and initialize it
      const mgr = new WebChatManager();
      mgr.initialize(mockFleetManager, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      // Manually set fleetManager to null to simulate unavailable state
      // This is a bit hacky but tests the error path
      (mgr as any).fleetManager = null;

      const onChunk = vi.fn();
      const result = await mgr.sendMessage("test-agent", null, "Hello", onChunk);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Fleet manager not available");
      expect(result.jobId).toBe("");
    });

    it("returns error when trigger fails", async () => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );

      mockFleetManager.trigger.mockRejectedValue(new Error("Connection timeout"));

      const onChunk = vi.fn();
      const result = await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection timeout");
      expect(result.jobId).toBe("");
    });

    it("returns error message from failed job result", async () => {
      manager.initialize(
        mockFleetManager,
        "/state/dir",
        createMockWebConfig(),
        mockDiscoveryService,
      );

      mockFleetManager.trigger.mockResolvedValue({
        jobId: "job-456",
        success: false,
        error: { message: "Agent busy" },
      });

      const onChunk = vi.fn();
      const result = await manager.sendMessage("test-agent", null, "Hello", onChunk);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Agent busy");
      expect(result.jobId).toBe("job-456");
    });
  });

  // ===========================================================================
  // Working Directory Resolution Tests
  // ===========================================================================

  describe("working directory resolution", () => {
    it("handles working_directory as string", async () => {
      const agent = createMockAgent({ working_directory: "/simple/path" });
      const fm = createMockFleetManager([agent]);
      const mgr = new WebChatManager();
      mgr.initialize(fm, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      await mgr.listSessions("test-agent");

      expect(mockDiscoveryService.getAgentSessions).toHaveBeenCalledWith(
        "test-agent",
        "/simple/path",
        false,
        { limit: undefined },
      );
    });

    it("handles working_directory as object with root", async () => {
      const agent = createMockAgent({ working_directory: { root: "/object/path" } });
      const fm = createMockFleetManager([agent]);
      const mgr = new WebChatManager();
      mgr.initialize(fm, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      await mgr.listSessions("test-agent");

      expect(mockDiscoveryService.getAgentSessions).toHaveBeenCalledWith(
        "test-agent",
        "/object/path",
        false,
        { limit: undefined },
      );
    });

    it("handles agents without working_directory in getAllSessionGroups", async () => {
      const agent = createMockAgent({ working_directory: undefined });
      const fm = createMockFleetManager([agent]);
      const mgr = new WebChatManager();
      mgr.initialize(fm, "/state/dir", createMockWebConfig(), mockDiscoveryService);

      await mgr.getAllSessionGroups();

      expect(mockDiscoveryService.getAllSessions).toHaveBeenCalledWith([
        expect.objectContaining({
          workingDirectory: "/tmp/unknown",
        }),
      ]);
    });
  });
});
