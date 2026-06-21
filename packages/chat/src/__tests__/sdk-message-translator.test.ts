/**
 * Tests for the transport-agnostic SDKMessage → chat-event translator.
 */

import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../message-extraction.js";
import {
  createSDKMessageHandler,
  SDKMessageTranslator,
  type TranslatedToolCall,
} from "../sdk-message-translator.js";

// =============================================================================
// Helpers — build SDK messages in the shape the extractors expect
// =============================================================================

function assistantText(text: string): SDKMessage {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}

function assistantToolUse(id: string, name: string, input?: unknown): SDKMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  } as unknown as SDKMessage;
}

function toolResult(toolUseId: string, output: string, isError = false): SDKMessage {
  return {
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: toolUseId, content: output, is_error: isError },
      ],
    },
  } as unknown as SDKMessage;
}

/**
 * The CLI-runtime shape: a user message that carries the result BOTH as an
 * id-less top-level `tool_use_result` (string/object, NO tool_use_id) AND as a
 * nested `message.content[]` `tool_result` block that DOES carry the
 * tool_use_id + is_error. Core's `extractToolResults` short-circuits on the
 * top-level field (losing the id); the translator must prefer the nested block.
 */
function cliToolResult(toolUseId: string, output: string, isError = false): SDKMessage {
  return {
    type: "user",
    // Id-less top-level result (this is what short-circuits extractToolResults).
    tool_use_result: output,
    message: {
      content: [
        { type: "tool_result", tool_use_id: toolUseId, content: output, is_error: isError },
      ],
    },
  } as unknown as SDKMessage;
}

/** SDK-runtime shape: only a top-level `tool_use_result`, no nested blocks. */
function sdkTopLevelToolResult(output: string): SDKMessage {
  return {
    type: "user",
    tool_use_result: output,
  } as unknown as SDKMessage;
}

