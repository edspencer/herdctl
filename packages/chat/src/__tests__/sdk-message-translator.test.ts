/**
 * Tests for the transport-agnostic SDKMessage → chat-event translator.
 */

import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../message-extraction.js";
import {
  createSDKMessageHandler,
  SDKMessageTranslator,
  type TranslatedToolCall,
  type TranslatedToolStart,
} from "../sdk-message-translator.js";

// =============================================================================
// Helpers — build SDK messages in the shape the extractors expect
// =============================================================================

function assistantText(text: string): SDKMessage {
  return { type: "assistant", message: { content: [{ type: "text", text }] } };
}

/**
 * A synthetic placeholder turn as the Claude Code CLI emits it (model
 * "<synthetic>", e.g. "No response requested." after a /compact continuation).
 */
function syntheticAssistant(text = "No response requested."): SDKMessage {
  return {
    type: "assistant",
    message: { model: "<synthetic>", content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
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

/** Assistant text produced by a subagent (carries a `parent_tool_use_id`). */
function subagentText(text: string, parentToolUseId: string): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    message: { content: [{ type: "text", text }] },
  } as unknown as SDKMessage;
}

/** A subagent's `tool_use` (carries the spawning `Task` tool_use id). */
function subagentToolUse(
  id: string,
  name: string,
  parentToolUseId: string,
  input?: unknown,
): SDKMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    message: { content: [{ type: "tool_use", id, name, input }] },
  } as unknown as SDKMessage;
}

/**
 * A partial-message text delta, as the SDK emits it when
 * `includePartialMessages` is on: `type: "stream_event"` wrapping a
 * `content_block_delta` whose `delta` is a `text_delta`.
 */
function textDelta(text: string, parentToolUseId: string | null = null): SDKMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: parentToolUseId,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  } as unknown as SDKMessage;
}

/** A non-text stream event (e.g. a tool input-json delta) the translator ignores. */
function inputJsonDelta(partialJson: string): SDKMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: partialJson },
    },
  } as unknown as SDKMessage;
}

/** A subagent's `tool_result` user message (carries `parent_tool_use_id`). */
function subagentToolResult(
  toolUseId: string,
  output: string,
  parentToolUseId: string,
): SDKMessage {
  return {
    type: "user",
    parent_tool_use_id: parentToolUseId,
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: output, is_error: false }],
    },
  } as unknown as SDKMessage;
}

