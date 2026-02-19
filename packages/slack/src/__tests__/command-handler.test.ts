import { describe, it, expect, vi } from "vitest";
import {
  CommandHandler,
  type PrefixCommand,
  type CommandContext,
} from "../commands/command-handler.js";
import type { IChatSessionManager } from "@herdctl/chat";
import type { SlackConnectorState } from "../types.js";

const createMockContext = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  agentName: "test-agent",
  channelId: "C0123456789",
  userId: "U0123456789",
  reply: vi.fn().mockResolvedValue(undefined),
  sessionManager: {
    agentName: "test-agent",
    getOrCreateSession: vi.fn(),
    touchSession: vi.fn(),
    getSession: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupExpiredSessions: vi.fn(),
    getActiveSessionCount: vi.fn(),
  } as unknown as IChatSessionManager,
  connectorState: {
    status: "connected",
    botUser: { id: "UBOT", username: "test-bot" },
    connectedAt: new Date().toISOString(),
    reconnectAttempts: 0,
    lastError: null,
  } as SlackConnectorState,
  ...overrides,
});

const createTestCommand = (name: string, executeFn?: PrefixCommand["execute"]): PrefixCommand => ({
  name,
  description: `Test ${name} command`,
  execute: executeFn ?? vi.fn().mockResolvedValue(undefined),
});

describe("CommandHandler", () => {
  describe("registerCommand", () => {
    it("registers a command", () => {
      const handler = new CommandHandler();
      const command = createTestCommand("test");

      handler.registerCommand(command);

      expect(handler.getCommands()).toHaveLength(1);
      expect(handler.getCommands()[0].name).toBe("test");
    });

    it("registers multiple commands", () => {
      const handler = new CommandHandler();

      handler.registerCommand(createTestCommand("cmd1"));
      handler.registerCommand(createTestCommand("cmd2"));

      expect(handler.getCommands()).toHaveLength(2);
    });
  });

  describe("isCommand", () => {
    it("returns true for registered commands", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("reset"));

      expect(handler.isCommand("!reset")).toBe(true);
    });

    it("returns false for unregistered commands", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("reset"));

      expect(handler.isCommand("!unknown")).toBe(false);
    });

    it("returns false for non-command messages", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("reset"));

      expect(handler.isCommand("hello")).toBe(false);
    });

    it("is case-insensitive", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("Reset"));

      expect(handler.isCommand("!RESET")).toBe(true);
      expect(handler.isCommand("!reset")).toBe(true);
    });

    it("handles commands with extra whitespace", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("reset"));

      expect(handler.isCommand("  !reset  ")).toBe(true);
    });

    it("handles commands with arguments", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("reset"));

      expect(handler.isCommand("!reset --force")).toBe(true);
    });
  });

  describe("executeCommand", () => {
    it("executes a registered command", async () => {
      const executeFn = vi.fn().mockResolvedValue(undefined);
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("test", executeFn));

      const context = createMockContext();
      const result = await handler.executeCommand("!test", context);

      expect(result).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(context);
    });

    it("returns false for non-command messages", async () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("test"));

      const context = createMockContext();
      const result = await handler.executeCommand("hello", context);

      expect(result).toBe(false);
    });

    it("returns false for unregistered commands", async () => {
      const handler = new CommandHandler();

      const context = createMockContext();
      const result = await handler.executeCommand("!unknown", context);

      expect(result).toBe(false);
    });

    it("handles command execution errors", async () => {
      const handler = new CommandHandler();
      handler.registerCommand(
        createTestCommand("fail", async () => {
          throw new Error("Command failed");
        }),
      );

      const context = createMockContext();
      const result = await handler.executeCommand("!fail", context);

      expect(result).toBe(true); // Command was attempted
      expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("error"));
    });

    it("handles reply error during error handling", async () => {
      const handler = new CommandHandler();
      handler.registerCommand(
        createTestCommand("fail", async () => {
          throw new Error("Command failed");
        }),
      );

      const context = createMockContext({
        reply: vi.fn().mockRejectedValue(new Error("Reply failed")),
      });

      // Should not throw
      const result = await handler.executeCommand("!fail", context);
      expect(result).toBe(true);
    });
  });

  describe("getCommands", () => {
    it("returns empty array when no commands registered", () => {
      const handler = new CommandHandler();
      expect(handler.getCommands()).toEqual([]);
    });

    it("returns all registered commands", () => {
      const handler = new CommandHandler();
      handler.registerCommand(createTestCommand("cmd1"));
      handler.registerCommand(createTestCommand("cmd2"));
      handler.registerCommand(createTestCommand("cmd3"));

      const commands = handler.getCommands();
      expect(commands).toHaveLength(3);
    });
  });
});
