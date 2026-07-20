/**
 * Regression: edspencer/herdctl#390 (secondary) — the injected `mcp__…__*` tool
 * patterns must not accumulate on `allowedTools` across turns.
 *
 * Two compounding bugs caused `--allowedTools` to grow unbounded (the same
 * wildcard repeated 2×/3×/4×…):
 *  1. `toSDKOptions` aliased the long-lived agent's `allowed_tools` array by
 *     reference, so the runtime's per-turn push mutated the persistent agent.
 *  2. The runtime pushed `mcp__<name>__*` without checking whether it was
 *     already present.
 * The fixes: copy the array in the adapter and de-dupe before pushing. This test
 * drives the real `execute()` path (with a mocked SDK `query()`) to prove the
 * captured `allowedTools` stays stable turn-over-turn and never duplicates.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the options every query() receives.
const queryCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((args: { options?: Record<string, unknown> }) => {
    queryCalls.push(args.options ?? {});
    return (async function* () {})();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

import type { ResolvedAgent } from "../../../config/index.js";
import type { InjectedMcpServerDef } from "../../types.js";
import type { RuntimeExecuteOptions } from "../interface.js";
import { SDKRuntime } from "../sdk-runtime.js";

function makeAgent(allowedTools: string[]): ResolvedAgent {
  return {
    name: "keeper",
    qualifiedName: "keeper",
    allowed_tools: allowedTools,
  } as unknown as ResolvedAgent;
}

const injected: Record<string, InjectedMcpServerDef> = {
  "paddock-self": { name: "paddock-self", tools: [] },
};

async function drain(iter: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iter) {
    // no messages yielded by the mocked query()
  }
}

function baseOptions(overrides: Partial<RuntimeExecuteOptions> = {}): RuntimeExecuteOptions {
  return { prompt: "hi", agent: makeAgent(["Read", "Write"]), ...overrides };
}

afterEach(() => {
  queryCalls.length = 0;
  vi.clearAllMocks();
});

describe("SDKRuntime allowedTools + injected MCP patterns (#390)", () => {
  it("adds the injected wildcard once and does not mutate the agent's array", async () => {
    const agent = makeAgent(["Read", "Write"]);
    const runtime = new SDKRuntime();

    await drain(runtime.execute(baseOptions({ agent, injectedMcpServers: injected })));

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].allowedTools).toEqual(["Read", "Write", "mcp__paddock-self__*"]);
    // The persistent agent's own array must be untouched (no aliasing).
    expect(agent.allowed_tools).toEqual(["Read", "Write"]);
  });

  it("does not accumulate duplicates when the same agent runs multiple turns", async () => {
    const agent = makeAgent(["Read", "Write"]);
    const runtime = new SDKRuntime();

    // Three turns reusing the same long-lived agent object + injected servers.
    await drain(runtime.execute(baseOptions({ agent, injectedMcpServers: injected })));
    await drain(runtime.execute(baseOptions({ agent, injectedMcpServers: injected })));
    await drain(runtime.execute(baseOptions({ agent, injectedMcpServers: injected })));

    expect(queryCalls).toHaveLength(3);
    for (const call of queryCalls) {
      // Each turn's allowedTools is identical — the wildcard appears exactly once.
      expect(call.allowedTools).toEqual(["Read", "Write", "mcp__paddock-self__*"]);
      const wildcards = (call.allowedTools as string[]).filter((t) => t === "mcp__paddock-self__*");
      expect(wildcards).toHaveLength(1);
    }
    // The agent never accreted the pattern.
    expect(agent.allowed_tools).toEqual(["Read", "Write"]);
  });

  it("de-dupes when the agent already lists the injected wildcard explicitly", async () => {
    const agent = makeAgent(["Read", "mcp__paddock-self__*"]);
    const runtime = new SDKRuntime();

    await drain(runtime.execute(baseOptions({ agent, injectedMcpServers: injected })));

    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].allowedTools).toEqual(["Read", "mcp__paddock-self__*"]);
  });
});
