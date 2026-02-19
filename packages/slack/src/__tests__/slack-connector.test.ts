import type { DMConfig, IChatSessionManager } from "@herdctl/chat";
import { describe, expect, it, vi } from "vitest";
import { SlackConnector } from "../slack-connector.js";
import type { SlackChannelConfig, SlackMessageEvent } from "../types.js";

const BOT_USER_ID = "U0123456789";
const CHANNEL_ID = "C_GENERAL";
const AGENT_NAME = "test-agent";

const createMockLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const createMockSessionManager = (
  overrides: Partial<IChatSessionManager> = {},
): IChatSessionManager => ({
  agentName: AGENT_NAME,
  platform: "slack",
  getOrCreateSession: vi.fn().mockResolvedValue({ sessionId: "s1", isNew: true }),
  getSession: vi.fn().mockResolvedValue(null),
  setSession: vi.fn().mockResolvedValue(undefined),
  touchSession: vi.fn().mockResolvedValue(undefined),
  clearSession: vi.fn().mockResolvedValue(true),
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
  getActiveSessionCount: vi.fn().mockResolvedValue(0),
  ...overrides,
});

/**
 * Helper to create a connector with a fake Bolt app and trigger handlers.
 *
 * We bypass connect() (which imports @slack/bolt) and instead inject a mock
 * app object, then call registerEventHandlers() via reflection.
 */
function createTestConnector(options?: {
  channels?: SlackChannelConfig[];
  dm?: Partial<DMConfig>;
  sessionManager?: IChatSessionManager;
}) {
  const channels = options?.channels ?? [{ id: CHANNEL_ID }];
  const sessionManager = options?.sessionManager ?? createMockSessionManager();

  const connector = new SlackConnector({
    agentName: AGENT_NAME,
    botToken: "xoxb-fake",
    appToken: "xapp-fake",
    channels,
    dm: options?.dm,
    sessionManager,
    logger: createMockLogger(),
  });

  // Collect registered handlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

  // Mock Bolt app
  const mockApp = {
    event: vi.fn((eventName: string, handler: (...args: unknown[]) => Promise<void>) => {
      handlers[`event:${eventName}`] = handler;
    }),
    message: vi.fn((handler: (...args: unknown[]) => Promise<void>) => {
      handlers.message = handler;
    }),
    client: {
      reactions: {
        add: vi.fn().mockResolvedValue({}),
        remove: vi.fn().mockResolvedValue({}),
      },
    },
  };

  // Inject mock app and botUserId via private field access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).app = mockApp;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).botUserId = BOT_USER_ID;

  // Trigger registerEventHandlers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (connector as any).registerEventHandlers();

  const say = vi.fn().mockResolvedValue(undefined);

  return { connector, handlers, say, mockApp, sessionManager };
}

// Helper to capture emitted message events
function captureMessages(connector: SlackConnector): SlackMessageEvent[] {
  const messages: SlackMessageEvent[] = [];
  connector.on("message", (msg: SlackMessageEvent) => messages.push(msg));
  return messages;
}

