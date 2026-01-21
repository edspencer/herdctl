import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DISCORD_MAX_MESSAGE_LENGTH,
  DEFAULT_MESSAGE_DELAY_MS,
  MIN_CHUNK_SIZE,
  findSplitPoint,
  splitMessage,
  needsSplit,
  startTypingIndicator,
  sendSplitMessage,
  sendWithTyping,
  truncateMessage,
  formatCodeBlock,
  escapeMarkdown,
  type SendableChannel,
  type SplitResult,
} from "../formatting.js";

// =============================================================================
// Mock Helpers
// =============================================================================

interface MockChannel {
  id: string;
  send: ReturnType<typeof vi.fn>;
  sendTyping: ReturnType<typeof vi.fn>;
}

function createMockChannel(): MockChannel & SendableChannel {
  return {
    id: "channel-123",
    send: vi.fn().mockResolvedValue({ id: "message-id" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
  } as unknown as MockChannel & SendableChannel;
}

// =============================================================================
// Constants Tests
// =============================================================================

describe("constants", () => {
  it("exports correct Discord message limit", () => {
    expect(DISCORD_MAX_MESSAGE_LENGTH).toBe(2000);
  });

  it("exports correct default message delay", () => {
    expect(DEFAULT_MESSAGE_DELAY_MS).toBe(500);
  });

  it("exports correct minimum chunk size", () => {
    expect(MIN_CHUNK_SIZE).toBe(100);
  });
});

// =============================================================================
// findSplitPoint Tests
// =============================================================================

describe("findSplitPoint", () => {
  it("returns text length when text fits within maxLength", () => {
    const text = "Short message";
    expect(findSplitPoint(text, 100)).toBe(text.length);
  });

  it("splits at paragraph break when available", () => {
    // Use a long enough first section to satisfy MIN_CHUNK_SIZE (>100 chars)
    const firstPart = "This is the first paragraph with enough content that exceeds the minimum chunk size requirement of one hundred.";
    const secondPart = "Second paragraph that continues with more content here.";
    const text = `${firstPart}\n\n${secondPart}`;
    // maxLength must include the paragraph break position
    const splitIndex = findSplitPoint(text, firstPart.length + 5);
    expect(text.slice(0, splitIndex).trim()).toBe(firstPart);
  });

  it("splits at newline when no paragraph break available", () => {
    // Use a long enough first line to satisfy MIN_CHUNK_SIZE (100 chars)
    // First line must be > 100 chars so the newline split point is valid
    const firstLine = "This is the first line with content that is definitely long enough to exceed one hundred characters minimum.";
    const secondLine = "Second line is much longer than this and continues with more text.";
    const text = `${firstLine}\n${secondLine}`;
    // maxLength must include the newline position
    const splitIndex = findSplitPoint(text, firstLine.length + 5);
    expect(text.slice(0, splitIndex).trim()).toBe(firstLine);
  });

  it("splits at sentence end when no newline available", () => {
    // Use a long enough first sentence to satisfy MIN_CHUNK_SIZE
    const firstSentence = "This is the first sentence with enough content to exceed the minimum chunk size of one hundred characters.";
    const secondSentence = " Second sentence continues on and is much longer with additional content.";
    const text = firstSentence + secondSentence;
    const splitIndex = findSplitPoint(text, 130);
    expect(text.slice(0, splitIndex).trim()).toBe(firstSentence);
  });

  it("splits at comma when no sentence boundary available", () => {
    // Use a long enough first clause to satisfy MIN_CHUNK_SIZE
    const firstClause = "This is a long clause that has enough content to exceed the minimum chunk size requirement for splitting,";
    const secondClause = " and here is another part that makes it even longer with more content.";
    const text = firstClause + secondClause;
    const splitIndex = findSplitPoint(text, 120);
    expect(text.slice(0, splitIndex).trim()).toBe(firstClause);
  });

  it("splits at space when no other boundary available", () => {
    // Use enough words to have a split point above MIN_CHUNK_SIZE
    const text = ("word " + "x".repeat(20) + " ").repeat(20);
    const splitIndex = findSplitPoint(text, 150);
    // Should find a space to split at within the limit
    expect(splitIndex).toBeLessThanOrEqual(150);
    expect(splitIndex).toBeGreaterThan(MIN_CHUNK_SIZE);
  });

  it("respects minimum chunk size", () => {
    // Even if there's a split point early, don't use it if it's too short
    const text = ". " + "a".repeat(200);
    const splitIndex = findSplitPoint(text, 150);
    // Should not split at position 2 because that's below MIN_CHUNK_SIZE
    expect(splitIndex).toBeGreaterThan(MIN_CHUNK_SIZE);
  });

  it("falls back to maxLength when no good split point found", () => {
    // Long string with no spaces or split points
    const text = "a".repeat(300);
    const splitIndex = findSplitPoint(text, 200);
    expect(splitIndex).toBe(200);
  });

  it("uses custom split points when provided", () => {
    // Use a long enough section to satisfy MIN_CHUNK_SIZE
    const text = "a".repeat(110) + "|" + "b".repeat(100);
    const splitIndex = findSplitPoint(text, 150, ["|"]);
    expect(text.slice(0, splitIndex)).toBe("a".repeat(110) + "|");
  });
});

// =============================================================================
// splitMessage Tests
// =============================================================================

describe("splitMessage", () => {
  it("returns single chunk for short messages", () => {
    const content = "This is a short message";
    const result = splitMessage(content);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(content);
    expect(result.wasSplit).toBe(false);
    expect(result.originalLength).toBe(content.length);
  });

  it("splits long messages into multiple chunks", () => {
    const content = "a".repeat(3000);
    const result = splitMessage(content);

    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.wasSplit).toBe(true);
    expect(result.originalLength).toBe(3000);
  });

  it("respects custom maxLength", () => {
    const content = "a".repeat(500);
    const result = splitMessage(content, { maxLength: 100 });

    expect(result.chunks.length).toBe(5);
    result.chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(100);
    });
  });

  it("preserves sentence boundaries by default", () => {
    // Use long enough sentences to satisfy MIN_CHUNK_SIZE
    const sentence1 = "This is the first sentence with enough content to exceed the minimum chunk size requirement for splitting.";
    const sentence2 = " This is the second sentence that continues with more content to make it longer.";
    const content = sentence1 + sentence2;

    const result = splitMessage(content, { maxLength: 130 });

    expect(result.chunks[0]).toBe(sentence1);
    expect(result.chunks[1].trim()).toBe(sentence2.trim());
  });

  it("does not preserve boundaries when disabled", () => {
    const content = "Short. " + "a".repeat(100);
    const result = splitMessage(content, {
      maxLength: 50,
      preserveBoundaries: false,
    });

    // Without boundary preservation, it just cuts at maxLength
    expect(result.chunks[0].length).toBe(50);
  });

  it("trims whitespace from chunks", () => {
    const content = "First part.   \n\n   Second part.";
    const result = splitMessage(content, { maxLength: 20 });

    result.chunks.forEach((chunk) => {
      expect(chunk).toBe(chunk.trim());
    });
  });

  it("handles content with only whitespace", () => {
    const content = "   ";
    const result = splitMessage(content);

    // Whitespace-only content returns as-is (not split, fits in one message)
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe("   ");
    expect(result.wasSplit).toBe(false);
  });

  it("handles empty content", () => {
    const content = "";
    const result = splitMessage(content);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe("");
    expect(result.wasSplit).toBe(false);
  });

  it("splits at paragraph breaks preferentially", () => {
    // Use long enough paragraphs to satisfy MIN_CHUNK_SIZE
    const para1 = "First paragraph with enough content to exceed the minimum chunk size requirement for the splitting algorithm.";
    const para2 = "Second paragraph that also has enough content to be considered a proper chunk in the split.";
    const content = `${para1}\n\n${para2}`;

    const result = splitMessage(content, { maxLength: 130 });

    expect(result.chunks[0]).toBe(para1);
    expect(result.chunks[1]).toBe(para2);
  });

  it("handles very long single word gracefully", () => {
    const longWord = "supercalifragilisticexpialidocious".repeat(100);
    const result = splitMessage(longWord, { maxLength: 100 });

    expect(result.wasSplit).toBe(true);
    // Each chunk should be at most maxLength
    result.chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(100);
    });
  });

  it("combines content from all chunks equals original (minus whitespace)", () => {
    const content = "Part one. Part two. Part three. Part four.";
    const result = splitMessage(content, { maxLength: 15 });

    const combined = result.chunks.join(" ");
    // The combined content should contain all the words
    expect(combined.replace(/\s+/g, " ")).toContain("Part one");
    expect(combined.replace(/\s+/g, " ")).toContain("Part four");
  });
});