describe("SDKMessageTranslator", () => {
  describe("text deltas", () => {
    it("emits assistant text via onText", async () => {
      const onText = vi.fn();
      const t = new SDKMessageTranslator({ onText });

      await t.handle(assistantText("Hello "));
      await t.handle(assistantText("world"));

      expect(onText).toHaveBeenNthCalledWith(1, "Hello ", { parentToolUseId: null });
      expect(onText).toHaveBeenNthCalledWith(2, "world", { parentToolUseId: null });
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

  describe("synthetic placeholder turns", () => {
    it("does not emit onText or a boundary for a synthetic assistant message", async () => {
      const onText = vi.fn();
      const onBoundary = vi.fn();
      const t = new SDKMessageTranslator({ onText, onBoundary });

      await t.handle(syntheticAssistant());

      expect(onText).not.toHaveBeenCalled();
      expect(onBoundary).not.toHaveBeenCalled();
    });

    it("does not start a boundary — the next real assistant text emits with no leading boundary", async () => {
      const order: string[] = [];
      const t = new SDKMessageTranslator({
        onText: (text) => {
          order.push(`text:${text}`);
        },
        onBoundary: () => {
          order.push("boundary");
        },
      });

      // Post-/compact continuation: a synthetic placeholder lands at the head of
      // the turn, right before the user's real message is answered.
      await t.handle(syntheticAssistant());
      await t.handle(assistantText("real reply"));

      expect(order).toEqual(["text:real reply"]);
    });

    it("does not disturb the boundary between two surrounding real assistant turns", async () => {
      const onBoundary = vi.fn();
      const t = new SDKMessageTranslator({ onText: vi.fn(), onBoundary });

      await t.handle(assistantText("first"));
      await t.handle(syntheticAssistant());
      await t.handle(assistantText("second"));

      // The synthetic turn is skipped, so first→second is still one boundary.
      expect(onBoundary).toHaveBeenCalledTimes(1);
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
        parentToolUseId: null,
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
          parentToolUseId: null,
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

  describe("tool starts (in-flight)", () => {
    it("emits onToolStart immediately when a tool_use appears, before any result", async () => {
      const starts: TranslatedToolStart[] = [];
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({
        onToolStart: (s) => void starts.push(s),
        onToolCall: (c) => void calls.push(c),
      });

      await t.handle(assistantToolUse("t1", "Bash", { command: "sleep 300" }));

      // Fires before the tool_result arrives — no completion yet.
      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        toolName: "Bash",
        inputSummary: "sleep 300",
        toolUseId: "t1",
        parentToolUseId: null,
      });
      expect(calls).toHaveLength(0);
    });

    it("reconciles: onToolStart then onToolCall share the same toolUseId", async () => {
      const starts: TranslatedToolStart[] = [];
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({
        onToolStart: (s) => void starts.push(s),
        onToolCall: (c) => void calls.push(c),
      });

      await t.handle(assistantToolUse("t1", "Task", { description: "do work" }));
      await t.handle(toolResult("t1", "done"));

      expect(starts).toHaveLength(1);
      expect(calls).toHaveLength(1);
      expect(starts[0].toolUseId).toBe("t1");
      expect(calls[0].toolUseId).toBe("t1");
    });

    it("attributes a subagent's in-flight tool_use to its spawning Task id", async () => {
      const starts: TranslatedToolStart[] = [];
      const t = new SDKMessageTranslator({ onToolStart: (s) => void starts.push(s) });

      await t.handle(subagentToolUse("s1", "Grep", "task-42", { pattern: "foo" }));

      expect(starts).toHaveLength(1);
      expect(starts[0]).toEqual({
        toolName: "Grep",
        inputSummary: "foo",
        toolUseId: "s1",
        parentToolUseId: "task-42",
      });
    });

    it("still fires onToolStart when toolResults is false (independent concern)", async () => {
      const onToolStart = vi.fn();
      const onToolCall = vi.fn();
      const t = new SDKMessageTranslator({ onToolStart, onToolCall }, { toolResults: false });

      await t.handle(assistantToolUse("t1", "Bash", { command: "ls" }));
      await t.handle(toolResult("t1", "out"));

      expect(onToolStart).toHaveBeenCalledTimes(1);
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it("does not require onToolStart to be present (backward compatible)", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      // No onToolStart handler — must not throw.
      await t.handle(assistantToolUse("t1", "Bash", { command: "echo hi" }));
      await t.handle(toolResult("t1", "hi"));

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("Bash");
    });
  });

  describe("agent attribution (parent_tool_use_id)", () => {
    it("attaches parentToolUseId: null to main-agent text", async () => {
      const onText = vi.fn();
      const t = new SDKMessageTranslator({ onText });

      await t.handle(assistantText("main agent speaking"));

      expect(onText).toHaveBeenCalledWith("main agent speaking", { parentToolUseId: null });
    });

    it("attaches the spawning Task tool_use id to subagent text", async () => {
      const onText = vi.fn();
      const t = new SDKMessageTranslator({ onText });

      await t.handle(subagentText("subagent speaking", "task_abc"));

      expect(onText).toHaveBeenCalledWith("subagent speaking", { parentToolUseId: "task_abc" });
    });

    it("routes main and subagent text into separate lanes on the same turn", async () => {
      const events: Array<{ text: string; lane: string | null }> = [];
      const t = new SDKMessageTranslator({
        onText: (text, attribution) => {
          events.push({ text, lane: attribution.parentToolUseId });
        },
      });

      await t.handle(assistantText("main before Task"));
      await t.handle(subagentText("subagent working", "task_abc"));
      await t.handle(assistantText("main after Task"));

      expect(events).toEqual([
        { text: "main before Task", lane: null },
        { text: "subagent working", lane: "task_abc" },
        { text: "main after Task", lane: null },
      ]);
    });

    it("carries the issuing agent's attribution onto a subagent tool call", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      await t.handle(subagentToolUse("t1", "Bash", "task_abc", { command: "ls" }));
      await t.handle(subagentToolResult("t1", "out", "task_abc"));

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("Bash");
      expect(calls[0].parentToolUseId).toBe("task_abc");
    });

    it("attributes a main-agent tool call to null", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      await t.handle(assistantToolUse("t1", "Read", { file_path: "/a" }));
      await t.handle(toolResult("t1", "contents"));

      expect(calls[0].parentToolUseId).toBeNull();
    });

    it("keeps a tracked tool_use's own null attribution even if the result message carries an id", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      // A tracked main-agent tool_use (parentToolUseId: null). The result message
      // carries a different attribution — the tracked value must win, not fall
      // through to the message's (a nullish-coalescing merge would lose the null).
      await t.handle(assistantToolUse("t1", "Bash", { command: "ls" }));
      await t.handle(subagentToolResult("t1", "out", "task_zzz"));

      expect(calls).toHaveLength(1);
      expect(calls[0].parentToolUseId).toBeNull();
    });

    it("falls back to the result message's attribution when the tool_use wasn't tracked", async () => {
      const calls: TranslatedToolCall[] = [];
      const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

      // Orphan result (no preceding tool_use) still carries the lane from its
      // own parent_tool_use_id.
      await t.handle(subagentToolResult("orphan", "result", "task_xyz"));

      expect(calls).toHaveLength(1);
      expect(calls[0].toolName).toBe("Tool");
      expect(calls[0].parentToolUseId).toBe("task_xyz");
    });

    it("attaches attribution of the turn beginning to a boundary", async () => {
      const boundaries: Array<string | null> = [];
      const t = new SDKMessageTranslator({
        onText: vi.fn(),
        onBoundary: (attribution) => {
          boundaries.push(attribution.parentToolUseId);
        },
      });

      await t.handle(assistantText("main text"));
      // A subagent turn after main text → boundary attributed to the subagent lane.
      await t.handle(subagentText("subagent text", "task_abc"));

      expect(boundaries).toEqual(["task_abc"]);
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

describe("partial-message text streaming (stream_event / text_delta)", () => {
  it("emits ordered incremental onText for each text_delta", async () => {
    const chunks: string[] = [];
    const t = new SDKMessageTranslator({ onText: (text) => void chunks.push(text) });

    await t.handle(textDelta("Hel"));
    await t.handle(textDelta("lo, "));
    await t.handle(textDelta("world"));

    expect(chunks).toEqual(["Hel", "lo, ", "world"]);
  });

  it("threads agent attribution from the partial message onto each delta", async () => {
    const onText = vi.fn();
    const t = new SDKMessageTranslator({ onText });

    await t.handle(textDelta("sub", "task-1"));

    expect(onText).toHaveBeenCalledWith("sub", { parentToolUseId: "task-1" });
  });

  it("does NOT re-emit the terminal assistant text once it streamed as deltas", async () => {
    const chunks: string[] = [];
    const t = new SDKMessageTranslator({ onText: (text) => void chunks.push(text) });

    // Deltas for one assistant message, then the terminal whole assistant message
    // carrying the fully-assembled text (as the SDK sends it after the stream).
    await t.handle(textDelta("Hello "));
    await t.handle(textDelta("world"));
    await t.handle(assistantText("Hello world"));

    // Only the two deltas — the terminal whole-text emit is suppressed.
    expect(chunks).toEqual(["Hello ", "world"]);
  });

  it("still tracks tool_use on the terminal assistant message after streaming text", async () => {
    const chunks: string[] = [];
    const starts: TranslatedToolStart[] = [];
    const calls: TranslatedToolCall[] = [];
    const t = new SDKMessageTranslator({
      onText: (text) => void chunks.push(text),
      onToolStart: (s) => void starts.push(s),
      onToolCall: (c) => void calls.push(c),
    });

    // Assistant streams text, then the terminal message carries BOTH the text and
    // a tool_use block; the tool must still be surfaced and paired.
    await t.handle(textDelta("Let me read "));
    await t.handle(textDelta("that file."));
    await t.handle({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a" } },
        ],
      },
    } as unknown as SDKMessage);
    await t.handle(toolResult("t1", "file contents"));

    expect(chunks).toEqual(["Let me read ", "that file."]);
    expect(starts[0]).toMatchObject({ toolName: "Read", toolUseId: "t1" });
    expect(calls[0]).toMatchObject({ toolName: "Read", output: "file contents" });
  });

  it("ignores non-text stream events (tool input-json deltas)", async () => {
    const onText = vi.fn();
    const t = new SDKMessageTranslator({ onText });

    await t.handle(inputJsonDelta('{"command":"l'));
    await t.handle(inputJsonDelta('s"}'));

    expect(onText).not.toHaveBeenCalled();
  });

  it("emits a boundary between two streamed assistant turns, once, on the first delta", async () => {
    const order: string[] = [];
    const t = new SDKMessageTranslator({
      onText: (text) => void order.push(`text:${text}`),
      onBoundary: () => void order.push("boundary"),
    });

    // First streamed message.
    await t.handle(textDelta("first "));
    await t.handle(textDelta("turn"));
    await t.handle(assistantText("first turn"));
    // Second streamed message, no tool call in between → one boundary, on delta 1.
    await t.handle(textDelta("second "));
    await t.handle(textDelta("turn"));
    await t.handle(assistantText("second turn"));

    expect(order).toEqual(["text:first ", "text:turn", "boundary", "text:second ", "text:turn"]);
  });

  it("does not emit a boundary for streamed text immediately after a tool result", async () => {
    const onBoundary = vi.fn();
    const t = new SDKMessageTranslator({
      onText: vi.fn(),
      onBoundary,
      onToolCall: vi.fn(),
    });

    await t.handle(textDelta("before "));
    await t.handle(textDelta("tool"));
    await t.handle(assistantText("before tool"));
    await t.handle(assistantToolUse("t1", "Read", { file_path: "/a" }));
    await t.handle(toolResult("t1", "contents"));
    // Streamed text right after the tool result — a fresh bubble, no boundary.
    await t.handle(textDelta("after tool"));

    expect(onBoundary).not.toHaveBeenCalled();
  });
});

describe("image content blocks (issue #385)", () => {
  const PNG_1x1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  function imageToolResult(toolUseId: string, withText: boolean): SDKMessage {
    const content: unknown[] = [];
    if (withText) content.push({ type: "text", text: "Screenshot captured" });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG_1x1 },
    });
    return {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
      },
    } as unknown as SDKMessage;
  }

  function assistantWithImage(): SDKMessage {
    return {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Here you go:" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_1x1 } },
        ],
      },
    } as unknown as SDKMessage;
  }

  it("carries a tool-returned image onto the TranslatedToolCall", async () => {
    const calls: TranslatedToolCall[] = [];
    const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

    await t.handle(assistantToolUse("t1", "browser_take_screenshot"));
    await t.handle(imageToolResult("t1", true));

    expect(calls).toHaveLength(1);
    expect(calls[0].output).toBe("Screenshot captured");
    expect(calls[0].images).toEqual([{ kind: "base64", mediaType: "image/png", data: PNG_1x1 }]);
  });

  it("still emits a tool call for an image-only result (empty output)", async () => {
    const calls: TranslatedToolCall[] = [];
    const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

    await t.handle(assistantToolUse("t1", "browser_take_screenshot"));
    await t.handle(imageToolResult("t1", false));

    expect(calls).toHaveLength(1);
    expect(calls[0].output).toBe("");
    expect(calls[0].images).toHaveLength(1);
  });

  it("omits images on a text-only tool call", async () => {
    const calls: TranslatedToolCall[] = [];
    const t = new SDKMessageTranslator({ onToolCall: (c) => void calls.push(c) });

    await t.handle(assistantToolUse("t1", "Read", { file_path: "/f" }));
    await t.handle(toolResult("t1", "contents"));

    expect(calls[0].images).toBeUndefined();
  });

  it("fires onImages for an inline assistant image, with attribution", async () => {
    const onText = vi.fn();
    const onImages = vi.fn();
    const t = new SDKMessageTranslator({ onText, onImages });

    await t.handle(assistantWithImage());

    expect(onText).toHaveBeenCalledWith("Here you go:", { parentToolUseId: null });
    expect(onImages).toHaveBeenCalledTimes(1);
    expect(onImages).toHaveBeenCalledWith(
      [{ kind: "base64", mediaType: "image/png", data: PNG_1x1 }],
      { parentToolUseId: null },
    );
  });

  it("does not fire onImages for a text-only assistant message", async () => {
    const onImages = vi.fn();
    const t = new SDKMessageTranslator({ onImages });

    await t.handle(assistantText("no pictures here"));

    expect(onImages).not.toHaveBeenCalled();
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

    expect(onText).toHaveBeenCalledWith("hi", { parentToolUseId: null });
    expect(calls[0]).toMatchObject({ toolName: "Read", inputSummary: "/f", output: "contents" });
  });
});
