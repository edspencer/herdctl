import { describe, it, expect, vi } from "vitest";
import type { Message, Snowflake } from "discord.js";
import {
  isBotMentioned,
  shouldProcessMessage,
  stripBotMention,
  stripMentions,
  processMessage,
  buildConversationContext,
  formatContextForPrompt,
  type TextBasedChannel,
  type ConversationContext,
  type ContextMessage,
} from "../mention-handler.js";

// =============================================================================
// Mock Types
// =============================================================================

// Use simplified mock types to avoid discord.js type complexity in tests
interface MockUser {
  id: string;
  username: string;
  displayName?: string;
  bot: boolean;
}

interface MockMentions {
  users: Map<string, MockUser>;
  roles: Map<string, { members: Map<string, unknown> }>;
}

interface MockMessage {
  id: string;
  content: string;
  author: MockUser;
  createdAt: Date;
  mentions: MockMentions;
  channel: MockChannel;
  guildId: string | null;
}

interface MockChannel {
  id: string;
  send: ReturnType<typeof vi.fn>;
  messages: {
    fetch: ReturnType<typeof vi.fn>;
  };
}

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: "user-123",
    username: "testuser",
    displayName: "Test User",
    bot: false,
    ...overrides,
  };
}

function createMockMessage(overrides: Partial<MockMessage> = {}): Message {
  const mockMentions: MockMentions = {
    users: new Map<string, MockUser>(),
    roles: new Map<string, { members: Map<string, unknown> }>(),
    ...(overrides.mentions as Partial<MockMentions>),
  };

  const base: MockMessage = {
    id: "message-123",
    content: "Hello world",
    author: createMockUser(),
    createdAt: new Date("2024-01-20T10:00:00Z"),
    mentions: mockMentions,
    channel: {
      id: "channel-123",
      send: vi.fn(),
      messages: {
        fetch: vi.fn(),
      },
    },
    guildId: "guild-123",
  };

  return {
    ...base,
    ...overrides,
    mentions: mockMentions,
  } as unknown as Message;
}

function createMockChannel(messages: Message[] = []): TextBasedChannel {
  const mockCollection = new Map<Snowflake, Message>();
  messages.forEach((msg) => mockCollection.set(msg.id, msg));

  return {
    id: "channel-123",
    send: vi.fn(),
    messages: {
      fetch: vi.fn().mockResolvedValue(mockCollection),
    },
  } as unknown as TextBasedChannel;
}

// =============================================================================
// isBotMentioned Tests
// =============================================================================

describe("isBotMentioned", () => {
  it("returns true when bot is mentioned", () => {
    const botUser = createMockUser({ id: "bot-123", bot: true });
    const mentionsMap = new Map<string, MockUser>();
    mentionsMap.set("bot-123", botUser);

    const message = createMockMessage({
      content: "<@bot-123> help me",
      mentions: { users: mentionsMap, roles: new Map() },
    });

    expect(isBotMentioned(message, "bot-123")).toBe(true);
  });

  it("returns false when bot is not mentioned", () => {
    const message = createMockMessage({
      content: "Hello everyone",
    });

    expect(isBotMentioned(message, "bot-123")).toBe(false);
  });

  it("returns false when different user is mentioned", () => {
    const otherUser = createMockUser({ id: "other-user" });
    const mentionsMap = new Map<string, MockUser>();
    mentionsMap.set("other-user", otherUser);

    const message = createMockMessage({
      content: "<@other-user> hello",
      mentions: { users: mentionsMap, roles: new Map() },
    });

    expect(isBotMentioned(message, "bot-123")).toBe(false);
  });
});

// =============================================================================
// shouldProcessMessage Tests
// =============================================================================

describe("shouldProcessMessage", () => {
  const botUserId = "bot-123";

  describe("mention mode", () => {
    it("returns true when bot is mentioned", () => {
      const botUser = createMockUser({ id: botUserId, bot: true });
      const mentionsMap = new Map<string, MockUser>();
      mentionsMap.set(botUserId, botUser);

      const message = createMockMessage({
        content: "<@bot-123> help me",
        mentions: { users: mentionsMap, roles: new Map() },
      });

      expect(shouldProcessMessage(message, botUserId, "mention")).toBe(true);
    });

    it("returns false when bot is not mentioned", () => {
      const message = createMockMessage({
        content: "Hello everyone",
      });

      expect(shouldProcessMessage(message, botUserId, "mention")).toBe(false);
    });

    it("returns false for bot messages even when mentioned", () => {
      const botUser = createMockUser({ id: botUserId, bot: true });
      const mentionsMap = new Map<string, MockUser>();
      mentionsMap.set(botUserId, botUser);

      const message = createMockMessage({
        content: "<@bot-123> test",
        author: createMockUser({ bot: true }),
        mentions: { users: mentionsMap, roles: new Map() },
      });

      expect(shouldProcessMessage(message, botUserId, "mention")).toBe(false);
    });
  });

  describe("auto mode", () => {
    it("returns true for non-bot messages", () => {
      const message = createMockMessage({
        content: "Hello world",
      });

      expect(shouldProcessMessage(message, botUserId, "auto")).toBe(true);
    });

    it("returns false for bot messages", () => {
      const message = createMockMessage({
        content: "Hello world",
        author: createMockUser({ bot: true }),
      });

      expect(shouldProcessMessage(message, botUserId, "auto")).toBe(false);
    });

    it("returns true regardless of mention status", () => {
      const message = createMockMessage({
        content: "No mention here",
      });

      expect(shouldProcessMessage(message, botUserId, "auto")).toBe(true);
    });
  });
});

