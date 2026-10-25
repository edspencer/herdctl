import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../runner/types.js";
import { buildLifecycleHooks, createTurnBoundary, tapLifecycleStream } from "../session-hooks.js";
import type { SessionLifecycleSignal } from "../types.js";

function stopInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    hook_event_name: "Stop",
    session_id: "sess-1",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp",
    stop_hook_active: false,
    session_crons: [{ id: "c1", schedule: "35 13 * * *", recurring: false, prompt: "go" }],
    background_tasks: [],
    ...overrides,
  } as HookInput;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  for (const m of messages) yield m;
}

function postToolUseInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "sess-1",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp",
    tool_name: "CronDelete",
    tool_input: { id: "c1" },
    tool_response: { id: "c1" },
    tool_use_id: "tu-1",
    ...overrides,
  } as HookInput;
}

describe("buildLifecycleHooks", () => {
  it("registers a Stop matcher and a PostToolUse matcher (never SubagentStop)", () => {
    const hooks = buildLifecycleHooks(vi.fn());
    expect(hooks?.Stop?.[0].hooks).toHaveLength(1);
    // The PostToolUse hook watches for CronDelete so a herdctl-owned recurring
    // wake can be retired (#409).
    expect(hooks?.PostToolUse?.[0].hooks).toHaveLength(1);
    // SubagentStop must NOT be wired: it fires mid-parent-turn when a synchronous
    // subagent finishes, and treating it as a turn_end reaps the live parent
    // session out from under the keeper. See isMainAgentStop.
    expect(hooks?.SubagentStop).toBeUndefined();
  });

  it("ignores a SubagentStop input (no turn_end for a synchronous subagent)", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.Stop![0].hooks[0];
    const subagentStop = {
      hook_event_name: "SubagentStop",
      session_id: "sess-1",
      transcript_path: "/tmp/t.jsonl",
      cwd: "/tmp",
      stop_hook_active: false,
    } as unknown as HookInput;
    const result = await cb(subagentStop, undefined, { signal: new AbortController().signal });
    expect(result).toEqual({ continue: true });
    expect(sink).not.toHaveBeenCalled();
  });

  it("forwards a turn_end signal carrying the crons/tasks snapshot", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.Stop![0].hooks[0];
    const result = await cb(stopInput(), undefined, { signal: new AbortController().signal });

    expect(result).toEqual({ continue: true });
    expect(sink).toHaveBeenCalledTimes(1);
    const signal = sink.mock.calls[0][0] as SessionLifecycleSignal;
    expect(signal).toMatchObject({
      kind: "turn_end",
      sessionId: "sess-1",
      sessionCrons: [{ id: "c1", recurring: false }],
      backgroundTasks: [],
    });
  });

  it("defaults absent crons/tasks to empty arrays", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.Stop![0].hooks[0];
    await cb(stopInput({ session_crons: undefined, background_tasks: undefined }), undefined, {
      signal: new AbortController().signal,
    });
    const signal = sink.mock.calls[0][0] as SessionLifecycleSignal;
    expect(signal.sessionCrons).toEqual([]);
    expect(signal.backgroundTasks).toEqual([]);
  });

  it("does nothing for non-stop hook inputs", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.Stop![0].hooks[0];
    const other = { hook_event_name: "PreToolUse", session_id: "s" } as unknown as HookInput;
    await cb(other, undefined, { signal: new AbortController().signal });
    expect(sink).not.toHaveBeenCalled();
  });

  it("resolves { continue: true } even when the sink rejects", async () => {
    const sink = vi.fn().mockRejectedValue(new Error("sink boom"));
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.Stop![0].hooks[0];
    await expect(
      cb(stopInput(), undefined, { signal: new AbortController().signal }),
    ).resolves.toEqual({ continue: true });
    // Let the swallowed rejection settle so it can't surface as unhandled.
    await new Promise((r) => setTimeout(r, 5));
  });

  it("emits a cron_deleted signal carrying the id of a CronDelete tool call", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.PostToolUse![0].hooks[0];
    const result = await cb(postToolUseInput(), undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(sink).toHaveBeenCalledTimes(1);
    const signal = sink.mock.calls[0][0] as SessionLifecycleSignal;
    expect(signal).toMatchObject({
      kind: "cron_deleted",
      sessionId: "sess-1",
      deletedCronIds: ["c1"],
    });
  });

  it("ignores PostToolUse for tools other than CronDelete", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.PostToolUse![0].hooks[0];
    await cb(postToolUseInput({ tool_name: "Bash", tool_input: { command: "ls" } }), undefined, {
      signal: new AbortController().signal,
    });
    expect(sink).not.toHaveBeenCalled();
  });

  it("ignores a CronDelete with a missing or non-string id", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const cb = hooks!.PostToolUse![0].hooks[0];
    for (const badInput of [{}, { id: 42 }, { id: "" }, null]) {
      await cb(postToolUseInput({ tool_input: badInput }), undefined, {
        signal: new AbortController().signal,
      });
    }
    expect(sink).not.toHaveBeenCalled();
  });

  it("the Stop callback ignores PostToolUse and the PostToolUse callback ignores Stop", async () => {
    const sink = vi.fn();
    const hooks = buildLifecycleHooks(sink);
    const stopCb = hooks!.Stop![0].hooks[0];
    const postCb = hooks!.PostToolUse![0].hooks[0];
    await stopCb(postToolUseInput(), undefined, { signal: new AbortController().signal });
    await postCb(stopInput(), undefined, { signal: new AbortController().signal });
    expect(sink).not.toHaveBeenCalled();
  });
});

