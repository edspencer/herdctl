import { describe, it, expect } from "vitest";
import {
  JobOutputTypeSchema,
  JobOutputMessageSchema,
  SystemMessageSchema,
  AssistantMessageSchema,
  ToolUseMessageSchema,
  ToolResultMessageSchema,
  ErrorMessageSchema,
  validateJobOutputMessage,
  isValidJobOutputInput,
  type JobOutputMessage,
  type JobOutputInput,
} from "../job-output.js";

describe("JobOutputTypeSchema", () => {
  it("accepts valid types", () => {
    expect(JobOutputTypeSchema.parse("system")).toBe("system");
    expect(JobOutputTypeSchema.parse("assistant")).toBe("assistant");
    expect(JobOutputTypeSchema.parse("tool_use")).toBe("tool_use");
    expect(JobOutputTypeSchema.parse("tool_result")).toBe("tool_result");
    expect(JobOutputTypeSchema.parse("error")).toBe("error");
  });

  it("rejects invalid types", () => {
    expect(() => JobOutputTypeSchema.parse("invalid")).toThrow();
    expect(() => JobOutputTypeSchema.parse("")).toThrow();
    expect(() => JobOutputTypeSchema.parse(null)).toThrow();
  });
});

describe("SystemMessageSchema", () => {
  it("accepts valid system message", () => {
    const message = {
      type: "system" as const,
      timestamp: "2024-01-15T10:00:00Z",
      content: "System initialized",
    };
    expect(SystemMessageSchema.parse(message)).toEqual(message);
  });

  it("accepts system message with subtype", () => {
    const message = {
      type: "system" as const,
      timestamp: "2024-01-15T10:00:00Z",
      subtype: "session_start",
    };
    expect(SystemMessageSchema.parse(message).subtype).toBe("session_start");
  });

  it("accepts minimal system message", () => {
    const message = {
      type: "system" as const,
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(SystemMessageSchema.parse(message)).toEqual(message);
  });
});

describe("AssistantMessageSchema", () => {
  it("accepts valid assistant message", () => {
    const message = {
      type: "assistant" as const,
      timestamp: "2024-01-15T10:00:00Z",
      content: "Hello, world!",
    };
    expect(AssistantMessageSchema.parse(message)).toEqual(message);
  });

  it("accepts assistant message with partial flag", () => {
    const message = {
      type: "assistant" as const,
      timestamp: "2024-01-15T10:00:00Z",
      content: "Partial...",
      partial: true,
    };
    expect(AssistantMessageSchema.parse(message).partial).toBe(true);
  });

  it("accepts assistant message with usage info", () => {
    const message = {
      type: "assistant" as const,
      timestamp: "2024-01-15T10:00:00Z",
      content: "Response",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    };
    expect(AssistantMessageSchema.parse(message).usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
    });
  });
});

