import { describe, it, expect } from "vitest";
import { parseCLILine, toSDKMessage, type CLIMessage } from "../cli-output-parser.js";

describe("parseCLILine", () => {
  describe("valid JSON parsing", () => {
    it("parses valid JSON line", () => {
      const line = '{"type":"assistant","message":"Hello"}';
      const result = parseCLILine(line);
      expect(result).toEqual({
        type: "assistant",
        session_id: undefined,
        message: "Hello",
        content: undefined,
      });
    });

    it("parses object with nested properties", () => {
      const line = '{"type":"system","subtype":"init","session_id":"abc123"}';
      const result = parseCLILine(line);
      expect(result).toEqual({
        type: "system",
        subtype: "init",
        session_id: "abc123",
      });
    });

    it("parses result message with is_error flag", () => {
      const line = '{"type":"result","result":"success","is_error":false}';
      const result = parseCLILine(line);
      expect(result?.type).toBe("result");
      expect(result?.result).toBe("success");
      expect(result?.is_error).toBe(false);
    });

    it("handles line with trailing whitespace", () => {
      const line = '{"type":"assistant","message":"Hello"}   \n';
      const result = parseCLILine(line);
      expect(result?.type).toBe("assistant");
    });

    it("handles line with leading whitespace", () => {
      const line = '   {"type":"assistant","message":"Hello"}';
      const result = parseCLILine(line);
      expect(result?.type).toBe("assistant");
    });
  });

  describe("invalid input handling", () => {
    it("returns null for empty line", () => {
      expect(parseCLILine("")).toBeNull();
    });

    it("returns null for whitespace-only line", () => {
      expect(parseCLILine("   ")).toBeNull();
      expect(parseCLILine("\n")).toBeNull();
      expect(parseCLILine("\t")).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseCLILine("not json")).toBeNull();
    });

    it("handles non-object JSON (string) as unknown type", () => {
      // JSON strings parse successfully but get spread as object properties
      const result = parseCLILine('"just a string"');
      expect(result).toBeTruthy();
      expect(result?.type).toBeUndefined();
    });

    it("handles non-object JSON (array) as unknown type", () => {
      // Arrays parse successfully and get indexed properties
      const result = parseCLILine('[1, 2, 3]');
      expect(result).toBeTruthy();
      expect(result?.type).toBeUndefined();
    });

    it("handles non-object JSON (number) as unknown type", () => {
      // Numbers parse but have no properties
      const result = parseCLILine('42');
      expect(result).toBeTruthy();
      expect(result?.type).toBeUndefined();
    });

    it("returns null for malformed JSON (trailing comma)", () => {
      expect(parseCLILine('{"type":"test",}')).toBeNull();
    });

    it("returns null for incomplete JSON", () => {
      expect(parseCLILine('{"type":"test"')).toBeNull();
    });
  });
});