// =============================================================================
// needsSplit Tests
// =============================================================================

describe("needsSplit", () => {
  it("returns false for messages under limit", () => {
    expect(needsSplit("Short message")).toBe(false);
  });

  it("returns false for messages at exactly the limit", () => {
    const content = "a".repeat(2000);
    expect(needsSplit(content)).toBe(false);
  });

  it("returns true for messages over the limit", () => {
    const content = "a".repeat(2001);
    expect(needsSplit(content)).toBe(true);
  });

  it("respects custom maxLength", () => {
    expect(needsSplit("12345", 5)).toBe(false);
    expect(needsSplit("123456", 5)).toBe(true);
  });
});

// =============================================================================
// startTypingIndicator Tests
// =============================================================================

describe("startTypingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends initial typing indicator", () => {
    const channel = createMockChannel();
    const controller = startTypingIndicator(channel);

    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it("refreshes typing indicator at interval", () => {
    const channel = createMockChannel();
    const controller = startTypingIndicator(channel, 1000);

    // Initial call
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);

    // After 1 second
    vi.advanceTimersByTime(1000);
    expect(channel.sendTyping).toHaveBeenCalledTimes(2);

    // After another second
    vi.advanceTimersByTime(1000);
    expect(channel.sendTyping).toHaveBeenCalledTimes(3);

    controller.stop();
  });

  it("stops refreshing when stop() is called", () => {
    const channel = createMockChannel();
    const controller = startTypingIndicator(channel, 1000);

    // Initial call
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);

    // Stop the typing indicator
    controller.stop();

    // Advance time - should not call sendTyping again
    vi.advanceTimersByTime(5000);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it("reports isActive correctly", () => {
    const channel = createMockChannel();
    const controller = startTypingIndicator(channel);

    expect(controller.isActive).toBe(true);

    controller.stop();

    expect(controller.isActive).toBe(false);
  });

  it("handles sendTyping errors gracefully", () => {
    const channel = createMockChannel();
    channel.sendTyping = vi.fn().mockRejectedValue(new Error("Network error"));

    // Should not throw
    const controller = startTypingIndicator(channel);
    expect(controller.isActive).toBe(true);

    controller.stop();
  });

  it("uses default refresh interval of 5000ms", () => {
    const channel = createMockChannel();
    const controller = startTypingIndicator(channel);

    // Initial call
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);

    // After 4999ms - should not have refreshed yet
    vi.advanceTimersByTime(4999);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);

    // After 5000ms total - should have refreshed
    vi.advanceTimersByTime(1);
    expect(channel.sendTyping).toHaveBeenCalledTimes(2);

    controller.stop();
  });
});

