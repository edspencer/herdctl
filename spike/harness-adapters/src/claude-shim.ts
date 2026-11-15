/**
 * Claude mapping shim: existing Claude `SDKMessage` stream -> normalised
 * `HarnessEvent` union.
 *
 * Purpose is evidence, not migration. herdctl's consumers (chat, discord,
 * slack, web, Paddock) all parse Claude's raw message shape today and this
 * file does not touch any of them. It exists to answer one question: does the
 * herdctl-owned event union actually fit Claude, or is it only shaped to fit
 * the newcomers?
 *
 * Shapes are taken from `packages/core/src/runner/message-processor.ts`, which
 * is the existing production normaliser and therefore the authority on what
 * Claude really emits.
 *
 * Worth recording: that existing normaliser maps Claude's terminal `result`
 * message onto a `JobOutputMessage` of type `tool_result`. A turn ending is not
 * a tool returning. That squash is a sign the current small normalised path has
 * already run out of vocabulary, which is part of the case for a real union.
 */

import type { HarnessCapabilities, HarnessEvent } from "./harness.ts";

/** Minimal structural view of the Claude SDK messages we translate. */
interface ClaudeSdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: {
    content?: unknown;
    usage?: Record<string, number | undefined>;
    model?: string;
  };
  usage?: Record<string, number | undefined>;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string; thinking?: string };
    content_block?: { type?: string; text?: string };
  };
  tool_use_id?: string;
  tool_use_result?: unknown;
  is_error?: boolean;
  errors?: string[];
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
}

const now = () => new Date().toISOString();

function usageEvent(
  raw: unknown,
  usage: Record<string, number | undefined> | undefined,
  costUsd?: number,
): HarnessEvent | undefined {
  if (!usage && costUsd === undefined) return undefined;
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheCreate = usage?.cache_creation_input_tokens ?? 0;
  const input = (usage?.input_tokens ?? 0) + cacheRead + cacheCreate;
  return {
    type: "usage",
    timestamp: now(),
    raw,
    ...(usage ? { inputTokens: input, outputTokens: usage.output_tokens ?? 0 } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  } as HarnessEvent;
}

/**
 * Translate ONE Claude SDK message into zero or more normalised events.
 *
 * One-to-many because a single Claude `assistant` message can carry text,
 * thinking and several tool_use blocks at once -- the normalised union splits
 * those into separate events, which is the whole point of normalising.
 */
export function translateClaudeMessage(msg: ClaudeSdkMessage): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  const base = { timestamp: now(), raw: msg };

  switch (msg.type) {
    case "system": {
      if (msg.subtype === "init" && msg.session_id) {
        out.push({
          ...base,
          type: "session_started",
          sessionId: msg.session_id,
          ...(msg.model ? { model: msg.model } : {}),
        });
      }
      // Other system subtypes (status, compact_boundary, ...) have no
      // normalised equivalent. Deliberately dropped rather than forced into
      // the union -- consumers that care read `raw`.
      return out;
    }

    case "assistant": {
      const blocks = Array.isArray(msg.message?.content) ? msg.message!.content : [];
      for (const b of blocks as Record<string, unknown>[]) {
        if (b?.type === "text" && typeof b.text === "string") {
          out.push({ ...base, type: "assistant_text", text: b.text });
        } else if (b?.type === "thinking" && typeof b.thinking === "string") {
          out.push({ ...base, type: "thinking", text: b.thinking });
        } else if (b?.type === "tool_use") {
          out.push({
            ...base,
            type: "tool_call",
            callId: String(b.id ?? ""),
            name: String(b.name ?? ""),
            input: b.input,
          });
        }
      }
      const u = usageEvent(msg, msg.message?.usage ?? msg.usage);
      if (u) out.push(u);
      return out;
    }

    case "stream_event": {
      const e = msg.event;
      if (e?.type === "content_block_delta") {
        if (e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
          out.push({ ...base, type: "assistant_delta", text: e.delta.text });
        } else if (e.delta?.type === "thinking_delta" && typeof e.delta.thinking === "string") {
          // Claude streams thinking incrementally. The union has no
          // `thinking_delta`, so this collapses onto `thinking`. See BEND note.
          out.push({ ...base, type: "thinking", text: e.delta.thinking });
        }
      }
      return out;
    }

    case "user": {
      // Claude reports tool RESULTS as user messages carrying tool_result
      // blocks -- the result arrives on the "wrong" role, which any normalising
      // layer has to know.
      const blocks = Array.isArray(msg.message?.content) ? msg.message!.content : [];
      for (const b of blocks as Record<string, unknown>[]) {
        if (b?.type === "tool_result") {
          out.push({
            ...base,
            type: "tool_result",
            callId: String(b.tool_use_id ?? ""),
            ok: b.is_error !== true,
            output: b.content,
          });
        }
      }
      if (out.length === 0 && msg.tool_use_result !== undefined) {
        out.push({
          ...base,
          type: "tool_result",
          callId: String(msg.tool_use_id ?? ""),
          ok: true,
          output: msg.tool_use_result,
        });
      }
      return out;
    }

    case "result": {
      const u = usageEvent(msg, msg.usage, msg.total_cost_usd);
      if (u) out.push(u);
      const isError = msg.is_error === true || (!!msg.subtype && msg.subtype !== "success");
      let status: "ok" | "interrupted" | "error" | "max_turns" = "ok";
      if (msg.subtype === "error_max_turns") status = "max_turns";
      else if (isError) status = "error";
      out.push({ ...base, type: "turn_end", status });
      return out;
    }

    case "error": {
      out.push({
        ...base,
        type: "error",
        message: msg.errors?.join("; ") ?? msg.result ?? "unknown Claude error",
      });
      return out;
    }

    default:
      // tool_progress, auth_status and anything new: no normalised equivalent.
      return out;
  }
}

/** Translate a whole stream. */
export async function* translateClaudeStream(
  messages: AsyncIterable<ClaudeSdkMessage>,
): AsyncIterable<HarnessEvent> {
  for await (const m of messages) {
    for (const e of translateClaudeMessage(m)) yield e;
  }
}

/**
 * What the Claude runtime can do, in the normalised vocabulary.
 * Values reflect herdctl's existing SDK runtime, not aspiration.
 */
export const claudeCapabilities: HarnessCapabilities = {
  resume: "yes",
  fork: "yes",
  interrupt: "yes",
  approvals: "yes", // canUseTool / permission modes
  streamingDeltas: "yes", // includePartialMessages
  thinking: "yes",
  toolOutputDeltas: "yes", // tool_progress messages
  mcpStdio: "yes",
  mcpHttp: "yes",
  transcriptRead: "yes", // the transcript store (out of scope for this spike)
  tokenUsage: "yes",
  costUsd: "yes", // total_cost_usd on the result message
  setModelMidSession: "yes", // RuntimeSession.setModel
  listCommands: "yes", // RuntimeSession.listCommands
  sandbox: "no", // permission prompts, not an enforced sandbox
  mcpInjection: "per-session",
  via: {
    sandbox: "permission modes gate tool use; they do not confine side effects",
  },
};
