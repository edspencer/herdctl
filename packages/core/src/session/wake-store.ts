/**
 * Reconcile session-only crons into herdctl-owned wake entries.
 *
 * At each turn boundary the SDK reports the session's pending `session_crons`.
 * herdctl reconciles that authoritative set (by `id`) against what it already
 * holds, then persists the result so its own scheduler can re-trigger the wakes
 * after the session is reaped. These functions are pure — persistence and cron
 * math are injected — so the reconciliation rules are unit-testable in isolation.
 *
 * See edspencer/herdctl#307 (§"Re-trigger timer-class work") and its gap-4 note
 * on recurring-cron ownership.
 */

import type { SessionCronSummary, SessionWakeEntry } from "./types.js";

/** Recurring session-only crons auto-expire after 7 days (mirrors the harness). */
export const RECURRING_WAKE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Injected cron resolver — decouples reconciliation from `scheduler/cron.ts`. */
export type NextRunResolver = (schedule: string, from: Date) => Date;

export interface ReconcileParams {
  /** All wake entries herdctl currently holds (across every session). */
  existing: SessionWakeEntry[];
  /** Qualified agent name that owns the session being reconciled. */
  agent: string;
  /** The session id these crons belong to. */
  sessionId: string;
  /** The authoritative pending set reported by this turn's Stop hook. */
  sessionCrons: SessionCronSummary[];
  /** Current time — the anchor for new `nextRunAt` / `createdAt` values. */
  now: Date;
  /** Resolves a cron expression to its next absolute fire time. */
  resolveNextRun: NextRunResolver;
}

/**
 * Reconcile one session's pending crons into the full wake set.
 *
 * Rules (see #307 gap 4):
 * - **New id** (in `sessionCrons`, not stored) → capture it, resolving an
 *   absolute `nextRunAt` now so an overdue fleet can fire it immediately.
 * - **Known id** (in both) → keep the stored entry unchanged; herdctl already
 *   owns its schedule and must not reset the cycle just because it was re-reported.
 * - **Dropped id** (stored for this session, absent from `sessionCrons`):
 *   - one-shot (`recurring:false`) → remove (it fired, or the agent cancelled it).
 *   - recurring (`recurring:true`) → **keep**. A herdctl-fired *resumed* turn does
 *     not re-arm the session-only cron, so it legitimately reports empty; dropping
 *     on absence would delete every recurring wake on its first re-trigger.
 *     Recurring wakes are instead retired by {@link pruneExpiredWakes} (7-day) or
 *     an explicit {@link removeWake} (a detected `CronDelete`).
 *
 * Entries for *other* sessions pass through untouched.
 */
export function reconcileSessionWakes(params: ReconcileParams): SessionWakeEntry[] {
  const { existing, agent, sessionId, sessionCrons, now, resolveNextRun } = params;

  const others = existing.filter((e) => e.sessionId !== sessionId);
  const mine = existing.filter((e) => e.sessionId === sessionId);
  const byId = new Map(mine.map((e) => [e.id, e]));
  const reportedIds = new Set(sessionCrons.map((c) => c.id));

  const result: SessionWakeEntry[] = [];

  // Known + new ids from the authoritative reported set.
  for (const cron of sessionCrons) {
    const known = byId.get(cron.id);
    if (known) {
      result.push(known);
      continue;
    }
    result.push({
      id: cron.id,
      agent,
      sessionId,
      schedule: cron.schedule,
      recurring: cron.recurring,
      prompt: cron.prompt,
      nextRunAt: resolveNextRun(cron.schedule, now).toISOString(),
      createdAt: now.toISOString(),
    });
  }

  // Dropped ids: keep recurring (herdctl-owned), discard stale one-shots.
  for (const entry of mine) {
    if (reportedIds.has(entry.id)) continue;
    if (entry.recurring) result.push(entry);
  }

  return [...others, ...result];
}

/**
 * Advance a recurring wake to its next fire time after it has fired; one-shots
 * return `null` (fire once, then drop). Recurring wakes past the 7-day lifetime
 * also return `null`.
 */
export function advanceWake(
  entry: SessionWakeEntry,
  now: Date,
  resolveNextRun: NextRunResolver,
  maxAgeMs: number = RECURRING_WAKE_MAX_AGE_MS,
): SessionWakeEntry | null {
  if (!entry.recurring) return null;
  if (isExpired(entry, now, maxAgeMs)) return null;
  return { ...entry, nextRunAt: resolveNextRun(entry.schedule, now).toISOString() };
}

/** A recurring wake is expired once it has outlived `maxAgeMs` since capture. */
export function isExpired(
  entry: SessionWakeEntry,
  now: Date,
  maxAgeMs: number = RECURRING_WAKE_MAX_AGE_MS,
): boolean {
  if (!entry.recurring) return false;
  return now.getTime() - new Date(entry.createdAt).getTime() > maxAgeMs;
}

/** Drop recurring wakes that have passed the 7-day lifetime. */
export function pruneExpiredWakes(
  entries: SessionWakeEntry[],
  now: Date,
  maxAgeMs: number = RECURRING_WAKE_MAX_AGE_MS,
): SessionWakeEntry[] {
  return entries.filter((e) => !isExpired(e, now, maxAgeMs));
}

/** Remove a wake by id (e.g. an explicitly detected `CronDelete`). */
export function removeWake(entries: SessionWakeEntry[], id: string): SessionWakeEntry[] {
  return entries.filter((e) => e.id !== id);
}

/** Remove every wake bound to a session (e.g. the session was permanently closed). */
export function removeSessionWakes(
  entries: SessionWakeEntry[],
  sessionId: string,
): SessionWakeEntry[] {
  return entries.filter((e) => e.sessionId !== sessionId);
}

/** Wakes whose `nextRunAt` is at or before `now` — the due set to fire. */
export function findDueWakes(entries: SessionWakeEntry[], now: Date): SessionWakeEntry[] {
  const t = now.getTime();
  return entries.filter((e) => new Date(e.nextRunAt).getTime() <= t);
}
