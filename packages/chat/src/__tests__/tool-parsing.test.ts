/**
 * Tests for tool parsing utilities
 */

import { describe, it, expect } from "vitest";
import {
  extractToolUseBlocks,
  extractToolResults,
  extractToolResultContent,
  getToolInputSummary,
  TOOL_EMOJIS,
} from "../tool-parsing.js";

describe("tool-parsing", () => {
  // ===========================================================================
  // extractToolUseBlocks
  // ===========================================================================

  describe("extractToolUseBlocks", () => {
    it("returns empty array for non-array content", () => {
      expect(extractToolUseBlocks({ type: "assistant" })).toEqual([]);
      expect(
        extractToolUseBlocks({
          type: "assistant",
          message: { content: "just text" },
        }),
      ).toEqual([]);
    });

    it("extracts tool_use blocks from content array", () => {
      const message = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me read that file." },
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Read",
              input: { file_path: "/foo/bar.ts" },
            },
          ],
        },
      };

      const blocks = extractToolUseBlocks(message);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        id: "toolu_123",
        name: "Read",
        input: { file_path: "/foo/bar.ts" },
      });
    });

    it("extracts multiple tool_use blocks", () => {
      const message = {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: { command: "ls" },
            },
            { type: "text", text: "Some text" },
            {
              type: "tool_use",
              id: "toolu_2",
              name: "Read",
              input: { file_path: "/a.ts" },
            },
          ],
        },
      };

      const blocks = extractToolUseBlocks(message);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].name).toBe("Bash");
      expect(blocks[1].name).toBe("Read");
    });

    it("handles blocks without id", () => {
      const message = {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
        },
      };

      const blocks = extractToolUseBlocks(message);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].id).toBeUndefined();
    });

    it("skips non-tool_use blocks", () => {
      const message = {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "image", source: {} },
            { type: "tool_use", id: "toolu_1", name: "Bash" },
          ],
        },
      };

      const blocks = extractToolUseBlocks(message);
      expect(blocks).toHaveLength(1);
    });
  });

  // ===========================================================================
  // getToolInputSummary
  // ===========================================================================

  describe("getToolInputSummary", () => {
    it("returns command for Bash", () => {
      expect(getToolInputSummary("Bash", { command: "ls -la" })).toBe("ls -la");
    });

    it("truncates long Bash commands", () => {
      const longCommand = "a".repeat(250);
      const result = getToolInputSummary("Bash", { command: longCommand });
      expect(result).toBe("a".repeat(200) + "...");
    });

    it("returns file_path for Read", () => {
      expect(getToolInputSummary("Read", { file_path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
    });

    it("returns file_path for Write", () => {
      expect(getToolInputSummary("Write", { file_path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
    });

    it("returns file_path for Edit", () => {
      expect(getToolInputSummary("Edit", { file_path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
    });

    it("returns pattern for Glob", () => {
      expect(getToolInputSummary("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
    });

    it("returns pattern for Grep", () => {
      expect(getToolInputSummary("Grep", { pattern: "function foo" })).toBe("function foo");
    });

    it("returns url for WebFetch", () => {
      expect(getToolInputSummary("WebFetch", { url: "https://example.com" })).toBe(
        "https://example.com",
      );
    });

    it("returns query for WebSearch", () => {
      expect(getToolInputSummary("WebSearch", { query: "how to test" })).toBe("how to test");
    });

    it("returns undefined for unknown tools", () => {
      expect(getToolInputSummary("UnknownTool", { data: "test" })).toBeUndefined();
    });

    it("returns undefined when input is undefined", () => {
      expect(getToolInputSummary("Bash")).toBeUndefined();
    });

    it("handles bash (lowercase)", () => {
      expect(getToolInputSummary("bash", { command: "ls" })).toBe("ls");
    });
  });

  // ===========================================================================
  // extractToolResults
  // ===========================================================================

  describe("extractToolResults", () => {
    it("returns empty array for non-user messages", () => {
      expect(extractToolResults({ type: "assistant" })).toEqual([]);
    });

    it("extracts from top-level tool_use_result string", () => {
      const message = {
        type: "user",
        tool_use_result: "command output here",
      };

      const results = extractToolResults(message);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        output: "command output here",
        isError: false,
      });
    });

    it("extracts from content blocks with tool_result type", () => {
      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "file contents here",
              is_error: false,
            },
          ],
        },
      };

      const results = extractToolResults(message);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        output: "file contents here",
        isError: false,
        toolUseId: "toolu_123",
      });
    });

    it("extracts error tool results", () => {
      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_456",
              content: "command failed: exit code 1",
              is_error: true,
            },
          ],
        },
      };

      const results = extractToolResults(message);
      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].toolUseId).toBe("toolu_456");
    });

    it("extracts from content blocks array inside tool_result", () => {
      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_789",
              content: [
                { type: "text", text: "line 1\n" },
                { type: "text", text: "line 2" },
              ],
            },
          ],
        },
      };

      const results = extractToolResults(message);
      expect(results).toHaveLength(1);
      expect(results[0].output).toBe("line 1\n\nline 2");
    });

    it("extracts multiple tool results", () => {
      const message = {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "result 1",
            },
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: "result 2",
              is_error: true,
            },
          ],
        },
      };

      const results = extractToolResults(message);
      expect(results).toHaveLength(2);
      expect(results[0].output).toBe("result 1");
      expect(results[1].output).toBe("result 2");
      expect(results[1].isError).toBe(true);
    });

    it("skips empty content", () => {
      const message = {
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "" }],
        },
      };

      expect(extractToolResults(message)).toEqual([]);
    });
  });

  // ===========================================================================
  // extractToolResultContent
  // ===========================================================================

  describe("extractToolResultContent", () => {
    it("extracts from plain string", () => {
      const result = extractToolResultContent("hello world");
      expect(result).toEqual({ output: "hello world", isError: false });
    });

    it("returns undefined for empty string", () => {
      expect(extractToolResultContent("")).toBeUndefined();
    });

    it("extracts from object with content string", () => {
      const result = extractToolResultContent({
        content: "file data",
        is_error: false,
        tool_use_id: "toolu_abc",
      });
      expect(result).toEqual({
        output: "file data",
        isError: false,
        toolUseId: "toolu_abc",
      });
    });

    it("extracts from object with error flag", () => {
      const result = extractToolResultContent({
        content: "error occurred",
        is_error: true,
      });
      expect(result?.isError).toBe(true);
    });

    it("extracts from object with content blocks array", () => {
      const result = extractToolResultContent({
        content: [
          { type: "text", text: "part 1" },
          { type: "text", text: "part 2" },
        ],
      });
      expect(result?.output).toBe("part 1\npart 2");
    });

    it("returns undefined for null", () => {
      expect(extractToolResultContent(null)).toBeUndefined();
    });

    it("returns undefined for number", () => {
      expect(extractToolResultContent(42)).toBeUndefined();
    });
  });

  // ===========================================================================
  // TOOL_EMOJIS
  // ===========================================================================

  describe("TOOL_EMOJIS", () => {
    it("has emoji for common tools", () => {
      expect(TOOL_EMOJIS["Bash"]).toBeDefined();
      expect(TOOL_EMOJIS["Read"]).toBeDefined();
      expect(TOOL_EMOJIS["Write"]).toBeDefined();
      expect(TOOL_EMOJIS["Glob"]).toBeDefined();
      expect(TOOL_EMOJIS["Grep"]).toBeDefined();
      expect(TOOL_EMOJIS["WebFetch"]).toBeDefined();
      expect(TOOL_EMOJIS["WebSearch"]).toBeDefined();
    });

    it("has lowercase bash variant", () => {
      expect(TOOL_EMOJIS["bash"]).toBe(TOOL_EMOJIS["Bash"]);
    });
  });
});