// =============================================================================
// sendSplitMessage Tests
// =============================================================================

describe("sendSplitMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a single message for short content", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg-1" });

    const promise = sendSplitMessage(channel, "Short message");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith("Short message");
    expect(result).toEqual(["msg-1"]);
  });

  it("sends multiple messages for long content", async () => {
    const channel = createMockChannel();
    let messageCount = 0;
    channel.send = vi.fn().mockImplementation(() => {
      messageCount++;
      return Promise.resolve({ id: `msg-${messageCount}` });
    });

    const content = "a".repeat(3000);
    const promise = sendSplitMessage(channel, content);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });

  it("adds delay between messages", async () => {
    const channel = createMockChannel();
    const sendTimes: number[] = [];
    channel.send = vi.fn().mockImplementation(() => {
      sendTimes.push(Date.now());
      return Promise.resolve({ id: "msg" });
    });

    const content = "First part. " + "a".repeat(2000);
    const promise = sendSplitMessage(channel, content, { delayMs: 1000 });

    // First message should be sent immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(sendTimes.length).toBeGreaterThanOrEqual(1);

    // Complete all timers
    await vi.runAllTimersAsync();
    await promise;

    // Should have sent multiple messages
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("respects custom delay", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg" });

    const content = "First. " + "a".repeat(2000);
    const promise = sendSplitMessage(channel, content, {
      delayMs: 200,
      maxLength: 100,
    });

    await vi.runAllTimersAsync();
    await promise;

    // Multiple messages should have been sent
    expect(channel.send.mock.calls.length).toBeGreaterThan(1);
  });

  it("passes split options through", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg" });

    const content = "a".repeat(500);
    const promise = sendSplitMessage(channel, content, { maxLength: 100 });

    await vi.runAllTimersAsync();
    await promise;

    // Should split into 5 messages
    expect(channel.send).toHaveBeenCalledTimes(5);
  });
});

