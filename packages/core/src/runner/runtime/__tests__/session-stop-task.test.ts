/**
 * Tests for `RuntimeSession.stopTask` — the SDK runtime forwarding the SDK's
 * `stop_task` control request (gap 1 of edspencer/herdctl#449).
 *
 * The `Query` handle `openSession()` opens is a `const` in a closure: unreachable
 * from outside except through the methods the returned literal exposes. So the
 * thing worth testing is exactly that the new member reaches `Query.stopTask`
 * with the caller's task id — and that a refusal (a `monitor_mcp` task, which the
 * CLI has no kill strategy for) comes back as a rejection rather than a
 * fabricated success.
 */

import { describe, expect, it, vi } from "vitest";

/** The Query test double every openSession() in this file is handed. */
function fakeQuery() {
  return {
    [Symbol.asyncIterator]: async function* () {},
    supportedCommands: vi.fn().mockResolvedValue([]),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    return: vi.fn().mockResolvedValue(undefined),
  };
}

let currentQuery = fakeQuery();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => currentQuery),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

import type { ResolvedAgent } from "../../../config/index.js";
import { SDKRuntime } from "../sdk-runtime.js";

const agent = { name: "keeper", qualifiedName: "keeper" } as unknown as ResolvedAgent;

function openSession(onLifecycleSignal?: () => void) {
  currentQuery = fakeQuery();
  const session = new SDKRuntime().openSession({ prompt: "hi", agent, onLifecycleSignal });
  return { session, q: currentQuery };
}

describe("RuntimeSession.stopTask", () => {
  it("forwards the task id to the SDK Query's stopTask", async () => {
    const { session, q } = openSession();

    await session.stopTask("task-abc");

    expect(q.stopTask).toHaveBeenCalledTimes(1);
    expect(q.stopTask).toHaveBeenCalledWith("task-abc");
  });

  it("stops one task without interrupting the turn or closing the session", async () => {
    const { session, q } = openSession();

    await session.stopTask("task-abc");

    // The whole point of a per-task stop: everything else is left running.
    expect(q.interrupt).not.toHaveBeenCalled();
    expect(q.return).not.toHaveBeenCalled();
  });

  it("stays reachable when a lifecycle tap wraps the message stream", async () => {
    // The interesting case per #449: with `onLifecycleSignal` the caller gets a
    // wrapper generator instead of the Query, so `session.messages` is no longer
    // an escape hatch onto it. stopTask must still reach through.
    const { session, q } = openSession(vi.fn());

    await session.stopTask("task-abc");

    expect(q.stopTask).toHaveBeenCalledWith("task-abc");
  });

  it("propagates a refusal (monitor_mcp: unsupported_type) instead of resolving", async () => {
    const { session, q } = openSession();
    q.stopTask.mockRejectedValue(new Error("unsupported_type"));

    await expect(session.stopTask("monitor-1")).rejects.toThrow("unsupported_type");
  });

  it("resolves for an already-finished task — the CLI answers not_found with a success", async () => {
    // Idempotency is the CLI's, not ours; assert we add no liveness pre-check
    // that would reintroduce the race.
    const { session, q } = openSession();

    await expect(session.stopTask("already-done")).resolves.toBeUndefined();
    expect(q.stopTask).toHaveBeenCalledWith("already-done");
  });
});
