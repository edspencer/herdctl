/**
 * issue #458: a one-shot `execute()` run must not hand JobExecutor the
 * terminal message (letting it tear the query down) while a
 * `run_in_background` Agent-tool subagent it spawned is still live — it
 * should hold the terminal message until `background_tasks_changed` reports
 * an empty set, capped by `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

type FakeMessage = Record<string, unknown>;

// A controllable async generator standing in for the SDK's query() stream.
// The queue is fed by the test; `query()` returns the Query object itself
// (`iterable` below), which `execute()` calls `q.return()` on directly — NOT
// only the iterator `[Symbol.asyncIterator]()` returns. A mock exposing
// `return()` solely on the iterator lets `q.return()` throw (silently caught
// by execute()'s own try/catch), so `isClosed()` never flips even though the
// test looks green — hence `return()` is defined on `iterable` itself here,
// same as the real SDK's `Query` (an AsyncGenerator, callable directly).
function makeControllableStream() {
  const pending: FakeMessage[] = [];
  const waiters: Array<(msg: FakeMessage | typeof DONE) => void> = [];
  const DONE = Symbol("done");
  let closed = false;

  function push(message: FakeMessage) {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else pending.push(message);
  }

  async function doReturn(): Promise<{ done: true; value: undefined }> {
    closed = true;
    for (const w of waiters.splice(0)) w(DONE);
    return { done: true as const, value: undefined };
  }

  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (closed) return { done: true, value: undefined };
          if (pending.length > 0) return { done: false, value: pending.shift() };
          const message = await new Promise<FakeMessage | typeof DONE>((resolve) => {
            waiters.push(resolve);
          });
          if (message === DONE) return { done: true, value: undefined };
          return { done: false, value: message };
        },
        return: doReturn,
      };
    },
    return: doReturn,
  };

  return { push, iterable, isClosed: () => closed };
}

let activeStream: ReturnType<typeof makeControllableStream> | undefined;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    const stream = makeControllableStream();
    activeStream = stream;
    return stream.iterable;
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedAgent } from "../../../config/index.js";
import type { SessionLifecycleSignal } from "../../../session/types.js";
import type { RuntimeExecuteOptions } from "../interface.js";
import { SDKRuntime } from "../sdk-runtime.js";

/** Grab the Stop-hook callback `execute()` registered on its last `query()` call. */
function stopCallbackFromLastQueryCall(): (input: unknown) => Promise<unknown> {
  const lastCall = vi.mocked(query).mock.calls.at(-1)!;
  const options = (lastCall[0] as { options: Record<string, unknown> }).options;
  const hooks = options.hooks as {
    Stop: Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>;
  };
  return hooks.Stop[0].hooks[0];
}

/** Grab the PostToolUse-hook callback `execute()` registered on its last `query()` call. */
function postToolUseCallbackFromLastQueryCall(): (input: unknown) => Promise<unknown> {
  const lastCall = vi.mocked(query).mock.calls.at(-1)!;
  const options = (lastCall[0] as { options: Record<string, unknown> }).options;
  const hooks = options.hooks as {
    PostToolUse: Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>;
  };
  return hooks.PostToolUse[0].hooks[0];
}

const agent = { name: "keeper", qualifiedName: "keeper" } as unknown as ResolvedAgent;

function baseOptions(overrides: Partial<RuntimeExecuteOptions> = {}): RuntimeExecuteOptions {
  return { prompt: "hi", agent, ...overrides };
}

afterEach(() => {
  activeStream = undefined;
  delete process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
});

