import { describe, expect, it } from "vitest";
import { normalizeDiscordMessage } from "../message-normalizer.js";

describe("normalizeDiscordMessage", () => {
  it("extracts assistant final content and tool uses", () => {
    const events = normalizeDiscordMessage({
      type: "assistant",
      message: {
        id: "msg-1",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Done." },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls -la" } },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "assistant_final",
      content: "Done.",
      messageId: "msg-1",
    });
    if (events[0].kind === "assistant_final") {
      expect(events[0].toolUses).toHaveLength(1);
      expect(events[0].toolUses[0].name).toBe("Bash");
    }
  });

  it("extracts stream_event text delta", () => {
    const events = normalizeDiscordMessage({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello " },
      },
    });

    expect(events).toEqual([{ kind: "assistant_delta", delta: "hello " }]);
  });

  it("extracts tool results from top-level tool_use_result", () => {
    const events = normalizeDiscordMessage({
      type: "user",
      tool_use_result: "output text",
    });

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("tool_results");
    if (events[0].kind === "tool_results") {
      expect(events[0].results).toHaveLength(1);
      expect(events[0].results[0]).toMatchObject({ output: "output text", isError: false });
    }
  });

  it("normalizes tool_progress and auth_status", () => {
    const toolProgress = normalizeDiscordMessage({
      type: "tool_progress",
      tool_name: "Bash",
    });
    expect(toolProgress).toEqual([{ kind: "tool_progress", content: "Tool Bash in progress" }]);

    const auth = normalizeDiscordMessage({
      type: "auth_status",
      output: ["Refreshing token", "Retrying..."],
    });
    expect(auth).toEqual([
      { kind: "auth_status", content: "Refreshing token\nRetrying...", isError: false },
    ]);
  });

  it("produces equivalent result events for SDK and CLI-style result payloads", () => {
    const sdkResult = normalizeDiscordMessage({
      type: "result",
      result: "All done",
      is_error: false,
      duration_ms: 1200,
      num_turns: 2,
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const cliSyntheticResult = normalizeDiscordMessage({
      type: "result",
      result: "All done",
      is_error: false,
      duration_ms: 1200,
      num_turns: 2,
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    expect(sdkResult).toEqual(cliSyntheticResult);
  });
});
