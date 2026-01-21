import { describe, it, expect, vi, beforeEach } from "vitest";
import { statusCommand } from "../status.js";
import type { CommandContext } from "../types.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ISessionManager, ChannelSession } from "../../session-manager/index.js";
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
    commandName: "status",
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

function createMockSessionManager(): ISessionManager {
  return {
    agentName: "test-agent",
    getOrCreateSession: vi.fn(),
    touchSession: vi.fn(),
    getSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupExpiredSessions: vi.fn(),
  };
}

function createMockConnectorState(
  overrides: Partial<DiscordConnectorState> = {}
): DiscordConnectorState {
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
    ...overrides,
  };
}

function createMockContext(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    interaction: createMockInteraction(),
    client: createMockClient(),
    agentName: "test-agent",
    sessionManager: createMockSessionManager(),
    connectorState: createMockConnectorState(),
    ...overrides,
  };
}

function createMockSession(sessionId = "test-session-123"): ChannelSession {
  return {
    sessionId,
    lastMessageAt: new Date().toISOString(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("statusCommand", () => {
  it("has correct name and description", () => {
    expect(statusCommand.name).toBe("status");
    expect(statusCommand.description).toBe("Show agent status and session info");
  });

  it("replies ephemerally", async () => {
    const context = createMockContext();
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await statusCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
      })
    );
  });

  it("includes agent name in response", async () => {
    const context = createMockContext({ agentName: "my-custom-agent" });
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await statusCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("my-custom-agent"),
      })
    );
  });

  it("includes connection status in response", async () => {
    const context = createMockContext({
      connectorState: createMockConnectorState({ status: "connected" }),
    });
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await statusCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("connected"),
      })
    );
  });

  it("includes bot username in response", async () => {
    const context = createMockContext({
      connectorState: createMockConnectorState({
        botUser: {
          id: "bot-123",
          username: "MyBot",
          discriminator: "0001",
        },
      }),
    });
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await statusCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("MyBot"),
      })
    );
  });

  describe("when session exists", () => {
    it("includes session info in response", async () => {
      const sessionManager = createMockSessionManager();
      const session = createMockSession("discord-test-agent-abc123");
      (sessionManager.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(
        session
      );

      const context = createMockContext({ sessionManager });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      const call = interaction.reply.mock.calls[0][0];
      expect(call.content).toContain("Session ID");
      expect(call.content).toContain("Last Activity");
    });

    it("queries session for correct channel", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const interaction = createMockInteraction("specific-channel-789");
      const context = createMockContext({ sessionManager, interaction });

      await statusCommand.execute(context);

      expect(sessionManager.getSession).toHaveBeenCalledWith(
        "specific-channel-789"
      );
    });
  });

  describe("when no session exists", () => {
    it("shows no active session message", async () => {
      const sessionManager = createMockSessionManager();
      (sessionManager.getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const context = createMockContext({ sessionManager });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("No active session"),
        })
      );
    });
  });

  describe("connection states", () => {
    it("shows reconnect attempts when > 0", async () => {
      const context = createMockContext({
        connectorState: createMockConnectorState({ reconnectAttempts: 3 }),
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Reconnect Attempts"),
        })
      );
    });

    it("does not show reconnect attempts when 0", async () => {
      const context = createMockContext({
        connectorState: createMockConnectorState({ reconnectAttempts: 0 }),
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      const call = interaction.reply.mock.calls[0][0];
      expect(call.content).not.toContain("Reconnect Attempts");
    });

    it("shows last error when present", async () => {
      const context = createMockContext({
        connectorState: createMockConnectorState({
          lastError: "Connection timeout",
        }),
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Connection timeout"),
        })
      );
    });

    it("shows uptime when connected", async () => {
      const connectedAt = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
      const context = createMockContext({
        connectorState: createMockConnectorState({ connectedAt }),
      });
      const interaction = context.interaction as unknown as {
        reply: ReturnType<typeof vi.fn>;
      };

      await statusCommand.execute(context);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Uptime"),
        })
      );
    });
  });
});
