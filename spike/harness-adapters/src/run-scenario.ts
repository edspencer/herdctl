/**
 * Scenario runner.
 *
 *   tsx src/run-scenario.ts <harness> phase1   # start, tool round-trip; records session id
 *   tsx src/run-scenario.ts <harness> phase2   # NEW PROCESS: resume that id
 *   tsx src/run-scenario.ts <harness> rest     # interrupt, mcp, approval
 *   tsx src/run-scenario.ts <harness> all      # phase1 + rest (resume needs phase2 separately)
 *
 * Resume is deliberately split across two process invocations. Running it
 * in-process would prove nothing: an adapter could hold the conversation in
 * memory and "resume" from a live object. The point is whether the id alone,
 * handed to a cold process, brings the history back.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeProvider } from "./fake-provider.ts";
import {
  printReport,
  saveResults,
  scenarioApproval,
  scenarioInterrupt,
  scenarioMcp,
  scenarioResume,
  scenarioToolRoundTrip,
  type ScenarioResult,
} from "./scenarios.ts";
import type { HarnessAdapter, StartSessionOptions } from "./harness.ts";

const SPIKE_ROOT = process.env.SPIKE_ROOT ?? "/data/paddock-servers/harness-spike";
const WORK_ROOT = join(SPIKE_ROOT, "work");
const STATE = join(SPIKE_ROOT, "logs", "scenario-state.json");
const RESULTS = join(SPIKE_ROOT, "logs", "scenario-results.json");
const PROVIDER_PORT = Number(process.env.SPIKE_PROVIDER_PORT ?? 8099);

// =============================================================================
// Adapter registry
// =============================================================================

async function loadAdapter(name: string): Promise<HarnessAdapter> {
  switch (name) {
    case "pi": {
      const { PiAdapter } = await import("./pi-adapter.ts");
      return new PiAdapter();
    }
    case "codex": {
      const { CodexAdapter } = await import("./codex-adapter.ts");
      return new CodexAdapter();
    }
    default:
      throw new Error(
        `unknown harness "${name}". Known: pi, codex. ` +
          `(claude is covered by the fixture test in scripts/test-claude-shim.ts, ` +
          `since driving it live would spend real credit for no extra protocol insight.)`,
      );
  }
}

// =============================================================================
// Injected MCP server (herdctl's own shape, served over herdctl's own bridge)
// =============================================================================

const spikeMcpDef = {
  name: "spike",
  version: "0.0.1",
  tools: [
    {
      name: "spike_ping",
      description:
        "Health check. Pass any message and it returns pong plus your message. " +
        "Use this when asked to call the spike ping tool.",
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

// =============================================================================
// State across the two processes
// =============================================================================

interface Phase1State {
  harness: string;
  sessionId?: string;
  cwd: string;
}

function saveState(s: Phase1State): void {
  mkdirSync(join(SPIKE_ROOT, "logs"), { recursive: true });
  const all = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
  all[s.harness] = s;
  writeFileSync(STATE, JSON.stringify(all, null, 2));
}

function loadState(harness: string): Phase1State | undefined {
  if (!existsSync(STATE)) return undefined;
  try {
    return JSON.parse(readFileSync(STATE, "utf8"))[harness];
  } catch {
    return undefined;
  }
}

// =============================================================================
// Main
// =============================================================================

const harnessName = process.argv[2];
const phase = process.argv[3] ?? "all";

if (!harnessName) {
  console.error("usage: tsx src/run-scenario.ts <pi|codex> <phase1|phase2|rest|all>");
  process.exit(2);
}

mkdirSync(WORK_ROOT, { recursive: true });
mkdirSync(join(SPIKE_ROOT, "logs"), { recursive: true });

// Log every provider request verbatim: it records exactly what each harness
// sends, which is itself spike evidence (tool vocabularies, history replay).
process.env.SPIKE_PROVIDER_LOG ??= join(SPIKE_ROOT, "logs", `provider-${harnessName}.jsonl`);
const provider = await startFakeProvider(PROVIDER_PORT);
console.log(`fake provider: ${provider.url}`);

const adapter = await loadAdapter(harnessName);
console.log(`harness: ${adapter.name}`);
console.log(`declared capabilities: ${JSON.stringify(adapter.capabilities)}\n`);

/** Base options every scenario shares: point the harness at the fake provider. */
const baseOpts: Omit<StartSessionOptions, "cwd"> = {
  model: process.env.SPIKE_MODEL ?? "spike-fake-1",
  env: {
    SPIKE_PROVIDER_URL: provider.url,
  },
};

const all: ScenarioResult[] = [];

try {
  if (phase === "phase1" || phase === "all") {
    console.log("=== S1/S2: start, tool round-trip, turn end ===");
    const { results, sessionId, cwd } = await scenarioToolRoundTrip(adapter, WORK_ROOT, baseOpts);
    all.push(...results);
    saveState({ harness: harnessName, sessionId, cwd });
    console.log(`\n(recorded session id for phase2: ${sessionId ?? "NONE"})\n`);
  }

  if (phase === "phase2") {
    const st = loadState(harnessName);
    if (!st?.sessionId) {
      all.push({
        name: "S3 resume by id in a new process",
        verdict: "BLOCKED",
        detail: "phase1 recorded no session id, so there is nothing to resume",
      });
    } else {
      console.log(`=== S3: resume ${st.sessionId} in THIS fresh process ===`);
      all.push(...(await scenarioResume(adapter, st.cwd, st.sessionId, baseOpts)));
    }
  }

  if (phase === "rest" || phase === "all") {
    console.log("\n=== S4: interrupt a long turn ===");
    all.push(...(await scenarioInterrupt(adapter, WORK_ROOT, baseOpts)));

    console.log("\n=== S5: injected MCP tool via herdctl's HTTP bridge ===");
    all.push(...(await scenarioMcp(adapter, WORK_ROOT, baseOpts, { spike: spikeMcpDef as never })));

    console.log("\n=== S6: approval round-trip ===");
    all.push(...(await scenarioApproval(adapter, WORK_ROOT, baseOpts)));
  }
} catch (err) {
  all.push({
    name: `runner aborted during ${phase}`,
    verdict: "FAIL",
    detail: String(err).slice(0, 500),
  });
  console.error(err);
}

printReport(`${adapter.name} (${phase})`, all);
saveResults(RESULTS, harnessName, all);
console.log(`\nresults appended to ${RESULTS}`);

provider.close();
// Harness child processes are closed by each scenario; nothing else to reap.
process.exit(0);