// =============================================================================
// stripBotMention Tests
// =============================================================================

describe("stripBotMention", () => {
  const botUserId = "123456789";

  it("strips regular mention format", () => {
    const content = "<@123456789> help me with this";
    expect(stripBotMention(content, botUserId)).toBe("help me with this");
  });

  it("strips nickname mention format", () => {
    const content = "<@!123456789> help me with this";
    expect(stripBotMention(content, botUserId)).toBe("help me with this");
  });

  it("strips multiple mentions of the same bot", () => {
    const content = "<@123456789> hello <@123456789>";
    expect(stripBotMention(content, botUserId)).toBe("hello");
  });

  it("preserves mentions of other users", () => {
    const content = "<@123456789> <@987654321> hello";
    expect(stripBotMention(content, botUserId)).toBe("<@987654321> hello");
  });

  it("handles content with no mentions", () => {
    const content = "Hello world";
    expect(stripBotMention(content, botUserId)).toBe("Hello world");
  });

  it("handles content that is only the mention", () => {
    const content = "<@123456789>";
    expect(stripBotMention(content, botUserId)).toBe("");
  });

  it("trims whitespace after stripping", () => {
    const content = "   <@123456789>   help   ";
    expect(stripBotMention(content, botUserId)).toBe("help");
  });

  it("handles mention at the end of message", () => {
    const content = "Hello <@123456789>";
    expect(stripBotMention(content, botUserId)).toBe("Hello");
  });

  it("handles mention in the middle of message", () => {
    const content = "Hello <@123456789> world";
    expect(stripBotMention(content, botUserId)).toBe("Hello  world");
  });
});

// =============================================================================
// stripMentions Tests
// =============================================================================

describe("stripMentions", () => {
  it("strips specific bot mention when botUserId provided", () => {
    const content = "<@123456789> <@987654321> hello";
    expect(stripMentions(content, "123456789")).toBe("<@987654321> hello");
  });

  it("strips all mentions when no botUserId provided", () => {
    const content = "<@123456789> <@987654321> hello";
    expect(stripMentions(content)).toBe("hello");
  });

  it("strips nickname format mentions", () => {
    const content = "<@!123456789> hello";
    expect(stripMentions(content)).toBe("hello");
  });

  it("handles content with no mentions", () => {
    const content = "Hello world";
    expect(stripMentions(content)).toBe("Hello world");
  });
});

// =============================================================================
// processMessage Tests
// =============================================================================

describe("processMessage", () => {
  const botUserId = "bot-123";

  it("processes a regular user message", () => {
    const message = createMockMessage({
      id: "msg-123",
      content: "<@bot-123> help me please",
      author: createMockUser({
        id: "user-456",
        username: "testuser",
        displayName: "Test User",
      }),
      createdAt: new Date("2024-01-20T10:00:00Z"),
    });

    const result = processMessage(message, botUserId);

    expect(result).toEqual({
      authorId: "user-456",
      authorName: "Test User",
      isBot: false,
      isSelf: false,
      content: "help me please",
      timestamp: "2024-01-20T10:00:00.000Z",
      messageId: "msg-123",
    });
  });

  it("identifies bot messages correctly", () => {
    const message = createMockMessage({
      author: createMockUser({ id: "some-bot", bot: true }),
    });

    const result = processMessage(message, botUserId);
    expect(result.isBot).toBe(true);
    expect(result.isSelf).toBe(false);
  });

  it("identifies self messages correctly", () => {
    const message = createMockMessage({
      author: createMockUser({ id: botUserId, bot: true }),
    });

    const result = processMessage(message, botUserId);
    expect(result.isBot).toBe(true);
    expect(result.isSelf).toBe(true);
  });

  it("uses username when displayName is not available", () => {
    const message = createMockMessage({
      author: createMockUser({
        id: "user-456",
        username: "testuser",
        displayName: undefined,
      }),
    });

    const result = processMessage(message, botUserId);
    expect(result.authorName).toBe("testuser");
  });
});

