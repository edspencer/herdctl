/**
 * Tests for StreamingResponder
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamingResponder } from "../streaming-responder.js";
import type { ChatConnectorLogger } from "../types.js";

describe("StreamingResponder", () => {
  let mockReply: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>;
  let mockLogger: ChatConnectorLogger;

  beforeEach(() => {
    mockReply = vi.fn<(content: string) => Promise<void>>().mockResolvedValue(undefined);
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  function createResponder(options?: Partial<ConstructorParameters<typeof StreamingResponder>[0]>) {
    return new StreamingResponder({
      reply: mockReply,
      logger: mockLogger,
      agentName: "test-agent",
      maxMessageLength: 2000,
      minMessageInterval: 0, // Disable rate limiting for tests
      ...options,
    });
  }

  describe("addContent", () => {
    it("buffers content without sending", () => {
      const responder = createResponder();
      responder.addContent("Hello");
      responder.addContent(" world");

      expect(mockReply).not.toHaveBeenCalled();
      expect(responder.getBufferContent()).toBe("Hello world");
    });

    it("ignores empty content", () => {
      const responder = createResponder();
      responder.addContent("");
      responder.addContent(undefined as unknown as string);

      expect(responder.getBufferContent()).toBe("");
    });
  });

  describe("addMessageAndSend", () => {
    it("sends content immediately", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("Hello world");

      expect(mockReply).toHaveBeenCalledWith("Hello world");
      expect(responder.hasSentAnything()).toBe(true);
    });

    it("ignores empty content", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("");
      await responder.addMessageAndSend("   ");

      expect(mockReply).not.toHaveBeenCalled();
    });

    it("combines with buffered content", async () => {
      const responder = createResponder();
      responder.addContent("Hello ");
      await responder.addMessageAndSend("world!");

      expect(mockReply).toHaveBeenCalledWith("Hello world!");
    });

    it("splits long messages", async () => {
      const responder = createResponder({ maxMessageLength: 10 });
      await responder.addMessageAndSend("Hello world this is a long message");

      expect(mockReply.mock.calls.length).toBeGreaterThan(1);
    });

    it("logs debug info", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("Hello");

      expect(mockLogger.debug).toHaveBeenCalled();
    });
  });

  describe("flush", () => {
    it("sends buffered content", async () => {
      const responder = createResponder();
      responder.addContent("Hello world");
      await responder.flush();

      expect(mockReply).toHaveBeenCalledWith("Hello world");
    });

    it("does nothing if buffer is empty", async () => {
      const responder = createResponder();
      await responder.flush();

      expect(mockReply).not.toHaveBeenCalled();
    });

    it("clears buffer after sending", async () => {
      const responder = createResponder();
      responder.addContent("Hello");
      await responder.flush();

      expect(responder.getBufferContent()).toBe("");
    });
  });

  describe("hasSentAnything / hasSentMessages", () => {
    it("returns false initially", () => {
      const responder = createResponder();
      expect(responder.hasSentAnything()).toBe(false);
      expect(responder.hasSentMessages()).toBe(false);
    });

    it("returns true after sending", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("Hello");

      expect(responder.hasSentAnything()).toBe(true);
      expect(responder.hasSentMessages()).toBe(true);
    });
  });

  describe("getMessagesSent", () => {
    it("returns 0 initially", () => {
      const responder = createResponder();
      expect(responder.getMessagesSent()).toBe(0);
    });

    it("counts sent messages", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("Hello");
      await responder.addMessageAndSend("World");

      expect(responder.getMessagesSent()).toBe(2);
    });

    it("counts multiple chunks as separate messages", async () => {
      const responder = createResponder({ maxMessageLength: 10 });
      await responder.addMessageAndSend("Hello world this is long");

      expect(responder.getMessagesSent()).toBeGreaterThan(1);
    });
  });

  describe("error handling", () => {
    it("logs errors and rethrows", async () => {
      const error = new Error("Send failed");
      mockReply.mockRejectedValueOnce(error);

      const responder = createResponder();

      await expect(responder.addMessageAndSend("Hello")).rejects.toThrow("Send failed");
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("respects minMessageInterval", async () => {
      const responder = createResponder({ minMessageInterval: 100 });
      const startTime = Date.now();

      await responder.addMessageAndSend("Hello");
      await responder.addMessageAndSend("World");

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
    });
  });

  describe("platform name", () => {
    it("uses custom platform name in logs", async () => {
      const responder = createResponder({ platformName: "discord" });
      await responder.addMessageAndSend("Hello");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("discord"),
        expect.any(Object),
      );
    });

    it("defaults to 'chat' platform name", async () => {
      const responder = createResponder();
      await responder.addMessageAndSend("Hello");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("chat"),
        expect.any(Object),
      );
    });
  });
});
