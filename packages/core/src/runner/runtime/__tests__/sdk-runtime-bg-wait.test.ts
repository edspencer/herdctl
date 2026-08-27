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
    // The drain message alone is non-terminal and no longer ends the wait
    // (see the "keeps waiting past a non-terminal drain message" test below)
    // — the background task's own re-invocation turn still needs to produce
    // its real terminal, here simulated as arriving right after the drain.
    stream.push({ type: "result", subtype: "success" });
    await drain;

    // Both background_tasks_changed messages passed through as normal
    // content; the terminal result was released only once a fresh terminal
    // arrived after tasks drained.
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
    // Drain alone is non-terminal — the loop still waits for a fresh
    // terminal (the re-invocation's own result) before releasing.
    stream.push({ type: "result", subtype: "success" });
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
    // A message that carries no task snapshot of its own must not clobber
    // the tracked live count either.
    stream.push({ type: "assistant", message: { content: [] } });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    // Drain alone is non-terminal — wait for the re-invocation's own result.
    stream.push({ type: "result", subtype: "success" });
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
    stream.push({ type: "assistant", message: { content: [] } });
    // The Stop hook's authoritative empty snapshot is non-terminal — wait
    // for the re-invocation's own result before releasing.
    stream.push({ type: "result", subtype: "success" });

    await drain;
    expect(seen.filter((m) => m.type === "result")).toHaveLength(1);
  });

  it("keeps waiting past a non-terminal drain message and yields the fresh terminal, not the stale held one", async () => {
    // Regression: the release check used to run after every message once a
    // terminal was pending, not only on a fresh terminal. A
    // `background_tasks_changed` drain message (tasks: []) is non-terminal —
    // it gets yielded and passes straight through — but it also flips
    // liveBackgroundTasks to empty in the same tick. The old code then broke
    // right there, before the background task's own re-invocation turn
    // (further assistant content + its real terminal) ever streamed, so the
    // consumer only ever saw the stale first result.
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
    stream.push({ type: "result", subtype: "success", stale: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.some((m) => m.type === "result")).toBe(false);

    // Drain event: non-terminal, but reports the task list as empty.
    stream.push({ type: "system", subtype: "background_tasks_changed", tasks: [] });
    await new Promise((r) => setTimeout(r, 10));
    // The background subagent's own re-invocation turn, arriving late.
    stream.push({ type: "assistant", message: { content: [] } });
    stream.push({ type: "result", subtype: "success", stale: false });

    await drain;

    const results = seen.filter((m) => m.type === "result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ stale: false });
  });
});
