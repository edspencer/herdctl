/**
 * Tests for message splitting utilities
 */

import { describe, it, expect } from "vitest";
import {
  findSplitPoint,
  splitMessage,
  needsSplit,
  truncateMessage,
  formatCodeBlock,
  DEFAULT_SPLIT_POINTS,
  MIN_CHUNK_SIZE,
  DEFAULT_MESSAGE_DELAY_MS,
} from "../message-splitting.js";

describe("message-splitting", () => {
  describe("findSplitPoint", () => {
    it("returns text length if text fits", () => {
      const text = "Hello world";
      expect(findSplitPoint(text, 100)).toBe(text.length);
    });

    it("splits at paragraph breaks when available", () => {
      // "First paragraph.\n\n" is 18 chars, maxLength 18 fits exactly
      // We need text > maxLength to trigger a split, and the split point
      // must be > MIN_CHUNK_SIZE (100). Use a larger test case.
      const text = "A".repeat(105) + ".\n\nSecond paragraph that is longer.";
      const splitIndex = findSplitPoint(text, 115);
      // Should split after the paragraph break
      expect(text.slice(0, splitIndex)).toBe("A".repeat(105) + ".\n\n");
    });

    it("splits at newlines when no paragraph break", () => {
      const text = "A".repeat(150) + "\n" + "B".repeat(50);
      const splitIndex = findSplitPoint(text, 160);
      // Should split at the newline
      expect(text.slice(0, splitIndex)).toBe("A".repeat(150) + "\n");
    });

    it("splits at sentence boundaries", () => {
      // Create text where the sentence boundary is past MIN_CHUNK_SIZE
      const text = "A".repeat(110) + ". Second sentence is much longer and exceeds the limit.";
      const splitIndex = findSplitPoint(text, 120);
      expect(text.slice(0, splitIndex)).toBe("A".repeat(110) + ". ");
    });

    it("splits at spaces when no sentence boundary", () => {
      // Create long enough text with no sentence boundaries
      const text = "A".repeat(110) + " Word2 Word3 Word4 Word5 Word6 Word7 Word8";
      const splitIndex = findSplitPoint(text, 120);
      // Should split at a space
      expect(text.charAt(splitIndex - 1)).toBe(" ");
    });

    it("hard splits at maxLength when no good split point", () => {
      const text = "A".repeat(200);
      const splitIndex = findSplitPoint(text, 50);
      expect(splitIndex).toBe(50);
    });

    it("respects MIN_CHUNK_SIZE", () => {
      const text = "A. " + "B".repeat(200);
      const splitIndex = findSplitPoint(text, 200);
      // Should not split at "A. " because it's too short (less than MIN_CHUNK_SIZE)
      expect(splitIndex).toBeGreaterThan(MIN_CHUNK_SIZE);
    });
  });

  describe("splitMessage", () => {
    it("returns single chunk if content fits", () => {
      const content = "Hello world";
      const result = splitMessage(content, { maxLength: 100 });
      expect(result.chunks).toEqual(["Hello world"]);
      expect(result.wasSplit).toBe(false);
      expect(result.originalLength).toBe(content.length);
    });

    it("splits long content into multiple chunks", () => {
      const content = "A".repeat(150);
      const result = splitMessage(content, { maxLength: 50 });
      expect(result.chunks.length).toBeGreaterThan(1);
      expect(result.wasSplit).toBe(true);
      expect(result.originalLength).toBe(150);
    });

    it("preserves boundaries by default", () => {
      // Use content where the split point is past MIN_CHUNK_SIZE
      const content = "A".repeat(105) + ".\n\nSecond paragraph.";
      const result = splitMessage(content, { maxLength: 115 });
      // Should split after the paragraph break, trimmed
      expect(result.chunks[0]).toBe("A".repeat(105) + ".");
    });

    it("can disable boundary preservation", () => {
      // When preserveBoundaries is false, it should cut exactly at maxLength
      const content = "A".repeat(50);
      const result = splitMessage(content, { maxLength: 25, preserveBoundaries: false });
      expect(result.chunks[0]).toHaveLength(25);
    });

    it("uses custom split points", () => {
      // Need content long enough to exceed MIN_CHUNK_SIZE before the split point
      const content = "A".repeat(105) + "|Part2|Part3";
      const result = splitMessage(content, {
        maxLength: 110,
        splitPoints: ["|"],
      });
      // Should split at the pipe (trimmed, so just the As and pipe)
      expect(result.chunks[0]).toBe("A".repeat(105) + "|");
    });

    it("trims chunks", () => {
      const content = "Hello  \n\n  World";
      const result = splitMessage(content, { maxLength: 10 });
      for (const chunk of result.chunks) {
        expect(chunk).toBe(chunk.trim());
      }
    });
  });

  describe("needsSplit", () => {
    it("returns false when content fits", () => {
      expect(needsSplit("Hello", 100)).toBe(false);
    });

    it("returns true when content exceeds limit", () => {
      expect(needsSplit("Hello", 3)).toBe(true);
    });

    it("returns false when content equals limit", () => {
      expect(needsSplit("Hello", 5)).toBe(false);
    });
  });

  describe("truncateMessage", () => {
    it("returns original if it fits", () => {
      expect(truncateMessage("Hello", 100)).toBe("Hello");
    });

    it("truncates and adds ellipsis", () => {
      expect(truncateMessage("Hello world", 8)).toBe("Hello...");
    });

    it("uses custom ellipsis", () => {
      expect(truncateMessage("Hello world", 9, "…")).toBe("Hello wo…");
    });

    it("handles ellipsis longer than remaining space", () => {
      const result = truncateMessage("Hi", 5, "...");
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe("formatCodeBlock", () => {
    it("formats code without language", () => {
      expect(formatCodeBlock("const x = 1;")).toBe("```\nconst x = 1;\n```");
    });

    it("formats code with language", () => {
      expect(formatCodeBlock("const x = 1;", "typescript")).toBe(
        "```typescript\nconst x = 1;\n```"
      );
    });

    it("handles empty code", () => {
      expect(formatCodeBlock("")).toBe("```\n\n```");
    });

    it("handles multiline code", () => {
      const code = "line1\nline2\nline3";
      expect(formatCodeBlock(code, "js")).toBe("```js\nline1\nline2\nline3\n```");
    });
  });

  describe("constants", () => {
    it("exports DEFAULT_SPLIT_POINTS", () => {
      expect(DEFAULT_SPLIT_POINTS).toContain("\n\n");
      expect(DEFAULT_SPLIT_POINTS).toContain("\n");
      expect(DEFAULT_SPLIT_POINTS).toContain(". ");
    });

    it("exports MIN_CHUNK_SIZE", () => {
      expect(MIN_CHUNK_SIZE).toBe(100);
    });

    it("exports DEFAULT_MESSAGE_DELAY_MS", () => {
      expect(DEFAULT_MESSAGE_DELAY_MS).toBe(500);
    });
  });
});
