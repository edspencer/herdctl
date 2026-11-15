/**
 * Probe herdctl's REAL MCP HTTP bridge the way a strict third-party
 * streamable-HTTP MCP client would, rather than the way Claude's CLI does.
 *
 * Why: the bridge is herdctl's story for giving a non-Claude harness access to
 * herdctl-owned tools (send-file, self-manage, ...). If third-party MCP clients
 * can't speak to it, "injected MCP servers are already transport-agnostic"
 * stops being true the moment we add a second harness. This probe finds the
 * gaps directly, without needing a harness or a credential.
 *
 * Run: npx tsx scripts/probe-bridge.ts
 */

import { startMcpHttpBridge } from "../../../packages/core/src/runner/runtime/mcp-http-bridge.ts";

const def = {
  name: "spike",
  version: "0.0.1",
  tools: [
    {
      name: "spike_ping",
      description: "Returns pong plus whatever message you pass.",
      inputSchema: {
        type: "object" as const,
        properties: { message: { type: "string" as const, description: "anything" } },
        required: ["message"],
      },
      handler: async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: `pong:${String(args.message ?? "")}` }],
      }),
    },
  ],
};

const results: { check: string; verdict: string; detail?: string }[] = [];
const record = (check: string, verdict: string, detail?: string) => {
  results.push({ check, verdict, detail });
  const icon = verdict === "PASS" ? "PASS" : verdict === "FAIL" ? "FAIL" : "NOTE";
  console.log(`[${icon}] ${check}${detail ? ` -- ${detail}` : ""}`);
};

const bridge = await startMcpHttpBridge(def as never, { host: "127.0.0.1" });
const url = `http://127.0.0.1:${bridge.port}/mcp`;
console.log(`bridge up on ${url}`);
console.log(`bridge-supplied headers: ${JSON.stringify(Object.keys(bridge.headers))}\n`);

/** POST like a spec-following MCP client: Accept allows BOTH json and SSE. */
async function rpc(
  method: string,
  params?: unknown,
  opts: { auth?: boolean; accept?: string; id?: number | null } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: opts.accept ?? "application/json, text/event-stream",
  };
  if (opts.auth !== false) Object.assign(headers, bridge.headers);
  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (opts.id !== null) body.id = opts.id ?? 1;
  if (params !== undefined) body.params = params;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return {
    status: res.status,
    ctype: res.headers.get("content-type") ?? "",
    mcpSession: res.headers.get("mcp-session-id"),
    json: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })(),
    text,
  };
}

// --- 1. auth is enforced -----------------------------------------------------
{
  const r = await rpc("initialize", {}, { auth: false });
  record(
    "unauthenticated request is rejected",
    r.status === 401 ? "PASS" : "FAIL",
    `status ${r.status}`,
  );
}

// --- 2. initialize handshake -------------------------------------------------
{
  const r = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: { roots: {}, sampling: {} },
    clientInfo: { name: "spike-probe", version: "0.0.1" },
  });
  record("initialize returns a result", r.json?.result ? "PASS" : "FAIL", `status ${r.status}`);
  const pv = r.json?.result?.protocolVersion;
  record(
    "initialize echoes a protocolVersion",
    pv ? "PASS" : "FAIL",
    pv ? `server says ${pv} (client asked 2025-06-18)` : "absent from result",
  );
  record(
    "server assigns an Mcp-Session-Id header",
    r.mcpSession ? "PASS" : "ABSENT",
    r.mcpSession
      ? r.mcpSession
      : "no Mcp-Session-Id; a client that requires session binding will break",
  );
  record(
    "response content-type",
    r.ctype.includes("application/json") ? "PASS" : "NOTE",
    `${r.ctype} (never SSE -- client must tolerate a plain JSON reply)`,
  );
  console.log(`      initialize result: ${JSON.stringify(r.json?.result)}`);
}

// --- 3. initialized notification --------------------------------------------
{
  const r = await rpc("notifications/initialized", undefined, { id: null });
  record(
    "notifications/initialized accepted without a response body",
    r.status === 204 ? "PASS" : "FAIL",
    `status ${r.status}`,
  );
}

// --- 4. tools/list -----------------------------------------------------------
{
  const r = await rpc("tools/list");
  const names = (r.json?.result?.tools ?? []).map((t: { name: string }) => t.name);
  record(
    "tools/list advertises the injected tool",
    names.includes("spike_ping") ? "PASS" : "FAIL",
    `tools: ${JSON.stringify(names)}`,
  );
}

// --- 5. tools/call -----------------------------------------------------------
{
  const r = await rpc("tools/call", { name: "spike_ping", arguments: { message: "hi" } });
  const text = r.json?.result?.content?.[0]?.text;
  record(
    "tools/call executes the herdctl-side handler",
    text === "pong:hi" ? "PASS" : "FAIL",
    `content[0].text = ${JSON.stringify(text)}`,
  );
}

// --- 6. GET /mcp (server->client SSE stream) --------------------------------
{
  const res = await fetch(url, { method: "GET", headers: { ...bridge.headers, Accept: "text/event-stream" } });
  record(
    "GET /mcp (SSE stream opening)",
    res.status === 405 ? "PASS" : "NOTE",
    `status ${res.status} -- spec suggests 405 when unsupported; a client that ` +
      `opens the GET stream first may treat ${res.status} as fatal rather than degrading`,
  );
}

// --- 7. root path tolerance --------------------------------------------------
{
  const res = await fetch(`http://127.0.0.1:${bridge.port}/`, {
    method: "POST",
    headers: { ...bridge.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
  });
  record("POST / (bare root) also routed", res.status === 200 ? "PASS" : "NOTE", `status ${res.status}`);
}

// --- 8. unknown method ------------------------------------------------------
{
  const r = await rpc("resources/list");
  record(
    "unsupported method returns JSON-RPC -32601",
    r.json?.error?.code === -32601 ? "PASS" : "NOTE",
    `${JSON.stringify(r.json?.error)} -- clients that probe resources/ or prompts/ ` +
      `at startup must tolerate this`,
  );
}

await bridge.close();

console.log(`\n--- summary ---`);
for (const r of results) console.log(`${r.verdict.padEnd(6)} ${r.check}`);
const fails = results.filter((r) => r.verdict === "FAIL").length;
console.log(`\n${results.length} checks, ${fails} FAIL`);
