import { describe, it, expect } from "vitest";
import { processSDKMessage, isTerminalMessage, extractSummary } from "../message-processor.js";
import type { SDKMessage } from "../types.js";

// =============================================================================
// processSDKMessage tests
// =============================================================================

describe("processSDKMessage", () => {
  describe("system messages", () => {
    it("processes basic system message", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Session initialized",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toBe("Session initialized");
      }
    });

    it("processes system message with subtype", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Session started",
        subtype: "session_start",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toBe("Session started");
        expect(result.output.subtype).toBe("session_start");
      }
    });

    it("extracts session_id from system message with init subtype", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Initialized",
        subtype: "init",
        session_id: "session-abc123",
      };

      const result = processSDKMessage(message);

      expect(result.sessionId).toBe("session-abc123");
    });

    it("does not extract session_id from non-init system messages", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Progress update",
        subtype: "progress",
        session_id: "session-should-be-ignored",
      };

      const result = processSDKMessage(message);

      expect(result.sessionId).toBeUndefined();
    });

    it("does not extract session_id from system message without subtype", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Some message",
        session_id: "session-should-be-ignored",
      };

      const result = processSDKMessage(message);

      expect(result.sessionId).toBeUndefined();
    });

    it("handles system message without content", () => {
      const message: SDKMessage = {
        type: "system",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toBeUndefined();
      }
    });
  });

  describe("assistant messages", () => {
    it("processes basic assistant message", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Hello, world!",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("assistant");
      if (result.output.type === "assistant") {
        expect(result.output.content).toBe("Hello, world!");
      }
    });

    it("processes partial assistant message", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Partial...",
        partial: true,
      };

      const result = processSDKMessage(message);

      if (result.output.type === "assistant") {
        expect(result.output.content).toBe("Partial...");
        expect(result.output.partial).toBe(true);
      }
    });

    it("processes assistant message with usage info", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Response",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };

      const result = processSDKMessage(message);

      if (result.output.type === "assistant") {
        expect(result.output.usage?.input_tokens).toBe(100);
        expect(result.output.usage?.output_tokens).toBe(50);
      }
    });

    it("handles assistant message without content", () => {
      const message: SDKMessage = {
        type: "assistant",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("assistant");
      if (result.output.type === "assistant") {
        expect(result.output.content).toBeUndefined();
      }
    });

    it("handles partial usage info", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Response",
        usage: {
          input_tokens: 100,
        },
      };

      const result = processSDKMessage(message);

      if (result.output.type === "assistant") {
        expect(result.output.usage?.input_tokens).toBe(100);
        expect(result.output.usage?.output_tokens).toBeUndefined();
      }
    });
  });

  describe("tool_use messages", () => {
    it("processes basic tool_use message", () => {
      const message: SDKMessage = {
        type: "tool_use",
        tool_name: "read_file",
        tool_use_id: "tool-123",
        input: { path: "/etc/hosts" },
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("tool_use");
      if (result.output.type === "tool_use") {
        expect(result.output.tool_name).toBe("read_file");
        expect(result.output.tool_use_id).toBe("tool-123");
        expect(result.output.input).toEqual({ path: "/etc/hosts" });
      }
    });

    it("handles tool_use with name field instead of tool_name", () => {
      const message: SDKMessage = {
        type: "tool_use",
        name: "bash",
        tool_use_id: "tool-456",
        input: { command: "ls -la" },
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_use") {
        expect(result.output.tool_name).toBe("bash");
      }
    });

    it("handles tool_use without tool_name (uses unknown)", () => {
      const message: SDKMessage = {
        type: "tool_use",
        tool_use_id: "tool-789",
        input: {},
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_use") {
        expect(result.output.tool_name).toBe("unknown");
      }
    });

    it("handles tool_use without tool_use_id", () => {
      const message: SDKMessage = {
        type: "tool_use",
        tool_name: "read_file",
        input: { path: "/tmp/test" },
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_use") {
        expect(result.output.tool_use_id).toBeUndefined();
      }
    });

    it("handles tool_use with complex input", () => {
      const message: SDKMessage = {
        type: "tool_use",
        tool_name: "edit_file",
        tool_use_id: "tool-edit",
        input: {
          path: "/src/index.ts",
          changes: [
            { line: 10, action: "replace", content: "new content" },
            { line: 20, action: "delete" },
          ],
        },
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_use") {
        expect(result.output.input).toEqual({
          path: "/src/index.ts",
          changes: [
            { line: 10, action: "replace", content: "new content" },
            { line: 20, action: "delete" },
          ],
        });
      }
    });
  });

  describe("tool_result messages", () => {
    it("processes successful tool_result message", () => {
      const message: SDKMessage = {
        type: "tool_result",
        tool_use_id: "tool-123",
        result: "127.0.0.1 localhost",
        success: true,
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("tool_result");
      if (result.output.type === "tool_result") {
        expect(result.output.tool_use_id).toBe("tool-123");
        expect(result.output.result).toBe("127.0.0.1 localhost");
        expect(result.output.success).toBe(true);
      }
    });

    it("processes failed tool_result message", () => {
      const message: SDKMessage = {
        type: "tool_result",
        tool_use_id: "tool-456",
        success: false,
        error: "File not found: /nonexistent",
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_result") {
        expect(result.output.success).toBe(false);
        expect(result.output.error).toBe("File not found: /nonexistent");
      }
    });

    it("handles tool_result with complex result", () => {
      const message: SDKMessage = {
        type: "tool_result",
        tool_use_id: "tool-789",
        result: { files: ["a.txt", "b.txt"], count: 2 },
        success: true,
      };

      const result = processSDKMessage(message);

      if (result.output.type === "tool_result") {
        expect(result.output.result).toEqual({ files: ["a.txt", "b.txt"], count: 2 });
      }
    });

    it("handles tool_result without optional fields", () => {
      const message: SDKMessage = {
        type: "tool_result",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("tool_result");
      if (result.output.type === "tool_result") {
        expect(result.output.tool_use_id).toBeUndefined();
        expect(result.output.result).toBeUndefined();
        expect(result.output.success).toBeUndefined();
      }
    });
  });

  describe("error messages", () => {
    it("processes basic error message", () => {
      const message: SDKMessage = {
        type: "error",
        message: "Something went wrong",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("error");
      if (result.output.type === "error") {
        expect(result.output.message).toBe("Something went wrong");
      }
      expect(result.isFinal).toBe(true);
    });

    it("processes error message with code", () => {
      const message: SDKMessage = {
        type: "error",
        message: "Connection timeout",
        code: "ETIMEDOUT",
      };

      const result = processSDKMessage(message);

      if (result.output.type === "error") {
        expect(result.output.message).toBe("Connection timeout");
        expect(result.output.code).toBe("ETIMEDOUT");
      }
    });

    it("processes error message with stack trace", () => {
      const message: SDKMessage = {
        type: "error",
        message: "Unexpected error",
        code: "ERR_UNKNOWN",
        stack: "Error: Unexpected error\n  at foo.ts:10\n  at bar.ts:20",
      };

      const result = processSDKMessage(message);

      if (result.output.type === "error") {
        expect(result.output.stack).toContain("at foo.ts:10");
      }
    });

    it("handles error message without message field", () => {
      const message: SDKMessage = {
        type: "error",
      };

      const result = processSDKMessage(message);

      if (result.output.type === "error") {
        expect(result.output.message).toBe("Unknown error");
      }
    });
  });

  describe("unknown message types", () => {
    it("handles unknown message type gracefully", () => {
      const message = {
        type: "unknown_type",
        data: "some data",
      } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("Unknown message type");
        expect(result.output.subtype).toBe("unknown_type");
      }
    });
  });
});

// =============================================================================
// isTerminalMessage tests
// =============================================================================

describe("isTerminalMessage", () => {
  it("returns true for error messages", () => {
    const message: SDKMessage = {
      type: "error",
      message: "Failed",
    };

    expect(isTerminalMessage(message)).toBe(true);
  });

  it("returns true for system message with end subtype", () => {
    const message: SDKMessage = {
      type: "system",
      subtype: "end",
    };

    expect(isTerminalMessage(message)).toBe(true);
  });

  it("returns true for system message with complete subtype", () => {
    const message: SDKMessage = {
      type: "system",
      subtype: "complete",
    };

    expect(isTerminalMessage(message)).toBe(true);
  });

  it("returns true for system message with session_end subtype", () => {
    const message: SDKMessage = {
      type: "system",
      subtype: "session_end",
    };

    expect(isTerminalMessage(message)).toBe(true);
  });

  it("returns false for regular system message", () => {
    const message: SDKMessage = {
      type: "system",
      content: "Progress update",
    };

    expect(isTerminalMessage(message)).toBe(false);
  });

  it("returns false for assistant message", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Hello",
    };

    expect(isTerminalMessage(message)).toBe(false);
  });

  it("returns false for tool_use message", () => {
    const message: SDKMessage = {
      type: "tool_use",
      tool_name: "read_file",
    };

    expect(isTerminalMessage(message)).toBe(false);
  });

  it("returns false for tool_result message", () => {
    const message: SDKMessage = {
      type: "tool_result",
      success: true,
    };

    expect(isTerminalMessage(message)).toBe(false);
  });
});

