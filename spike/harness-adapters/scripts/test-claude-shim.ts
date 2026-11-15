/**
 * Fixture test for the Claude -> HarnessEvent shim.
 *
 * FIXTURE, NOT LIVE. These SDKMessage shapes are hand-built from
 * packages/core/src/runner/message-processor.ts (the production normaliser) and
 * from the SDK's own types -- no Claude API call is made, so nothing here costs
 * anything and nothing here proves the shapes are byte-accurate against a live
 * stream. It proves the UNION has somewhere to put each concept.
 */

import { translateClaudeMessage } from "../src/claude-shim.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`[PASS] ${name}`);
  } else {
    fail++;
    console.log(`[FAIL] ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// --- session start ----------------------------------------------------------
{
  const ev = translateClaudeMessage({
    type: "system",
    subtype: "init",
    session_id: "sess-abc-123",
    model: "claude-opus-5",
  });
  check("system/init -> session_started with id", ev[0]?.type === "session_started", JSON.stringify(ev));
  check(
    "session_started carries the id and model",
    ev[0]?.type === "session_started" && ev[0].sessionId === "sess-abc-123" && ev[0].model === "claude-opus-5",
  );
  check("raw native event is attached", ev[0]?.raw !== undefined);
}

// --- a non-init system message is dropped, not forced -----------------------
{
  const ev = translateClaudeMessage({ type: "system", subtype: "compact_boundary" });
  check("system/compact_boundary produces no normalised event", ev.length === 0, JSON.stringify(ev));
}

// --- assistant message with text + thinking + tool_use ----------------------
{
  const ev = translateClaudeMessage({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "I should write the file." },
        { type: "text", text: "Writing it now." },
        { type: "tool_use", id: "toolu_01", name: "Write", input: { file_path: "spike-alpha.txt" } },
      ],
      usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 },
    },
  } as never);
  const types = ev.map((e) => e.type);
  check(
    "one assistant message fans out to thinking + text + tool_call + usage",
    JSON.stringify(types) === JSON.stringify(["thinking", "assistant_text", "tool_call", "usage"]),
    JSON.stringify(types),
  );
  const call = ev.find((e) => e.type === "tool_call");
  check(
    "tool_call carries callId, name, input",
    call?.type === "tool_call" && call.callId === "toolu_01" && call.name === "Write",
  );
  const u = ev.find((e) => e.type === "usage");
  check(
    "usage folds cache tokens into inputTokens (10+90=100)",
    u?.type === "usage" && u.inputTokens === 100 && u.outputTokens === 5,
    JSON.stringify(u),
  );
}

// --- tool result arrives on a USER message ----------------------------------
{
  const ev = translateClaudeMessage({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "toolu_01", content: "File written", is_error: false },
      ],
    },
  } as never);
  check("user/tool_result -> tool_result", ev[0]?.type === "tool_result", JSON.stringify(ev));
  check(
    "tool_result correlates to the call and reports ok",
    ev[0]?.type === "tool_result" && ev[0].callId === "toolu_01" && ev[0].ok === true,
  );
}

// --- failing tool result ----------------------------------------------------
{
  const ev = translateClaudeMessage({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "nope", is_error: true }] },
  } as never);
  check("is_error tool_result maps to ok:false", ev[0]?.type === "tool_result" && ev[0].ok === false);
}

// --- deltas -----------------------------------------------------------------
{
  const ev = translateClaudeMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
  } as never);
  check("text_delta -> assistant_delta", ev[0]?.type === "assistant_delta" && ev[0].text === "Hel");
}
{
  const ev = translateClaudeMessage({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hm" } },
  } as never);
  check(
    "thinking_delta collapses onto thinking (union has no thinking_delta)",
    ev[0]?.type === "thinking",
    JSON.stringify(ev),
  );
}

// --- turn end: success ------------------------------------------------------
{
  const ev = translateClaudeMessage({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, output_tokens: 20 },
    num_turns: 2,
  } as never);
  const types = ev.map((e) => e.type);
  check("result -> usage + turn_end", JSON.stringify(types) === JSON.stringify(["usage", "turn_end"]), JSON.stringify(types));
  const u = ev.find((e) => e.type === "usage");
  check("Claude reports a dollar cost", u?.type === "usage" && u.costUsd === 0.0123);
  const te = ev.find((e) => e.type === "turn_end");
  check("successful result -> status ok", te?.type === "turn_end" && te.status === "ok");
}

// --- turn end: max turns ----------------------------------------------------
{
  const ev = translateClaudeMessage({ type: "result", subtype: "error_max_turns" } as never);
  const te = ev.find((e) => e.type === "turn_end");
  check("error_max_turns -> status max_turns", te?.type === "turn_end" && te.status === "max_turns");
}

// --- turn end: execution error ----------------------------------------------
{
  const ev = translateClaudeMessage({ type: "result", subtype: "error_during_execution" } as never);
  const te = ev.find((e) => e.type === "turn_end");
  check("error_during_execution -> status error", te?.type === "turn_end" && te.status === "error");
}

// --- unknown message type is survivable -------------------------------------
{
  const ev = translateClaudeMessage({ type: "tool_progress" } as never);
  check("unknown/unmapped type yields no events and does not throw", ev.length === 0);
}

console.log(`\n${pass + fail} checks: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exitCode = 1;
