import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_MAX_MESSAGE_LENGTH,
  escapeMarkdown,
  type SendableChannel,
  sendSplitMessage,
  sendWithTyping,
  startTypingIndicator,
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

    const content = `First part. ${"a".repeat(2000)}`;
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

    const content = `First. ${"a".repeat(2000)}`;
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
    const contentProvider = vi.fn().mockRejectedValue(new Error("Processing failed"));

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

    const promise = sendWithTyping(channel, async () => response, { delayMs: 100 });

    await vi.runAllTimersAsync();
    const result = await promise;

    // Should have sent multiple messages
    expect(result.length).toBeGreaterThan(1);

    // All messages should be under the limit
    const sentContents = channel.send.mock.calls.map((call) => call[0] as string);
    sentContents.forEach((content) => {
      expect(content.length).toBeLessThanOrEqual(DISCORD_MAX_MESSAGE_LENGTH);
    });

    // Typing indicator should have been started
    expect(channel.sendTyping).toHaveBeenCalled();
  });
});
