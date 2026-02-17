/**
 * Tests for SlackManager
 *
 * Tests the SlackManager class which manages a single Slack connector
 * shared across agents with chat.slack configured.
 *
 * Since @herdctl/slack is not a dependency of @herdctl/core, we mock the
 * dynamic import to test the full initialization and lifecycle paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { FleetManagerContext } from "../context.js";
import type {
  ResolvedConfig,
  ResolvedAgent,
  AgentChatSlack,
} from "../../config/index.js";

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createMockEmitter() {
  const emitter = new EventEmitter();
  vi.spyOn(emitter, "emit");
  return emitter;
}

function createMockContext(
  config: ResolvedConfig | null = null,
  emitter: EventEmitter = createMockEmitter()
): FleetManagerContext {
  return {
    getConfig: () => config,
    getStateDir: () => "/tmp/test-state",
    getStateDirInfo: () => null,
    getLogger: () => mockLogger,
    getScheduler: () => null,
    getStatus: () => "initialized",
    getInitializedAt: () => null,
    getStartedAt: () => null,
    getStoppedAt: () => null,
    getLastError: () => null,
    getCheckInterval: () => 1000,
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    getEmitter: () => emitter,
  };
}

function createSlackAgent(
  name: string,
  slackConfig: AgentChatSlack
): ResolvedAgent {
  return {
    name,
    model: "sonnet",
    runtime: "sdk",
    schedules: {},
    chat: { slack: slackConfig },
    configPath: "/test/herdctl.yaml",
  } as ResolvedAgent;
}

function createNonSlackAgent(name: string): ResolvedAgent {
  return {
    name,
    model: "sonnet",
    schedules: {},
    configPath: "/test/herdctl.yaml",
  } as ResolvedAgent;
}

const defaultSlackConfig: AgentChatSlack = {
  bot_token_env: "SLACK_BOT_TOKEN",
  app_token_env: "SLACK_APP_TOKEN",
  session_expiry_hours: 24,
  log_level: "standard",
  channels: [{ id: "C0123456789", mode: "mention", context_messages: 10 }],
};

function createConfigWithAgents(
  ...agents: ResolvedAgent[]
): ResolvedConfig {
  return {
    fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
    agents,
    configPath: "/test/herdctl.yaml",
    configDir: "/test",
  };
}

// ---------------------------------------------------------------------------
// Mock SlackConnector and SessionManager
// ---------------------------------------------------------------------------

function createMockConnector() {
  const connector = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  connector.connect = vi.fn().mockResolvedValue(undefined);
  connector.disconnect = vi.fn().mockResolvedValue(undefined);
  connector.isConnected = vi.fn().mockReturnValue(false);
  connector.getState = vi.fn().mockReturnValue({
    status: "disconnected",
    connectedAt: null,
    disconnectedAt: null,
    reconnectAttempts: 0,
    lastError: null,
    botUser: null,
    messageStats: { received: 0, sent: 0, ignored: 0 },
  });
  return connector;
}

function createMockSessionManager(agentName: string) {
  return {
    agentName,
    getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "session-1", isNew: true }),
    getSession: vi.fn().mockResolvedValue(null),
    setSession: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn().mockResolvedValue(true),
    cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
    getActiveSessionCount: vi.fn().mockResolvedValue(0),
  };
}

// ---------------------------------------------------------------------------
// Tests – No Mock (no mocked SlackConnector; tests basic init paths)
// ---------------------------------------------------------------------------

describe("SlackManager (no @herdctl/slack)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // We import fresh each time to avoid stale module state
  async function getSlackManager() {
    const mod = await import("../slack-manager.js");
    return mod.SlackManager;
  }

  describe("constructor", () => {
    it("creates instance with context", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext();
      const manager = new SlackManager(ctx);
      expect(manager).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("skips initialization when no config is available", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No config available, skipping Slack initialization"
      );
    });

    it("skips when @herdctl/slack is not installed (no slack agents)", async () => {
      const SlackManager = await getSlackManager();
      const config = createConfigWithAgents(
        createNonSlackAgent("agent1"),
        createNonSlackAgent("agent2")
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "@herdctl/slack not installed, skipping Slack connector"
      );
    });

    it("skips when @herdctl/slack is not installed (with slack agents)", async () => {
      const SlackManager = await getSlackManager();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "@herdctl/slack not installed, skipping Slack connector"
      );
    });

    it("allows retry when no config (initialized not set)", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.initialize();

      const calls = mockLogger.debug.mock.calls.filter(
        (c: string[]) =>
          c[0] === "No config available, skipping Slack initialization"
      );
      expect(calls.length).toBe(2);
    });
  });

  describe("start", () => {
    it("does nothing when no connector exists", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Slack connector to start"
      );
    });
  });

  describe("stop", () => {
    it("does nothing when no connector exists", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Slack connector to stop"
      );
    });
  });

  describe("hasAgent", () => {
    it("returns false when not initialized", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.hasAgent("test-agent")).toBe(false);
    });
  });

  describe("getState", () => {
    it("returns null when no connector", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getState()).toBeNull();
    });
  });

  describe("isConnected", () => {
    it("returns false when no connector", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.isConnected()).toBe(false);
    });
  });

  describe("getConnector", () => {
    it("returns null when no connector", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getConnector()).toBeNull();
    });
  });

  describe("getChannelAgentMap", () => {
    it("returns empty map when not initialized", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getChannelAgentMap().size).toBe(0);
    });
  });

  describe("splitResponse", () => {
    it("returns single chunk for short text", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const result = manager.splitResponse("Hello, world!");
      expect(result).toEqual(["Hello, world!"]);
    });

    it("splits long text at natural breaks", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      // Build a text larger than 4000 chars
      const line = "This is a test line that is moderately long. ";
      const longText = line.repeat(100); // ~4500 chars
      const chunks = manager.splitResponse(longText);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(4000);
      }
      // All content preserved
      expect(chunks.join("")).toBe(longText);
    });

    it("splits at double newlines when available", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const part1 = "A".repeat(3800);
      const part2 = "B".repeat(200);
      const longText = part1 + "\n\n" + part2;
      const chunks = manager.splitResponse(longText);

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(part1 + "\n\n");
    });

    it("splits at single newline when no double newline", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const part1 = "A".repeat(3900);
      const part2 = "B".repeat(200);
      const longText = part1 + "\n" + part2;
      const chunks = manager.splitResponse(longText);

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(part1 + "\n");
    });

    it("splits at space when no newline", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const part1 = "A".repeat(3950);
      const part2 = "B".repeat(200);
      const longText = part1 + " " + part2;
      const chunks = manager.splitResponse(longText);

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toBe(part1 + " ");
    });
  });

  describe("formatErrorMessage", () => {
    it("formats an error with !reset suggestion", async () => {
      const SlackManager = await getSlackManager();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const result = manager.formatErrorMessage(new Error("Something broke"));
      expect(result).toContain("Something broke");
      expect(result).toContain("!reset");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests – With Mocked @herdctl/slack (full initialization paths)
// ---------------------------------------------------------------------------

describe("SlackManager (mocked @herdctl/slack)", () => {
  let mockConnector: ReturnType<typeof createMockConnector>;
  let MockSlackConnector: ReturnType<typeof vi.fn>;
  let MockSessionManager: ReturnType<typeof vi.fn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };

    // Set required env vars
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot-token";
    process.env.SLACK_APP_TOKEN = "xapp-test-app-token";

    // Create mock implementations
    mockConnector = createMockConnector();

    // Must use function expressions (not arrows) so they work with `new`
    MockSlackConnector = vi.fn().mockImplementation(function () {
      return mockConnector;
    });
    MockSessionManager = vi.fn().mockImplementation(function (
      this: unknown,
      opts: { agentName: string }
    ) {
      return createMockSessionManager(opts.agentName);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  async function getSlackManagerWithMock() {
    // Mock the dynamic import. vi.resetModules() in beforeEach ensures
    // the import cache is cleared so our mock takes effect.
    vi.doMock("@herdctl/slack", () => ({
      SlackConnector: MockSlackConnector,
      SessionManager: MockSessionManager,
    }));

    // Force fresh import of the slack-manager module
    const mod = await import("../slack-manager.js");
    return mod.SlackManager;
  }

  describe("initialize", () => {
    it("creates connector when slack agents exist and tokens are set", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(MockSessionManager).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "agent1",
          stateDir: "/tmp/test-state",
          sessionExpiryHours: 24,
        })
      );
      expect(MockSlackConnector).toHaveBeenCalledWith(
        expect.objectContaining({
          botToken: "xoxb-test-bot-token",
          appToken: "xapp-test-app-token",
          stateDir: "/tmp/test-state",
        })
      );
      expect(manager.hasAgent("agent1")).toBe(true);
      expect(manager.getConnector()).toBe(mockConnector);
    });

    it("builds channel→agent routing map", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", {
          ...defaultSlackConfig,
          channels: [{ id: "C001", mode: "mention" as const, context_messages: 10 }, { id: "C002", mode: "mention" as const, context_messages: 10 }],
        }),
        createSlackAgent("agent2", {
          ...defaultSlackConfig,
          channels: [{ id: "C003", mode: "mention" as const, context_messages: 10 }],
        })
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      const channelMap = manager.getChannelAgentMap();
      expect(channelMap.get("C001")).toBe("agent1");
      expect(channelMap.get("C002")).toBe("agent1");
      expect(channelMap.get("C003")).toBe("agent2");
      expect(channelMap.size).toBe(3);
    });

    it("warns about overlapping channel mappings", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", {
          ...defaultSlackConfig,
          channels: [{ id: "C001", mode: "mention" as const, context_messages: 10 }],
        }),
        createSlackAgent("agent2", {
          ...defaultSlackConfig,
          channels: [{ id: "C001", mode: "mention" as const, context_messages: 10 }], // Same channel as agent1
        })
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Channel C001 is already mapped")
      );
      // Second agent wins
      expect(manager.getChannelAgentMap().get("C001")).toBe("agent2");
    });

    it("skips when no agents have Slack configured", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createNonSlackAgent("agent1")
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No agents with Slack configured"
      );
      expect(MockSlackConnector).not.toHaveBeenCalled();
    });

    it("warns and skips when bot token env var is missing", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Slack bot token not found")
      );
      expect(MockSlackConnector).not.toHaveBeenCalled();
    });

    it("warns and skips when app token env var is missing", async () => {
      delete process.env.SLACK_APP_TOKEN;

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Slack app token not found")
      );
      expect(MockSlackConnector).not.toHaveBeenCalled();
    });

    it("is idempotent after successful initialization", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.initialize();

      // Constructor only called once
      expect(MockSlackConnector).toHaveBeenCalledTimes(1);
    });

    it("is idempotent after no-agents path", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(createNonSlackAgent("agent1"));
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.initialize();

      const calls = mockLogger.debug.mock.calls.filter(
        (c: string[]) => c[0] === "No agents with Slack configured"
      );
      expect(calls.length).toBe(1);
    });

    it("logs info about successful initialization", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Slack manager initialized with 1 agent(s)")
      );
    });

    it("handles connector creation failure", async () => {
      MockSlackConnector.mockImplementation(() => {
        throw new Error("Failed to create Bolt app");
      });

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create Slack connector")
      );
      expect(manager.getConnector()).toBeNull();
    });

    it("creates multiple session managers for multiple agents", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", {
          ...defaultSlackConfig,
          channels: [{ id: "C001", mode: "mention" as const, context_messages: 10 }],
        }),
        createSlackAgent("agent2", {
          ...defaultSlackConfig,
          channels: [{ id: "C002", mode: "mention" as const, context_messages: 10 }],
        }),
        createNonSlackAgent("agent3")
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(MockSessionManager).toHaveBeenCalledTimes(2);
      expect(manager.hasAgent("agent1")).toBe(true);
      expect(manager.hasAgent("agent2")).toBe(true);
      expect(manager.hasAgent("agent3")).toBe(false);
    });
  });

  describe("start", () => {
    it("connects the connector and subscribes to events", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      expect(mockConnector.connect).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith("Slack connector started");
    });

    it("handles connection failure", async () => {
      mockConnector.connect.mockRejectedValue(new Error("Connection refused"));

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect Slack")
      );
    });

    it("logs debug message when no connector to start", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.start();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Slack connector to start"
      );
    });
  });

  describe("stop", () => {
    it("disconnects the connector", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockConnector.disconnect).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith("Slack connector stopped");
    });

    it("handles disconnect failure", async () => {
      mockConnector.disconnect.mockRejectedValue(
        new Error("Disconnect timeout")
      );

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error disconnecting Slack")
      );
    });

    it("logs active session counts before stopping", async () => {
      const mockSessionMgr = createMockSessionManager("agent1");
      mockSessionMgr.getActiveSessionCount.mockResolvedValue(3);
      MockSessionManager.mockImplementation(function () {
        return mockSessionMgr;
      });

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Preserving 3 active Slack session(s)")
      );
    });

    it("handles session count query failure gracefully", async () => {
      const mockSessionMgr = createMockSessionManager("agent1");
      mockSessionMgr.getActiveSessionCount.mockRejectedValue(
        new Error("File read error")
      );
      MockSessionManager.mockImplementation(function () {
        return mockSessionMgr;
      });

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to get Slack session count")
      );
    });
  });

  describe("isConnected", () => {
    it("delegates to connector.isConnected()", async () => {
      mockConnector.isConnected.mockReturnValue(true);

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(manager.isConnected()).toBe(true);
    });
  });

  describe("getState", () => {
    it("delegates to connector.getState()", async () => {
      const state = {
        status: "connected" as const,
        connectedAt: "2026-01-01T00:00:00Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "U123", username: "testbot" },
        messageStats: { received: 5, sent: 3, ignored: 1 },
      };
      mockConnector.getState.mockReturnValue(state);

      const SlackManager = await getSlackManagerWithMock();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(manager.getState()).toBe(state);
    });
  });

  describe("message handling (via connector events)", () => {
    it("emits slack:error event when connector error fires", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      // Simulate error from connector (no agentName — connector is shared)
      mockConnector.emit("error", {
        error: new Error("Socket closed"),
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack connector error for agent 'slack'")
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        "slack:error",
        expect.objectContaining({
          agentName: "slack",
          error: "Socket closed",
        })
      );
    });

    it("handles message for unknown agent", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      // Simulate message for an agent not in config
      mockConnector.emit("message", {
        agentName: "unknown-agent",
        prompt: "Hello there",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      // Give time for the async handler to run
      await new Promise((r) => setTimeout(r, 50));

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Agent 'unknown-agent' not found in configuration"
      );
      expect(replyFn).toHaveBeenCalledWith(
        expect.stringContaining("not properly configured")
      );
    });

    it("handles message with successful trigger", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      // Add a trigger method to the emitter (FleetManager exposes this)
      const triggerMock = vi.fn().mockResolvedValue({
        jobId: "job-123",
        success: true,
        sessionId: "session-abc",
      });
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);
      const stopIndicator = vi.fn();

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Help me with coding",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => stopIndicator,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(triggerMock).toHaveBeenCalledWith(
        "agent1",
        undefined,
        expect.objectContaining({
          prompt: "Help me with coding",
        })
      );
      expect(stopIndicator).toHaveBeenCalled();
      expect(emitter.emit).toHaveBeenCalledWith(
        "slack:message:handled",
        expect.objectContaining({
          agentName: "agent1",
          jobId: "job-123",
        })
      );
    });

    it("sends fallback when no messages streamed and job succeeds", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const triggerMock = vi.fn().mockResolvedValue({
        jobId: "job-123",
        success: true,
        sessionId: null,
      });
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Do something",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should send fallback message
      expect(replyFn).toHaveBeenCalledWith(
        expect.stringContaining("completed the task")
      );
    });

    it("sends error fallback when job fails and no messages streamed", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const triggerMock = vi.fn().mockResolvedValue({
        jobId: "job-123",
        success: false,
        error: new Error("API rate limit"),
        errorDetails: { message: "API rate limit exceeded" },
      });
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Do something",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(replyFn).toHaveBeenCalledWith(
        expect.stringContaining("API rate limit exceeded")
      );
    });

    it("handles trigger throw and sends error message", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const triggerMock = vi.fn().mockRejectedValue(new Error("Trigger failed"));
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Do something",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack message handling failed")
      );
      expect(replyFn).toHaveBeenCalledWith(
        expect.stringContaining("Trigger failed")
      );
      expect(emitter.emit).toHaveBeenCalledWith(
        "slack:message:error",
        expect.objectContaining({
          agentName: "agent1",
          error: "Trigger failed",
        })
      );
    });

    it("resumes existing session when one exists", async () => {
      const mockSessionMgr = createMockSessionManager("agent1");
      mockSessionMgr.getSession.mockResolvedValue({
        sessionId: "existing-session-456",
        lastMessageAt: "2026-02-15T10:00:00Z",
      });
      MockSessionManager.mockImplementation(function () {
        return mockSessionMgr;
      });

      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const triggerMock = vi.fn().mockResolvedValue({
        jobId: "job-123",
        success: true,
        sessionId: "new-session-789",
      });
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Continue our conversation",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: false,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should pass the existing session for resume
      expect(triggerMock).toHaveBeenCalledWith(
        "agent1",
        undefined,
        expect.objectContaining({
          resume: "existing-session-456",
        })
      );

      // Should store the new session
      expect(mockSessionMgr.setSession).toHaveBeenCalledWith(
        "C0123456789",
        "new-session-789"
      );
    });

    it("streams assistant messages via onMessage callback", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      let capturedOnMessage: ((msg: unknown) => Promise<void>) | null = null;
      const triggerMock = vi.fn().mockImplementation(
        async (_name: string, _schedule: unknown, opts: { onMessage?: (msg: unknown) => Promise<void> }) => {
          capturedOnMessage = opts?.onMessage ?? null;
          // Simulate streaming messages
          if (capturedOnMessage) {
            await capturedOnMessage({ type: "assistant", content: "Hello from agent!" });
          }
          return { jobId: "job-123", success: true, sessionId: "s1" };
        }
      );
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Say hello",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      // Should have sent the streamed message
      expect(replyFn).toHaveBeenCalledWith("Hello from agent!");
    });

    it("handles non-Error string in error handler", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      // Simulate non-Error (string) error from connector
      mockConnector.emit("error", {
        error: "string error",
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack connector error for agent 'slack': string error")
      );
    });

    it("handles reply failure during error handling gracefully", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const triggerMock = vi.fn().mockRejectedValue(new Error("Boom"));
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockRejectedValue(new Error("Reply failed too"));

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Do something",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should log both the original error and the reply failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Slack message handling failed")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send error reply")
      );
    });

    it("handles error from reply during agent-not-found", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockRejectedValue(new Error("Reply error"));

      mockConnector.emit("message", {
        agentName: "nonexistent",
        prompt: "Hello",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Agent 'nonexistent' not found")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send error reply")
      );
    });

    it("extracts text from message.message.content array", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      let capturedOnMessage: ((msg: unknown) => Promise<void>) | null = null;
      const triggerMock = vi.fn().mockImplementation(
        async (_name: string, _schedule: unknown, opts: { onMessage?: (msg: unknown) => Promise<void> }) => {
          capturedOnMessage = opts?.onMessage ?? null;
          if (capturedOnMessage) {
            // Simulate content array format
            await capturedOnMessage({
              type: "assistant",
              message: {
                content: [
                  { type: "text", text: "Part 1 " },
                  { type: "text", text: "Part 2" },
                ],
              },
            });
          }
          return { jobId: "job-123", success: true, sessionId: null };
        }
      );
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Test",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(replyFn).toHaveBeenCalledWith("Part 1 Part 2");
    });

    it("extracts text from message.message.content string", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      let capturedOnMessage: ((msg: unknown) => Promise<void>) | null = null;
      const triggerMock = vi.fn().mockImplementation(
        async (_name: string, _schedule: unknown, opts: { onMessage?: (msg: unknown) => Promise<void> }) => {
          capturedOnMessage = opts?.onMessage ?? null;
          if (capturedOnMessage) {
            await capturedOnMessage({
              type: "assistant",
              message: { content: "Direct string content" },
            });
          }
          return { jobId: "job-123", success: true, sessionId: null };
        }
      );
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Test",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(replyFn).toHaveBeenCalledWith("Direct string content");
    });

    it("ignores non-assistant messages in onMessage callback", async () => {
      const SlackManager = await getSlackManagerWithMock();
      const emitter = createMockEmitter();
      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );

      let capturedOnMessage: ((msg: unknown) => Promise<void>) | null = null;
      const triggerMock = vi.fn().mockImplementation(
        async (_name: string, _schedule: unknown, opts: { onMessage?: (msg: unknown) => Promise<void> }) => {
          capturedOnMessage = opts?.onMessage ?? null;
          if (capturedOnMessage) {
            await capturedOnMessage({ type: "system", content: "System msg" });
            await capturedOnMessage({ type: "assistant", content: "Real response" });
          }
          return { jobId: "job-123", success: true, sessionId: null };
        }
      );
      (emitter as unknown as Record<string, unknown>).trigger = triggerMock;

      const ctx = createMockContext(config, emitter);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      const replyFn = vi.fn().mockResolvedValue(undefined);

      mockConnector.emit("message", {
        agentName: "agent1",
        prompt: "Test",
        metadata: {
          channelId: "C0123456789",
          messageTs: "1707930001.000000",
          userId: "U0123456789",
          wasMentioned: true,
        },
        reply: replyFn,
        startProcessingIndicator: () => () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      // Should only send the assistant message, not the system one
      expect(replyFn).toHaveBeenCalledWith("Real response");
      expect(replyFn).not.toHaveBeenCalledWith("System msg");
    });
  });
});
