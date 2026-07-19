/**
 * Tests that the SDK runtime forwards the `includePartialMessages` opt-in to the
 * SDK `query()` — on for callers that request partial (streaming) assistant
 * messages, and left unset (SDK default: off) otherwise, so batch/one-shot and
 * non-opting session callers are unchanged.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// Capture the options every query() receives.
const queryCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  // execute() consumes the returned iterable; yield nothing.
  query: vi.fn((args: { options?: Record<string, unknown> }) => {
    queryCalls.push(args.options ?? {});
    return (async function* () {})();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

import type { ResolvedAgent } from "../../../config/index.js";
import type { RuntimeExecuteOptions } from "../interface.js";
import { SDKRuntime } from "../sdk-runtime.js";

const agent = { name: "keeper", qualifiedName: "keeper" } as unknown as ResolvedAgent;

function baseOptions(overrides: Partial<RuntimeExecuteOptions> = {}): RuntimeExecuteOptions {
  return { prompt: "hi", agent, ...overrides };
}

afterEach(() => {
  queryCalls.length = 0;
});

describe("SDKRuntime includePartialMessages", () => {
  describe("execute()", () => {
    it("sets includePartialMessages on query() when opted in", async () => {
      const runtime = new SDKRuntime();
      // Drain the generator so query() actually runs.
      for await (const _ of runtime.execute(baseOptions({ includePartialMessages: true }))) {
        // no messages yielded
      }

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].includePartialMessages).toBe(true);
    });

    it("does NOT set includePartialMessages by default", async () => {
      const runtime = new SDKRuntime();
      for await (const _ of runtime.execute(baseOptions())) {
        // no messages yielded
      }

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].includePartialMessages).toBeUndefined();
    });
  });

  describe("openSession()", () => {
    it("sets includePartialMessages on query() when opted in", () => {
      const runtime = new SDKRuntime();
      runtime.openSession(baseOptions({ includePartialMessages: true }));

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].includePartialMessages).toBe(true);
    });

    it("does NOT set includePartialMessages by default", () => {
      const runtime = new SDKRuntime();
      runtime.openSession(baseOptions());

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].includePartialMessages).toBeUndefined();
    });
  });
});
