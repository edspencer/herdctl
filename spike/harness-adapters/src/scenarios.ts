/**
 * The one scenario, run against every harness.
 *
 * Written purely against `HarnessAdapter` / `HarnessSession` -- it never names
 * Pi, Codex or Claude. That is deliberate: if a scenario needs a harness-shaped
 * escape hatch to pass, the interface is wrong and that is a finding, not
 * something to paper over in the runner.
 *
 * Each scenario returns a verdict:
 *   PASS    -- observed working
 *   FAIL    -- the harness/adapter claims to support it but it did not work
 *   ABSENT  -- the harness genuinely does not have this concept
 *   BLOCKED -- could not be tested here (e.g. needs a credential)
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { HarnessAdapter, HarnessEvent, HarnessSession, StartSessionOptions } from "./harness.ts";

export type Verdict = "PASS" | "FAIL" | "ABSENT" | "BLOCKED";

export interface ScenarioResult {
  name: string;
  verdict: Verdict;
  detail: string;
  /** Normalised event types observed, in order -- the evidence. */
  events?: string[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Collect events until a predicate fires or we time out. */
export async function collectUntil(
  session: HarnessSession,
  stop: (e: HarnessEvent) => boolean,
  timeoutMs: number,
  onEvent?: (e: HarnessEvent) => void,
): Promise<{ events: HarnessEvent[]; timedOut: boolean }> {
  const events: HarnessEvent[] = [];
  let timedOut = true;
  const deadline = Date.now() + timeoutMs;

  const iterator = session.events[Symbol.asyncIterator]();
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const next = await Promise.race([
      iterator.next(),
      new Promise<{ done: true; value: undefined }>((r) =>
        setTimeout(() => r({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (next.done) break;
    const e = next.value as HarnessEvent;
    events.push(e);
    onEvent?.(e);
    if (stop(e)) {
      timedOut = false;
      break;
    }
  }
  return { events, timedOut };
}

export function printEvent(e: HarnessEvent): void {
  const t = e.type.padEnd(16);
  switch (e.type) {
    case "session_started":
      console.log(`  ${t} id=${e.sessionId}${e.model ? ` model=${e.model}` : ""}`);
      break;
    case "assistant_text":
      console.log(`  ${t} ${JSON.stringify(e.text.slice(0, 160))}`);
      break;
    case "assistant_delta":
      console.log(`  ${t} ${JSON.stringify(e.text.slice(0, 40))}`);
      break;
    case "thinking":
      console.log(`  ${t} ${JSON.stringify(e.text.slice(0, 80))}`);
      break;
    case "tool_call":
      console.log(`  ${t} ${e.name}(${JSON.stringify(e.input).slice(0, 140)}) id=${e.callId}`);
      break;
    case "tool_result":
      console.log(`  ${t} ok=${e.ok} ${JSON.stringify(e.output).slice(0, 140)} id=${e.callId}`);
      break;
    case "usage":
      console.log(`  ${t} in=${e.inputTokens} out=${e.outputTokens} cost=${e.costUsd ?? "n/a"}`);
      break;
    case "turn_end":
      console.log(`  ${t} status=${e.status}`);
      break;
    case "error":
      console.log(`  ${t} ${e.message.slice(0, 220)}`);
      break;
  }
}

const TURN_TIMEOUT = 90_000;

function freshWorkdir(root: string, tag: string): string {
  const dir = join(root, tag);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// =============================================================================
// S1 + S2: start, session id, tool round-trip, turn end
// =============================================================================

/**
 * Start a session, force a tool call that creates a file, confirm the file
 * really landed on disk, and confirm the turn ended.
 *
 * Checks the file itself rather than trusting the event stream: a harness can
 * report a tool call it never actually executed.
 */
export async function scenarioToolRoundTrip(
  adapter: HarnessAdapter,
  workRoot: string,
  baseOpts: Omit<StartSessionOptions, "cwd">,
): Promise<{ results: ScenarioResult[]; sessionId?: string; cwd: string }> {
  const cwd = freshWorkdir(workRoot, "s1-tool");
  const results: ScenarioResult[] = [];
  let session: HarnessSession | undefined;
  let sessionId: string | undefined;

  try {
    session = await adapter.startSession({ ...baseOpts, cwd });
  } catch (err) {
    results.push({
      name: "S1 session starts",
      verdict: "FAIL",
      detail: `startSession threw: ${String(err).slice(0, 300)}`,
    });
    return { results, cwd };
  }

  const seen: string[] = [];
  const collector = collectUntil(
    session,
    (e) => e.type === "turn_end",
    TURN_TIMEOUT,
    (e) => {
      seen.push(e.type);
      printEvent(e);
    },
  );

  await session.prompt(
    "Create a file in the current directory and then read it back to confirm. [[SPIKE:tool_file]]",
  );
  const { events, timedOut } = await collector;

  sessionId = session.currentSessionId();
  results.push({
    name: "S1 session starts and yields a session id",
    verdict: sessionId ? "PASS" : "FAIL",
    detail: sessionId ? `id=${sessionId}` : "no session id was ever observed",
  });

  const toolCalls = events.filter((e) => e.type === "tool_call");
  const toolResults = events.filter((e) => e.type === "tool_result");
  results.push({
    name: "S2a tool_call observed",
    verdict: toolCalls.length > 0 ? "PASS" : "FAIL",
    detail:
      toolCalls.length > 0
        ? `${toolCalls.length} call(s): ${toolCalls.map((c) => (c.type === "tool_call" ? c.name : "")).join(", ")}`
        : "no normalised tool_call event",
    events: seen,
  });
  results.push({
    name: "S2b tool_result observed and correlates to a call",
    verdict:
      toolResults.length > 0 &&
      toolResults.every(
        (r) =>
          r.type === "tool_result" &&
          (r.callId === "" || toolCalls.some((c) => c.type === "tool_call" && c.callId === r.callId)),
      )
        ? "PASS"
        : toolResults.length > 0
          ? "FAIL"
          : "FAIL",
    detail:
      toolResults.length === 0
        ? "no normalised tool_result event"
        : `${toolResults.length} result(s); callIds ${
            toolResults.map((r) => (r.type === "tool_result" ? r.callId || "(empty)" : "")).join(",")
          }`,
  });

  // Ground truth: did a file actually appear?
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(cwd).filter((f) => f.startsWith("spike-"));
  let contentOk = false;
  if (files[0]) {
    try {
      contentOk = readFileSync(join(cwd, files[0]), "utf8").includes("hello-from-spike");
    } catch {
      /* ignore */
    }
  }
  results.push({
    name: "S2c the tool really ran (file exists on disk with expected content)",
    verdict: files.length > 0 && contentOk ? "PASS" : files.length > 0 ? "FAIL" : "FAIL",
    detail:
      files.length === 0
        ? `no spike-* file in ${cwd}`
        : `${files.join(", ")} content-ok=${contentOk}`,
  });

  const turnEnd = events.find((e) => e.type === "turn_end");
  results.push({
    name: "S2d turn_end with a status",
    verdict: turnEnd ? "PASS" : "FAIL",
    detail: turnEnd?.type === "turn_end" ? `status=${turnEnd.status}` : `timedOut=${timedOut}`,
  });

  await session.close().catch(() => {});
  return { results, sessionId, cwd };
}

// =============================================================================
// S3: resume from a NEW PROCESS
// =============================================================================

/**
 * Resume a session id recorded by an earlier process and ask it to recall the
 * filename from the first turn.
 *
 * The fake provider answers `RECALLED <file>` only if the harness replayed the
 * earlier conversation, and `NO_MEMORY` otherwise. So this distinguishes real
 * resume from a harness that accepted the id and silently started fresh --
 * which is the failure that matters and the one a "did it error?" check misses.
 */
export async function scenarioResume(
  adapter: HarnessAdapter,
  cwd: string,
  sessionId: string,
  baseOpts: Omit<StartSessionOptions, "cwd">,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  if (!adapter.capabilities.resume) {
    return [
      { name: "S3 resume by id in a new process", verdict: "ABSENT", detail: "adapter declares resume:false" },
    ];
  }

  let session: HarnessSession;
  try {
    session = await adapter.startSession({ ...baseOpts, cwd, resumeSessionId: sessionId });
  } catch (err) {
    return [
      {
        name: "S3 resume by id in a new process",
        verdict: "FAIL",
        detail: `resume threw: ${String(err).slice(0, 300)}`,
      },
    ];
  }

  const collector = collectUntil(session, (e) => e.type === "turn_end", TURN_TIMEOUT, printEvent);
  await session.prompt("Which spike file did you create earlier? [[SPIKE:recall]]");
  const { events } = await collector;

  const text = events
    .filter((e) => e.type === "assistant_text" || e.type === "assistant_delta")
    .map((e) => (e.type === "assistant_text" || e.type === "assistant_delta" ? e.text : ""))
    .join("");

  const recalled = text.includes("RECALLED");
  const noMemory = text.includes("NO_MEMORY");
  results.push({
    name: "S3 resume by id in a new process actually restores history",
    verdict: recalled ? "PASS" : "FAIL",
    detail: recalled
      ? `provider saw replayed history: ${text.trim().slice(0, 120)}`
      : noMemory
        ? "harness ACCEPTED the resume id but replayed NO history (silent fresh session)"
        : `inconclusive reply: ${JSON.stringify(text.trim().slice(0, 160))}`,
  });

  await session.close().catch(() => {});
  return results;
}

// =============================================================================
// S4: interrupt
// =============================================================================

export async function scenarioInterrupt(
  adapter: HarnessAdapter,
  workRoot: string,
  baseOpts: Omit<StartSessionOptions, "cwd">,
): Promise<ScenarioResult[]> {
  if (!adapter.capabilities.interrupt) {
    return [{ name: "S4 interrupt a long turn", verdict: "ABSENT", detail: "adapter declares interrupt:false" }];
  }
  const cwd = freshWorkdir(workRoot, "s4-interrupt");
  let session: HarnessSession;
  try {
    session = await adapter.startSession({ ...baseOpts, cwd });
  } catch (err) {
    return [{ name: "S4 interrupt a long turn", verdict: "FAIL", detail: `startSession threw: ${String(err).slice(0, 200)}` }];
  }

  const collector = collectUntil(session, (e) => e.type === "turn_end", 45_000);
  await session.prompt("Count very slowly for a long time. [[SPIKE:slow]]");

  // Let the turn genuinely get going, then interrupt.
  await new Promise((r) => setTimeout(r, 4000));
  const t0 = Date.now();
  let threw: string | undefined;
  try {
    await session.interrupt();
  } catch (err) {
    threw = String(err).slice(0, 200);
  }
  const { events, timedOut } = await collector;
  const elapsed = Date.now() - t0;

  const turnEnd = events.find((e) => e.type === "turn_end");
  const results: ScenarioResult[] = [
    {
      name: "S4a interrupt() returns without throwing",
      verdict: threw ? "FAIL" : "PASS",
      detail: threw ?? "ok",
    },
    {
      name: "S4b the turn actually stops after interrupt",
      verdict: turnEnd ? "PASS" : "FAIL",
      detail: turnEnd?.type === "turn_end"
        ? `turn_end status=${turnEnd.status} ${elapsed}ms after interrupt`
        : `no turn_end within 45s (timedOut=${timedOut}) -- interrupt did not terminate the turn`,
    },
    {
      name: "S4c interrupt is distinguishable from normal completion",
      verdict:
        turnEnd?.type === "turn_end"
          ? turnEnd.status === "interrupted"
            ? "PASS"
            : "FAIL"
          : "FAIL",
      detail:
        turnEnd?.type === "turn_end"
          ? `status=${turnEnd.status} (want "interrupted"; anything else means a consumer cannot tell a cancelled turn from a finished one)`
          : "no turn_end",
    },
  ];

  await session.close().catch(() => {});
  return results;
}

// =============================================================================
// S5: injected MCP tool through herdctl's bridge
// =============================================================================

export async function scenarioMcp(
  adapter: HarnessAdapter,
  workRoot: string,
  baseOpts: Omit<StartSessionOptions, "cwd">,
  mcpServers: StartSessionOptions["injectedMcpServers"],
): Promise<ScenarioResult[]> {
  if (!adapter.capabilities.mcpHttp && !adapter.capabilities.mcpStdio) {
    return [{ name: "S5 injected MCP tool call", verdict: "ABSENT", detail: "adapter declares no MCP transport" }];
  }
  const cwd = freshWorkdir(workRoot, "s5-mcp");
  let session: HarnessSession;
  try {
    session = await adapter.startSession({ ...baseOpts, cwd, injectedMcpServers: mcpServers });
  } catch (err) {
    return [{ name: "S5 injected MCP tool call", verdict: "FAIL", detail: `startSession threw: ${String(err).slice(0, 250)}` }];
  }

  const collector = collectUntil(session, (e) => e.type === "turn_end", TURN_TIMEOUT, printEvent);
  await session.prompt("Call the spike ping tool. [[SPIKE:mcp]]");
  const { events } = await collector;

  const calls = events.filter((e) => e.type === "tool_call");
  const sawMcpCall = calls.some(
    (c) => c.type === "tool_call" && /spike|ping|mcp/i.test(c.name),
  );
  const results2 = events.filter((e) => e.type === "tool_result");
  const gotPong = results2.some(
    (r) => r.type === "tool_result" && JSON.stringify(r.output ?? "").includes("pong"),
  );
  const noSuitable = events.some(
    (e) =>
      (e.type === "assistant_text" || e.type === "assistant_delta") &&
      e.text.includes("NO_SUITABLE_TOOL"),
  );

  const results: ScenarioResult[] = [
    {
      name: "S5a the injected MCP tool is visible to the harness",
      verdict: noSuitable ? "FAIL" : sawMcpCall ? "PASS" : "FAIL",
      detail: noSuitable
        ? "harness advertised no MCP tool to the model -- the bridge was not wired in"
        : `calls: ${calls.map((c) => (c.type === "tool_call" ? c.name : "")).join(", ") || "(none)"}`,
    },
    {
      name: "S5b the herdctl-side MCP handler actually executed (pong returned)",
      verdict: gotPong ? "PASS" : "FAIL",
      detail: gotPong
        ? "tool_result contained pong"
        : `no pong in results: ${results2.map((r) => (r.type === "tool_result" ? JSON.stringify(r.output).slice(0, 80) : "")).join(" | ") || "(no results)"}`,
    },
  ];

  await session.close().catch(() => {});
  return results;
}

// =============================================================================
// S6: approval round-trip
// =============================================================================

export async function scenarioApproval(
  adapter: HarnessAdapter,
  workRoot: string,
  baseOpts: Omit<StartSessionOptions, "cwd">,
): Promise<ScenarioResult[]> {
  if (!adapter.capabilities.approvals) {
    return [
      {
        name: "S6 approval round-trip",
        verdict: "ABSENT",
        detail: "adapter declares approvals:false (harness has no approval concept)",
      },
    ];
  }
  const cwd = freshWorkdir(workRoot, "s6-approval");
  const asked: { toolName: string }[] = [];
  let session: HarnessSession;
  try {
    session = await adapter.startSession({
      ...baseOpts,
      cwd,
      onApproval: async (req) => {
        asked.push({ toolName: req.toolName });
        console.log(`  [approval] asked for ${req.toolName}; denying to prove the round-trip`);
        return { allow: false, reason: "spike denies this one on purpose" };
      },
    });
  } catch (err) {
    return [{ name: "S6 approval round-trip", verdict: "FAIL", detail: `startSession threw: ${String(err).slice(0, 250)}` }];
  }

  const collector = collectUntil(session, (e) => e.type === "turn_end", TURN_TIMEOUT, printEvent);
  await session.prompt("Create a file in the current directory. [[SPIKE:tool_file]]");
  const { events } = await collector;

  const { readdirSync } = await import("node:fs");
  const files = readdirSync(cwd).filter((f) => f.startsWith("spike-"));

  const results: ScenarioResult[] = [
    {
      name: "S6a harness asked the client for approval",
      verdict: asked.length > 0 ? "PASS" : "FAIL",
      detail: asked.length > 0 ? `asked for: ${asked.map((a) => a.toolName).join(", ")}` : "no approval request arrived",
    },
    {
      name: "S6b a denial actually prevented the side effect",
      verdict: asked.length === 0 ? "FAIL" : files.length === 0 ? "PASS" : "FAIL",
      detail:
        asked.length === 0
          ? "n/a, never asked"
          : files.length === 0
            ? "denied tool did not create the file"
            : `DENIED BUT FILE STILL CREATED: ${files.join(", ")}`,
    },
  ];
  void events;

  await session.close().catch(() => {});
  return results;
}

// =============================================================================
// Reporting
// =============================================================================

export function printReport(harness: string, all: ScenarioResult[]): void {
  console.log(`\n================ ${harness} ================`);
  const width = Math.max(...all.map((r) => r.name.length));
  for (const r of all) {
    console.log(`${r.verdict.padEnd(8)} ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const counts = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\n${all.length} checks: ` +
      Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(", "),
  );
}

/** Persist results so the two-process resume test can be stitched together. */
export function saveResults(path: string, harness: string, results: ScenarioResult[]): void {
  let existing: Record<string, ScenarioResult[]> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* start fresh */
    }
  }
  existing[harness] = [...(existing[harness] ?? []), ...results];
  writeFileSync(path, JSON.stringify(existing, null, 2));
}
