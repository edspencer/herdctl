import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../runner/types.js";
import { buildLifecycleHooks, tapLifecycleStream } from "../session-hooks.js";
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

async function* stream(messages: SDKMessage[]): AsyncGenerator<SDKMessage> {
  for (const m of messages) yield m;
}

describe("buildLifecycleHooks", () => {
  it("registers a Stop matcher only (never SubagentStop)", () => {
    const hooks = buildLifecycleHooks(vi.fn());
    expect(hooks?.Stop?.[0].hooks).toHaveLength(1);
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
});