describe("SlackConnector registerEventHandlers", () => {
  describe("app_mention handler", () => {
    it("emits message event for @mention in configured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help me`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("help me");
      expect(messages[0].metadata.wasMentioned).toBe(true);
      expect(messages[0].metadata.channelId).toBe(CHANNEL_ID);
      expect(messages[0].metadata.isDM).toBe(false);
    });

    it("ignores @mention in unconfigured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("message handler — channel routing", () => {
    it("routes message in configured channel to agent", async () => {
      const { connector, handlers, say } = createTestConnector({
        channels: [{ id: CHANNEL_ID, mode: "auto" }],
      });
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello bot",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("hello bot");
      expect(messages[0].metadata.wasMentioned).toBe(false);
      expect(messages[0].metadata.channelId).toBe(CHANNEL_ID);
      expect(messages[0].metadata.isDM).toBe(false);
    });

    it("routes thread reply in configured channel to agent", async () => {
      const { connector, handlers, say } = createTestConnector({
        channels: [{ id: CHANNEL_ID, mode: "auto" }],
      });
      const messages = captureMessages(connector);

      // Thread reply — should still route via channel
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "follow up in thread",
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
          thread_ts: "1707930001.000001",
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].agentName).toBe(AGENT_NAME);
      expect(messages[0].prompt).toBe("follow up in thread");
    });

    it("ignores top-level message in mention-mode channel (default)", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello bot",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores message in unconfigured channel", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930001.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("@mention dedup", () => {
    it("message handler skips messages containing @mention (handled by app_mention)", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> do something`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Should be skipped — app_mention handler processes these
      expect(messages).toHaveLength(0);
    });

    it("app_mention and message for same @mention produce exactly one event", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      // Slack sends both events for an @mention
      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Only one message event should be emitted (from app_mention)
      expect(messages).toHaveLength(1);
      expect(messages[0].metadata.wasMentioned).toBe(true);
    });
  });

  describe("bot message filtering", () => {
    it("ignores messages from bots", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          bot_id: "BBOT123",
          text: "I am a bot",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores messages with bot_message subtype", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          subtype: "bot_message",
          user: "UUSER1",
          text: "bot subtype message",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("ignores messages from the bot itself", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: BOT_USER_ID,
          text: "my own message",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("message stats", () => {
    it("increments received and ignored counts correctly", async () => {
      const { connector, handlers, say } = createTestConnector();

      // Bot message -> received + ignored
      await handlers["event:message"]({
        event: {
          type: "message",
          bot_id: "BBOT123",
          text: "bot msg",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      // Unknown channel -> received + ignored
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930002.000001",
          channel: "C_UNKNOWN",
        },
        say,
      });

      // Top-level in configured channel with default mention mode -> also ignored
      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello bot",
          ts: "1707930003.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      const state = connector.getState();
      expect(state.messageStats.received).toBe(3);
      expect(state.messageStats.ignored).toBe(3);
    });
  });

  describe("reply function", () => {
    it("sends reply in the channel (no thread_ts)", async () => {
      const { connector, handlers, say } = createTestConnector({
        channels: [{ id: CHANNEL_ID, mode: "auto" }],
      });
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930001.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);

      await messages[0].reply("hi back!");

      expect(say).toHaveBeenCalledWith({
        text: "hi back!",
      });
    });

    it("converts markdown to mrkdwn in replies", async () => {
      const { connector, handlers, say } = createTestConnector({
        channels: [{ id: CHANNEL_ID, mode: "auto" }],
      });
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello",
          ts: "1707930002.000001",
          channel: CHANNEL_ID,
        },
        say,
      });

      await messages[0].reply("**bold** and [link](https://example.com)");

      const sentText = say.mock.calls[say.mock.calls.length - 1][0].text;
      expect(sentText).toContain("*bold*");
      expect(sentText).not.toContain("**bold**");
      expect(sentText).toContain("<https://example.com|link>");
    });
  });

  describe("DM handling", () => {
    const DM_CHANNEL_ID = "D069C7QFK";

    it("processes DM messages when DMs are enabled (default)", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello via DM",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].prompt).toBe("hello via DM");
      expect(messages[0].metadata.isDM).toBe(true);
      expect(messages[0].metadata.channelId).toBe(DM_CHANNEL_ID);
    });

    it("processes DM @mentions when DMs are enabled", async () => {
      const { connector, handlers, say } = createTestConnector();
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help via DM`,
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].prompt).toBe("help via DM");
      expect(messages[0].metadata.isDM).toBe(true);
      expect(messages[0].metadata.wasMentioned).toBe(true);
    });

    it("ignores DM messages when DMs are explicitly disabled", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: false, mode: "auto" },
      });
      const messages = captureMessages(connector);
      const ignored: Array<{ reason: string }> = [];
      connector.on("messageIgnored", (e) => ignored.push(e));

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello via DM",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
      expect(ignored).toHaveLength(1);
      expect(ignored[0].reason).toBe("dm_disabled");
    });

    it("ignores DM @mentions when DMs are disabled", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: false, mode: "auto" },
      });
      const messages = captureMessages(connector);
      const ignored: Array<{ reason: string }> = [];
      connector.on("messageIgnored", (e) => ignored.push(e));

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
      expect(ignored).toHaveLength(1);
      expect(ignored[0].reason).toBe("dm_disabled");
    });

    it("allows DM from user on allowlist", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "auto", allowlist: ["UUSER1"] },
      });
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "I am allowed",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].prompt).toBe("I am allowed");
    });

    it("blocks DM from user not on allowlist", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "auto", allowlist: ["UOTHER"] },
      });
      const messages = captureMessages(connector);
      const ignored: Array<{ reason: string }> = [];
      connector.on("messageIgnored", (e) => ignored.push(e));

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "I am not allowed",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
      expect(ignored).toHaveLength(1);
      expect(ignored[0].reason).toBe("dm_filtered");
    });

    it("blocks DM from user on blocklist", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "auto", blocklist: ["UUSER1"] },
      });
      const messages = captureMessages(connector);
      const ignored: Array<{ reason: string }> = [];
      connector.on("messageIgnored", (e) => ignored.push(e));

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "I am blocked",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
      expect(ignored).toHaveLength(1);
      expect(ignored[0].reason).toBe("dm_filtered");
    });

    it("blocklist takes precedence over allowlist", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "auto", allowlist: ["UUSER1"], blocklist: ["UUSER1"] },
      });
      const messages = captureMessages(connector);
      const ignored: Array<{ reason: string }> = [];
      connector.on("messageIgnored", (e) => ignored.push(e));

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "I am on both lists",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
      expect(ignored[0].reason).toBe("dm_filtered");
    });

    it("ignores DM without mention when DM mode is mention", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "mention" },
      });
      const messages = captureMessages(connector);

      await handlers["event:message"]({
        event: {
          type: "message",
          user: "UUSER1",
          text: "hello no mention",
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(0);
    });

    it("processes DM @mention when DM mode is mention", async () => {
      const { connector, handlers, say } = createTestConnector({
        dm: { enabled: true, mode: "mention" },
      });
      const messages = captureMessages(connector);

      await handlers["event:app_mention"]({
        event: {
          type: "app_mention",
          user: "UUSER1",
          text: `<@${BOT_USER_ID}> help`,
          ts: "1707930001.000001",
          channel: DM_CHANNEL_ID,
        },
        say,
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].metadata.isDM).toBe(true);
    });
  });

  describe("event handler registration", () => {
    it("registers both app_mention and message via app.event()", () => {
      const { mockApp } = createTestConnector();

      expect(mockApp.event).toHaveBeenCalledTimes(2);
      expect(mockApp.event).toHaveBeenCalledWith("app_mention", expect.any(Function));
      expect(mockApp.event).toHaveBeenCalledWith("message", expect.any(Function));
    });
  });
});
