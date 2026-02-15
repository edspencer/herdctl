import { describe, it, expect } from "vitest";
import {
  markdownToMrkdwn,
  splitMessage,
  findSplitPoint,
  needsSplit,
  createContextAttachment,
  truncateMessage,
  formatCodeBlock,
  escapeMrkdwn,
  SLACK_MAX_MESSAGE_LENGTH,
  MIN_CHUNK_SIZE,
} from "../formatting.js";

describe("markdownToMrkdwn", () => {
  it("converts bold markdown to mrkdwn", () => {
    expect(markdownToMrkdwn("**hello**")).toBe("*hello*");
  });

  it("converts multiple bold segments", () => {
    expect(markdownToMrkdwn("**hello** world **foo**")).toBe(
      "*hello* world *foo*"
    );
  });

  it("preserves italic (same in both formats)", () => {
    expect(markdownToMrkdwn("_hello_")).toBe("_hello_");
  });

  it("converts links to mrkdwn format", () => {
    expect(markdownToMrkdwn("[click here](https://example.com)")).toBe(
      "<https://example.com|click here>"
    );
  });

  it("handles multiple links", () => {
    const input = "[link1](https://a.com) and [link2](https://b.com)";
    const expected = "<https://a.com|link1> and <https://b.com|link2>";
    expect(markdownToMrkdwn(input)).toBe(expected);
  });

  it("preserves inline code", () => {
    expect(markdownToMrkdwn("`code here`")).toBe("`code here`");
  });

  it("preserves code blocks and does not transform inside them", () => {
    const input = "text **bold** ```\n**not bold**\n``` after";
    const result = markdownToMrkdwn(input);
    expect(result).toContain("*bold*");
    expect(result).toContain("**not bold**");
  });

  it("preserves inline code content", () => {
    const input = "text **bold** `**not bold**` after";
    const result = markdownToMrkdwn(input);
    expect(result).toContain("*bold*");
    expect(result).toContain("`**not bold**`");
  });

  it("handles text with no markdown", () => {
    expect(markdownToMrkdwn("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(markdownToMrkdwn("")).toBe("");
  });
});

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    const result = splitMessage("Hello world");

    expect(result.chunks).toEqual(["Hello world"]);
    expect(result.wasSplit).toBe(false);
    expect(result.originalLength).toBe(11);
  });

  it("splits long messages at paragraph boundaries", () => {
    const paragraph1 = "a".repeat(2000);
    const paragraph2 = "b".repeat(2000);
    const content = `${paragraph1}\n\n${paragraph2}`;

    const result = splitMessage(content);

    expect(result.wasSplit).toBe(true);
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("splits at sentence boundaries when no paragraphs", () => {
    const sentence = "This is a sentence. ";
    const content = sentence.repeat(300); // ~6000 chars

    const result = splitMessage(content);

    expect(result.wasSplit).toBe(true);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(SLACK_MAX_MESSAGE_LENGTH);
    }
  });

  it("respects custom maxLength", () => {
    const content = "a".repeat(500);
    const result = splitMessage(content, { maxLength: 200 });

    expect(result.wasSplit).toBe(true);
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("handles preserveBoundaries=false", () => {
    const content = "a".repeat(500);
    const result = splitMessage(content, {
      maxLength: 200,
      preserveBoundaries: false,
    });

    expect(result.wasSplit).toBe(true);
  });
});

describe("findSplitPoint", () => {
  it("returns text length if under max", () => {
    expect(findSplitPoint("hello", 100)).toBe(5);
  });

  it("splits at paragraph boundary", () => {
    const text = "a".repeat(200) + "\n\n" + "b".repeat(200);
    const splitIndex = findSplitPoint(text, 250);

    expect(splitIndex).toBeLessThanOrEqual(250);
    expect(splitIndex).toBeGreaterThan(MIN_CHUNK_SIZE);
  });

  it("splits at newline if no paragraph boundary", () => {
    const text = "a".repeat(200) + "\n" + "b".repeat(200);
    const splitIndex = findSplitPoint(text, 250);

    expect(splitIndex).toBeLessThanOrEqual(250);
    expect(splitIndex).toBeGreaterThan(MIN_CHUNK_SIZE);
  });

  it("falls back to hard split at maxLength", () => {
    const text = "a".repeat(500); // No split points
    const splitIndex = findSplitPoint(text, 200);

    expect(splitIndex).toBe(200);
  });
});

describe("needsSplit", () => {
  it("returns false for short messages", () => {
    expect(needsSplit("Hello")).toBe(false);
  });

  it("returns true for messages exceeding default limit", () => {
    expect(needsSplit("a".repeat(SLACK_MAX_MESSAGE_LENGTH + 1))).toBe(true);
  });

  it("respects custom maxLength", () => {
    expect(needsSplit("hello world", 5)).toBe(true);
    expect(needsSplit("hello world", 100)).toBe(false);
  });
});

describe("createContextAttachment", () => {
  it("creates green attachment for high context", () => {
    const attachment = createContextAttachment(80);

    expect(attachment.footer).toBe("Context: 80% remaining");
    expect(attachment.color).toBe("#36a64f");
  });

  it("creates red attachment for low context", () => {
    const attachment = createContextAttachment(15);

    expect(attachment.footer).toBe("Context: 15% remaining");
    expect(attachment.color).toBe("#ff0000");
  });

  it("uses red threshold at 20%", () => {
    expect(createContextAttachment(20).color).toBe("#36a64f");
    expect(createContextAttachment(19).color).toBe("#ff0000");
  });

  it("rounds the percentage", () => {
    expect(createContextAttachment(33.7).footer).toBe(
      "Context: 34% remaining"
    );
  });
});

describe("truncateMessage", () => {
  it("returns message unchanged if under limit", () => {
    expect(truncateMessage("hello")).toBe("hello");
  });

  it("truncates and adds ellipsis", () => {
    const result = truncateMessage("hello world", 8);
    expect(result).toBe("hello...");
    expect(result.length).toBe(8);
  });

  it("uses custom ellipsis", () => {
    const result = truncateMessage("hello world", 9, " [more]");
    expect(result).toBe("he [more]");
  });

  it("uses default max length", () => {
    const shortMsg = "a".repeat(100);
    expect(truncateMessage(shortMsg)).toBe(shortMsg);
  });
});

describe("formatCodeBlock", () => {
  it("formats code without language", () => {
    expect(formatCodeBlock("const x = 1")).toBe("```\nconst x = 1\n```");
  });

  it("formats code with language", () => {
    expect(formatCodeBlock("const x = 1", "typescript")).toBe(
      "```typescript\nconst x = 1\n```"
    );
  });
});

describe("escapeMrkdwn", () => {
  it("escapes mrkdwn special characters", () => {
    expect(escapeMrkdwn("*bold*")).toBe("\\*bold\\*");
    expect(escapeMrkdwn("_italic_")).toBe("\\_italic\\_");
    expect(escapeMrkdwn("~strike~")).toBe("\\~strike\\~");
    expect(escapeMrkdwn("<link>")).toBe("\\<link\\>");
  });

  it("handles text with no special characters", () => {
    expect(escapeMrkdwn("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(escapeMrkdwn("")).toBe("");
  });
});
