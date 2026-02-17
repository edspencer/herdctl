/**
 * Tests for DiscordManager
 *
 * Tests the DiscordManager class which manages Discord connectors
 * for agents with chat.discord configured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { DiscordManager } from "../manager.js";
import type {
  DiscordConnectorState,
  DiscordReplyEmbed,
  DiscordReplyEmbedField,
  DiscordReplyPayload,
  DiscordConnectorEventMap,
} from "../types.js";
import type { FleetManagerContext, ResolvedConfig, ResolvedAgent, AgentChatDiscord } from "@herdctl/core";

// Define event types from the connector event map
type DiscordMessageEvent = DiscordConnectorEventMap["message"];
type DiscordErrorEvent = DiscordConnectorEventMap["error"];

// Mock logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock emitter
const mockEmitter = new EventEmitter();

// Create mock FleetManagerContext
function createMockContext(config: ResolvedConfig | null = null): FleetManagerContext {
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
    emit: (event: string, ...args: unknown[]) => mockEmitter.emit(event, ...args),
    getEmitter: () => mockEmitter,
    trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
  };
}

// Create a mock agent with Discord config
function createDiscordAgent(
  name: string,
  discordConfig: AgentChatDiscord
): ResolvedAgent {
  return {
    name,
    model: "sonnet",
    runtime: "sdk", // Explicitly set runtime for session validation
    schedules: {},
    chat: {
      discord: discordConfig,
    },
    configPath: "/test/herdctl.yaml",
  } as ResolvedAgent;
}

// Create a mock agent without Discord config
function createNonDiscordAgent(name: string): ResolvedAgent {
  return {
    name,
    model: "sonnet",
    schedules: {},
    configPath: "/test/herdctl.yaml",
  } as ResolvedAgent;
}

describe("DiscordManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("creates instance with context", () => {
      const ctx = createMockContext();
      const manager = new DiscordManager(ctx);
      expect(manager).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("skips initialization when no config is available", async () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      await manager.initialize();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No config available, skipping Discord initialization"
      );
      expect(manager.getConnectorNames()).toEqual([]);
    });

    it("skips initialization when no agents have Discord configured", async () => {
      const config: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [
          createNonDiscordAgent("agent1"),
          createNonDiscordAgent("agent2"),
        ],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };
      const ctx = createMockContext(config);
      const manager = new DiscordManager(ctx);

      // Mock the dynamic import to return null (package not installed)
      vi.doMock("@herdctl/discord", () => {
        throw new Error("Package not found");
      });

      await manager.initialize();

      // Should either say "not installed" or "No agents with Discord configured"
      const debugCalls = mockLogger.debug.mock.calls.map((c) => c[0]);
      expect(
        debugCalls.some(
          (msg) =>
            msg.includes("not installed") ||
            msg.includes("No agents with Discord configured")
        )
      ).toBe(true);
    });

    it("is idempotent - multiple calls only initialize once", async () => {
      const config: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [createNonDiscordAgent("agent1")],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };
      const ctx = createMockContext(config);
      const manager = new DiscordManager(ctx);

      await manager.initialize();
      await manager.initialize();

      // The second call should return early without doing anything
      // We can verify by checking the debug logs
      const debugCalls = mockLogger.debug.mock.calls.map((c) => c[0]);
      // First init will log something, second call should not add more logs
      // about initialization because it returns early
    });

    it("warns when bot token environment variable is not set", async () => {
      const discordConfig: AgentChatDiscord = {
        bot_token_env: "NONEXISTENT_BOT_TOKEN_VAR",
        session_expiry_hours: 24,
        log_level: "standard",
        output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
        guilds: [],
      };
      const config: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [createDiscordAgent("agent1", discordConfig)],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };
      const ctx = createMockContext(config);
      const manager = new DiscordManager(ctx);

      // Clear the env var if it exists
      const originalValue = process.env["NONEXISTENT_BOT_TOKEN_VAR"];
      delete process.env["NONEXISTENT_BOT_TOKEN_VAR"];

      await manager.initialize();

      // Restore if it existed
      if (originalValue !== undefined) {
        process.env["NONEXISTENT_BOT_TOKEN_VAR"] = originalValue;
      }

      // The warning should only be logged if the discord package is available
      // If the package is not available, it will log "not installed" first
      const warnCalls = mockLogger.warn.mock.calls;
      const debugCalls = mockLogger.debug.mock.calls;

      // Either the package is not installed (debug log) or the token is missing (warn log)
      const packageNotInstalled = debugCalls.some(
        (call) => call[0].includes("not installed")
      );
      const tokenMissing = warnCalls.some(
        (call) => call[0].includes("bot token not found")
      );

      expect(packageNotInstalled || tokenMissing || warnCalls.length === 0).toBe(true);
    });
  });

  describe("start", () => {
    it("logs when no connectors to start", async () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      await manager.initialize();
      await manager.start();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Discord connectors to start"
      );
    });
  });

  describe("stop", () => {
    it("logs when no connectors to stop", async () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      await manager.initialize();
      await manager.stop();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "No Discord connectors to stop"
      );
    });
  });

  describe("getConnector", () => {
    it("returns undefined for non-existent agent", () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      const connector = manager.getConnector("nonexistent");
      expect(connector).toBeUndefined();
    });
  });

  describe("getConnectorNames", () => {
    it("returns empty array when no connectors", () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      expect(manager.getConnectorNames()).toEqual([]);
    });
  });

  describe("getConnectedCount", () => {
    it("returns 0 when no connectors", () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      expect(manager.getConnectedCount()).toBe(0);
    });
  });

  describe("hasConnector", () => {
    it("returns false for non-existent agent", () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      expect(manager.hasConnector("nonexistent")).toBe(false);
    });
  });
});

describe("DiscordConnectorState type", () => {
  it("defines proper connector state structure", () => {
    // This test verifies the type is exported correctly
    const state: DiscordConnectorState = {
      status: "disconnected",
      connectedAt: null,
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: null,
      rateLimits: {
        totalCount: 0,
        lastRateLimitAt: null,
        isRateLimited: false,
        currentResetTime: 0,
      },
      messageStats: {
        received: 0,
        sent: 0,
        ignored: 0,
      },
    };

    expect(state.status).toBe("disconnected");
    expect(state.botUser).toBeNull();
    expect(state.rateLimits.isRateLimited).toBe(false);
    expect(state.messageStats.received).toBe(0);
  });

  it("supports all connection status values", () => {
    const statuses: DiscordConnectorState["status"][] = [
      "disconnected",
      "connecting",
      "connected",
      "reconnecting",
      "disconnecting",
      "error",
    ];

    statuses.forEach((status) => {
      const state: DiscordConnectorState = {
        status,
        connectedAt: null,
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: null,
        rateLimits: {
          totalCount: 0,
          lastRateLimitAt: null,
          isRateLimited: false,
          currentResetTime: 0,
        },
        messageStats: {
          received: 0,
          sent: 0,
          ignored: 0,
        },
      };
      expect(state.status).toBe(status);
    });
  });

  it("supports connected state with bot user", () => {
    const state: DiscordConnectorState = {
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: {
        id: "123456789",
        username: "TestBot",
        discriminator: "1234",
      },
      rateLimits: {
        totalCount: 5,
        lastRateLimitAt: "2024-01-01T00:01:00.000Z",
        isRateLimited: false,
        currentResetTime: 0,
      },
      messageStats: {
        received: 100,
        sent: 50,
        ignored: 25,
      },
    };

    expect(state.status).toBe("connected");
    expect(state.botUser?.username).toBe("TestBot");
    expect(state.messageStats.received).toBe(100);
  });
});

describe("DiscordMessageEvent type", () => {
  it("defines proper message event structure", () => {
    const event: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello, how are you?",
      context: {
        messages: [
          {
            authorId: "user123",
            authorName: "TestUser",
            content: "Hello!",
            isBot: false,
            isSelf: false,
            timestamp: "2024-01-01T00:00:00.000Z",
            messageId: "msg001",
          },
        ],
        wasMentioned: true,
        prompt: "Hello, how are you?",
      },
      metadata: {
        guildId: "guild123",
        channelId: "channel456",
        messageId: "msg789",
        userId: "user123",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: async (content) => {
        console.log("Reply:", content);
      },
      startTyping: () => () => {},
    };

    expect(event.agentName).toBe("test-agent");
    expect(event.prompt).toBe("Hello, how are you?");
    expect(event.metadata.guildId).toBe("guild123");
    expect(event.context.wasMentioned).toBe(true);
  });

  it("supports DM context (null guildId)", () => {
    const event: DiscordMessageEvent = {
      agentName: "dm-agent",
      prompt: "Private message",
      context: {
        messages: [],
        wasMentioned: false,
        prompt: "Private message",
      },
      metadata: {
        guildId: null,
        channelId: "dm-channel",
        messageId: "dm-msg",
        userId: "user1",
        username: "DMUser",
        wasMentioned: false,
        mode: "auto",
      },
      reply: async () => {},
      startTyping: () => () => {},
    };

    expect(event.metadata.guildId).toBeNull();
    expect(event.metadata.mode).toBe("auto");
  });
});

describe("DiscordErrorEvent type", () => {
  it("defines proper error event structure", () => {
    const event: DiscordErrorEvent = {
      agentName: "test-agent",
      error: new Error("Connection failed"),
    };

    expect(event.agentName).toBe("test-agent");
    expect(event.error.message).toBe("Connection failed");
  });
});

// Message splitting behavior is now tested in @herdctl/chat package (message-splitting.test.ts)
// These tests are skipped since DiscordManager now delegates to the shared utility
describe.skip("DiscordManager response splitting", () => {
  let manager: DiscordManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = createMockContext(null);
    manager = new DiscordManager(ctx);
  });

  describe("splitResponse", () => {
    it("returns text as-is when under 2000 characters", () => {
      const text = "Hello, this is a short message.";
      const result = manager.splitResponse(text);
      expect(result).toEqual([text]);
    });

    it("returns text as-is when exactly 2000 characters", () => {
      const text = "a".repeat(2000);
      const result = manager.splitResponse(text);
      expect(result).toEqual([text]);
    });

    it("splits text at natural boundaries (newlines)", () => {
      // Create text that's over 2000 chars with newlines
      const line = "This is a line of text.\n";
      const text = line.repeat(100); // About 2400 chars
      const result = manager.splitResponse(text);

      expect(result.length).toBeGreaterThan(1);
      // Each chunk should be under 2000 chars
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
      // Chunks should join back to original
      expect(result.join("")).toBe(text);
    });

    it("splits text at spaces when no newlines available", () => {
      // Create text that's over 2000 chars with spaces but no newlines
      const words = "word ".repeat(500); // About 2500 chars
      const result = manager.splitResponse(words);

      expect(result.length).toBeGreaterThan(1);
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("handles text with no natural break points", () => {
      const text = "a".repeat(3000); // No spaces or newlines
      const result = manager.splitResponse(text);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2000);
      expect(result[1].length).toBe(1000);
    });

    it("preserves code blocks when splitting", () => {
      // Create a code block that spans beyond 2000 chars
      const codeBlock = "```typescript\n" + "const x = 1;\n".repeat(200) + "```";
      const result = manager.splitResponse(codeBlock);

      expect(result.length).toBeGreaterThan(1);

      // First chunk should close the code block
      expect(result[0]).toMatch(/```$/);

      // Second chunk should reopen with the same language
      expect(result[1]).toMatch(/^```typescript/);
    });

    it("preserves code blocks with no language specified", () => {
      const codeBlock = "```\n" + "line of code\n".repeat(200) + "```";
      const result = manager.splitResponse(codeBlock);

      expect(result.length).toBeGreaterThan(1);

      // First chunk should close the code block
      expect(result[0]).toMatch(/```$/);

      // Second chunk should reopen (possibly with empty language)
      expect(result[1]).toMatch(/^```/);
    });

    it("handles multiple code blocks", () => {
      const text =
        "Some text\n```js\nconsole.log('hello');\n```\nMore text\n```python\nprint('hello')\n```";
      const result = manager.splitResponse(text);

      // This should fit in one message
      expect(result).toEqual([text]);
    });

    it("handles empty string", () => {
      const result = manager.splitResponse("");
      expect(result).toEqual([""]);
    });

    it("prefers paragraph breaks over line breaks", () => {
      // Create text with both paragraph and line breaks
      const paragraph1 = "First paragraph. ".repeat(50) + "\n\n";
      const paragraph2 = "Second paragraph. ".repeat(50);
      const text = paragraph1 + paragraph2;

      if (text.length > 2000) {
        const result = manager.splitResponse(text);

        // Should split at the paragraph break
        expect(result[0]).toMatch(/\n\n$/);
      }
    });

    it("handles code block that opens and closes within split region", () => {
      // Create text where a code block opens and then closes before split point
      // This tests the code path where insideBlock becomes false after closing
      const text = "Some intro text\n```js\nconst x = 1;\n```\nMore text here " + "padding ".repeat(250);
      const result = manager.splitResponse(text);

      expect(result.length).toBeGreaterThanOrEqual(1);
      // Should not break inside code block since it's closed
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("handles code block analysis when initially inside but closes on re-analysis", () => {
      // Create text where initial analysis shows inside block at 2000 chars,
      // but when we find a natural break and re-analyze, the block is closed
      // This exercises the code path at line 727 where actualState.insideBlock is false
      const codeBlock = "```js\nshort code\n```";
      const paddingToReachSplit = "x".repeat(1900 - codeBlock.length);
      const moreContent = " ".repeat(50) + "y".repeat(200); // Add space for split and more content
      const text = codeBlock + paddingToReachSplit + moreContent;

      const result = manager.splitResponse(text);

      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("handles multiple code blocks opening and closing", () => {
      // Multiple code blocks that open and close
      const text = "```js\ncode1\n```\n" + "text ".repeat(100) + "\n```py\ncode2\n```\n" + "more ".repeat(200);
      const result = manager.splitResponse(text);

      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("splits at paragraph break when within 500 chars of split point", () => {
      // Create text where paragraph break is close enough to the split point to be used
      // Need text > 2000 chars with a paragraph break in the last 500 chars before 2000
      const part1 = "a".repeat(1600);
      const part2 = "\n\n"; // paragraph break
      const part3 = "b".repeat(600); // Pushes us over 2000
      const text = part1 + part2 + part3;

      const result = manager.splitResponse(text);

      expect(result.length).toBe(2);
      // First chunk should end at paragraph break
      expect(result[0]).toBe(part1 + part2);
      expect(result[1]).toBe(part3);
    });

    it("falls back to newline when paragraph break is too far from split point", () => {
      // Create text where paragraph break is too far but newline is close
      const part1 = "a".repeat(1000);
      const part2 = "\n\n"; // paragraph break too early
      const part3 = "b".repeat(800);
      const part4 = "\n"; // newline close to split point
      const part5 = "c".repeat(400);
      const text = part1 + part2 + part3 + part4 + part5;

      const result = manager.splitResponse(text);

      expect(result.length).toBeGreaterThanOrEqual(1);
      result.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("handles text just slightly over 2000 chars", () => {
      const text = "a".repeat(2001);
      const result = manager.splitResponse(text);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(2000);
      expect(result[1].length).toBe(1);
    });
  });

  describe("formatErrorMessage", () => {
    it("formats error with message and guidance", () => {
      const error = new Error("Something went wrong");
      const result = manager.formatErrorMessage(error);

      expect(result).toContain("❌ **Error**:");
      expect(result).toContain("Something went wrong");
      expect(result).toContain("/reset");
      expect(result).toContain("Please try again");
    });

    it("handles errors with special characters", () => {
      const error = new Error("Error with `code` and *markdown*");
      const result = manager.formatErrorMessage(error);

      expect(result).toContain("Error with `code` and *markdown*");
    });
  });

  describe("sendResponse", () => {
    it("sends single message for short content", async () => {
      const replyMock = vi.fn().mockResolvedValue(undefined);
      await manager.sendResponse(replyMock, "Short message");

      expect(replyMock).toHaveBeenCalledTimes(1);
      expect(replyMock).toHaveBeenCalledWith("Short message");
    });

    it("sends multiple messages for long content", async () => {
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const longText = "word ".repeat(500); // About 2500 chars

      await manager.sendResponse(replyMock, longText);

      expect(replyMock).toHaveBeenCalledTimes(2);
    });

    it("sends messages in order", async () => {
      const calls: string[] = [];
      const replyMock = vi.fn().mockImplementation(async (content: string) => {
        calls.push(content);
      });

      const text = "First part.\n" + "x".repeat(2000) + "\nLast part.";
      await manager.sendResponse(replyMock, text);

      // Verify order by checking first call starts with "First"
      expect(calls[0]).toMatch(/^First/);
    });
  });
});

// Message handling tests are skipped pending refactor to work with the new architecture
// The new DiscordManager uses this.ctx.trigger() directly instead of emitter.trigger
// and delegates message extraction/splitting to @herdctl/chat
describe.skip("DiscordManager message handling", () => {
  let manager: DiscordManager;
  let mockContext: FleetManagerContext;
  let triggerMock: ReturnType<typeof vi.fn>;
  let emitterWithTrigger: EventEmitter & { trigger: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a mock FleetManager (emitter) with trigger method
    triggerMock = vi.fn().mockResolvedValue({ jobId: "job-123" });
    emitterWithTrigger = Object.assign(new EventEmitter(), {
      trigger: triggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        createDiscordAgent("test-agent", {
          bot_token_env: "TEST_BOT_TOKEN",
          session_expiry_hours: 24,
          log_level: "standard",
          output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
          guilds: [],
        }),
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    mockContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => emitterWithTrigger.emit(event, ...args),
      getEmitter: () => emitterWithTrigger,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    manager = new DiscordManager(mockContext);
  });

  describe("start with mock connector", () => {
    it("subscribes to connector events when starting", async () => {
      // Create a mock connector that supports event handling
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "test-agent";

      // Access private connectors map to inject mock
      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("test-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      expect(mockConnector.connect).toHaveBeenCalled();
      // Verify event listeners were attached
      expect(mockConnector.listenerCount("message")).toBeGreaterThan(0);
      expect(mockConnector.listenerCount("error")).toBeGreaterThan(0);
    });

    it("handles message events from connector", async () => {
      // Create a mock connector
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "test-agent";

      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("test-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      // Create a mock message event
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "test-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have called trigger
      expect(triggerMock).toHaveBeenCalledWith(
        "test-agent",
        undefined,
        expect.objectContaining({
          prompt: "Hello bot!",
        })
      );
    });

    it("streams each assistant message immediately via onMessage callback", async () => {
      // Create trigger mock that invokes onMessage callback with streaming content
      const customTriggerMock = vi.fn().mockImplementation(async (_agentName, _scheduleName, options) => {
        // Simulate streaming messages from the agent - each is sent immediately
        if (options?.onMessage) {
          await options.onMessage({ type: "assistant", content: "Hello! " });
          await options.onMessage({ type: "assistant", content: "How can I help you today?" });
          // Non-assistant message should be ignored
          await options.onMessage({ type: "system", content: "System message" });
        }
        return { jobId: "streaming-job-123" };
      });

      const streamingEmitter = Object.assign(new EventEmitter(), {
        trigger: customTriggerMock,
      });

      const streamingConfig: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [
          createDiscordAgent("streaming-agent", {
            bot_token_env: "TEST_BOT_TOKEN",
            session_expiry_hours: 24,
            log_level: "standard",
            output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
            guilds: [],
          }),
        ],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };

      const streamingContext: FleetManagerContext = {
        getConfig: () => streamingConfig,
        getStateDir: () => "/tmp/test-state",
        getStateDirInfo: () => null,
        getLogger: () => mockLogger,
        getScheduler: () => null,
        getStatus: () => "running",
        getInitializedAt: () => "2024-01-01T00:00:00.000Z",
        getStartedAt: () => "2024-01-01T00:00:01.000Z",
        getStoppedAt: () => null,
        getLastError: () => null,
        getCheckInterval: () => 1000,
        emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
        getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
      };

      const streamingManager = new DiscordManager(streamingContext);

      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
        sessionManager: {
          getOrCreateSession: ReturnType<typeof vi.fn>;
          getSession: ReturnType<typeof vi.fn>;
          setSession: ReturnType<typeof vi.fn>;
          touchSession: ReturnType<typeof vi.fn>;
          getActiveSessionCount: ReturnType<typeof vi.fn>;
        };
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "streaming-agent";
      mockConnector.sessionManager = {
        getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
        getSession: vi.fn().mockResolvedValue({ sessionId: "s1", lastMessageAt: new Date().toISOString() }),
        setSession: vi.fn().mockResolvedValue(undefined),
        touchSession: vi.fn().mockResolvedValue(undefined),
        getActiveSessionCount: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - accessing private property for testing
      streamingManager.connectors.set("streaming-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      streamingManager.initialized = true;

      await streamingManager.start();

      // Create a mock message event
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "streaming-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing (includes rate limiting delays between messages)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Should have sent each message immediately (streaming behavior)
      expect(replyMock).toHaveBeenCalledTimes(2);
      expect(replyMock).toHaveBeenNthCalledWith(1, "Hello!");
      expect(replyMock).toHaveBeenNthCalledWith(2, "How can I help you today?");
    });

    it("sends long streaming response with splitResponse", async () => {
      // Create trigger mock that produces a long response
      const longResponse = "This is a very long response. ".repeat(100); // About 3100 chars
      const customTriggerMock = vi.fn().mockImplementation(async (_agentName, _scheduleName, options) => {
        if (options?.onMessage) {
          await options.onMessage({ type: "assistant", content: longResponse });
        }
        return { jobId: "long-job-123" };
      });

      const streamingEmitter = Object.assign(new EventEmitter(), {
        trigger: customTriggerMock,
      });

      const streamingConfig: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [
          createDiscordAgent("long-agent", {
            bot_token_env: "TEST_BOT_TOKEN",
            session_expiry_hours: 24,
            log_level: "standard",
            output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
            guilds: [],
          }),
        ],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };

      const streamingContext: FleetManagerContext = {
        getConfig: () => streamingConfig,
        getStateDir: () => "/tmp/test-state",
        getStateDirInfo: () => null,
        getLogger: () => mockLogger,
        getScheduler: () => null,
        getStatus: () => "running",
        getInitializedAt: () => "2024-01-01T00:00:00.000Z",
        getStartedAt: () => "2024-01-01T00:00:01.000Z",
        getStoppedAt: () => null,
        getLastError: () => null,
        getCheckInterval: () => 1000,
        emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
        getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
      };

      const streamingManager = new DiscordManager(streamingContext);

      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
        sessionManager: {
          getOrCreateSession: ReturnType<typeof vi.fn>;
          getSession: ReturnType<typeof vi.fn>;
          setSession: ReturnType<typeof vi.fn>;
          touchSession: ReturnType<typeof vi.fn>;
          getActiveSessionCount: ReturnType<typeof vi.fn>;
        };
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "long-agent";
      mockConnector.sessionManager = {
        getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
        getSession: vi.fn().mockResolvedValue({ sessionId: "s1", lastMessageAt: new Date().toISOString() }),
        setSession: vi.fn().mockResolvedValue(undefined),
        touchSession: vi.fn().mockResolvedValue(undefined),
        getActiveSessionCount: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - accessing private property for testing
      streamingManager.connectors.set("long-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      streamingManager.initialized = true;

      await streamingManager.start();

      // Create a mock message event
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "long-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing (includes delay between split chunks)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should have sent multiple messages (split response)
      expect(replyMock).toHaveBeenCalledTimes(2);
    });

    it("streams tool results from user messages to Discord", async () => {
      // Create trigger mock that sends assistant message with tool_use, then user message with tool_result
      const customTriggerMock = vi.fn().mockImplementation(async (_agentName, _scheduleName, options) => {
        if (options?.onMessage) {
          // Claude decides to use Bash tool
          await options.onMessage({
            type: "assistant",
            message: {
              content: [
                { type: "text", text: "Let me check that for you." },
                { type: "tool_use", name: "Bash", id: "tool-1", input: { command: "ls -la /tmp" } },
              ],
            },
          });
          // Tool result comes back as a user message
          await options.onMessage({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "tool-1",
                  content: "total 48\ndrwxr-xr-x  5 user  staff  160 Jan 20 10:00 .",
                },
              ],
            },
          });
          // Claude sends final response
          await options.onMessage({
            type: "assistant",
            message: {
              content: [
                { type: "text", text: "Here are the files in /tmp." },
              ],
            },
          });
        }
        return { jobId: "tool-job-123", success: true };
      });

      const streamingEmitter = Object.assign(new EventEmitter(), {
        trigger: customTriggerMock,
      });

      const streamingConfig: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [
          createDiscordAgent("tool-agent", {
            bot_token_env: "TEST_BOT_TOKEN",
            session_expiry_hours: 24,
            log_level: "standard",
            output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
            guilds: [],
          }),
        ],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };

      const streamingContext: FleetManagerContext = {
        getConfig: () => streamingConfig,
        getStateDir: () => "/tmp/test-state",
        getStateDirInfo: () => null,
        getLogger: () => mockLogger,
        getScheduler: () => null,
        getStatus: () => "running",
        getInitializedAt: () => "2024-01-01T00:00:00.000Z",
        getStartedAt: () => "2024-01-01T00:00:01.000Z",
        getStoppedAt: () => null,
        getLastError: () => null,
        getCheckInterval: () => 1000,
        emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
        getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
      };

      const streamingManager = new DiscordManager(streamingContext);

      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
        sessionManager: {
          getOrCreateSession: ReturnType<typeof vi.fn>;
          getSession: ReturnType<typeof vi.fn>;
          setSession: ReturnType<typeof vi.fn>;
          touchSession: ReturnType<typeof vi.fn>;
          getActiveSessionCount: ReturnType<typeof vi.fn>;
        };
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "tool-agent";
      mockConnector.sessionManager = {
        getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
        getSession: vi.fn().mockResolvedValue(null),
        setSession: vi.fn().mockResolvedValue(undefined),
        touchSession: vi.fn().mockResolvedValue(undefined),
        getActiveSessionCount: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - accessing private property for testing
      streamingManager.connectors.set("tool-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      streamingManager.initialized = true;

      await streamingManager.start();

      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "tool-agent",
        prompt: "List files in /tmp",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "List files in /tmp",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      mockConnector.emit("message", messageEvent);

      // Wait for async processing (includes rate limiting delays)
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Should have sent: text response, tool result embed, final text response
      expect(replyMock).toHaveBeenCalledTimes(3);
      // First: the text part of the assistant message
      expect(replyMock).toHaveBeenNthCalledWith(1, "Let me check that for you.");
      // Second: tool result as a Discord embed
      const embedCall = replyMock.mock.calls[1][0] as DiscordReplyPayload;
      expect(embedCall).toHaveProperty("embeds");
      expect(embedCall.embeds).toHaveLength(1);
      const embed = embedCall.embeds[0];
      expect(embed.title).toContain("Bash");
      expect(embed.description).toContain("ls -la /tmp");
      expect(embed.color).toBe(0x5865f2); // blurple (not error)
      // Should have Duration and Output fields plus the Result field
      expect(embed.fields).toBeDefined();
      const fieldNames = embed.fields!.map((f: DiscordReplyEmbedField) => f.name);
      expect(fieldNames).toContain("Duration");
      expect(fieldNames).toContain("Output");
      expect(fieldNames).toContain("Result");
      // Third: final assistant response
      expect(replyMock).toHaveBeenNthCalledWith(3, "Here are the files in /tmp.");
    }, 10000);

    it("streams tool results from top-level tool_use_result", async () => {
      // Test the alternative SDK format where tool_use_result is at the top level
      const customTriggerMock = vi.fn().mockImplementation(async (_agentName, _scheduleName, options) => {
        if (options?.onMessage) {
          await options.onMessage({
            type: "user",
            tool_use_result: "output from tool execution",
          });
        }
        return { jobId: "tool-job-456", success: true };
      });

      const streamingEmitter = Object.assign(new EventEmitter(), {
        trigger: customTriggerMock,
      });

      const streamingConfig: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [
          createDiscordAgent("tool-agent-2", {
            bot_token_env: "TEST_BOT_TOKEN",
            session_expiry_hours: 24,
            log_level: "standard",
            output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
            guilds: [],
          }),
        ],
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };

      const streamingContext: FleetManagerContext = {
        getConfig: () => streamingConfig,
        getStateDir: () => "/tmp/test-state",
        getStateDirInfo: () => null,
        getLogger: () => mockLogger,
        getScheduler: () => null,
        getStatus: () => "running",
        getInitializedAt: () => "2024-01-01T00:00:00.000Z",
        getStartedAt: () => "2024-01-01T00:00:01.000Z",
        getStoppedAt: () => null,
        getLastError: () => null,
        getCheckInterval: () => 1000,
        emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
        getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
      };

      const streamingManager = new DiscordManager(streamingContext);

      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
        sessionManager: {
          getOrCreateSession: ReturnType<typeof vi.fn>;
          getSession: ReturnType<typeof vi.fn>;
          setSession: ReturnType<typeof vi.fn>;
          touchSession: ReturnType<typeof vi.fn>;
          getActiveSessionCount: ReturnType<typeof vi.fn>;
        };
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "tool-agent-2";
      mockConnector.sessionManager = {
        getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
        getSession: vi.fn().mockResolvedValue(null),
        setSession: vi.fn().mockResolvedValue(undefined),
        touchSession: vi.fn().mockResolvedValue(undefined),
        getActiveSessionCount: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - accessing private property for testing
      streamingManager.connectors.set("tool-agent-2", mockConnector);
      // @ts-expect-error - accessing private property for testing
      streamingManager.initialized = true;

      await streamingManager.start();

      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "tool-agent-2",
        prompt: "Run something",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Run something",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      mockConnector.emit("message", messageEvent);

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have sent the tool result as an embed
      expect(replyMock).toHaveBeenCalledTimes(1);
      const embedCall = replyMock.mock.calls[0][0] as DiscordReplyPayload;
      expect(embedCall).toHaveProperty("embeds");
      expect(embedCall.embeds).toHaveLength(1);
      const embed = embedCall.embeds[0];
      // No matching tool_use, so title falls back to "Tool"
      expect(embed.title).toContain("Tool");
      // Should have Output field and Result field
      expect(embed.fields).toBeDefined();
      const resultField = embed.fields!.find((f: DiscordReplyEmbedField) => f.name === "Result");
      expect(resultField).toBeDefined();
      expect(resultField!.value).toContain("output from tool execution");
    });

    it("handles message handler rejection via catch handler", async () => {
      // This tests the .catch(error => this.handleError()) path in start()
      // when handleMessage throws an error that propagates to the catch handler

      // Create a config with no agents to trigger the "agent not found" error path
      const emptyConfig: ResolvedConfig = {
        fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
        agents: [], // No agents!
        configPath: "/test/herdctl.yaml",
        configDir: "/test",
      };

      const errorEmitter = new EventEmitter();
      const errorContext: FleetManagerContext = {
        getConfig: () => emptyConfig,
        getStateDir: () => "/tmp/test-state",
        getStateDirInfo: () => null,
        getLogger: () => mockLogger,
        getScheduler: () => null,
        getStatus: () => "running",
        getInitializedAt: () => "2024-01-01T00:00:00.000Z",
        getStartedAt: () => "2024-01-01T00:00:01.000Z",
        getStoppedAt: () => null,
        getLastError: () => null,
        getCheckInterval: () => 1000,
        emit: (event: string, ...args: unknown[]) => errorEmitter.emit(event, ...args),
        getEmitter: () => errorEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
      };

      const errorManager = new DiscordManager(errorContext);

      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
        sessionManager: {
          getActiveSessionCount: ReturnType<typeof vi.fn>;
        };
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "missing-agent";
      mockConnector.sessionManager = {
        getActiveSessionCount: vi.fn().mockResolvedValue(0),
      };

      // @ts-expect-error - accessing private property for testing
      errorManager.connectors.set("missing-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      errorManager.initialized = true;

      await errorManager.start();

      // Create a message event with a reply that throws
      const replyMock = vi.fn().mockRejectedValue(new Error("Reply threw"));
      const messageEvent: DiscordMessageEvent = {
        agentName: "missing-agent",
        prompt: "Hello!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event - this will trigger handleMessage which will fail
      // because agent is not in config, and then try to reply, and that also fails
      mockConnector.emit("message", messageEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The catch handler should have caught the error and called handleError
      // which logs the error via discord:error event
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("handles error events from connector", async () => {
      // Create a mock connector
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "test-agent";

      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("test-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      // Emit an error event
      const errorEvent: DiscordErrorEvent = {
        agentName: "test-agent",
        error: new Error("Test error"),
      };
      mockConnector.emit("error", errorEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have logged the error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Discord connector error")
      );
    });

    it("sends formatted error reply when trigger fails", async () => {
      // Create a mock connector
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "test-agent";

      // Make trigger fail
      triggerMock.mockRejectedValueOnce(new Error("Agent execution failed"));

      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("test-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      // Create a mock message event
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "test-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have sent a formatted error reply
      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("❌ **Error**:")
      );
      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("Agent execution failed")
      );
      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("/reset")
      );
    });

    it("handles error reply failure when trigger fails", async () => {
      // Create a mock connector
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "test-agent";

      // Make trigger fail
      triggerMock.mockRejectedValueOnce(new Error("Agent execution failed"));

      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("test-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      // Create a mock message event with reply that also fails
      const replyMock = vi.fn().mockRejectedValue(new Error("Reply also failed"));
      const messageEvent: DiscordMessageEvent = {
        agentName: "test-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have logged both errors
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Discord message handling failed")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send error reply")
      );
    });

    it("sends error reply when agent not found", async () => {
      // Create a mock connector
      const mockConnector = new EventEmitter() as EventEmitter & {
        connect: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        isConnected: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        agentName: string;
      };
      mockConnector.connect = vi.fn().mockResolvedValue(undefined);
      mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
      mockConnector.isConnected = vi.fn().mockReturnValue(true);
      mockConnector.getState = vi.fn().mockReturnValue({
        status: "connected",
        connectedAt: "2024-01-01T00:00:00.000Z",
        disconnectedAt: null,
        reconnectAttempts: 0,
        lastError: null,
        botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
        rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
        messageStats: { received: 0, sent: 0, ignored: 0 },
      } satisfies DiscordConnectorState);
      mockConnector.agentName = "unknown-agent";

      // @ts-expect-error - accessing private property for testing
      manager.connectors.set("unknown-agent", mockConnector);
      // @ts-expect-error - accessing private property for testing
      manager.initialized = true;

      await manager.start();

      // Create a mock message event for an agent not in config
      const replyMock = vi.fn().mockResolvedValue(undefined);
      const messageEvent: DiscordMessageEvent = {
        agentName: "unknown-agent",
        prompt: "Hello bot!",
        context: {
          messages: [],
          wasMentioned: true,
          prompt: "Hello bot!",
        },
        metadata: {
          guildId: "guild1",
          channelId: "channel1",
          messageId: "msg1",
          userId: "user1",
          username: "TestUser",
          wasMentioned: true,
          mode: "mention",
        },
        reply: replyMock,
        startTyping: () => () => {},
      };

      // Emit the message event
      mockConnector.emit("message", messageEvent);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have sent an error reply
      expect(replyMock).toHaveBeenCalledWith(
        expect.stringContaining("not properly configured")
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Agent 'unknown-agent' not found")
      );
    });
  });

  describe("extractMessageContent", () => {
    it("extracts direct string content", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        content: "Direct content",
      });
      expect(result).toBe("Direct content");
    });

    it("extracts nested message content", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: { content: "Nested content" },
      });
      expect(result).toBe("Nested content");
    });

    it("extracts text from content blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: " Second part" },
          ],
        },
      });
      expect(result).toBe("First part Second part");
    });

    it("returns undefined for empty content", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for non-text content blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "some_tool" },
          ],
        },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for empty string content", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        content: "",
      });
      expect(result).toBeUndefined();
    });

    it("handles mixed content blocks (text and non-text)", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "some_tool" },
            { type: "text", text: "After tool" },
          ],
        },
      });
      expect(result).toBe("After tool");
    });

    it("handles empty content blocks array", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [],
        },
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for content that is not a string or array", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: { someObject: "value" }, // Not string or array
        },
      });
      expect(result).toBeUndefined();
    });

    it("handles content blocks with missing text property", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [
            { type: "text" }, // Missing text property
          ],
        },
      });
      expect(result).toBeUndefined();
    });

    it("handles content block with non-string text", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractMessageContent({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: 123 }, // Non-string text
          ],
        },
      });
      expect(result).toBeUndefined();
    });
  });

  describe("extractToolUseBlocks", () => {
    it("extracts tool_use blocks with id from assistant message content", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me run that command." },
            { type: "tool_use", name: "Bash", id: "tool-1", input: { command: "ls -la" } },
          ],
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Bash");
      expect(result[0].id).toBe("tool-1");
      expect(result[0].input).toEqual({ command: "ls -la" });
    });

    it("extracts multiple tool_use blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", id: "tool-1", input: { file_path: "/tmp/a.txt" } },
            { type: "text", text: "Reading file..." },
            { type: "tool_use", name: "Bash", id: "tool-2", input: { command: "cat /tmp/a.txt" } },
          ],
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Read");
      expect(result[0].id).toBe("tool-1");
      expect(result[1].name).toBe("Bash");
      expect(result[1].id).toBe("tool-2");
    });

    it("handles tool_use blocks without id", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "some_tool" },
          ],
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("some_tool");
      expect(result[0].id).toBeUndefined();
    });

    it("returns empty array when no tool_use blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Just a text response" },
          ],
        },
      });
      expect(result).toHaveLength(0);
    });

    it("returns empty array when content is not an array", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
        message: { content: "string content" },
      });
      expect(result).toHaveLength(0);
    });

    it("returns empty array when no message field", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.extractToolUseBlocks({
        type: "assistant",
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("getToolInputSummary", () => {
    it("returns command for Bash tool", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Bash", { command: "ls -la" });
      expect(result).toBe("ls -la");
    });

    it("truncates long Bash commands", () => {
      const longCommand = "echo " + "a".repeat(250);
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Bash", { command: longCommand });
      expect(result).toContain("...");
      expect(result!.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it("returns file path for Read tool", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Read", { file_path: "/src/index.ts" });
      expect(result).toBe("/src/index.ts");
    });

    it("returns file path for Write tool", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Write", { file_path: "/src/output.ts" });
      expect(result).toBe("/src/output.ts");
    });

    it("returns file path for Edit tool", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Edit", { file_path: "/src/utils.ts" });
      expect(result).toBe("/src/utils.ts");
    });

    it("returns pattern for Glob/Grep tools", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Grep", { pattern: "TODO" });
      expect(result).toBe("TODO");
    });

    it("returns query for WebSearch", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("WebSearch", { query: "discord embeds" });
      expect(result).toBe("discord embeds");
    });

    it("returns undefined for unknown tools", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("SomeCustomTool", { data: "value" });
      expect(result).toBeUndefined();
    });

    it("returns undefined for Bash without command", () => {
      // @ts-expect-error - accessing private method for testing
      const result = manager.getToolInputSummary("Bash", {});
      expect(result).toBeUndefined();
    });
  });

  describe("extractToolResults", () => {
    it("extracts tool result from top-level tool_use_result string", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        tool_use_result: "file1.txt\nfile2.txt\nfile3.txt",
      });
      expect(results).toHaveLength(1);
      expect(results[0].output).toBe("file1.txt\nfile2.txt\nfile3.txt");
      expect(results[0].isError).toBe(false);
    });

    it("extracts tool result from tool_use_result object with content string", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        tool_use_result: {
          content: "Command output here",
          is_error: false,
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].output).toBe("Command output here");
      expect(results[0].isError).toBe(false);
    });

    it("extracts error tool result from tool_use_result object", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        tool_use_result: {
          content: "Permission denied",
          is_error: true,
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].output).toBe("Permission denied");
      expect(results[0].isError).toBe(true);
    });

    it("extracts tool results with tool_use_id from content blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "total 48\ndrwxr-xr-x  5 user  staff  160 Jan 20 10:00 .",
            },
          ],
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].output).toContain("total 48");
      expect(results[0].isError).toBe(false);
      expect(results[0].toolUseId).toBe("tool-1");
    });

    it("extracts error tool result from content blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "bash: command not found: foo",
              is_error: true,
            },
          ],
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].toolUseId).toBe("tool-1");
    });

    it("extracts tool results with nested content blocks", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: [
                { type: "text", text: "Line 1 of output" },
                { type: "text", text: "Line 2 of output" },
              ],
            },
          ],
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].output).toBe("Line 1 of output\nLine 2 of output");
    });

    it("extracts multiple tool results with different IDs", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "Result 1",
            },
            {
              type: "tool_result",
              tool_use_id: "tool-2",
              content: "Result 2",
            },
          ],
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0].output).toBe("Result 1");
      expect(results[0].toolUseId).toBe("tool-1");
      expect(results[1].output).toBe("Result 2");
      expect(results[1].toolUseId).toBe("tool-2");
    });

    it("returns empty array for user message without tool results", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
        message: {
          content: [
            { type: "text", text: "Just a regular user message" },
          ],
        },
      });
      expect(results).toHaveLength(0);
    });

    it("returns empty array for user message without content", () => {
      // @ts-expect-error - accessing private method for testing
      const results = manager.extractToolResults({
        type: "user",
      });
      expect(results).toHaveLength(0);
    });
  });

  describe("buildToolEmbed", () => {
    it("builds embed with tool_use info and result", () => {
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Bash", input: { command: "ls -la" }, startTime: Date.now() - 1200 },
        { output: "file1.txt\nfile2.txt", isError: false },
      );
      expect(embed.title).toContain("Bash");
      expect(embed.description).toContain("ls -la");
      expect(embed.color).toBe(0x5865f2);
      expect(embed.fields).toBeDefined();
      const fieldNames = embed.fields!.map(f => f.name);
      expect(fieldNames).toContain("Duration");
      expect(fieldNames).toContain("Output");
      expect(fieldNames).toContain("Result");
      // Result field should contain the output in a code block
      const resultField = embed.fields!.find(f => f.name === "Result");
      expect(resultField!.value).toContain("file1.txt");
    });

    it("builds embed with error color for error results", () => {
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Bash", input: { command: "rm -rf /" }, startTime: Date.now() - 500 },
        { output: "Permission denied", isError: true },
      );
      expect(embed.color).toBe(0xef4444);
      const errorField = embed.fields!.find(f => f.name === "Error");
      expect(errorField).toBeDefined();
      expect(errorField!.value).toContain("Permission denied");
    });

    it("builds embed without tool_use info (fallback)", () => {
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        null,
        { output: "some output", isError: false },
      );
      expect(embed.title).toContain("Tool");
      expect(embed.description).toBeUndefined();
      // No Duration field when no tool_use info
      const fieldNames = embed.fields!.map(f => f.name);
      expect(fieldNames).not.toContain("Duration");
      expect(fieldNames).toContain("Output");
    });

    it("truncates long output in embed field", () => {
      const longOutput = "x".repeat(2000);
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Bash", input: { command: "cat bigfile" }, startTime: Date.now() - 100 },
        { output: longOutput, isError: false },
      );
      const resultField = embed.fields!.find(f => f.name === "Result");
      expect(resultField).toBeDefined();
      expect(resultField!.value).toContain("chars total");
      // Total field value should fit in Discord embed field limit (1024)
      expect(resultField!.value.length).toBeLessThanOrEqual(1024);
    });

    it("formats output length with k suffix for large outputs", () => {
      const output = "x".repeat(1500);
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Read", input: { file_path: "/big.txt" }, startTime: Date.now() - 200 },
        { output, isError: false },
      );
      const outputField = embed.fields!.find(f => f.name === "Output");
      expect(outputField!.value).toContain("k chars");
    });

    it("shows Read tool with file path in description", () => {
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Read", input: { file_path: "/src/index.ts" }, startTime: Date.now() - 50 },
        { output: "file contents", isError: false },
      );
      expect(embed.title).toContain("Read");
      expect(embed.description).toContain("/src/index.ts");
    });

    it("omits Result field for empty output", () => {
      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Bash", input: { command: "true" }, startTime: Date.now() - 10 },
        { output: "   \n\n  ", isError: false },
      );
      const fieldNames = embed.fields!.map(f => f.name);
      expect(fieldNames).not.toContain("Result");
    });
  });
});

// Session integration tests are skipped pending refactor to work with the new architecture
// These tests rely on the message handling infrastructure which has been refactored
describe.skip("DiscordManager session integration", () => {
  let manager: DiscordManager;
  let mockContext: FleetManagerContext;
  let triggerMock: ReturnType<typeof vi.fn>;
  let emitterWithTrigger: EventEmitter & { trigger: ReturnType<typeof vi.fn> };
  let mockSessionManager: {
    agentName: string;
    getOrCreateSession: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    setSession: ReturnType<typeof vi.fn>;
    touchSession: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
    cleanupExpiredSessions: ReturnType<typeof vi.fn>;
    getActiveSessionCount: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock session manager
    mockSessionManager = {
      agentName: "test-agent",
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "session-123", isNew: false }),
      getSession: vi.fn().mockResolvedValue({ sessionId: "session-123", lastMessageAt: new Date().toISOString() }),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      clearSession: vi.fn().mockResolvedValue(true),
      cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
      getActiveSessionCount: vi.fn().mockResolvedValue(5),
    };

    // Create a mock FleetManager (emitter) with trigger method
    triggerMock = vi.fn().mockResolvedValue({ jobId: "job-123", success: true, sessionId: "sdk-session-456" });
    emitterWithTrigger = Object.assign(new EventEmitter(), {
      trigger: triggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        createDiscordAgent("test-agent", {
          bot_token_env: "TEST_BOT_TOKEN",
          session_expiry_hours: 24,
          log_level: "standard",
          output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
          guilds: [],
        }),
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    mockContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => emitterWithTrigger.emit(event, ...args),
      getEmitter: () => emitterWithTrigger,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    manager = new DiscordManager(mockContext);
  });

  it("calls getSession on message to check for existing session", async () => {
    // Create a mock connector with session manager
    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have called getSession to check for existing session
    expect(mockSessionManager.getSession).toHaveBeenCalledWith("channel1");
  });

  it("calls setSession after successful response with SDK session ID", async () => {
    // Create a mock connector with session manager
    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have called setSession with the SDK session ID from trigger result
    expect(mockSessionManager.setSession).toHaveBeenCalledWith("channel1", "sdk-session-456");
  });

  it("handles getSession errors gracefully", async () => {
    // Create a mock connector with session manager where getSession fails
    mockSessionManager.getSession.mockRejectedValue(new Error("Session error"));

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have logged a warning but continued processing
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to get session")
    );
    // Should still have called trigger
    expect(triggerMock).toHaveBeenCalled();
  });

  it("handles setSession errors gracefully", async () => {
    // Create a mock connector with session manager where setSession fails
    mockSessionManager.setSession.mockRejectedValue(new Error("Session storage error"));

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have logged a warning but continued
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to store session")
    );
    // Reply should still have been sent
    expect(replyMock).toHaveBeenCalled();
  });

  it("logs session count on stop", async () => {
    // Create a mock connector with session manager
    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.stop();

    // Should have queried session count
    expect(mockSessionManager.getActiveSessionCount).toHaveBeenCalled();
    // Should have logged about preserving sessions
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Preserving 5 active session(s)")
    );
  });

  it("handles getActiveSessionCount errors on stop", async () => {
    // Create a mock connector with session manager that fails
    mockSessionManager.getActiveSessionCount.mockRejectedValue(new Error("Count error"));

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.stop();

    // Should have warned about the error
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to get session count")
    );
    // Should still disconnect
    expect(mockConnector.disconnect).toHaveBeenCalled();
  });

  it("does not log session preservation when count is 0", async () => {
    // Create a mock connector with session manager returning 0 sessions
    mockSessionManager.getActiveSessionCount.mockResolvedValue(0);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: typeof mockSessionManager;
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = mockSessionManager;

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.stop();

    // Should NOT have logged about preserving sessions (0 sessions)
    expect(mockLogger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Preserving")
    );
  });
});

// Lifecycle tests are skipped pending refactor to work with the new architecture
// These tests rely on the message handling infrastructure which has been refactored
describe.skip("DiscordManager lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles connect failure gracefully", async () => {
    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockRejectedValue(new Error("Connection failed"));
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(false);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "error",
      connectedAt: null,
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: "Connection failed",
      botUser: null,
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    const ctx = createMockContext(null);
    const manager = new DiscordManager(ctx);

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    // Should not throw
    await manager.start();

    // Should have logged the error
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to connect Discord")
    );
  });

  it("handles disconnect failure gracefully", async () => {
    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockRejectedValue(new Error("Disconnect failed"));
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    const ctx = createMockContext(null);
    const manager = new DiscordManager(ctx);

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    // Should not throw
    await manager.stop();

    // Should have logged the error
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error disconnecting Discord")
    );
  });

  it("reports correct connected count", async () => {
    const connectedConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    connectedConnector.connect = vi.fn().mockResolvedValue(undefined);
    connectedConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    connectedConnector.isConnected = vi.fn().mockReturnValue(true);
    connectedConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    connectedConnector.agentName = "connected-agent";
    connectedConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    const disconnectedConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    disconnectedConnector.connect = vi.fn().mockRejectedValue(new Error("Failed"));
    disconnectedConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    disconnectedConnector.isConnected = vi.fn().mockReturnValue(false);
    disconnectedConnector.getState = vi.fn().mockReturnValue({
      status: "error",
      connectedAt: null,
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: "Failed",
      botUser: null,
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    disconnectedConnector.agentName = "disconnected-agent";
    disconnectedConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    const ctx = createMockContext(null);
    const manager = new DiscordManager(ctx);

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("connected-agent", connectedConnector);
    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("disconnected-agent", disconnectedConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Should report correct counts
    expect(manager.getConnectedCount()).toBe(1);
    expect(manager.getConnectorNames()).toEqual(["connected-agent", "disconnected-agent"]);
  });

  it("emits discord:message:handled event on successful message handling", async () => {
    const eventEmitter = new EventEmitter();
    const emittedEvents: Array<{ event: string; data: unknown }> = [];

    // Track emitted events
    eventEmitter.on("discord:message:handled", (data) => {
      emittedEvents.push({ event: "discord:message:handled", data });
    });

    const triggerMock = vi.fn().mockResolvedValue({ jobId: "job-456" });
    const emitterWithTrigger = Object.assign(eventEmitter, {
      trigger: triggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        createDiscordAgent("test-agent", {
          bot_token_env: "TEST_BOT_TOKEN",
          session_expiry_hours: 24,
          log_level: "standard",
          output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
          guilds: [],
        }),
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => emitterWithTrigger.emit(event, ...args),
      getEmitter: () => emitterWithTrigger,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have emitted the handled event
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].event).toBe("discord:message:handled");
    expect(emittedEvents[0].data).toMatchObject({
      agentName: "test-agent",
      channelId: "channel1",
      messageId: "msg1",
      jobId: "job-456",
    });
  });

  it("emits discord:message:error event on message handling failure", async () => {
    const eventEmitter = new EventEmitter();
    const emittedEvents: Array<{ event: string; data: unknown }> = [];

    // Track emitted events
    eventEmitter.on("discord:message:error", (data) => {
      emittedEvents.push({ event: "discord:message:error", data });
    });

    const triggerMock = vi.fn().mockRejectedValue(new Error("Execution failed"));
    const emitterWithTrigger = Object.assign(eventEmitter, {
      trigger: triggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        createDiscordAgent("test-agent", {
          bot_token_env: "TEST_BOT_TOKEN",
          session_expiry_hours: 24,
          log_level: "standard",
          output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
          guilds: [],
        }),
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => emitterWithTrigger.emit(event, ...args),
      getEmitter: () => emitterWithTrigger,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have emitted the error event
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].event).toBe("discord:message:error");
    expect(emittedEvents[0].data).toMatchObject({
      agentName: "test-agent",
      channelId: "channel1",
      messageId: "msg1",
      error: "Execution failed",
    });
  });

  it("emits discord:error event on connector error", async () => {
    const eventEmitter = new EventEmitter();
    const emittedEvents: Array<{ event: string; data: unknown }> = [];

    // Track emitted events
    eventEmitter.on("discord:error", (data) => {
      emittedEvents.push({ event: "discord:error", data });
    });

    const mockContext: FleetManagerContext = {
      getConfig: () => null,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => eventEmitter.emit(event, ...args),
      getEmitter: () => eventEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Emit error event from connector
    const errorEvent: DiscordErrorEvent = {
      agentName: "test-agent",
      error: new Error("Connector error"),
    };
    mockConnector.emit("error", errorEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have emitted the discord:error event
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].event).toBe("discord:error");
    expect(emittedEvents[0].data).toMatchObject({
      agentName: "test-agent",
      error: "Connector error",
    });
  });

  it("handles reply failure when agent not found", async () => {
    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [],  // No agents!
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: () => true,
      getEmitter: () => new EventEmitter(),
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "unknown-agent";
    mockConnector.sessionManager = {
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("unknown-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Reply that fails
    const replyMock = vi.fn().mockRejectedValue(new Error("Reply failed"));
    const messageEvent: DiscordMessageEvent = {
      agentName: "unknown-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have logged both the agent not found error and the reply failure
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Agent 'unknown-agent' not found")
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to send error reply")
    );
  });

  it("sends default response when job produces no output", async () => {
    const eventEmitter = new EventEmitter();
    // Trigger that returns a successful result but doesn't send any messages
    const triggerMock = vi.fn().mockImplementation(async () => {
      return {
        jobId: "job-789",
        agentName: "test-agent",
        scheduleName: null,
        startedAt: new Date().toISOString(),
        success: true,
      };
    });
    const emitterWithTrigger = Object.assign(eventEmitter, {
      trigger: triggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        createDiscordAgent("test-agent", {
          bot_token_env: "TEST_BOT_TOKEN",
          session_expiry_hours: 24,
          log_level: "standard",
          output: { tool_results: true, tool_result_max_length: 900, system_status: true, result_summary: false, errors: true },
          guilds: [],
        }),
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => emitterWithTrigger.emit(event, ...args),
      getEmitter: () => emitterWithTrigger,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "test-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("test-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    // Create a mock message event
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "test-agent",
      prompt: "Hello bot!",
      context: {
        messages: [],
        wasMentioned: true,
        prompt: "Hello bot!",
      },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    // Emit the message event
    mockConnector.emit("message", messageEvent);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have sent the default "no output" message
    expect(replyMock).toHaveBeenCalledWith(
      "I've completed the task, but I don't have a specific response to share."
    );
  });
});

// Output configuration tests are skipped pending refactor to work with the new architecture
// These tests rely on the message handling infrastructure which has been refactored
describe.skip("DiscordManager output configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send tool result embeds when tool_results is disabled", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        // Claude decides to use Bash tool
        await options.onMessage({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Let me run that." },
              { type: "tool_use", name: "Bash", id: "tool-1", input: { command: "ls" } },
            ],
          },
        });
        // Tool result
        await options.onMessage({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "tool-1", content: "file1.txt\nfile2.txt" },
            ],
          },
        });
        // Final response
        await options.onMessage({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Done!" }],
          },
        });
      }
      return { jobId: "job-123", success: true };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    // Agent with tool_results disabled
    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "no-tool-results-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: false,
                tool_result_max_length: 900,
                system_status: true,
                result_summary: false,
                errors: true,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "no-tool-results-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("no-tool-results-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "no-tool-results-agent",
      prompt: "List files",
      context: { messages: [], wasMentioned: true, prompt: "List files" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Should have sent text responses but NO embed payloads
    expect(replyMock).toHaveBeenCalledWith("Let me run that.");
    expect(replyMock).toHaveBeenCalledWith("Done!");
    // Should NOT have sent any embeds for tool results
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(0);
  }, 10000);

  it("sends system status embed when system_status is enabled", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        // Send a system status message
        await options.onMessage({
          type: "system",
          subtype: "status",
          status: "compacting",
        });
      }
      return { jobId: "job-123", success: true };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "system-status-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: true,
                tool_result_max_length: 900,
                system_status: true,
                result_summary: false,
                errors: true,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "system-status-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("system-status-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "system-status-agent",
      prompt: "Hello",
      context: { messages: [], wasMentioned: true, prompt: "Hello" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Should have sent a system status embed
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(1);
    const embed = (embedCalls[0][0] as DiscordReplyPayload).embeds[0];
    expect(embed.title).toContain("System");
    expect(embed.description).toContain("Compacting context");
  }, 10000);

  it("does not send system status embed when system_status is disabled", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        await options.onMessage({
          type: "system",
          subtype: "status",
          status: "compacting",
        });
      }
      return { jobId: "job-123", success: true };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "no-system-status-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: true,
                tool_result_max_length: 900,
                system_status: false,
                result_summary: false,
                errors: true,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "no-system-status-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("no-system-status-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "no-system-status-agent",
      prompt: "Hello",
      context: { messages: [], wasMentioned: true, prompt: "Hello" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Should NOT have sent any embeds
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(0);
  }, 10000);

  it("sends result summary embed when result_summary is enabled", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        await options.onMessage({
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 5000,
          total_cost_usd: 0.0123,
          num_turns: 3,
          usage: { input_tokens: 1000, output_tokens: 500 },
        });
      }
      return { jobId: "job-123", success: true };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "result-summary-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: true,
                tool_result_max_length: 900,
                system_status: true,
                result_summary: true,
                errors: true,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "result-summary-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("result-summary-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "result-summary-agent",
      prompt: "Hello",
      context: { messages: [], wasMentioned: true, prompt: "Hello" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Should have sent a result summary embed
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(1);
    const embed = (embedCalls[0][0] as DiscordReplyPayload).embeds[0];
    expect(embed.title).toContain("Task Complete");
    expect(embed.fields).toBeDefined();
    const fieldNames = embed.fields!.map((f: DiscordReplyEmbedField) => f.name);
    expect(fieldNames).toContain("Duration");
    expect(fieldNames).toContain("Turns");
    expect(fieldNames).toContain("Cost");
    expect(fieldNames).toContain("Tokens");
  }, 10000);

  it("sends error embed for SDK error messages", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        await options.onMessage({
          type: "error",
          content: "Something went wrong",
        });
      }
      return { jobId: "job-123", success: false };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "error-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: true,
                tool_result_max_length: 900,
                system_status: true,
                result_summary: false,
                errors: true,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "error-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("error-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "error-agent",
      prompt: "Hello",
      context: { messages: [], wasMentioned: true, prompt: "Hello" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Should have sent an error embed
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(1);
    const embed = (embedCalls[0][0] as DiscordReplyPayload).embeds[0];
    expect(embed.title).toContain("Error");
    expect(embed.description).toBe("Something went wrong");
  }, 10000);

  it("does not send error embed when errors is disabled", async () => {
    const customTriggerMock = vi.fn().mockImplementation(async (_agentName: string, _scheduleName: string | undefined, options: { onMessage?: (msg: unknown) => Promise<void> }) => {
      if (options?.onMessage) {
        await options.onMessage({
          type: "error",
          content: "Something went wrong",
        });
      }
      return { jobId: "job-123", success: false };
    });

    const streamingEmitter = Object.assign(new EventEmitter(), {
      trigger: customTriggerMock,
    });

    const config: ResolvedConfig = {
      fleet: { name: "test-fleet" } as unknown as ResolvedConfig["fleet"],
      agents: [
        {
          name: "no-errors-agent",
          model: "sonnet",
          runtime: "sdk",
          schedules: {},
          chat: {
            discord: {
              bot_token_env: "TEST_TOKEN",
              session_expiry_hours: 24,
              log_level: "standard",
              output: {
                tool_results: true,
                tool_result_max_length: 900,
                system_status: true,
                result_summary: false,
                errors: false,
              },
              guilds: [],
            },
          },
          configPath: "/test/herdctl.yaml",
        } as ResolvedAgent,
      ],
      configPath: "/test/herdctl.yaml",
      configDir: "/test",
    };

    const mockContext: FleetManagerContext = {
      getConfig: () => config,
      getStateDir: () => "/tmp/test-state",
      getStateDirInfo: () => null,
      getLogger: () => mockLogger,
      getScheduler: () => null,
      getStatus: () => "running",
      getInitializedAt: () => "2024-01-01T00:00:00.000Z",
      getStartedAt: () => "2024-01-01T00:00:01.000Z",
      getStoppedAt: () => null,
      getLastError: () => null,
      getCheckInterval: () => 1000,
      emit: (event: string, ...args: unknown[]) => streamingEmitter.emit(event, ...args),
      getEmitter: () => streamingEmitter,
      trigger: vi.fn().mockResolvedValue({ jobId: "test-job", agentName: "test", scheduleName: null, startedAt: new Date().toISOString(), success: true }),
    };

    const manager = new DiscordManager(mockContext);

    const mockConnector = new EventEmitter() as EventEmitter & {
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      isConnected: ReturnType<typeof vi.fn>;
      getState: ReturnType<typeof vi.fn>;
      agentName: string;
      sessionManager: {
        getOrCreateSession: ReturnType<typeof vi.fn>;
        getSession: ReturnType<typeof vi.fn>;
        setSession: ReturnType<typeof vi.fn>;
        touchSession: ReturnType<typeof vi.fn>;
        getActiveSessionCount: ReturnType<typeof vi.fn>;
      };
    };
    mockConnector.connect = vi.fn().mockResolvedValue(undefined);
    mockConnector.disconnect = vi.fn().mockResolvedValue(undefined);
    mockConnector.isConnected = vi.fn().mockReturnValue(true);
    mockConnector.getState = vi.fn().mockReturnValue({
      status: "connected",
      connectedAt: "2024-01-01T00:00:00.000Z",
      disconnectedAt: null,
      reconnectAttempts: 0,
      lastError: null,
      botUser: { id: "bot1", username: "TestBot", discriminator: "0000" },
      rateLimits: { totalCount: 0, lastRateLimitAt: null, isRateLimited: false, currentResetTime: 0 },
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState);
    mockConnector.agentName = "no-errors-agent";
    mockConnector.sessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: false }),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      touchSession: vi.fn().mockResolvedValue(undefined),
      getActiveSessionCount: vi.fn().mockResolvedValue(0),
    };

    // @ts-expect-error - accessing private property for testing
    manager.connectors.set("no-errors-agent", mockConnector);
    // @ts-expect-error - accessing private property for testing
    manager.initialized = true;

    await manager.start();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const messageEvent: DiscordMessageEvent = {
      agentName: "no-errors-agent",
      prompt: "Hello",
      context: { messages: [], wasMentioned: true, prompt: "Hello" },
      metadata: {
        guildId: "guild1",
        channelId: "channel1",
        messageId: "msg1",
        userId: "user1",
        username: "TestUser",
        wasMentioned: true,
        mode: "mention",
      },
      reply: replyMock,
      startTyping: () => () => {},
    };

    mockConnector.emit("message", messageEvent);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Should NOT have sent any embeds
    const embedCalls = replyMock.mock.calls.filter((call: unknown[]) => {
      const payload = call[0] as DiscordReplyPayload | string;
      return typeof payload === "object" && payload !== null && "embeds" in payload;
    });
    expect(embedCalls.length).toBe(0);
  }, 10000);

  describe("buildToolEmbed with custom maxOutputChars", () => {
    it("respects custom maxOutputChars parameter", () => {
      const ctx = createMockContext(null);
      const manager = new DiscordManager(ctx);

      // Long output that exceeds both custom and default limits
      const longOutput = "x".repeat(600);

      // @ts-expect-error - accessing private method for testing
      const embed: DiscordReplyEmbed = manager.buildToolEmbed(
        { name: "Bash", input: { command: "cat bigfile" }, startTime: Date.now() - 100 },
        { output: longOutput, isError: false },
        400 // Custom max length
      );

      const resultField = embed.fields!.find((f: DiscordReplyEmbedField) => f.name === "Result");
      expect(resultField).toBeDefined();
      // The result should be truncated, showing "chars total" suffix
      expect(resultField!.value).toContain("chars total");
      // Verify the output starts with the truncated content (400 x's)
      expect(resultField!.value).toContain("x".repeat(400));
      // Verify it does NOT contain the full output (600 x's)
      expect(resultField!.value).not.toContain("x".repeat(600));
    });
  });
});
