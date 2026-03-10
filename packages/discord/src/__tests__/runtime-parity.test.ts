import type { SDKMessage } from "@herdctl/core";
import { describe, expect, it } from "vitest";
import { normalizeDiscordMessage } from "../message-normalizer.js";

function renderTimeline(messages: SDKMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    for (const event of normalizeDiscordMessage(message)) {
      switch (event.kind) {
        case "assistant_delta":
          lines.push(`delta:${event.delta}`);
          break;
        case "assistant_final":
          if (event.content) {
            lines.push(`answer:${event.content}`);
          }
          if (event.toolUses.length > 0) {
            lines.push(`tools:${event.toolUses.map((t) => t.name).join(",")}`);
          }
          break;
        case "tool_results":
          for (const result of event.results) {
            lines.push(
              `tool_result:${result.isError ? "error" : "ok"}:${result.output.slice(0, 40)}`,
            );
          }
          break;
        case "system_status":
          lines.push(`system:${event.status}`);
          break;
        case "tool_progress":
          lines.push(`progress:${event.content}`);
          break;
        case "auth_status":
          lines.push(`auth:${event.isError ? "error" : "ok"}:${event.content}`);
          break;
        case "result":
          lines.push(`result:${event.isError ? "error" : "ok"}:${event.resultText ?? ""}`);
          break;
        case "error":
          lines.push(`error:${event.message}`);
          break;
      }
    }
  }
  return lines;
}

type RuntimeFixture = {
  name: string;
  sdk: SDKMessage[];
  cli: SDKMessage[];
};

const fixtures: RuntimeFixture[] = [
  {
    name: "tool-heavy flow",
    sdk: [
      {
        type: "assistant",
        message: {
          id: "a1",
          stop_reason: null,
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }],
        },
      } as SDKMessage,
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "file-a\nfile-b" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "a1",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done with listing." }],
        },
      } as SDKMessage,
      { type: "result", result: "Done with listing.", is_error: false } as SDKMessage,
    ],
    cli: [
      {
        type: "assistant",
        message: {
          id: "a1",
          stop_reason: null,
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls -la" } }],
        },
      } as SDKMessage,
      { type: "user", tool_use_result: "file-a\nfile-b" } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "a1",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Done with listing." }],
        },
      } as SDKMessage,
      { type: "result", result: "Done with listing.", is_error: false } as SDKMessage,
    ],
  },
  {
    name: "streaming answer flow",
    sdk: [
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
      } as SDKMessage,
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "a2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Hello world" }],
        },
      } as SDKMessage,
      { type: "result", result: "Hello world", is_error: false } as SDKMessage,
    ],
    cli: [
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
      } as SDKMessage,
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "a2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Hello world" }],
        },
      } as SDKMessage,
      { type: "result", result: "Hello world", is_error: false } as SDKMessage,
    ],
  },
  {
    name: "error/status flow",
    sdk: [
      { type: "tool_progress", tool_name: "Read" } as SDKMessage,
      { type: "auth_status", output: ["Authenticating"] } as SDKMessage,
      { type: "auth_status", error: "Token expired" } as SDKMessage,
      { type: "error", content: "Execution failed" } as SDKMessage,
      { type: "result", result: "Execution failed", is_error: true } as SDKMessage,
    ],
    cli: [
      { type: "tool_progress", tool_name: "Read" } as SDKMessage,
      { type: "auth_status", output: ["Authenticating"] } as SDKMessage,
      { type: "auth_status", error: "Token expired" } as SDKMessage,
      { type: "error", message: "Execution failed" } as SDKMessage,
      { type: "result", result: "Execution failed", is_error: true } as SDKMessage,
    ],
  },
];

describe("runtime stream parity", () => {
  it.each(fixtures)("produces equivalent visible timeline for $name", (fixture) => {
    expect(renderTimeline(fixture.sdk)).toEqual(renderTimeline(fixture.cli));
  });
});
