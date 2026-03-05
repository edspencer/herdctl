import type { IChatSessionManager } from "@herdctl/chat";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { DiscordConnectorState } from "../../types.js";
import { configCommand } from "../config.js";
import { newCommand } from "../new.js";
import { pingCommand } from "../ping.js";
import { retryCommand } from "../retry.js";
import { sessionCommand } from "../session.js";
import { skillCommand } from "../skill.js";
import { skillsCommand } from "../skills.js";
import { stopCommand } from "../stop.js";
import { toolsCommand } from "../tools.js";
import type { CommandContext } from "../types.js";
import { usageCommand } from "../usage.js";

function makeContext(): CommandContext {
  const interaction = {
    channelId: "channel-1",
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn((key: string) => (key === "name" ? "pdf" : "inspect this file")),
    },
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
      runSkill: vi.fn().mockResolvedValue({ success: true, message: "skill started" }),
      listSkills: vi.fn().mockResolvedValue([{ name: "pdf", description: "Work with PDFs" }]),
      getUsage: vi.fn().mockResolvedValue({
        timestamp: new Date().toISOString(),
        numTurns: 2,
        inputTokens: 120,
        outputTokens: 30,
        isError: false,
      }),
      getCumulativeUsage: vi.fn().mockResolvedValue({
        totalRuns: 5,
        totalSuccesses: 4,
        totalFailures: 1,
        totalCostUsd: 0.1234,
        totalInputTokens: 5000,
        totalOutputTokens: 1200,
        totalDurationMs: 45000,
        firstRunAt: new Date(Date.now() - 3600000).toISOString(),
        lastRunAt: new Date().toISOString(),
      }),
      getAgentConfig: vi.fn().mockResolvedValue({
        runtime: "sdk",
        model: "claude-sonnet-4",
        permissionMode: "acceptEdits",
        workingDirectory: "/tmp/project",
        allowedTools: ["Read"],
        deniedTools: [],
        mcpServers: ["filesystem"],
      }),
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

  it("executes /skills and /skill", async () => {
    const ctx = makeContext();
    await skillsCommand.execute(ctx);
    await skillCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledTimes(2);
  });

  it("executes /usage, /tools, /config, and /ping", async () => {
    const ctx = makeContext();
    await usageCommand.execute(ctx);
    await toolsCommand.execute(ctx);
    await configCommand.execute(ctx);
    await pingCommand.execute(ctx);
    expect(ctx.interaction.reply).toHaveBeenCalledTimes(4);
  });

  it("/usage shows both last run and cumulative embeds", async () => {
    const ctx = makeContext();
    await usageCommand.execute(ctx);
    const call = (ctx.interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.embeds).toHaveLength(2);
    expect(call.embeds[0].title).toBe("Last Run");
    expect(call.embeds[1].title).toBe("Session Totals");
    expect(call.embeds[1].description).toContain("5");
    expect(call.embeds[1].description).toContain("4 ok");
    expect(call.ephemeral).toBe(true);
  });

  it("/usage shows only cumulative when no last run", async () => {
    const ctx = makeContext();
    ctx.commandActions!.getUsage = vi.fn().mockResolvedValue(null);
    await usageCommand.execute(ctx);
    const call = (ctx.interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.embeds).toHaveLength(1);
    expect(call.embeds[0].title).toBe("Session Totals");
  });

  it("/usage shows empty message when no data", async () => {
    const ctx = makeContext();
    ctx.commandActions!.getUsage = vi.fn().mockResolvedValue(null);
    ctx.commandActions!.getCumulativeUsage = vi.fn().mockResolvedValue({
      totalRuns: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalDurationMs: 0,
      firstRunAt: "",
      lastRunAt: "",
    });
    await usageCommand.execute(ctx);
    const call = (ctx.interaction.reply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.content).toContain("No usage data");
  });
});