// =============================================================================
// buildConversationContext Tests
// =============================================================================

describe("buildConversationContext", () => {
  const botUserId = "bot-123";

  it("builds context with message history", async () => {
    // Create history messages (older messages first)
    const historyMessages = [
      createMockMessage({
        id: "msg-1",
        content: "First message",
        createdAt: new Date("2024-01-20T09:58:00Z"),
        author: createMockUser({ id: "user-1", username: "user1" }),
      }),
      createMockMessage({
        id: "msg-2",
        content: "Second message",
        createdAt: new Date("2024-01-20T09:59:00Z"),
        author: createMockUser({ id: "user-2", username: "user2" }),
      }),
    ];

    const channel = createMockChannel(historyMessages);

    // Trigger message with mention
    const botUser = createMockUser({ id: botUserId, bot: true });
    const mentionsMap = new Map<string, MockUser>();
    mentionsMap.set(botUserId, botUser);

    const triggerMessage = createMockMessage({
      id: "msg-3",
      content: "<@bot-123> help me please",
      createdAt: new Date("2024-01-20T10:00:00Z"),
      mentions: { users: mentionsMap, roles: new Map() },
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId, {
      maxMessages: 10,
    });

    expect(context.prompt).toBe("help me please");
    expect(context.wasMentioned).toBe(true);
    expect(context.messages).toHaveLength(2);
    // Messages should be in chronological order
    expect(context.messages[0].content).toBe("First message");
    expect(context.messages[1].content).toBe("Second message");
  });

  it("respects maxMessages limit", async () => {
    const historyMessages = Array.from({ length: 20 }, (_, i) =>
      createMockMessage({
        id: `msg-${i}`,
        content: `Message ${i}`,
        createdAt: new Date(`2024-01-20T09:${String(i).padStart(2, "0")}:00Z`),
        author: createMockUser({ id: `user-${i}` }),
      }),
    );

    const channel = createMockChannel(historyMessages);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "trigger message",
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId, {
      maxMessages: 5,
    });

    expect(context.messages).toHaveLength(5);
  });

  it("filters out empty messages", async () => {
    const historyMessages = [
      createMockMessage({
        id: "msg-1",
        content: "Valid message",
        createdAt: new Date("2024-01-20T09:58:00Z"),
      }),
      createMockMessage({
        id: "msg-2",
        content: "", // Empty message
        createdAt: new Date("2024-01-20T09:59:00Z"),
      }),
      createMockMessage({
        id: "msg-3",
        content: "   ", // Whitespace only
        createdAt: new Date("2024-01-20T09:59:30Z"),
      }),
    ];

    const channel = createMockChannel(historyMessages);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "trigger message",
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId, {
      maxMessages: 10,
    });

    expect(context.messages).toHaveLength(1);
    expect(context.messages[0].content).toBe("Valid message");
  });

  it("filters out bot messages when includeBotMessages is false", async () => {
    const historyMessages = [
      createMockMessage({
        id: "msg-1",
        content: "User message",
        author: createMockUser({ id: "user-1", bot: false }),
        createdAt: new Date("2024-01-20T09:58:00Z"),
      }),
      createMockMessage({
        id: "msg-2",
        content: "Bot response",
        author: createMockUser({ id: botUserId, bot: true }),
        createdAt: new Date("2024-01-20T09:59:00Z"),
      }),
    ];

    const channel = createMockChannel(historyMessages);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "trigger message",
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId, {
      maxMessages: 10,
      includeBotMessages: false,
    });

    expect(context.messages).toHaveLength(1);
    expect(context.messages[0].content).toBe("User message");
  });

  it("prioritizes user messages when enabled", async () => {
    // Create 5 bot messages and 3 user messages
    const historyMessages = [
      createMockMessage({
        id: "user-1",
        content: "User 1",
        author: createMockUser({ id: "user-1", bot: false }),
        createdAt: new Date("2024-01-20T09:50:00Z"),
      }),
      createMockMessage({
        id: "bot-1",
        content: "Bot 1",
        author: createMockUser({ id: "bot-other", bot: true }),
        createdAt: new Date("2024-01-20T09:51:00Z"),
      }),
      createMockMessage({
        id: "bot-2",
        content: "Bot 2",
        author: createMockUser({ id: "bot-other", bot: true }),
        createdAt: new Date("2024-01-20T09:52:00Z"),
      }),
      createMockMessage({
        id: "user-2",
        content: "User 2",
        author: createMockUser({ id: "user-2", bot: false }),
        createdAt: new Date("2024-01-20T09:53:00Z"),
      }),
      createMockMessage({
        id: "bot-3",
        content: "Bot 3",
        author: createMockUser({ id: "bot-other", bot: true }),
        createdAt: new Date("2024-01-20T09:54:00Z"),
      }),
      createMockMessage({
        id: "user-3",
        content: "User 3",
        author: createMockUser({ id: "user-3", bot: false }),
        createdAt: new Date("2024-01-20T09:55:00Z"),
      }),
      createMockMessage({
        id: "bot-4",
        content: "Bot 4",
        author: createMockUser({ id: "bot-other", bot: true }),
        createdAt: new Date("2024-01-20T09:56:00Z"),
      }),
      createMockMessage({
        id: "bot-5",
        content: "Bot 5",
        author: createMockUser({ id: "bot-other", bot: true }),
        createdAt: new Date("2024-01-20T09:57:00Z"),
      }),
    ];

    const channel = createMockChannel(historyMessages);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "trigger message",
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId, {
      maxMessages: 5,
      prioritizeUserMessages: true,
    });

    // Should include all 3 user messages and 2 bot messages to fill up to 5
    expect(context.messages).toHaveLength(5);
    const userMessages = context.messages.filter((m) => !m.isBot);
    expect(userMessages).toHaveLength(3);
  });

  it("returns correct wasMentioned for mentions", async () => {
    const channel = createMockChannel([]);

    const botUser = createMockUser({ id: botUserId, bot: true });
    const mentionsMap = new Map<string, MockUser>();
    mentionsMap.set(botUserId, botUser);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "<@bot-123> hello",
      mentions: { users: mentionsMap, roles: new Map() },
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId);

    expect(context.wasMentioned).toBe(true);
  });

  it("returns correct wasMentioned when not mentioned", async () => {
    const channel = createMockChannel([]);

    const triggerMessage = createMockMessage({
      id: "trigger",
      content: "hello",
      channel: channel as unknown as MockChannel,
    });

    const context = await buildConversationContext(triggerMessage, channel, botUserId);

    expect(context.wasMentioned).toBe(false);
  });
});