describe("SDKMessageTranslator", () => {
  describe("text deltas", () => {
    it("emits assistant text via onText", async () => {
      const onText = vi.fn();
      const t = new SDKMessageTranslator({ onText });

      await t.handle(assistantText("Hello "));
      await t.handle(assistantText("world"));

      expect(onText).toHaveBeenNthCalledWith(1, "Hello ");
      expect(onText).toHaveBeenNthCalledWith(2, "world");
    });

    it("ignores non-assistant/non-user messages", async () => {
      const onText = vi.fn();
      const onToolCall = vi.fn();
      const t = new SDKMessageTranslator({ onText, onToolCall });

      await t.handle({ type: "system" });
      await t.handle({ type: "result" });
      await t.handle({ type: "stream_event" } as SDKMessage);

      expect(onText).not.toHaveBeenCalled();
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it("does not emit onText for an assistant message with no text", async () => {
      const onText = vi.fn();
      const t = new SDKMessageTranslator({ onText });

      await t.handle(assistantToolUse("t1", "Bash", { command: "ls" }));

      expect(onText).not.toHaveBeenCalled();
    });
  });

  describe("boundaries", () => {
    it("emits a boundary between two consecutive assistant text turns", async () => {
      const order: string[] = [];
      const t = new SDKMessageTranslator({
        onText: (text) => {
          order.push(`text:${text}`);
        },
        onBoundary: () => {
          order.push("boundary");
        },
      });

      await t.handle(assistantText("first"));
      await t.handle(assistantText("second"));

      expect(order).toEqual(["text:first", "boundary", "text:second"]);
    });

    it("does not emit a boundary before the first text", async () => {
      const onBoundary = vi.fn();
      const t = new SDKMessageTranslator({ onText: vi.fn(), onBoundary });

      await t.handle(assistantText("only"));

      expect(onBoundary).not.toHaveBeenCalled();
    });

    it("does not emit a boundary for text that immediately follows a tool result", async () => {
      const onBoundary = vi.fn();
      const t = new SDKMessageTranslator({ onText: vi.fn(), onBoundary, onToolCall: vi.fn() });

      await t.handle(assistantText("before tool"));
      await t.handle(assistantToolUse("t1", "Read", { file_path: "/a" }));
      await t.handle(toolResult("t1", "file contents"));
      await t.handle(assistantText("after tool"));

      // The tool result resets the text flag, so the post-tool text is NOT a boundary.
      expect(onBoundary).not.toHaveBeenCalled();
    });
  });

  describe("tool calls", () => {
    it("pairs a tool_use with its result, including name, input summary and duration", async () => {
      const calls: TranslatedToolCall[] = [];
      let clock = 1000;
      const t = new SDKMessageTranslator(
        { onToolCall: (c) => void calls.push(c) },
        { now: () => clock },
      );

      await t.handle(assistantToolUse("t1", "Bash", { command: "echo hi" }));
      clock = 1250; // 250ms later
      await t.handle(toolResult("t1", "hi"));

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        toolName: "Bash",
        inputSummary: "echo hi",
        output: "hi",
        isError: false,
        durationMs: 250,
        toolUseId: "t1",
      });
    });

    it("marks error results", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      await t.handle(assistantToolUse("t1", "Bash", { command: "false" }));
      await t.handle(toolResult("t1", "boom", true));

      expect(calls[0].isError).toBe(true);
      expect(calls[0].output).toBe("boom");
    });

    it("falls back to 'Tool' when there is no matching tool_use", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      // Result arrives with no preceding tool_use of that id
      await t.handle(toolResult("orphan", "result"));

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("Tool");
      expect(calls[0].durationMs).toBeUndefined();
      expect(calls[0].inputSummary).toBeUndefined();
    });

    it("does not emit tool calls when toolResults is false but still consumes pending uses", async () => {
      const onToolCall = vi.fn();
      const t = new SDKMessageTranslator({ onToolCall }, { toolResults: false });

      await t.handle(assistantToolUse("t1", "Bash", { command: "ls" }));
      await t.handle(toolResult("t1", "out"));

      expect(onToolCall).not.toHaveBeenCalled();
    });

    describe("CLI runtime (double-encoded results)", () => {
      it("pairs via the nested id-bearing block even when an id-less top-level tool_use_result is present", async () => {
        const calls: TranslatedToolCall[] = [];
        let clock = 1000;
        const t = new SDKMessageTranslator(
          { onToolCall: (c) => void calls.push(c) },
          { now: () => clock },
        );

        await t.handle(assistantToolUse("t1", "Bash", { command: "pwd" }));
        clock = 1113; // 113ms later
        // CLI shape: id-less top-level tool_use_result AND nested id-bearing block.
        await t.handle(cliToolResult("t1", "/home/agent"));

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({
          toolName: "Bash",
          inputSummary: "pwd",
          output: "/home/agent",
          isError: false,
          durationMs: 113,
          toolUseId: "t1",
        });
      });

      it("preserves is_error from the nested block in the CLI shape", async () => {
        const calls: TranslatedToolCall[] = [];
        const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

        await t.handle(assistantToolUse("t1", "Bash", { command: "false" }));
        await t.handle(cliToolResult("t1", "boom", true));

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
          toolName: "Bash",
          inputSummary: "false",
          output: "boom",
          isError: true,
          toolUseId: "t1",
        });
        expect(calls[0].durationMs).toBeDefined();
      });

      it("does not mutate the original SDK message when stripping the top-level field", async () => {
        const t = new SDKMessageTranslator({ onToolCall: vi.fn() });

        await t.handle(assistantToolUse("t1", "Read", { file_path: "/a" }));
        const msg = cliToolResult("t1", "contents");
        await t.handle(msg);

        // The id-less top-level field must still be present on the caller's object.
        expect((msg as unknown as { tool_use_result?: unknown }).tool_use_result).toBe("contents");
      });

      it("still falls back to the id-less top-level result when there is no nested block (SDK shape)", async () => {
        const calls: TranslatedToolCall[] = [];
        const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

        // tool_use is tracked, but the SDK-shape result has no tool_use_id, so it
        // cannot be paired — it falls back to the generic name (unchanged behavior).
        await t.handle(assistantToolUse("t1", "Bash", { command: "ls" }));
        await t.handle(sdkTopLevelToolResult("file-a\nfile-b"));

        expect(calls).toHaveLength(1);
        expect(calls[0].toolName).toBe("Tool");
        expect(calls[0].output).toBe("file-a\nfile-b");
        expect(calls[0].inputSummary).toBeUndefined();
        expect(calls[0].durationMs).toBeUndefined();
        expect(calls[0].toolUseId).toBeUndefined();
      });
    });
  });

  describe("backpressure", () => {
    it("awaits async handlers in order", async () => {
      const order: string[] = [];
      const t = new SDKMessageTranslator({
        onText: async (text) => {
          await new Promise((r) => setTimeout(r, 5));
          order.push(`text:${text}`);
        },
        onBoundary: async () => {
          order.push("boundary");
        },
      });

      await t.handle(assistantText("a"));
      await t.handle(assistantText("b"));

      expect(order).toEqual(["text:a", "boundary", "text:b"]);
    });
  });

  describe("reset()", () => {
    it("clears pending tool uses and text state", async () => {
      const onBoundary = vi.fn();
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({
        onText: vi.fn(),
        onBoundary,
        onToolCall: (c) => void calls.push(c),
      });

      await t.handle(assistantText("turn 1"));
      await t.handle(assistantToolUse("t1", "Bash", { command: "x" }));
      t.reset();

      // After reset: previous text flag cleared (no boundary on next text)
      await t.handle(assistantText("turn 2"));
      expect(onBoundary).not.toHaveBeenCalled();

      // After reset: the orphaned tool_use no longer pairs
      await t.handle(toolResult("t1", "late"));
      expect(calls[0].toolName).toBe("Tool");
    });
  });
});

describe("createSDKMessageHandler", () => {
  it("returns an onMessage handler driving a fresh translator", async () => {
    const onText = vi.fn();
    const calls: TranslatedToolCall[] = [];
    const handler = createSDKMessageHandler({
      onText,
      onToolCall: (c) => void calls.push(c),
    });

    await handler(assistantText("hi"));
    await handler(assistantToolUse("t1", "Read", { file_path: "/f" }));
    await handler(toolResult("t1", "contents"));

    expect(onText).toHaveBeenCalledWith("hi");
    expect(calls[0]).toMatchObject({ toolName: "Read", inputSummary: "/f", output: "contents" });
  });
});