// =============================================================================
// extractSummary tests
// =============================================================================

describe("extractSummary", () => {
  it("extracts explicit summary field", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Long content here...",
      summary: "Brief summary",
    };

    expect(extractSummary(message)).toBe("Brief summary");
  });

  it("uses short assistant content as summary", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Task completed successfully.",
      partial: false,
    };

    expect(extractSummary(message)).toBe("Task completed successfully.");
  });

  it("returns full assistant content regardless of length", () => {
    const longContent = "x".repeat(5000);
    const message: SDKMessage = {
      type: "assistant",
      content: longContent,
      partial: false,
    };

    // No length limit - returns full content
    expect(extractSummary(message)).toBe(longContent);
  });

  it("does not use partial assistant content as summary", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Partial content...",
      partial: true,
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("returns undefined for non-assistant messages", () => {
    const message: SDKMessage = {
      type: "system",
      content: "System message",
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("returns undefined for assistant message without content", () => {
    const message: SDKMessage = {
      type: "assistant",
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("prefers explicit summary over content", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Short content",
      summary: "Explicit summary",
    };

    expect(extractSummary(message)).toBe("Explicit summary");
  });

  it("handles long assistant content", () => {
    const content = "x".repeat(5000);
    const message: SDKMessage = {
      type: "assistant",
      content,
      partial: false,
    };

    // No truncation - returns full content
    expect(extractSummary(message)).toBe(content);
  });

  it("handles empty summary field", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Some content",
      summary: "",
    };

    // Empty string is falsy, so should fall back to content
    expect(extractSummary(message)).toBe("Some content");
  });

  it("returns full explicit summary without truncation", () => {
    const longSummary = "x".repeat(5000);
    const message: SDKMessage = {
      type: "assistant",
      content: "Some content",
      summary: longSummary,
    };

    // No truncation - downstream consumers handle their own limits
    const result = extractSummary(message);
    expect(result).toBe(longSummary);
    expect(result!.length).toBe(5000);
  });

  it("converts non-string summary to string", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Some content",
      summary: 12345 as unknown as string,
    };

    const result = extractSummary(message);
    expect(result).toBe("12345");
  });

  it("returns undefined for tool_use messages", () => {
    const message: SDKMessage = {
      type: "tool_use",
      tool_name: "bash",
      input: { command: "ls" },
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("returns undefined for tool_result messages", () => {
    const message: SDKMessage = {
      type: "tool_result",
      tool_use_id: "tool-123",
      result: "file1\nfile2",
      success: true,
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("returns undefined for error messages", () => {
    const message: SDKMessage = {
      type: "error",
      message: "Something went wrong",
    };

    expect(extractSummary(message)).toBeUndefined();
  });

  it("handles null message", () => {
    expect(extractSummary(null as unknown as SDKMessage)).toBeUndefined();
  });

  it("handles undefined message", () => {
    expect(extractSummary(undefined as unknown as SDKMessage)).toBeUndefined();
  });

  it("handles non-object message", () => {
    expect(extractSummary("string" as unknown as SDKMessage)).toBeUndefined();
    expect(extractSummary(123 as unknown as SDKMessage)).toBeUndefined();
  });
});

// =============================================================================
// Edge cases and special scenarios
// =============================================================================

describe("edge cases", () => {
  it("handles message with special characters in content", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: 'Content with "quotes", \\backslashes\\, and\nnewlines',
    };

    const result = processSDKMessage(message);

    if (result.output.type === "assistant") {
      expect(result.output.content).toBe('Content with "quotes", \\backslashes\\, and\nnewlines');
    }
  });

  it("handles message with unicode content", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "Hello 世界! 🌍 Γεια σου κόσμε",
    };

    const result = processSDKMessage(message);

    if (result.output.type === "assistant") {
      expect(result.output.content).toBe("Hello 世界! 🌍 Γεια σου κόσμε");
    }
  });

  it("handles message with empty string content", () => {
    const message: SDKMessage = {
      type: "assistant",
      content: "",
    };

    const result = processSDKMessage(message);

    if (result.output.type === "assistant") {
      expect(result.output.content).toBe("");
    }
  });

  it("handles tool_use with null input", () => {
    const message: SDKMessage = {
      type: "tool_use",
      tool_name: "test",
      input: null,
    };

    const result = processSDKMessage(message);

    if (result.output.type === "tool_use") {
      expect(result.output.input).toBeNull();
    }
  });

  it("handles tool_result with null result", () => {
    const message: SDKMessage = {
      type: "tool_result",
      tool_use_id: "tool-1",
      result: null,
      success: true,
    };

    const result = processSDKMessage(message);

    if (result.output.type === "tool_result") {
      expect(result.output.result).toBeNull();
    }
  });

  it("preserves extra fields in input", () => {
    const message: SDKMessage = {
      type: "tool_use",
      tool_name: "custom",
      input: {
        standard: "field",
        nested: { deeply: { nested: "value" } },
        array: [1, 2, 3],
      },
    };

    const result = processSDKMessage(message);

    if (result.output.type === "tool_use") {
      expect(result.output.input).toEqual({
        standard: "field",
        nested: { deeply: { nested: "value" } },
        array: [1, 2, 3],
      });
    }
  });
});

// =============================================================================
// Malformed response handling tests (US-7)
// =============================================================================

describe("malformed response handling (US-7)", () => {
  describe("null and undefined messages", () => {
    it("handles null message gracefully", () => {
      const result = processSDKMessage(null as unknown as SDKMessage);

      // Malformed messages are logged as system warnings, not errors,
      // to avoid terminating execution
      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("null");
        expect(result.output.subtype).toBe("malformed_message");
      }
    });

    it("handles undefined message gracefully", () => {
      const result = processSDKMessage(undefined as unknown as SDKMessage);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("undefined");
        expect(result.output.subtype).toBe("malformed_message");
      }
    });
  });

  describe("non-object messages", () => {
    it("handles string message", () => {
      const result = processSDKMessage("string message" as unknown as SDKMessage);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("string");
        expect(result.output.subtype).toBe("malformed_message");
      }
    });

    it("handles number message", () => {
      const result = processSDKMessage(42 as unknown as SDKMessage);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("number");
        expect(result.output.subtype).toBe("malformed_message");
      }
    });

    it("handles array message", () => {
      const result = processSDKMessage(["array"] as unknown as SDKMessage);

      // Arrays are objects, so this should be handled differently
      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.subtype).toBe("unknown_type");
      }
    });
  });

  describe("missing type field", () => {
    it("handles message without type field", () => {
      const message = { content: "No type field" } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("Unknown message type");
        expect(result.output.subtype).toBe("unknown_type");
      }
    });

    it("handles message with null type", () => {
      const message = { type: null, content: "Null type" } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.subtype).toBe("unknown_type");
      }
    });
  });

  describe("unexpected type values", () => {
    it("handles numeric type value", () => {
      const message = { type: 123, content: "Numeric type" } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("123");
        expect(result.output.subtype).toBe("unknown_type");
      }
    });

    it("handles object type value", () => {
      const message = {
        type: { nested: "object" },
        content: "Object type",
      } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.subtype).toBe("unknown_type");
      }
    });

    it("handles unknown string type value", () => {
      const message = { type: "custom_unknown_type", content: "Unknown" } as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.content).toContain("custom_unknown_type");
        expect(result.output.subtype).toBe("unknown_type");
      }
    });
  });

  describe("empty object messages", () => {
    it("handles empty object message", () => {
      const message = {} as unknown as SDKMessage;

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      if (result.output.type === "system") {
        expect(result.output.subtype).toBe("unknown_type");
      }
    });
  });

  describe("valid messages still work", () => {
    it("processes valid system message after malformed handling", () => {
      const message: SDKMessage = {
        type: "system",
        content: "Valid system message",
        subtype: "init",
        session_id: "session-123",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("system");
      expect(result.sessionId).toBe("session-123");
    });

    it("processes valid assistant message after malformed handling", () => {
      const message: SDKMessage = {
        type: "assistant",
        content: "Valid assistant response",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("assistant");
      if (result.output.type === "assistant") {
        expect(result.output.content).toBe("Valid assistant response");
      }
    });

    it("processes valid error message after malformed handling", () => {
      const message: SDKMessage = {
        type: "error",
        message: "Valid error message",
        code: "VALID_ERROR",
      };

      const result = processSDKMessage(message);

      expect(result.output.type).toBe("error");
      if (result.output.type === "error") {
        expect(result.output.message).toBe("Valid error message");
        expect(result.output.code).toBe("VALID_ERROR");
      }
      expect(result.isFinal).toBe(true);
    });
  });
});
