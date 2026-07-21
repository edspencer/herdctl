/**
 * Tests for message extraction utilities
 */

import { describe, expect, it } from "vitest";
import {
  extractImageBlocks,
  extractMessageContent,
  getAgentAttribution,
  hasImageContent,
  hasTextContent,
  isSyntheticMessage,
  isTextContentBlock,
  type SDKMessage,
} from "../message-extraction.js";

const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
          content: [{ type: "tool_use", id: "123", name: "tool" }],
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

  describe("isSyntheticMessage", () => {
    it("returns true for a '<synthetic>' model message", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: { model: "<synthetic>", content: "No response requested." },
      };
      expect(isSyntheticMessage(message)).toBe(true);
    });

    it("returns false for a real model message", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: { model: "claude-opus-4-8", content: "Real reply" },
      };
      expect(isSyntheticMessage(message)).toBe(false);
    });

    it("returns false when no model is present", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: { content: "Real reply" },
      };
      expect(isSyntheticMessage(message)).toBe(false);
    });
  });

  describe("getAgentAttribution", () => {
    it("returns null for the main agent (absent parent_tool_use_id)", () => {
      const message: SDKMessage = { type: "assistant", message: { content: "hi" } };
      expect(getAgentAttribution(message)).toEqual({ parentToolUseId: null });
    });

    it("returns null when parent_tool_use_id is explicitly null", () => {
      const message: SDKMessage = {
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: "hi" },
      };
      expect(getAgentAttribution(message)).toEqual({ parentToolUseId: null });
    });

    it("returns the Task tool_use id for a subagent message", () => {
      const message: SDKMessage = {
        type: "assistant",
        parent_tool_use_id: "task_abc",
        message: { content: "hi" },
      };
      expect(getAgentAttribution(message)).toEqual({ parentToolUseId: "task_abc" });
    });
  });

  describe("extractImageBlocks (issue #385)", () => {
    it("extracts image blocks from an assistant message, preserving order", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Here is the chart:" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1x1 } },
            { type: "image", source: { type: "url", url: "https://example.com/b.png" } },
          ],
        },
      };

      expect(extractImageBlocks(message)).toEqual([
        { kind: "base64", mediaType: "image/png", data: PNG_1x1 },
        { kind: "url", mediaType: undefined, url: "https://example.com/b.png" },
      ]);
    });

    it("returns [] for flat-string and text-only messages", () => {
      expect(extractImageBlocks({ type: "assistant", content: "hi" })).toEqual([]);
      expect(extractImageBlocks({ type: "assistant", message: { content: "hi" } })).toEqual([]);
      expect(
        extractImageBlocks({
          type: "assistant",
          message: { content: [{ type: "text", text: "no images" }] },
        }),
      ).toEqual([]);
    });

    it("keeps text extraction and image extraction independent for a mixed message", () => {
      const message: SDKMessage = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "look: " },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1x1 } },
          ],
        },
      };

      // Text-only fallback still works (backward compatible)…
      expect(extractMessageContent(message)).toBe("look: ");
      // …and the image survives.
      expect(hasImageContent(message)).toBe(true);
      expect(extractImageBlocks(message)).toHaveLength(1);
    });

    it("hasImageContent is false when there are no image blocks", () => {
      expect(
        hasImageContent({
          type: "assistant",
          message: { content: [{ type: "text", text: "just words" }] },
        }),
      ).toBe(false);
    });
  });
});
