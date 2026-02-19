import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetCommand } from "../reset.js";
import type { CommandContext } from "../types.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { IChatSessionManager } from "@herdctl/chat";
import type { DiscordConnectorState } from "../../types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockInteraction(channelId = "channel-123"): ChatInputCommandInteraction {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    channelId,
    user: {
      id: "user-123",
      username: "TestUser",
    },
    commandName: "reset",
  } as unknown as ChatInputCommandInteraction;
}

function createMockClient(): Client {
  return {
    user: {
      id: "bot-123",
      username: "TestBot",
    },
  } as unknown as Client;
}

function createMockSessionManager(): IChatSessionManager {
  return {
    agentName: "test-agent",
    platform: "discord",
    getOrCreateSession: vi.fn(),
    touchSession: vi.fn(),
    getSession: vi.fn(),
    setSession: vi.fn(),
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

function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    interaction: createMockInteraction(),
    client: createMockClient(),
    agentName: "test-agent",
    sessionManager: createMockSessionManager(),
    connectorState: createMockConnectorState(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("resetCommand", () => {
  it("has correct name and description", () => {
    expect(resetCommand.name).toBe("reset");
    expect(resetCommand.description).toBe("Clear conversation context (start fresh session)");
  });

  describe("when session exists", () => {
    it("clears the session", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const context = createMockContext({ sessionManager });

      await resetCommand.execute(context);

      expect(sessionManager.clearSession).toHaveBeenCalledWith("channel-123");
    });

    it("replies with confirmation message ephemerally", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const context = createMockContext({
        sessionManager,
        agentName: "my-agent",
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await resetCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("my-agent"),
        ephemeral: true,
      });
      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("cleared"),
        ephemeral: true,
      });
    });
  });

  describe("when no session exists", () => {
    it("replies with no session message", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const context = createMockContext({
        sessionManager,
        agentName: "my-agent",
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await resetCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.stringContaining("No active session"),
        ephemeral: true,
      });
    });

    it("still responds ephemerally", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const context = createMockContext({ sessionManager });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await resetCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          ephemeral: true,
        }),
      );
    });
  });

  it("uses the correct channel ID from interaction", async () => {
    const sessionManager = createMockSessionManager();
    (sessionManager.clearSession as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const interaction = createMockInteraction("specific-channel-456");
    const context = createMockContext({ sessionManager, interaction });

    await resetCommand.execute(context);

    expect(sessionManager.clearSession).toHaveBeenCalledWith("specific-channel-456");
  });
});
