/**
 * Normalizes the loose SDKMessage union into typed Discord display events.
 *
 * SDKMessage uses `[key: string]: unknown` (an intentional design choice to
 * stay compatible with both the SDK and CLI runtimes without a compile-time
 * dependency). The casts in this file are a consequence of that — they narrow
 * the runtime shape for each message type. If SDKMessage is ever refined into
 * a proper discriminated union, these casts can be removed.
 */
import { extractMessageContent } from "@herdctl/chat";
import {
  extractToolResults,
  extractToolUseBlocks,
  type SDKMessage,
  type ToolResult,
  type ToolUseBlock,
} from "@herdctl/core";

export type DiscordNormalizedMessageEvent =
  | {
      kind: "assistant_final";
      content?: string;
      messageId?: string;
      stopReason?: unknown;
      toolUses: ToolUseBlock[];
    }
  | {
      kind: "assistant_delta";
      delta: string;
    }
  | {
      kind: "tool_results";
      results: ToolResult[];
    }
  | {
      kind: "system_status";
      status: string;
    }
  | {
      kind: "tool_progress";
      content: string;
    }
  | {
      kind: "auth_status";
      content: string;
      isError: boolean;
    }
  | {
      kind: "result";
      resultText?: string;
      isError: boolean;
      durationMs?: number;
      totalCostUsd?: number;
      numTurns?: number;
      usage?: { input_tokens?: number; output_tokens?: number };
    }
  | {
      kind: "error";
      message: string;
    };

function extractStreamDelta(message: SDKMessage): string | undefined {
  const event = message.event as
    | {
        type?: string;
        delta?: { type?: string; text?: string };
        content_block?: { type?: string; text?: string };
      }
    | undefined;

  if (!event) return undefined;

  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return event.delta.text;
  }
  if (event.type === "content_block_start" && event.content_block?.type === "text") {
    return event.content_block.text;
  }
  return undefined;
}

export function normalizeDiscordMessage(message: SDKMessage): DiscordNormalizedMessageEvent[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  if (message.type === "assistant") {
    const sdkMessage = message as unknown as Parameters<typeof extractMessageContent>[0];
    return [
      {
        kind: "assistant_final",
        content: extractMessageContent(sdkMessage) ?? undefined,
        messageId: (message as { message?: { id?: string } }).message?.id,
        stopReason: (message as { message?: { stop_reason?: unknown } }).message?.stop_reason,
        toolUses: extractToolUseBlocks(
          message as {
            type: string;
            message?: { content?: unknown };
          },
        ),
      },
    ];
  }

  if (message.type === "stream_event") {
    const delta = extractStreamDelta(message);
    return delta ? [{ kind: "assistant_delta", delta }] : [];
  }

  if (message.type === "user") {
    const results = extractToolResults(
      message as {
        type: string;
        message?: { content?: unknown };
        tool_use_result?: unknown;
      },
    );
    return results.length > 0 ? [{ kind: "tool_results", results }] : [];
  }

  if (message.type === "system") {
    const sys = message as { subtype?: string; status?: string | null; content?: string };
    if (sys.subtype === "status" && typeof sys.status === "string" && sys.status.length > 0) {
      return [{ kind: "system_status", status: sys.status }];
    }
    return [];
  }

  if (message.type === "tool_progress") {
    const toolName =
      typeof (message as { tool_name?: unknown }).tool_name === "string"
        ? (message as { tool_name: string }).tool_name
        : "Tool";
    return [{ kind: "tool_progress", content: `Tool ${toolName} in progress` }];
  }

  if (message.type === "auth_status") {
    const auth = message as { output?: string[]; error?: string };
    if (typeof auth.error === "string" && auth.error.length > 0) {
      return [
        { kind: "auth_status", content: `Authentication error: ${auth.error}`, isError: true },
      ];
    }
    if (Array.isArray(auth.output) && auth.output.length > 0) {
      return [{ kind: "auth_status", content: auth.output.join("\n"), isError: false }];
    }
    return [];
  }

  if (message.type === "result") {
    const resultMessage = message as {
      result?: string;
      is_error?: boolean;
      duration_ms?: number;
      total_cost_usd?: number;
      num_turns?: number;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return [
      {
        kind: "result",
        resultText:
          typeof resultMessage.result === "string" && resultMessage.result.trim().length > 0
            ? resultMessage.result
            : undefined,
        isError: resultMessage.is_error === true,
        durationMs: resultMessage.duration_ms,
        totalCostUsd: resultMessage.total_cost_usd,
        numTurns: resultMessage.num_turns,
        usage: resultMessage.usage,
      },
    ];
  }

  if (message.type === "error") {
    const errorText =
      typeof (message as { content?: unknown }).content === "string"
        ? ((message as { content: string }).content ?? "An unknown error occurred")
        : typeof (message as { message?: unknown }).message === "string"
          ? ((message as { message: string }).message ?? "An unknown error occurred")
          : "An unknown error occurred";
    return [{ kind: "error", message: errorText }];
  }

  return [];
}
