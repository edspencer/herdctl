/**
 * The stateful coordinator over herdctl-owned session wakes.
 *
 * Wraps the pure {@link ./wake-store.js} reconciliation with persistence, a
 * cron resolver, and a concurrency-limited firing path. All mutations funnel
 * through a single async lock so a turn-end reconcile can't race the scheduler's
 * due-check. Firing happens **outside** the lock — a fired wake resumes the
 * session, whose own Stop hook re-enters {@link reconcile}, so holding the lock
 * across a fire would deadlock.
 *
 * See edspencer/herdctl#307 gap 2 (fire-time concurrency) and gap 6 (wake-vs-live
 * collision).
 */

import { createLogger } from "../utils/logger.js";
import type { SessionCronSummary, SessionWakeEntry } from "./types.js";

/** The structural logger returned by {@link createLogger}. */
type Logger = ReturnType<typeof createLogger>;

import {
  advanceWake,
  findDueWakes,
  type NextRunResolver,
  pruneExpiredWakes,
  RECURRING_WAKE_MAX_AGE_MS,
  reconcileSessionWakes,
  removeSessionWakes,
  removeWake,
} from "./wake-store.js";

/** Where the wake set is read from / written to (fleet state in production). */
export interface WakePersistence {
  load(): Promise<SessionWakeEntry[]>;
  save(entries: SessionWakeEntry[]): Promise<void>;
}

export interface WakeRegistryOptions {
  /** Durable store for the wake set. */
  persistence: WakePersistence;
  /** Resolves a cron expression to its next absolute fire time. */
  resolveNextRun: NextRunResolver;
  /**
   * Fires a due wake: resume its session and inject its prompt. Called outside
   * the registry lock; a throw is logged and the wake is not retried (recurring
   * wakes simply fire next cycle).
   */
  fire: (entry: SessionWakeEntry) => Promise<void>;
  /**
   * True while `sessionId` has a live, herdctl-managed session open. A wake for a
   * live session is skipped at due time — that session's own next turn re-captures
   * it — rather than spawning a second process for the same session (gap 6).
   */
  isSessionLive?: (sessionId: string) => boolean;
  /** Max concurrent fires at one due tick (gap 2). Default 4. */
  concurrency?: number;
  /** Recurring-wake lifetime; defaults to the 7-day harness parity. */
  maxAgeMs?: number;
  logger?: Logger;
}

const DEFAULT_CONCURRENCY = 4;

export class WakeRegistry {
  private readonly persistence: WakePersistence;
  private readonly resolveNextRun: NextRunResolver;
  private readonly fire: (entry: SessionWakeEntry) => Promise<void>;
  private readonly isSessionLive: (sessionId: string) => boolean;
  private readonly concurrency: number;
  private readonly maxAgeMs: number;
  private readonly logger: Logger;

  /** Serializes all persisted-state mutations (reconcile + due bookkeeping). */
  private lock: Promise<void> = Promise.resolve();

  constructor(options: WakeRegistryOptions) {
    this.persistence = options.persistence;
    this.resolveNextRun = options.resolveNextRun;
    this.fire = options.fire;
    this.isSessionLive = options.isSessionLive ?? (() => false);
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxAgeMs = options.maxAgeMs ?? RECURRING_WAKE_MAX_AGE_MS;
    this.logger = options.logger ?? createLogger("wake-registry");
  }

  /** Run `fn` with exclusive access to the persisted wake set. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    // Keep the chain alive but swallow errors so one failure can't wedge the lock.
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Reconcile a session's pending crons (from its Stop hook) into the durable
   * wake set. Call at every turn boundary, before reaping.
   */
  async reconcile(
    agent: string,
    sessionId: string,
    sessionCrons: SessionCronSummary[],
    now: Date = new Date(),
  ): Promise<void> {
    await this.withLock(async () => {
      const existing = await this.persistence.load();
      const reconciled = reconcileSessionWakes({
        existing,
        agent,
        sessionId,
        sessionCrons,
        now,
        resolveNextRun: this.resolveNextRun,
      });
      const pruned = pruneExpiredWakes(reconciled, now, this.maxAgeMs);
      await this.persistence.save(pruned);
    });
  }

  /** Remove a single wake by id (an explicitly detected `CronDelete`; gap 4b). */
  async remove(id: string): Promise<void> {
    await this.withLock(async () => {
      const existing = await this.persistence.load();
      await this.persistence.save(removeWake(existing, id));
    });
  }

  /** Drop all wakes for a session (e.g. it was permanently closed by the user). */
  async forgetSession(sessionId: string): Promise<void> {
    await this.withLock(async () => {
      const existing = await this.persistence.load();
      await this.persistence.save(removeSessionWakes(existing, sessionId));
    });
  }

  /**
   * Fire every wake now due, honoring the concurrency limit and skipping wakes
   * whose session is currently live. Bookkeeping (advance recurring / drop
   * one-shot) is persisted *before* firing so a slow or failed fire can't
   * double-trigger; the fires then run outside the lock.
   *
   * @returns the wakes that were dispatched this tick.
   */
  async dispatchDue(now: Date = new Date()): Promise<SessionWakeEntry[]> {
    const due = await this.withLock(async () => {
      const existing = pruneExpiredWakes(await this.persistence.load(), now, this.maxAgeMs);
      const dueNow = findDueWakes(existing, now).filter((e) => !this.isSessionLive(e.sessionId));
      if (dueNow.length === 0) {
        await this.persistence.save(existing);
        return [];
      }
      // Pre-compute the post-fire set: advance recurring, drop one-shots.
      const dueIds = new Set(dueNow.map((e) => e.id));
      const next: SessionWakeEntry[] = [];
      for (const entry of existing) {
        if (!dueIds.has(entry.id)) {
          next.push(entry);
          continue;
        }
        const advanced = advanceWake(entry, now, this.resolveNextRun, this.maxAgeMs);
        if (advanced) next.push(advanced);
      }
      await this.persistence.save(next);
      return dueNow;
    });

    if (due.length > 0) {
      await this.runLimited(due, (entry) => this.fireOne(entry));
    }
    return due;
  }

  private async fireOne(entry: SessionWakeEntry): Promise<void> {
    try {
      this.logger.debug(`Firing session wake ${entry.id} for ${entry.agent} (${entry.sessionId})`);
      await this.fire(entry);
    } catch (error) {
      this.logger.warn(
        `Session wake ${entry.id} for ${entry.agent} failed to fire: ${(error as Error).message}`,
      );
    }
  }

  /** Run `task` over `items` with at most `this.concurrency` in flight. */
  private async runLimited<T>(items: T[], task: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await task(item);
      }
    };
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, () =>
      worker(),
    );
    await Promise.all(workers);
  }
}
