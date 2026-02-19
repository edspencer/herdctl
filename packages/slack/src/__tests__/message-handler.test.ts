import { describe, expect, it } from "vitest";
import {
  isBotMentioned,
  processMessage,
  shouldProcessMessage,
  stripBotMention,
  stripMentions,
} from "../message-handler.js";

const BOT_USER_ID = "U0123456789";

describe("isBotMentioned", () => {
  it("returns true when bot is mentioned", () => {
    expect(isBotMentioned(`<@${BOT_USER_ID}> hello`, BOT_USER_ID)).toBe(true);
  });

  it("returns false when bot is not mentioned", () => {
    expect(isBotMentioned("hello world", BOT_USER_ID)).toBe(false);
  });

  it("returns false for different user mention", () => {
    expect(isBotMentioned("<@UOTHER123> hello", BOT_USER_ID)).toBe(false);
  });

  it("returns true when bot is mentioned in the middle", () => {
    expect(isBotMentioned(`hey <@${BOT_USER_ID}> do something`, BOT_USER_ID)).toBe(true);
  });
});

describe("stripBotMention", () => {
  it("removes bot mention from start", () => {
    expect(stripBotMention(`<@${BOT_USER_ID}> hello`, BOT_USER_ID)).toBe("hello");
  });

  it("removes bot mention from middle", () => {
    expect(stripBotMention(`hey <@${BOT_USER_ID}> do this`, BOT_USER_ID)).toBe("hey  do this");
  });

  it("removes multiple bot mentions", () => {
    const text = `<@${BOT_USER_ID}> hello <@${BOT_USER_ID}>`;
    expect(stripBotMention(text, BOT_USER_ID)).toBe("hello");
  });

  it("handles text with no mentions", () => {
    expect(stripBotMention("hello world", BOT_USER_ID)).toBe("hello world");
  });

  it("trims resulting text", () => {
    expect(stripBotMention(`  <@${BOT_USER_ID}>  `, BOT_USER_ID)).toBe("");
  });
});

describe("stripMentions", () => {
  it("removes all user mentions", () => {
    expect(stripMentions("<@U123> hello <@U456>")).toBe("hello");
  });

  it("handles text with no mentions", () => {
    expect(stripMentions("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripMentions("")).toBe("");
  });
});

describe("shouldProcessMessage", () => {
  it("returns true for regular user messages", () => {
    expect(shouldProcessMessage({ user: "UUSER123" }, BOT_USER_ID)).toBe(true);
  });

  it("returns false for bot messages", () => {
    expect(shouldProcessMessage({ bot_id: "BBOT123" }, BOT_USER_ID)).toBe(false);
  });

  it("returns false for bot_message subtype", () => {
    expect(shouldProcessMessage({ subtype: "bot_message", user: "UUSER123" }, BOT_USER_ID)).toBe(
      false,
    );
  });

  it("returns false for messages from the bot itself", () => {
    expect(shouldProcessMessage({ user: BOT_USER_ID }, BOT_USER_ID)).toBe(false);
  });

  it("returns true for thread replies from users", () => {
    expect(
      shouldProcessMessage({ user: "UUSER123", thread_ts: "1707930000.123456" }, BOT_USER_ID),
    ).toBe(true);
  });
});

describe("processMessage", () => {
  it("strips bot mention and returns prompt", () => {
    expect(processMessage(`<@${BOT_USER_ID}> help me`, BOT_USER_ID)).toBe("help me");
  });

  it("trims whitespace", () => {
    expect(processMessage(`  <@${BOT_USER_ID}>   hello  `, BOT_USER_ID)).toBe("hello");
  });

  it("returns full text if no bot mention", () => {
    expect(processMessage("just a message", BOT_USER_ID)).toBe("just a message");
  });

  it("handles empty text after mention removal", () => {
    expect(processMessage(`<@${BOT_USER_ID}>`, BOT_USER_ID)).toBe("");
  });
});
