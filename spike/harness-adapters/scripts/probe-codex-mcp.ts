/**
 * Does herdctl's MCP HTTP bridge actually connect to Codex?
 *
 * WHY THIS EXISTS SEPARATELY FROM SCENARIO S5
 * S5 asks the model to call the tool. For Codex that step is blocked by the
 * FAKE provider, not by the bridge: Codex nests MCP tools inside a
 * `namespace`-typed tool and rejects every plain function_call name we tried
 * ("unsupported call: spike_ping", and likewise for mcp__spike__spike_ping,
 * mcp__spike.spike_ping, mcp__spike/spike_ping). A real model presumably emits
 * whatever form Codex routes; a hand-rolled fake cannot guess it.
 *
 * So S5's failure would be ambiguous: did the bridge fail, or just our fake?
 * This probe removes the model from the question entirely by asking Codex
 * directly, over app-server, what it thinks of the MCP server: did it start,
 * what tools does it see, and does it report an error. That is a
 * credential-free, model-free answer about herdctl's bridge.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonLines, writeJsonLine } from "../src/jsonl.ts";
import { startMcpHttpBridge } from "../../../packages/core/src/runner/runtime/mcp-http-bridge.ts";

const SPIKE_ROOT = process.env.SPIKE_ROOT ?? "/data/paddock-servers/harness-spike";
const CODEX_BIN = join(
  import.meta.dirname,
  "..",
  "node_modules",
  "@openai/codex-linux-x64",
  "vendor",
  "x86_64-unknown-linux-musl",
  "bin",
  "codex",
);

const def = {
  name: "spike",
  version: "0.0.1",
  tools: [
    {
      name: "spike_ping",
      description: "Health check. Pass any message and it returns pong plus your message.",
      inputSchema: {
        type: "object" as const,
        properties: { message: { type: "string" as const, description: "any text" } },
        required: ["message"],
      },
      handler: async (args: Record<string, unknown>) => ({
        content: [{ type: "text" as const, text: `pong:${String(args.message ?? "")}` }],
      }),
    },
  ],
};

const bridge = await startMcpHttpBridge(def as never, { host: "127.0.0.1" });
console.log(`herdctl bridge listening on http://127.0.0.1:${bridge.port}/mcp`);

const codexHome = join(SPIKE_ROOT, "codex-home-mcpprobe");
mkdirSync(codexHome, { recursive: true });
writeFileSync(
  join(codexHome, "config.toml"),
  [
    `model = "spike-fake-1"`,
    `model_provider = "spikefake"`,
    `approval_policy = "never"`,
    `sandbox_mode = "danger-full-access"`,
    ``,
    `[model_providers.spikefake]`,
    `name = "Spike Fake"`,
    `base_url = "http://127.0.0.1:8099/v1"`,
    `wire_api = "responses"`,
    `env_key = "SPIKE_FAKE_KEY"`,
    `requires_openai_auth = false`,
    ``,
    `[mcp_servers.spike]`,
    `url = "http://127.0.0.1:${bridge.port}/mcp"`,
    `bearer_token_env_var = "SPIKE_MCP_TOKEN"`,
    `startup_timeout_sec = 20`,
    ``,
  ].join("\n"),
);

const child = spawn(CODEX_BIN, ["app-server", "--stdio"], {
  cwd: join(SPIKE_ROOT, "work"),
  env: {
    ...process.env,
    CODEX_HOME: codexHome,
    SPIKE_MCP_TOKEN: bridge.token,
    SPIKE_FAKE_KEY: "spike-placeholder-not-a-real-key",
  },
  stdio: ["pipe", "pipe", "pipe"],
}) as ChildProcessWithoutNullStreams;

let id = 0;
const pending = new Map<number, (v: unknown) => void>();
const notifications: Record<string, unknown>[] = [];

readJsonLines(child.stdout, (v) => {
  const m = v as Record<string, unknown>;
  if (m.id !== undefined && m.method === undefined) {
    const r = pending.get(m.id as number);
    if (r) {
      pending.delete(m.id as number);
      r(m.error ? { __error: m.error } : m.result);
    }
    return;
  }
  if (m.method) notifications.push(m);
});

const req = (method: string, params?: unknown): Promise<any> => {
  const i = ++id;
  writeJsonLine(child.stdin, params === undefined ? { id: i, method } : { id: i, method, params });
  return new Promise((r) => pending.set(i, r));
};

await req("initialize", {
  clientInfo: { name: "herdctl-spike", title: "mcp probe", version: "0.0.1" },
  capabilities: { experimentalApi: false, requestAttestation: false },
});
writeJsonLine(child.stdin, { method: "initialized" });

// Starting a thread is what triggers MCP server startup.
const started = await req("thread/start", {
  cwd: join(SPIKE_ROOT, "work"),
  sandbox: "danger-full-access",
});
const threadId = String(started?.thread?.id ?? "");
console.log(`thread: ${threadId}`);

// Give the server time to connect.
await new Promise((r) => setTimeout(r, 6000));

const status = await req("mcpServerStatus/list", { threadId });
console.log(`\n--- Codex's own view of the herdctl bridge ---`);
console.log(JSON.stringify(status, null, 2).slice(0, 2600));

const startupNotifs = notifications.filter((n) =>
  String(n.method).startsWith("mcpServer/startupStatus"),
);
console.log(`\nmcpServer/startupStatus notifications: ${startupNotifs.length}`);
for (const n of startupNotifs) console.log(`  ${JSON.stringify(n.params).slice(0, 400)}`);

// Codex can also invoke an MCP tool directly, with no model involved.
console.log(`\n--- direct mcpServer/tool/call (no model in the loop) ---`);
const called = await req("mcpServer/tool/call", {
  threadId,
  server: "spike",
  tool: "spike_ping",
  arguments: { message: "from-codex-direct" },
});
console.log(JSON.stringify(called, null, 2).slice(0, 1200));

const ok = JSON.stringify(called ?? {}).includes("pong:from-codex-direct");
console.log(`\nVERDICT: herdctl bridge + Codex direct tool call => ${ok ? "PASS (pong returned)" : "FAIL"}`);

child.stdin.end();
if (child.pid && !child.killed) child.kill("SIGTERM");
await bridge.close();
process.exit(ok ? 0 : 1);