describe("ToolUseMessageSchema", () => {
  it("accepts valid tool_use message", () => {
    const message = {
      type: "tool_use" as const,
      timestamp: "2024-01-15T10:00:00Z",
      tool_name: "read_file",
    };
    expect(ToolUseMessageSchema.parse(message)).toEqual(message);
  });

  it("accepts tool_use with full details", () => {
    const message = {
      type: "tool_use" as const,
      timestamp: "2024-01-15T10:00:00Z",
      tool_name: "bash",
      tool_use_id: "tool-123",
      input: { command: "ls -la" },
    };
    const parsed = ToolUseMessageSchema.parse(message);
    expect(parsed.tool_name).toBe("bash");
    expect(parsed.tool_use_id).toBe("tool-123");
    expect(parsed.input).toEqual({ command: "ls -la" });
  });

  it("rejects tool_use without tool_name", () => {
    const message = {
      type: "tool_use" as const,
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(() => ToolUseMessageSchema.parse(message)).toThrow();
  });
});

describe("ToolResultMessageSchema", () => {
  it("accepts valid tool_result message", () => {
    const message = {
      type: "tool_result" as const,
      timestamp: "2024-01-15T10:00:00Z",
      result: "file contents",
      success: true,
    };
    expect(ToolResultMessageSchema.parse(message).success).toBe(true);
  });

  it("accepts tool_result with error", () => {
    const message = {
      type: "tool_result" as const,
      timestamp: "2024-01-15T10:00:00Z",
      success: false,
      error: "Command failed with exit code 1",
    };
    const parsed = ToolResultMessageSchema.parse(message);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe("Command failed with exit code 1");
  });

  it("accepts minimal tool_result", () => {
    const message = {
      type: "tool_result" as const,
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(ToolResultMessageSchema.parse(message)).toEqual(message);
  });
});

describe("ErrorMessageSchema", () => {
  it("accepts valid error message", () => {
    const message = {
      type: "error" as const,
      timestamp: "2024-01-15T10:00:00Z",
      message: "Something went wrong",
    };
    expect(ErrorMessageSchema.parse(message).message).toBe("Something went wrong");
  });

  it("accepts error with code and stack", () => {
    const message = {
      type: "error" as const,
      timestamp: "2024-01-15T10:00:00Z",
      message: "Timeout",
      code: "ERR_TIMEOUT",
      stack: "Error: Timeout\n  at foo.ts:10",
    };
    const parsed = ErrorMessageSchema.parse(message);
    expect(parsed.code).toBe("ERR_TIMEOUT");
    expect(parsed.stack).toContain("foo.ts:10");
  });

  it("rejects error without message", () => {
    const message = {
      type: "error" as const,
      timestamp: "2024-01-15T10:00:00Z",
    };
    expect(() => ErrorMessageSchema.parse(message)).toThrow();
  });
});

describe("JobOutputMessageSchema (discriminated union)", () => {
  it("parses system message", () => {
    const msg: JobOutputMessage = JobOutputMessageSchema.parse({
      type: "system",
      timestamp: "2024-01-15T10:00:00Z",
      content: "Init",
    });
    expect(msg.type).toBe("system");
  });

  it("parses assistant message", () => {
    const msg: JobOutputMessage = JobOutputMessageSchema.parse({
      type: "assistant",
      timestamp: "2024-01-15T10:00:00Z",
      content: "Hello",
    });
    expect(msg.type).toBe("assistant");
  });

  it("parses tool_use message", () => {
    const msg: JobOutputMessage = JobOutputMessageSchema.parse({
      type: "tool_use",
      timestamp: "2024-01-15T10:00:00Z",
      tool_name: "test",
    });
    expect(msg.type).toBe("tool_use");
  });

  it("parses tool_result message", () => {
    const msg: JobOutputMessage = JobOutputMessageSchema.parse({
      type: "tool_result",
      timestamp: "2024-01-15T10:00:00Z",
    });
    expect(msg.type).toBe("tool_result");
  });

  it("parses error message", () => {
    const msg: JobOutputMessage = JobOutputMessageSchema.parse({
      type: "error",
      timestamp: "2024-01-15T10:00:00Z",
      message: "Oops",
    });
    expect(msg.type).toBe("error");
  });

  it("rejects invalid type", () => {
    expect(() =>
      JobOutputMessageSchema.parse({
        type: "invalid",
        timestamp: "2024-01-15T10:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects missing type", () => {
    expect(() =>
      JobOutputMessageSchema.parse({
        timestamp: "2024-01-15T10:00:00Z",
      }),
    ).toThrow();
  });
});

describe("validateJobOutputMessage", () => {
  it("returns parsed message for valid input", () => {
    const input = {
      type: "assistant",
      timestamp: "2024-01-15T10:00:00Z",
      content: "Hello",
    };
    const result = validateJobOutputMessage(input);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("assistant");
  });

  it("returns null for invalid input", () => {
    expect(validateJobOutputMessage({ type: "invalid" })).toBeNull();
    expect(validateJobOutputMessage(null)).toBeNull();
    expect(validateJobOutputMessage("string")).toBeNull();
    expect(validateJobOutputMessage(123)).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(
      validateJobOutputMessage({
        type: "error",
        timestamp: "2024-01-15T10:00:00Z",
        // missing message
      }),
    ).toBeNull();

    expect(
      validateJobOutputMessage({
        type: "tool_use",
        timestamp: "2024-01-15T10:00:00Z",
        // missing tool_name
      }),
    ).toBeNull();
  });
});

describe("isValidJobOutputInput", () => {
  it("returns true for valid input objects", () => {
    expect(isValidJobOutputInput({ type: "system" })).toBe(true);
    expect(isValidJobOutputInput({ type: "assistant", content: "Hi" })).toBe(true);
    expect(isValidJobOutputInput({ type: "tool_use", tool_name: "test" })).toBe(true);
    expect(isValidJobOutputInput({ type: "tool_result" })).toBe(true);
    expect(isValidJobOutputInput({ type: "error", message: "Err" })).toBe(true);
  });

  it("returns false for invalid type", () => {
    expect(isValidJobOutputInput({ type: "invalid" })).toBe(false);
    expect(isValidJobOutputInput({ type: "" })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isValidJobOutputInput(null)).toBe(false);
    expect(isValidJobOutputInput(undefined)).toBe(false);
    expect(isValidJobOutputInput("string")).toBe(false);
    expect(isValidJobOutputInput(123)).toBe(false);
    expect(isValidJobOutputInput([])).toBe(false);
  });

  it("returns false for objects without type", () => {
    expect(isValidJobOutputInput({})).toBe(false);
    expect(isValidJobOutputInput({ content: "Hi" })).toBe(false);
  });

  it("returns false for objects with non-string type", () => {
    expect(isValidJobOutputInput({ type: 123 })).toBe(false);
    expect(isValidJobOutputInput({ type: null })).toBe(false);
    expect(isValidJobOutputInput({ type: {} })).toBe(false);
  });

  it("allows objects without timestamp (timestamp added later)", () => {
    const input: JobOutputInput = { type: "assistant", content: "Hi" };
    expect(isValidJobOutputInput(input)).toBe(true);
  });
});