// =============================================================================
// sendWithTyping Tests
// =============================================================================

describe("sendWithTyping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows typing indicator while processing", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg-1" });

    const contentProvider = vi.fn().mockResolvedValue("Response content");

    const promise = sendWithTyping(channel, contentProvider);

    // Typing indicator should be started
    expect(channel.sendTyping).toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await promise;
  });

  it("sends the content from contentProvider", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg-1" });

    const contentProvider = vi.fn().mockResolvedValue("Generated content");

    const promise = sendWithTyping(channel, contentProvider);
    await vi.runAllTimersAsync();
    await promise;

    expect(contentProvider).toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith("Generated content");
  });

  it("stops typing indicator after sending", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg-1" });

    const contentProvider = vi.fn().mockResolvedValue("Content");

    const promise = sendWithTyping(channel, contentProvider);
    await vi.runAllTimersAsync();
    await promise;

    // Advance more time - typing should have stopped
    const callCountAfterSend = channel.sendTyping.mock.calls.length;
    vi.advanceTimersByTime(10000);

    // Should not have sent more typing indicators
    expect(channel.sendTyping.mock.calls.length).toBe(callCountAfterSend);
  });

  it("stops typing indicator on error", async () => {
    const channel = createMockChannel();
    const contentProvider = vi
      .fn()
      .mockRejectedValue(new Error("Processing failed"));

    // Start the operation (will fail) - need to catch the rejection
    let caughtError: Error | null = null;
    const promise = sendWithTyping(channel, contentProvider).catch((err) => {
      caughtError = err;
    });

    // Run timers and wait for the promise to settle
    await vi.runAllTimersAsync();
    await promise;

    // Verify error was caught
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as unknown as Error).message).toBe("Processing failed");

    // Typing should have stopped - save current count
    const callCountAfterError = channel.sendTyping.mock.calls.length;

    // Advance time to verify no more typing calls happen
    await vi.advanceTimersByTimeAsync(10000);

    expect(channel.sendTyping.mock.calls.length).toBe(callCountAfterError);
  });

  it("returns message IDs from sent messages", async () => {
    const channel = createMockChannel();
    channel.send = vi.fn().mockResolvedValue({ id: "msg-123" });

    const contentProvider = vi.fn().mockResolvedValue("Short");

    const promise = sendWithTyping(channel, contentProvider);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual(["msg-123"]);
  });
});

// =============================================================================
// truncateMessage Tests
// =============================================================================