// =============================================================================
// formatContextForPrompt Tests
// =============================================================================

describe("formatContextForPrompt", () => {
  it("formats messages correctly", () => {
    const context: ConversationContext = {
      messages: [
        {
          authorId: "user-1",
          authorName: "Alice",
          isBot: false,
          isSelf: false,
          content: "How do I use this?",
          timestamp: "2024-01-20T10:00:00.000Z",
          messageId: "msg-1",
        },
        {
          authorId: "bot-1",
          authorName: "HelperBot",
          isBot: true,
          isSelf: true,
          content: "Here is how you can use it...",
          timestamp: "2024-01-20T10:00:30.000Z",
          messageId: "msg-2",
        },
        {
          authorId: "user-1",
          authorName: "Alice",
          isBot: false,
          isSelf: false,
          content: "Thanks, but what about...",
          timestamp: "2024-01-20T10:01:00.000Z",
          messageId: "msg-3",
        },
      ],
      prompt: "Can you explain more?",
      wasMentioned: true,
    };

    const formatted = formatContextForPrompt(context);

    expect(formatted).toContain("[Alice at 2024-01-20T10:00:00.000Z]: How do I use this?");
    expect(formatted).toContain(
      "[HelperBot (bot) at 2024-01-20T10:00:30.000Z]: Here is how you can use it...",
    );
    expect(formatted).toContain("[Alice at 2024-01-20T10:01:00.000Z]: Thanks, but what about...");
  });

  it("returns empty string for empty messages", () => {
    const context: ConversationContext = {
      messages: [],
      prompt: "Hello",
      wasMentioned: false,
    };

    expect(formatContextForPrompt(context)).toBe("");
  });

  it("marks bot messages with (bot) label", () => {
    const context: ConversationContext = {
      messages: [
        {
          authorId: "bot-1",
          authorName: "BotName",
          isBot: true,
          isSelf: false,
          content: "Bot message",
          timestamp: "2024-01-20T10:00:00.000Z",
          messageId: "msg-1",
        },
      ],
      prompt: "Test",
      wasMentioned: false,
    };

    const formatted = formatContextForPrompt(context);
    expect(formatted).toContain("BotName (bot)");
  });

  it("does not mark user messages with (bot) label", () => {
    const context: ConversationContext = {
      messages: [
        {
          authorId: "user-1",
          authorName: "UserName",
          isBot: false,
          isSelf: false,
          content: "User message",
          timestamp: "2024-01-20T10:00:00.000Z",
          messageId: "msg-1",
        },
      ],
      prompt: "Test",
      wasMentioned: false,
    };

    const formatted = formatContextForPrompt(context);
    expect(formatted).not.toContain("(bot)");
    expect(formatted).toContain("[UserName at");
  });
});
