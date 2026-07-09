/**
 * The reaper decision — one rule, no timers.
 *
 * Reaping a streaming session is cheap and lossless (measured on SDK 0.3.205):
 * resume recovers the full conversation, cold respawn → `init` ≈ 0.5 s, and the
 * Anthropic prompt cache is server-side so it survives the reap. Keeping an idle
 * session warm therefore buys ~1 s and costs ~300 MB — a false economy. So the
 * only reason to keep a session alive is *live background work* that reaping
 * would kill. Everything else is reaped the instant it goes idle. No idle timer,
 * no max-lifetime backstop, no idle-concurrency cap. See edspencer/herdctl#307.
 */

import type { SessionLifecycleSignal } from "./types.js";

/**
 * What to do with a session that has just gone idle.
 *
 * - `reap`: no continuous-class work is running — close the process now (after
 *   sweeping any `sessionCrons` into the scheduler).
 * - `keepAlive`: continuous-class background work is in flight; closing would
 *   kill it. Hold the process open and re-evaluate when the task set changes.
 */
export type ReapDecision =
  | { action: "reap" }
  | {
      action: "keepAlive";
      reason: "background_tasks";
      tasks: SessionLifecycleSignal["backgroundTasks"];
    };

/**
 * Decide whether an idle session should be reaped.
 *
 * The rule is deliberately total and stateless: keep the session alive **iff**
 * it holds live background work; otherwise reap. Timer-class `sessionCrons` do
 * **not** keep a session alive — they are captured and re-triggered by the
 * scheduler, so a session with only pending wakeups is still reaped.
 */
export function decideReap(signal: SessionLifecycleSignal): ReapDecision {
  if (signal.backgroundTasks.length > 0) {
    return { action: "keepAlive", reason: "background_tasks", tasks: signal.backgroundTasks };
  }
  return { action: "reap" };
}