describe("SDKRuntime.execute() background-task hold (issue #458)", () => {
  it("holds the terminal result until background_tasks_changed reports empty", async () => {
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    // Let execute() start and register its iterator.
    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });

    // Give the loop a couple of ticks to process both messages.
    await new Promise((r) => setTimeout(r, 10));
    // Non-terminal messages (like the background_tasks_changed system message
    // itself) still pass straight through — only the terminal `result` is held.
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;

    // Both background_tasks_changed messages passed through as normal
    // content; the terminal result was released only once tasks drained.
    expect(seen.map((m) => m.type)).toEqual(["system", "system", "result"]);
    expect(stream.isClosed()).toBe(true);
  });

  it("does not release the held terminal on an unrelated activity signal", async () => {
    // Regression for a bug CodeRabbit caught on PR #459: onLifecycleSignal
    // used to overwrite liveBackgroundTasks on EVERY signal, including
    // `activity` (fired on the next assistant message, always backgroundTasks
    // []) — wiping a real pending count and releasing the terminal early.
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));

    // An assistant message is what tapLifecycleStream treats as `activity` —
    // must NOT clear the held task count.
    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
  });

  it("does not hold the terminal result when ceiling is 0", async () => {
    process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "0";
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;
    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });

    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
    expect(stream.isClosed()).toBe(true);
  });

  it("gives up and yields the terminal once the ceiling elapses", async () => {
    process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "20";
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;
    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    // Background task never drains — no further push.

    await drain; // resolves once the 20ms ceiling fires
    const results = seen.filter((m) => m.type === "result");
    expect(results).toHaveLength(1);
    expect(stream.isClosed()).toBe(true);
  });

  it("does not release the held terminal on a turn_end Stop hook fired without a background_tasks snapshot", async () => {
    // Regression for the prod #459 follow-up (job-2026-08-26-6opnmq): the
    // CLI's Stop-hook payload builder is conditional and can omit
    // `background_tasks`/`session_crons` entirely for a turn, independent of
    // the SDK's own per-field `?`-optionality. `input.background_tasks ?? []`
    // used to read that omission as an authoritative "nothing pending",
    // clobbering the live count tracked from `background_tasks_changed` and
    // releasing the held terminal — killing the still-running background
    // subagent.
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    // Simulate the CLI firing Stop without the background_tasks/session_crons
    // envelope at all (not even `background_tasks: undefined`).
    const stopCallback = stopCallbackFromLastQueryCall();
    await stopCallback({
      hook_event_name: "Stop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
    });
    // Force the execute() loop to re-check its release condition (it only
    // re-evaluates on the next stream message, not on the out-of-band hook
    // call itself) with a message that carries no task snapshot of its own.
    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
  });

  it("releases the held terminal on a turn_end Stop hook that authoritatively reports empty background_tasks", async () => {
    // Counter-check: a genuine empty snapshot (the field present, just empty)
    // must still release as before — only an omitted field is a non-snapshot.
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions())) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    const stopCallback = stopCallbackFromLastQueryCall();
    await stopCallback({
      hook_event_name: "Stop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
      background_tasks: [],
      session_crons: [],
    });
    // Force the execute() loop to re-check its release condition — see the
    // no-snapshot test above for why this is needed.
    stream.push({ type: "assistant", message: { content: [] } });

    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
  });
});