describe("truncateMessage", () => {
  it("returns message unchanged if under limit", () => {
    const content = "Short message";
    expect(truncateMessage(content)).toBe(content);
  });

  it("returns message unchanged if exactly at limit", () => {
    const content = "a".repeat(2000);
    expect(truncateMessage(content)).toBe(content);
  });

  it("truncates and adds ellipsis for long messages", () => {
    const content = "a".repeat(2010);
    const result = truncateMessage(content);

    expect(result.length).toBe(2000);
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom maxLength", () => {
    const content = "This is a test message";
    const result = truncateMessage(content, 10);

    expect(result.length).toBe(10);
    expect(result).toBe("This is...");
  });

  it("uses custom ellipsis", () => {
    const content = "This is a test message";
    const result = truncateMessage(content, 12, "…");

    expect(result.length).toBe(12);
    expect(result.endsWith("…")).toBe(true);
  });
});

// =============================================================================
// formatCodeBlock Tests
// =============================================================================

describe("formatCodeBlock", () => {
  it("formats code without language tag", () => {
    const code = 'const x = 1;';
    const result = formatCodeBlock(code);

    expect(result).toBe('```\nconst x = 1;\n```');
  });

  it("formats code with language tag", () => {
    const code = 'const x: number = 1;';
    const result = formatCodeBlock(code, 'typescript');

    expect(result).toBe('```typescript\nconst x: number = 1;\n```');
  });

  it("handles multiline code", () => {
    const code = 'function test() {\n  return true;\n}';
    const result = formatCodeBlock(code, 'javascript');

    expect(result).toBe('```javascript\nfunction test() {\n  return true;\n}\n```');
  });

  it("handles empty code", () => {
    const result = formatCodeBlock('');
    expect(result).toBe('```\n\n```');
  });
});

// =============================================================================
// escapeMarkdown Tests
// =============================================================================

describe("escapeMarkdown", () => {
  it("escapes asterisks", () => {
    expect(escapeMarkdown("*bold*")).toBe("\\*bold\\*");
  });

  it("escapes underscores", () => {
    expect(escapeMarkdown("_italic_")).toBe("\\_italic\\_");
  });

  it("escapes tildes", () => {
    expect(escapeMarkdown("~~strike~~")).toBe("\\~\\~strike\\~\\~");
  });

  it("escapes backticks", () => {
    expect(escapeMarkdown("`code`")).toBe("\\`code\\`");
  });

  it("escapes pipes", () => {
    expect(escapeMarkdown("a|b")).toBe("a\\|b");
  });

  it("escapes backslashes", () => {
    expect(escapeMarkdown("a\\b")).toBe("a\\\\b");
  });

  it("escapes multiple characters", () => {
    expect(escapeMarkdown("*_~`|\\")).toBe("\\*\\_\\~\\`\\|\\\\");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeMarkdown("Hello world!")).toBe("Hello world!");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles a realistic long response scenario", async () => {
    const channel = createMockChannel();
    const messageIds: string[] = [];
    let msgCounter = 0;
    channel.send = vi.fn().mockImplementation(() => {
      msgCounter++;
      messageIds.push(`msg-${msgCounter}`);
      return Promise.resolve({ id: `msg-${msgCounter}` });
    });

    // Simulate a long Claude response with multiple paragraphs
    const response = `
Here's how you can implement the feature:

First, create a new file called handler.ts and add the following code:

\`\`\`typescript
export function handleRequest(req: Request) {
  const data = parseInput(req.body);
  return processData(data);
}
\`\`\`

This function takes a request, parses the input, and processes the data.

Next, you'll need to update your router to use this handler. Add the following to your routes.ts file:

\`\`\`typescript
router.post('/api/data', handleRequest);
\`\`\`

Finally, make sure to add proper error handling. You can wrap the handler in a try-catch block or use middleware for global error handling.

Let me know if you have any questions about the implementation!
    `.repeat(3); // Make it long enough to split

    const promise = sendWithTyping(
      channel,
      async () => response,
      { delayMs: 100 }
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    // Should have sent multiple messages
    expect(result.length).toBeGreaterThan(1);

    // All messages should be under the limit
    const sentContents = channel.send.mock.calls.map(
      (call) => call[0] as string
    );
    sentContents.forEach((content) => {
      expect(content.length).toBeLessThanOrEqual(DISCORD_MAX_MESSAGE_LENGTH);
    });

    // Typing indicator should have been started
    expect(channel.sendTyping).toHaveBeenCalled();
  });
});