describe("tapLifecycleStream", () => {
  it("yields every message through unchanged", async () => {
    const messages: SDKMessage[] = [
      { type: "assistant", session_id: "s" },
      { type: "result", session_id: "s" },
    ];
    const out: SDKMessage[] = [];
    for await (const m of tapLifecycleStream(stream(messages), vi.fn())) out.push(m);
    expect(out).toEqual(messages);
  });

  it("emits a background_tasks_changed signal with mapped tasks", async () => {
    const sink = vi.fn();
    const messages: SDKMessage[] = [
      {
        type: "system",
        subtype: "background_tasks_changed",
        session_id: "sess-1",
        tasks: [{ task_id: "t1", task_type: "shell", description: "dev server" }],
      } as unknown as SDKMessage,
    ];
    for await (const _ of tapLifecycleStream(stream(messages), sink)) {
      /* drain */
    }
    expect(sink).toHaveBeenCalledTimes(1);
    const signal = sink.mock.calls[0][0] as SessionLifecycleSignal;
    expect(signal.kind).toBe("background_tasks_changed");
    expect(signal.backgroundTasks).toEqual([
      { id: "t1", type: "shell", status: "running", description: "dev server" },
    ]);
  });

  it("keeps streaming when the sink rejects (no unhandled rejection)", async () => {
    const sink = vi.fn().mockRejectedValue(new Error("sink boom"));
    const messages: SDKMessage[] = [
      { type: "assistant", session_id: "s" },
      { type: "result", session_id: "s" },
    ];
    const out: SDKMessage[] = [];
    for await (const m of tapLifecycleStream(stream(messages), sink)) out.push(m);
    expect(out).toEqual(messages);
    await new Promise((r) => setTimeout(r, 5));
  });

  it("emits exactly one activity signal per turn (reset on result)", async () => {
    const sink = vi.fn();
    const messages: SDKMessage[] = [
      { type: "assistant", session_id: "s" },
      { type: "assistant", session_id: "s" },
      { type: "result", session_id: "s" },
      { type: "assistant", session_id: "s" },
    ];
    for await (const _ of tapLifecycleStream(stream(messages), sink)) {
      /* drain */
    }
    const activity = sink.mock.calls
      .map((c) => c[0] as SessionLifecycleSignal)
      .filter((s) => s.kind === "activity");
    expect(activity).toHaveLength(2);
  });

  describe("turn_aborted (a turn that ends without its Stop hook)", () => {
    const signals = (sink: ReturnType<typeof vi.fn>) =>
      sink.mock.calls.map((c) => c[0] as SessionLifecycleSignal);
    const ctx = { signal: new AbortController().signal };

    it("emits turn_aborted on a result whose turn never fired Stop (a user interrupt)", async () => {
      const sink = vi.fn();
      const boundary = createTurnBoundary();
      const messages: SDKMessage[] = [
        { type: "assistant", session_id: "s" },
        { type: "result", subtype: "error_during_execution", session_id: "s" } as SDKMessage,
      ];
      for await (const _ of tapLifecycleStream(stream(messages), sink, boundary)) {
        /* drain */
      }
      await tick();
      const aborted = signals(sink).filter((s) => s.kind === "turn_aborted");
      expect(aborted).toEqual([
        { kind: "turn_aborted", sessionId: "s", sessionCrons: [], backgroundTasks: [] },
      ]);
    });

    it("does NOT emit turn_aborted when the turn's Stop hook fired first", async () => {
      const sink = vi.fn();
      const boundary = createTurnBoundary();
      const stopCb = buildLifecycleHooks(sink, boundary)!.Stop![0].hooks[0];
      async function* turn(): AsyncGenerator<SDKMessage> {
        yield { type: "assistant", session_id: "sess-1" };
        // The CLI awaits the Stop hook's response before it emits `result`.
        await stopCb(stopInput(), undefined, ctx);
        yield { type: "result", subtype: "success", session_id: "sess-1" } as SDKMessage;
      }
      for await (const _ of tapLifecycleStream(turn(), sink, boundary)) {
        /* drain */
      }
      await tick();
      expect(signals(sink).map((s) => s.kind)).toEqual(["activity", "turn_end"]);
    });

    it("resets per turn: a Stop on turn 1 does not cover an interrupted turn 2", async () => {
      const sink = vi.fn();
      const boundary = createTurnBoundary();
      const stopCb = buildLifecycleHooks(sink, boundary)!.Stop![0].hooks[0];
      async function* turns(): AsyncGenerator<SDKMessage> {
        yield { type: "assistant", session_id: "sess-1" };
        await stopCb(stopInput(), undefined, ctx);
        yield { type: "result", session_id: "sess-1" };
        yield { type: "assistant", session_id: "sess-1" };
        yield { type: "result", session_id: "sess-1" };
      }
      for await (const _ of tapLifecycleStream(turns(), sink, boundary)) {
        /* drain */
      }
      await tick();
      expect(signals(sink).map((s) => s.kind)).toEqual([
        "activity",
        "turn_end",
        "activity",
        "turn_aborted",
      ]);
    });

    it("carries the latest background-task set seen on the stream", async () => {
      const sink = vi.fn();
      const boundary = createTurnBoundary();
      const changed = (tasks: unknown[]) =>
        ({
          type: "system",
          subtype: "background_tasks_changed",
          session_id: "s",
          tasks,
        }) as unknown as SDKMessage;
      const messages: SDKMessage[] = [
        changed([{ task_id: "t1", task_type: "local_bash", description: "a" }]),
        changed([
          { task_id: "t1", task_type: "local_bash", description: "a" },
          { task_id: "t2", task_type: "local_agent", description: "b" },
        ]),
        changed([{ task_id: "t2", task_type: "local_agent", description: "b" }]),
        { type: "result", session_id: "s" },
      ];
      for await (const _ of tapLifecycleStream(stream(messages), sink, boundary)) {
        /* drain */
      }
      await tick();
      const aborted = signals(sink).find((s) => s.kind === "turn_aborted");
      expect(aborted?.backgroundTasks).toEqual([
        { id: "t2", type: "local_agent", status: "running", description: "b" },
      ]);
    });

    it("emits nothing extra without a boundary (callers that don't share one are unchanged)", async () => {
      const sink = vi.fn();
      const messages: SDKMessage[] = [
        { type: "assistant", session_id: "s" },
        { type: "result", session_id: "s" },
      ];
      for await (const _ of tapLifecycleStream(stream(messages), sink)) {
        /* drain */
      }
      await tick();
      expect(signals(sink).map((s) => s.kind)).toEqual(["activity"]);
    });
  });
});