describe("toSDKMessage", () => {
  describe("assistant message transformation", () => {
    it("transforms assistant message with text content", () => {
      const cli: CLIMessage = {
        type: "assistant",
        session_id: "abc123",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("assistant");
      expect(sdk.session_id).toBe("abc123");
      expect(sdk.content).toBe("Hello world");
      expect(sdk.message).toEqual(cli.message);
    });

    it("handles assistant message without text content", () => {
      const cli: CLIMessage = {
        type: "assistant",
        session_id: "abc123",
        message: {
          content: [{ type: "tool_use" }],
        },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("assistant");
      expect(sdk.content).toBeUndefined();
    });

    it("handles assistant message with no content array", () => {
      const cli: CLIMessage = {
        type: "assistant",
        session_id: "abc123",
        message: {},
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("assistant");
      expect(sdk.content).toBeUndefined();
    });

    it("handles assistant message with empty content array", () => {
      const cli: CLIMessage = {
        type: "assistant",
        session_id: "abc123",
        message: {
          content: [],
        },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("assistant");
      expect(sdk.content).toBeUndefined();
    });
  });

  describe("system message transformation", () => {
    it("transforms system message", () => {
      const cli: CLIMessage = {
        type: "system",
        subtype: "init",
        session_id: "abc123",
        cwd: "/workspace",
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("system");
      expect(sdk.subtype).toBe("init");
      expect(sdk.session_id).toBe("abc123");
      expect(sdk.cwd).toBe("/workspace");
    });

    it("preserves all system fields", () => {
      const cli: CLIMessage = {
        type: "system",
        subtype: "status",
        custom_field: "preserved",
        nested: { data: "also preserved" },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.custom_field).toBe("preserved");
      expect(sdk.nested).toEqual({ data: "also preserved" });
    });
  });

  describe("result message transformation", () => {
    it("transforms result message", () => {
      const cli: CLIMessage = {
        type: "result",
        result: "Task completed",
        is_error: false,
        cost_usd: 0.05,
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("result");
      expect(sdk.result).toBe("Task completed");
      expect(sdk.is_error).toBe(false);
      expect(sdk.cost_usd).toBe(0.05);
    });

    it("transforms error result", () => {
      const cli: CLIMessage = {
        type: "result",
        result: "Error occurred",
        is_error: true,
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("result");
      expect(sdk.is_error).toBe(true);
    });
  });

  describe("user message transformation", () => {
    it("transforms user message", () => {
      const cli: CLIMessage = {
        type: "user",
        session_id: "abc123",
        message: {
          content: [{ type: "text", text: "User input" }],
        },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("user");
      expect(sdk.session_id).toBe("abc123");
      expect(sdk.message).toEqual(cli.message);
    });
  });

  describe("unknown message types", () => {
    it("handles unknown type gracefully", () => {
      const cli: CLIMessage = {
        type: "unknown_type" as any,
        data: "test",
        custom: "field",
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("unknown_type");
      expect(sdk.data).toBe("test");
      expect(sdk.custom).toBe("field");
    });

    it("handles tool_use type", () => {
      const cli: CLIMessage = {
        type: "tool_use",
        name: "Bash",
        input: { command: "ls" },
      };
      const sdk = toSDKMessage(cli);

      expect(sdk.type).toBe("tool_use");
      expect(sdk.name).toBe("Bash");
      expect(sdk.input).toEqual({ command: "ls" });
    });
  });

  describe("field preservation", () => {
    it("preserves extra fields for system messages", () => {
      const cli: CLIMessage = {
        type: "system",
        subtype: "test",
        extra_field: "preserved",
        another_field: 123,
        nested_object: { key: "value" },
      };
      const sdk = toSDKMessage(cli);

      // System messages spread ...rest, so extra fields are preserved
      expect(sdk.extra_field).toBe("preserved");
      expect(sdk.another_field).toBe(123);
      expect(sdk.nested_object).toEqual({ key: "value" });
    });

    it("preserves extra fields for result messages", () => {
      const cli: CLIMessage = {
        type: "result",
        result: "test",
        extra_field: "preserved",
      };
      const sdk = toSDKMessage(cli);

      // Result messages spread ...rest
      expect(sdk.extra_field).toBe("preserved");
    });

    it("does not preserve extra fields for assistant messages", () => {
      const cli: CLIMessage = {
        type: "assistant",
        message: { content: [] },
        extra_field: "not preserved",
      };
      const sdk = toSDKMessage(cli);

      // Assistant messages only set specific fields, no spread
      expect(sdk.extra_field).toBeUndefined();
      expect(sdk.type).toBe("assistant");
      expect(sdk.message).toBeDefined();
    });

    it("does not preserve extra fields for user messages", () => {
      const cli: CLIMessage = {
        type: "user",
        session_id: "abc",
        message: {},
        extra_field: "not preserved",
      };
      const sdk = toSDKMessage(cli);

      // User messages only set specific fields, no spread
      expect(sdk.extra_field).toBeUndefined();
    });

    it("does not include type in spread fields", () => {
      const cli: CLIMessage = {
        type: "system",
        subtype: "test",
      };
      const sdk = toSDKMessage(cli);

      // Type should be set explicitly, not from spread
      expect(sdk.type).toBe("system");
      expect(Object.keys(sdk)).toContain("type");
    });
  });
});
