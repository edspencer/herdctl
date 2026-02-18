/**
 * Tests for SlackManager
 *
 * Tests the SlackManager class which manages Slack connectors for agents
 * with chat.slack configured (one connector per agent).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { FleetManagerContext, ResolvedAgent } from "@herdctl/core";
import type { AgentChatSlack } from "@herdctl/core";
import type { ResolvedConfig } from "@herdctl/core";
import { SlackManager } from "../manager.js";

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
    trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
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

function createMockConnector(agentName: string, sessionManager: ReturnType<typeof createMockSessionManager>) {
  const connector = new EventEmitter() as EventEmitter & {
    agentName: string;
    sessionManager: ReturnType<typeof createMockSessionManager>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    uploadFile: ReturnType<typeof vi.fn>;
  };
  connector.agentName = agentName;
  connector.sessionManager = sessionManager;
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
  connector.uploadFile = vi.fn().mockResolvedValue({ fileId: "file-123" });
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
// Tests – Basic initialization paths (without mocking SlackConnector)
// ---------------------------------------------------------------------------

describe("SlackManager basic tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates instance with context", () => {
      const ctx = createMockContext();
      const manager = new SlackManager(ctx);
      expect(manager).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("skips initialization when no config is available", async () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No config available, skipping Slack initialization"
      );
    });

    it("skips when no agents have Slack configured", async () => {
      const config = createConfigWithAgents(
        createNonSlackAgent("agent1"),
        createNonSlackAgent("agent2")
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No agents with Slack configured"
      );
    });

    it("allows retry when no config (initialized not set)", async () => {
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
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.start();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Slack connectors to start"
      );
    });
  });

  describe("stop", () => {
    it("does nothing when no connector exists", async () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Slack connectors to stop"
      );
    });
  });

  describe("hasAgent", () => {
    it("returns false when not initialized", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.hasAgent("test-agent")).toBe(false);
    });
  });

  describe("getState", () => {
    it("returns undefined when no connector for agent", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getState("test-agent")).toBeUndefined();
    });
  });

  describe("getConnectedCount", () => {
    it("returns 0 when no connectors", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getConnectedCount()).toBe(0);
    });
  });

  describe("getConnector", () => {
    it("returns undefined when no connector for agent", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getConnector("test-agent")).toBeUndefined();
    });
  });

  describe("getConnectorNames", () => {
    it("returns empty array when not initialized", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      expect(manager.getConnectorNames()).toEqual([]);
    });
  });

  describe("splitResponse", () => {
    it("returns single chunk for short text", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const result = manager.splitResponse("Hello, world!");
      expect(result).toEqual(["Hello, world!"]);
    });

    it("splits long text at natural breaks", () => {
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
      // Most content preserved (may lose some whitespace at split points)
      expect(chunks.join("").length).toBeGreaterThan(longText.length * 0.95);
    });
  });

  describe("formatErrorMessage", () => {
    it("formats an error with !reset suggestion", () => {
      const ctx = createMockContext(null);
      const manager = new SlackManager(ctx);

      const result = manager.formatErrorMessage(new Error("Something broke"));
      expect(result).toContain("Something broke");
      expect(result).toContain("!reset");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests – With Mocked SlackConnector (full initialization paths)
// ---------------------------------------------------------------------------

describe("SlackManager with mocked connector", () => {
  let mockConnectors: Map<string, ReturnType<typeof createMockConnector>>;
  let mockSessionManagers: Map<string, ReturnType<typeof createMockSessionManager>>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    originalEnv = { ...process.env };

    // Set required env vars
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot-token";
    process.env.SLACK_APP_TOKEN = "xapp-test-app-token";

    // Create mock implementations - per-agent connectors
    mockConnectors = new Map();
    mockSessionManagers = new Map();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  // Note: Since SlackManager is now in the same package as SlackConnector,
  // full integration testing with mocked imports is more complex.
  // These tests cover the public API and some key behaviors.

  describe("initialize with missing tokens", () => {
    it("warns and skips agent when bot token env var is missing", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Slack bot token not found")
      );
    });

    it("warns and skips agent when app token env var is missing", async () => {
      delete process.env.SLACK_APP_TOKEN;

      const config = createConfigWithAgents(
        createSlackAgent("agent1", defaultSlackConfig)
      );
      const ctx = createMockContext(config);
      const manager = new SlackManager(ctx);

      await manager.initialize();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Slack app token not found")
      );
    });
  });
});
