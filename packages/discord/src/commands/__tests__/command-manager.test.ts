import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction, Client, REST } from "discord.js";
import type { ISessionManager } from "../../session-manager/index.js";
import type { DiscordConnectorState } from "../../types.js";

// =============================================================================
// Mock discord.js REST and Routes
// =============================================================================

const mockRestPut = vi.fn().mockResolvedValue([]);

vi.mock("discord.js", async () => {
  const actual = await vi.importActual<typeof import("discord.js")>("discord.js");

  // Create a mock REST class
  class MockREST {
    setToken() {
      return this;
    }
    put = mockRestPut;
  }

  return {
    ...actual,
    REST: MockREST,
    Routes: {
      applicationCommands: (clientId: string) => `/applications/${clientId}/commands`,
    },
  };
});

// Import after mock
import { CommandManager } from "../command-manager.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockClient(): Client {
  return {
    user: {
      id: "bot-123",
      username: "TestBot",
    },
  } as unknown as Client;
}

function createMockSessionManager(): ISessionManager {
  return {
    agentName: "test-agent",
    getOrCreateSession: vi.fn(),
    touchSession: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupExpiredSessions: vi.fn(),
    getActiveSessionCount: vi.fn(),
  };
}

function createMockConnectorState(): DiscordConnectorState {
  return {
    status: "connected",
    connectedAt: new Date().toISOString(),
    disconnectedAt: null,
    reconnectAttempts: 0,
    lastError: null,
    botUser: {
      id: "bot-123",
      username: "TestBot",
      discriminator: "0001",
    },
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
}

function createMockInteraction(
  commandName: string,
  channelId = "channel-123"
): ChatInputCommandInteraction {
  return {
    commandName,
    channelId,
    reply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
    user: {
      id: "user-123",
      username: "TestUser",
    },
  } as unknown as ChatInputCommandInteraction;
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("CommandManager", () => {
  let client: Client;
  let sessionManager: ISessionManager;
  let connectorState: DiscordConnectorState;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    sessionManager = createMockSessionManager();
    connectorState = createMockConnectorState();
    logger = createMockLogger();
  });

  describe("constructor", () => {
    it("creates command manager with valid options", () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      expect(manager).toBeDefined();
    });

    it("registers built-in commands", () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const commands = manager.getCommands();
      expect(commands.has("help")).toBe(true);
      expect(commands.has("reset")).toBe(true);
      expect(commands.has("status")).toBe(true);
    });
  });

  describe("registerCommands", () => {
    it("registers commands with Discord API", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      await manager.registerCommands();

      expect(mockRestPut).toHaveBeenCalledTimes(1);
      expect(mockRestPut).toHaveBeenCalledWith(
        expect.stringContaining("bot-123"),
        expect.objectContaining({
          body: expect.any(Array),
        })
      );
    });

    it("logs successful registration", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      await manager.registerCommands();

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Registering"),
        expect.any(Object)
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Successfully")
      );
    });

    it("throws when client user ID not available", async () => {
      const clientWithoutUser = {
        user: null,
      } as unknown as Client;

      const manager = new CommandManager({
        agentName: "test-agent",
        client: clientWithoutUser,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      await expect(manager.registerCommands()).rejects.toThrow(
        "Client user ID not available"
      );
    });

    it("logs error on registration failure", async () => {
      mockRestPut.mockRejectedValueOnce(new Error("API Error"));

      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      await expect(manager.registerCommands()).rejects.toThrow("API Error");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed"),
        expect.any(Object)
      );
    });
  });

  describe("handleInteraction", () => {
    it("executes known commands", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const interaction = createMockInteraction("help");
      await manager.handleInteraction(interaction);

      const reply = interaction.reply as ReturnType<typeof vi.fn>;
      expect(reply).toHaveBeenCalledTimes(1);
    });

    it("responds with error for unknown commands", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const interaction = createMockInteraction("unknown-command");
      await manager.handleInteraction(interaction);

      const reply = interaction.reply as ReturnType<typeof vi.fn>;
      expect(reply).toHaveBeenCalledWith({
        content: "Unknown command.",
        ephemeral: true,
      });
    });

    it("logs warning for unknown commands", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const interaction = createMockInteraction("unknown-command");
      await manager.handleInteraction(interaction);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Unknown command"),
        expect.any(Object)
      );
    });

    it("logs command execution", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const interaction = createMockInteraction("help");
      await manager.handleInteraction(interaction);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Executing"),
        expect.objectContaining({
          commandName: "help",
        })
      );
    });

    it("handles command execution errors gracefully", async () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      // Create an interaction that will fail when executing
      const interaction = createMockInteraction("reset");
      (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Session error")
      );

      await manager.handleInteraction(interaction);

      // ErrorHandler logs with different format
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error during"),
        expect.any(Object)
      );

      const reply = interaction.reply as ReturnType<typeof vi.fn>;
      // User-friendly error message (no stack traces)
      expect(reply).toHaveBeenCalledWith({
        content: "Sorry, I encountered an error processing your request. Please try again.",
        ephemeral: true,
      });
    });

    it("provides correct context to command handler", async () => {
      const manager = new CommandManager({
        agentName: "my-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const interaction = createMockInteraction("help");
      await manager.handleInteraction(interaction);

      const reply = interaction.reply as ReturnType<typeof vi.fn>;
      // Help command should include agent name in response
      expect(reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("my-agent"),
        })
      );
    });
  });

  describe("getCommands", () => {
    it("returns readonly map of commands", () => {
      const manager = new CommandManager({
        agentName: "test-agent",
        client,
        botToken: "test-token",
        sessionManager,
        getConnectorState: () => connectorState,
        logger,
      });

      const commands = manager.getCommands();

      expect(commands).toBeInstanceOf(Map);
      expect(commands.size).toBe(3);
    });
  });
});
