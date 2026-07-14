/**
 * Types for streaming-session lifecycle management (reaper + wake re-trigger).
 *
 * A long-lived chat session (`FleetManager.openChatSession` /
 * `SDKRuntime.openSession`) keeps a native `claude` process warm at ~300 MB RSS.
 * These types back the machinery that reaps such a process the instant it goes
 * idle and re-triggers any scheduled wakeups it left behind — see the `session/`
 * module docs and edspencer/herdctl#307.
 */

import type { BackgroundTaskSummary, SessionCronSummary } from "@anthropic-ai/claude-agent-sdk";

// Re-export the SDK's summary shapes so consumers of `@herdctl/core` can type
// lifecycle signals without importing the SDK directly (mirrors how
// `interface.ts` re-exports `SlashCommand`).
export type { BackgroundTaskSummary, SessionCronSummary };

/**
 * A snapshot of a session's pending background work, captured at a turn
 * boundary (the SDK main-agent `Stop` hook) or when the live background-task
 * set changes (`background_tasks_changed`).
 *
 * `sessionCrons` are the timer-class wakeups (`ScheduleWakeup`, `CronCreate`,
 * `/loop`) that want to re-run the session later; `backgroundTasks` are the
 * continuous-class work (a dev/web server, a `Monitor`, a detached subagent)
 * that must keep the process alive while running.
 */
export interface SessionLifecycleSignal {
  /**
   * What produced the signal:
   * - `turn_end` — the main-agent `Stop` hook fired; `sessionCrons` and
   *   `backgroundTasks` are the authoritative turn-boundary snapshot.
   * - `background_tasks_changed` — the live background-task set changed
   *   mid-session; `backgroundTasks` is fresh, `sessionCrons` is not reported
   *   (empty) and must not be reconciled.
   * - `activity` — the session started producing output again (a new turn is
   *   underway); carries no snapshot, only clears the idle-waiting state.
   */
  kind: "turn_end" | "background_tasks_changed" | "activity";
  /** The resolved session id the wakeups/tasks belong to. */
  sessionId: string;
  /** Pending timer-class wakeups. Empty when none are scheduled. */
  sessionCrons: SessionCronSummary[];
  /** In-flight continuous-class background work. Empty when the session is idle. */
  backgroundTasks: BackgroundTaskSummary[];
}

/**
 * A herdctl-owned wake, captured from a `SessionCronSummary` and persisted so
 * the fleet's own scheduler can re-trigger it after the session is reaped.
 *
 * The SDK's session-only cron dies with the `claude` process (durable crons are
 * silently downgraded in the headless SDK context), so herdctl becomes the
 * persistence layer: it stores the resolved absolute `nextRunAt` and, on due,
 * resumes the session and injects `prompt`.
 */
export interface SessionWakeEntry {
  /** The SDK cron id — the reconciliation key across turns. */
  id: string;
  /** Qualified agent name that owns the session. */
  agent: string;
  /** Session id to resume when the wake fires. */
  sessionId: string;
  /** Cron expression. For a one-shot `ScheduleWakeup` it encodes a single fire time. */
  schedule: string;
  /** `false` for one-shot wakeups; `true` for crons that re-fire on every match. */
  recurring: boolean;
  /** Prompt injected into the resumed session when the wake fires. */
  prompt: string;
  /** Resolved absolute next fire time (ISO). Stored so an overdue fleet fires immediately. */
  nextRunAt: string;
  /** ISO timestamp the wake was first captured — anchors the recurring-cron expiry. */
  createdAt: string;
}
