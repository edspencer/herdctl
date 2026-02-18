/**
 * Tests for message extraction utilities
 */

import { describe, it, expect } from "vitest";
import {
  extractMessageContent,
  isTextContentBlock,
  hasTextContent,
  type SDKMessage,
} from "../message-extraction.js";

describe("message-extraction", () => {
  describe("extractMessageContent", () => {
    it("extracts direct string content", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Hello world",
      };
      expect(extractMessageContent(message)).toBe("Hello world");
    });

    it("extracts nested string content", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: "Hello from nested",
        },
      };
      expect(extractMessageContent(message)).toBe("Hello from nested");
    });

    it("extracts from array of text content blocks", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world!" },
          ],
        },
      };
      expect(extractMessageContent(message)).toBe("Hello world!");
    });

    it("ignores non-text content blocks", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "tool_use", id: "123", name: "tool" },
            { type: "text", text: " world" },
          ],
        },
      };
      expect(extractMessageContent(message)).toBe("Hello world");
    });

    it("returns undefined for empty content", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "",
      };
      expect(extractMessageContent(message)).toBeUndefined();
    });

    it("returns undefined for no content", () => {
      const message: SDKMessage = {
        type: "assistant",
      };
      expect(extractMessageContent(message)).toBeUndefined();
    });

    it("returns undefined for empty array content", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [],
        },
      };
      expect(extractMessageContent(message)).toBeUndefined();
    });

    it("returns undefined for array with no text blocks", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "123", name: "tool" },
          ],
        },
      };
      expect(extractMessageContent(message)).toBeUndefined();
    });

    it("prefers direct content over nested content", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Direct content",
        message: {
          content: "Nested content",
        },
      };
      expect(extractMessageContent(message)).toBe("Direct content");
    });

    it("handles null message property", () => {
      const message = {
        type: "assistant",
        message: null,
      } as unknown as SDKMessage;
      expect(extractMessageContent(message)).toBeUndefined();
    });
  });

  describe("isTextContentBlock", () => {
    it("returns true for valid text block", () => {
      expect(isTextContentBlock({ type: "text", text: "Hello" })).toBe(true);
    });

    it("returns false for non-text block", () => {
      expect(isTextContentBlock({ type: "tool_use", id: "123" })).toBe(false);
    });

    it("returns false for missing text property", () => {
      expect(isTextContentBlock({ type: "text" })).toBe(false);
    });

    it("returns false for non-string text", () => {
      expect(isTextContentBlock({ type: "text", text: 123 })).toBe(false);
    });

    it("returns false for null", () => {
      expect(isTextContentBlock(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isTextContentBlock(undefined)).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isTextContentBlock("string")).toBe(false);
      expect(isTextContentBlock(123)).toBe(false);
      expect(isTextContentBlock(true)).toBe(false);
    });
  });

  describe("hasTextContent", () => {
    it("returns true when message has content", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Hello",
      };
      expect(hasTextContent(message)).toBe(true);
    });

    it("returns false when message has no content", () => {
      const message: SDKMessage = {
        type: "assistant",
      };
      expect(hasTextContent(message)).toBe(false);
    });

    it("returns false for empty string content", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "",
      };
      expect(hasTextContent(message)).toBe(false);
    });

    it("returns true for nested content", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: "Hello",
        },
      };
      expect(hasTextContent(message)).toBe(true);
    });
  });
});
