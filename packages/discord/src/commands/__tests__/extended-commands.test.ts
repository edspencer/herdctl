import type { IChatSessionManager } from "@herdctl/chat";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { DiscordConnectorState } from "../../types.js";
import { newCommand } from "../new.js";
import { retryCommand } from "../retry.js";
import { sessionCommand } from "../session.js";
import { stopCommand } from "../stop.js";
import type { CommandContext } from "../types.js";

function makeContext(): CommandContext {
  const interaction = {
    channelId: "channel-1",
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;

  const sessionManager = {
    getSession: vi.fn().mockResolvedValue({
      sessionId: "session-1234567890abcdefghijkl",
      lastMessageAt: new Date().toISOString(),
    }),
    clearSession: vi.fn().mockResolvedValue(true),
  } as unknown as IChatSessionManager;

  return {
    interaction,
    client: {} as Client,
    agentName: "test-agent",
    sessionManager,
    connectorState: {
      status: "connected",
      connectedAt: new Date().toISOString(),
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
      messageStats: { received: 0, sent: 0, ignored: 0 },
    } satisfies DiscordConnectorState,
    commandActions: {
      stopRun: vi.fn().mockResolvedValue({ success: true, message: "stopped" }),
      retryRun: vi.fn().mockResolvedValue({ success: true, message: "retried" }),
      getSessionInfo: vi.fn().mockResolvedValue({
        activeJobId: "job-123",
        lastPrompt: "hello",
      }),
    },
  };
}

describe("extended commands", () => {
  it("executes /new", async () => {
    const ctx = makeContext();
    await newCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledOnce();
  });

  it("executes /session", async () => {
    const ctx = makeContext();
    await sessionCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledOnce();
  });

  it("executes /stop", async () => {
    const ctx = makeContext();
    await stopCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledOnce();
  });

  it("executes /retry", async () => {
    const ctx = makeContext();
    await retryCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledOnce();
  });
});