// vulpes-pack#148 — RuntimeExecuteOptions.onLifecycleSignal was documented
// "ignored" by execute() and nothing consumed it: a job's ScheduleWakeup/
// session cron never reached anywhere and evaporated on job completion. These
// pin the composition contract a job-path consumer (SessionLifecycleManager.
// trackJob) relies on: it rides along on the same signals as the internal
// bg-wait tracker, in addition to it, never instead of it.
describe("SDKRuntime.execute() onLifecycleSignal consumer composition (vulpes-pack#148)", () => {
  it("delivers all four SessionLifecycleSignal kinds to a supplied consumer", async () => {
    const runtime = new SDKRuntime();
    const signals: SessionLifecycleSignal[] = [];
    const onLifecycleSignal = vi.fn((signal: SessionLifecycleSignal) => {
      signals.push(signal);
    });
    const drain = (async () => {
      for await (const _message of runtime.execute(baseOptions({ onLifecycleSignal }))) {
        // drain
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    await new Promise((r) => setTimeout(r, 10));

    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));

    const postToolUseCallback = postToolUseCallbackFromLastQueryCall();
    await postToolUseCallback({
      hook_event_name: "PostToolUse",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      tool_name: "CronDelete",
      tool_input: { id: "c1" },
      tool_response: {},
    });
    await new Promise((r) => setTimeout(r, 10));

    const stopCallback = stopCallbackFromLastQueryCall();
    await stopCallback({
      hook_event_name: "Stop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
      background_tasks: [],
      session_crons: [{ id: "c2", schedule: "+60s", recurring: false, prompt: "WAKE" }],
    });
    await new Promise((r) => setTimeout(r, 10));

    stream.push({ type: "result", subtype: "success" });
    await drain;

    const kinds = signals.map((s) => s.kind);
    expect(kinds).toContain("background_tasks_changed");
    expect(kinds).toContain("activity");
    expect(kinds).toContain("cron_deleted");
    expect(kinds).toContain("turn_end");

    const turnEnd = signals.find((s) => s.kind === "turn_end");
    expect(turnEnd?.sessionCrons).toEqual([
      { id: "c2", schedule: "+60s", recurring: false, prompt: "WAKE" },
    ]);
    const cronDeleted = signals.find((s) => s.kind === "cron_deleted");
    expect(cronDeleted?.deletedCronIds).toEqual(["c1"]);
  });

  it("holds the terminal exactly as without a consumer, and the consumer sees the same hasSnapshot: false", async () => {
    // Byte-for-byte composition check: attaching a consumer must not change
    // the #458/#459 anchor semantics at all.
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const signals: SessionLifecycleSignal[] = [];
    const onLifecycleSignal = (signal: SessionLifecycleSignal) => {
      signals.push(signal);
    };
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions({ onLifecycleSignal }))) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    // A turn_end fired without the background_tasks/session_crons envelope —
    // must not clobber the live task count, even with a consumer attached.
    const stopCallback = stopCallbackFromLastQueryCall();
    await stopCallback({
      hook_event_name: "Stop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
    });
    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);

    // The consumer still saw the non-authoritative turn_end (hasSnapshot: false).
    const turnEnd = signals.find((s) => s.kind === "turn_end");
    expect(turnEnd?.hasSnapshot).toBe(false);
  });

  it("a throwing consumer does not break the message loop or drop messages", async () => {
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const onLifecycleSignal = vi.fn(() => {
      throw new Error("consumer boom");
    });
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions({ onLifecycleSignal }))) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "assistant", message: { content: [] } });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));
    // Terminal still held (the throwing consumer didn't corrupt bg-task tracking).
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;

    // Every non-terminal message still reached the consumer of the stream itself.
    expect(seen.map((m) => m.type)).toEqual(["system", "assistant", "system", "result"]);
    expect(onLifecycleSignal.mock.calls.length).toBeGreaterThan(0);
  });

  it("a rejecting (async) consumer does not break the message loop", async () => {
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const onLifecycleSignal = vi.fn(() => Promise.reject(new Error("consumer boom async")));
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions({ onLifecycleSignal }))) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;

    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
    expect(stream.isClosed()).toBe(true);
  });

  it("holds the terminal for a live background task AND delivers its concurrent session cron", async () => {
    const runtime = new SDKRuntime();
    const seen: FakeMessage[] = [];
    const signals: SessionLifecycleSignal[] = [];
    const onLifecycleSignal = (signal: SessionLifecycleSignal) => {
      signals.push(signal);
    };
    const drain = (async () => {
      for await (const message of runtime.execute(baseOptions({ onLifecycleSignal }))) {
        seen.push(message);
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const stream = activeStream!;

    stream.push({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{ task_id: "t1" }],
    });
    stream.push({ type: "result", subtype: "success" });
    await new Promise((r) => setTimeout(r, 10));

    // Authoritative turn_end reports BOTH a live background task and a pending
    // session cron in the same snapshot.
    const stopCallback = stopCallbackFromLastQueryCall();
    await stopCallback({
      hook_event_name: "Stop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
      background_tasks: [{ id: "t1", type: "shell", status: "running", description: "server" }],
      session_crons: [{ id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" }],
    });
    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));

    // Still held — the task is live per the authoritative snapshot.
    expect(seen.some((m) => m.type === "result")).toBe(false);
    const turnEnd = signals.find((s) => s.kind === "turn_end");
    expect(turnEnd?.sessionCrons).toEqual([
      { id: "c1", schedule: "+60s", recurring: false, prompt: "WAKE" },
    ]);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
  });
});
