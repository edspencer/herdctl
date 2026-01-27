import { describe, it, expect, vi, beforeEach } from "vitest";
import { helpCommand } from "../help.js";
import type { CommandContext } from "../types.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { ISessionManager } from "../../session-manager/index.js";
import type { DiscordConnectorState } from "../../types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockInteraction(): ChatInputCommandInteraction {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    channelId: "channel-123",
    user: {
      id: "user-123",
      username: "TestUser",
    },
    commandName: "help",
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

// =============================================================================
// Tests
// =============================================================================

describe("helpCommand", () => {
  it("has correct name and description", () => {
    expect(helpCommand.name).toBe("help");
    expect(helpCommand.description).toBe("Show available commands");
  });

  it("replies with ephemeral help message", async () => {
    const context = createMockContext();
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await helpCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
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

    await helpCommand.execute(context);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("my-custom-agent"),
      })
    );
  });

  it("includes command descriptions in response", async () => {
    const context = createMockContext();
    const interaction = context.interaction as unknown as {
      reply: ReturnType<typeof vi.fn>;
    };

    await helpCommand.execute(context);

    const call = interaction.reply.mock.calls[0][0];
    expect(call.content).toContain("/help");
    expect(call.content).toContain("/status");
    expect(call.content).toContain("/reset");
  });
});
