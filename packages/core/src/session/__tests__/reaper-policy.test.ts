import { describe, expect, it } from "vitest";
import { decideReap } from "../reaper-policy.js";
import type { SessionLifecycleSignal } from "../types.js";

function signal(overrides: Partial<SessionLifecycleSignal> = {}): SessionLifecycleSignal {
  return {
    kind: "turn_end",
    sessionId: "sess-1",
    sessionCrons: [],
    backgroundTasks: [],
    ...overrides,
  };
}

describe("decideReap", () => {
  it("reaps an idle session with no background work", () => {
    expect(decideReap(signal())).toEqual({ action: "reap" });
  });

  it("reaps even when timer-class wakeups are pending (they are re-triggered, not pinned)", () => {
    const decision = decideReap(
      signal({
        sessionCrons: [{ id: "c1", schedule: "*/5 * * * *", recurring: true, prompt: "go" }],
      }),
    );
    expect(decision).toEqual({ action: "reap" });
  });

  it("keeps alive while continuous-class background work is running", () => {
    const tasks = [{ id: "t1", type: "shell", status: "running", description: "dev server" }];
    const decision = decideReap(signal({ backgroundTasks: tasks }));
    expect(decision.action).toBe("keepAlive");
    if (decision.action === "keepAlive") {
      expect(decision.reason).toBe("background_tasks");
      expect(decision.tasks).toEqual(tasks);
    }
  });
});
