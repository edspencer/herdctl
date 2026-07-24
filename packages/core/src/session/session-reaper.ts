/**
 * Ties a live streaming session to the reap decision.
 *
 * A managed session forwards its turn-boundary {@link SessionLifecycleSignal}s
 * here (via `RuntimeExecuteOptions.onLifecycleSignal`, wired in the SDK runtime).
 * On each signal the reaper (1) reconciles the session's pending crons into the
 * {@link WakeRegistry} so they survive the reap, then (2) applies the one-rule
 * {@link decideReap} policy: keep the process alive while continuous-class
 * background work runs, otherwise close it immediately. A `cron_deleted` signal
 * (the agent ran `CronDelete`) instead routes to {@link WakeRegistry.remove} so a
 * herdctl-owned recurring wake is retired rather than firing until its 7-day
 * prune (#409).
 *
 * The reaper also answers "is this session live?" for the registry, so a due
 * wake never spawns a second process for a session that is still open (gap 6).
 *
 * See edspencer/herdctl#307.
 */

import type { RuntimeSession } from "../runner/runtime/interface.js";
import { createLogger } from "../utils/logger.js";
import { decideReap } from "./reaper-policy.js";
import type { BackgroundTaskSummary, SessionLifecycleSignal } from "./types.js";
import type { WakeRegistry } from "./wake-registry.js";

type Logger = ReturnType<typeof createLogger>;

/**
 * How long to hold an idle session open after its background-task set drains to
 * empty, giving a re-invocation turn (the SDK handing the parent the completed
 * task's result) time to announce itself via an `activity` signal before we reap.
 *
 * Reaping is cheap and lossless (#307), so erring generous costs only a little
 * delayed RSS reclamation for a genuine fire-and-forget completion; erring short
 * reintroduces #368 — reaping the session out from under the re-invocation, so
 * the keeper "stops" the instant its background work finishes and never consumes
 * the result. An `activity` cancels the wait early, so in the common case the
 * full window is never spent.
 */
export const DEFAULT_REINVOCATION_GRACE_MS = 15_000;

export interface SessionReaperOptions {
  /** Durable wake store the reaper reconciles captured crons into. */
  registry: WakeRegistry;
  logger?: Logger;
  /** Notified when a managed session is reaped (idle, no background work). */
  onReap?: (info: { agent: string; sessionId: string }) => void;
  /** Notified when a session is held open because background work is running. */
  onKeepAlive?: (info: {
    agent: string;
    sessionId: string;
    tasks: BackgroundTaskSummary[];
  }) => void;
  /**
   * Grace window (ms) before reaping a session whose background-task set just
   * drained to empty — see {@link DEFAULT_REINVOCATION_GRACE_MS}. Overridable
   * mainly for tests. Defaults to {@link DEFAULT_REINVOCATION_GRACE_MS}.
   */
  reinvocationGraceMs?: number;
}

/** Per-session options for {@link SessionReaper.manage}. */
export interface ManageSessionOptions {
  /**
   * Grace (ms) to defer a `turn_end` reap so an immediately-following turn's
   * `activity` can cancel it — `0`/undefined reaps a `turn_end` synchronously
   * (the default, unchanged behavior).
   *
   * Set on a resume that carries a human prompt: if the prior process died
   * mid-turn leaving pending background-task state, the CLI replays that leftover
   * as its OWN turn (turn A) BEFORE the caller's queued prompt turn (turn B).
   * Turn A ends with no background work, so an immediate reap on its `turn_end`
   * closes the session out from under turn B — interrupting it (`[Request
   * interrupted by user]` / `interruptedByShutdown`) and losing the human's
   * message. Deferring the reap lets turn B's `activity` cancel it so B runs to
   * completion; a genuinely final turn's grace still elapses and reaps. Mirrors
   * the background-task-drain grace (#368). See edspencer/herdctl#406.
   */
  turnEndReapGraceMs?: number;
}

/** A handle to a session the reaper is managing. */
export interface ManagedSession {
  /**
   * Feed a turn-boundary signal to the reaper. Wire into
   * `RuntimeExecuteOptions.onLifecycleSignal`. Signals are serialized internally
   * (reconcile → decision → close, in order), so callers may fire-and-forget; the
   * returned promise settles when this signal has been processed. The actual
   * `close()` is deferred so it never re-enters the hook that triggered it.
   */
  handleSignal(signal: SessionLifecycleSignal): Promise<void>;
  /** True until the session has been reaped or detached. */
  isLive(): boolean;
  /** The resolved session id, once learned from the first signal (else undefined). */
  sessionId(): string | undefined;
  /** Stop managing without reaping — the consumer closed the session itself. */
  detach(): void;
}

/**
 * Owns the reap policy across every managed streaming session in a fleet.
 *
 * One reaper is shared by all sessions; {@link manage} returns a per-session
 * {@link ManagedSession} handle. {@link isSessionLive} is passed to the
 * {@link WakeRegistry} so it can defer wakes for still-open sessions.
 */
export class SessionReaper {
  private readonly registry: WakeRegistry;
  private readonly logger: Logger;
  private readonly onReap?: SessionReaperOptions["onReap"];
  private readonly onKeepAlive?: SessionReaperOptions["onKeepAlive"];
  private readonly reinvocationGraceMs: number;

  /** Live managed sessions by resolved session id. */
  private readonly liveById = new Map<string, ManagedSessionImpl>();

  /**
   * Resolvers waiting for a session id to stop being live, keyed by id. Fed by
   * {@link whenSessionReaped}, drained by {@link unregisterLive}. Lets a resume
   * (`openChatSession`) wait for a reaper-kept-alive subprocess to be reaped
   * before spawning, instead of launching a second competing `claude`
   * (edspencer/herdctl#403).
   */
  private readonly reapWaiters = new Map<string, Array<() => void>>();

  constructor(options: SessionReaperOptions) {
    this.registry = options.registry;
    this.logger = options.logger ?? createLogger("session-reaper");
    this.onReap = options.onReap;
    this.onKeepAlive = options.onKeepAlive;
    this.reinvocationGraceMs = options.reinvocationGraceMs ?? DEFAULT_REINVOCATION_GRACE_MS;
  }

  /** Begin managing a session's lifecycle. */
  manage(session: RuntimeSession, agent: string, options?: ManageSessionOptions): ManagedSession {
    const managed = new ManagedSessionImpl(session, agent, this, options?.turnEndReapGraceMs ?? 0);
    return managed;
  }

  /** True while any managed session with this id is open. Used by the registry. */
  isSessionLive(sessionId: string): boolean {
    return this.liveById.has(sessionId);
  }

  /**
   * Resolve once no managed session with this id is live — immediately if it is
   * already not live, otherwise when the current one is reaped or detached.
   *
   * `openChatSession` awaits this to defer a resume off a still-live session so it
   * never spawns a second `claude` on the same id: two processes resuming one
   * session collide and the SDK resolves it by interrupting the in-flight turn
   * (`[Request interrupted by user]`, edspencer/herdctl#403). This mirrors the
   * `isSessionLive` guard the wake registry already applies before firing — the
   * one resume path that lacked it.
   */
  whenSessionReaped(sessionId: string): Promise<void> {
    if (!this.liveById.has(sessionId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiters = this.reapWaiters.get(sessionId) ?? [];
      waiters.push(resolve);
      this.reapWaiters.set(sessionId, waiters);
    });
  }

  // --- internal, called by ManagedSessionImpl ---

  registerLive(sessionId: string, managed: ManagedSessionImpl): void {
    this.liveById.set(sessionId, managed);
  }

  unregisterLive(sessionId: string): void {
    this.liveById.delete(sessionId);
    // Release any resume deferred on this id (#403). Drain-and-resolve so a
    // deferred resume proceeds the instant the session is reaped/detached.
    const waiters = this.reapWaiters.get(sessionId);
    if (waiters) {
      this.reapWaiters.delete(sessionId);
      for (const resolve of waiters) resolve();
    }
  }

  async processSignal(managed: ManagedSessionImpl, signal: SessionLifecycleSignal): Promise<void> {
    // A new turn is producing output — the session is no longer idle-waiting, so
    // a later background_tasks_changed must not reap it out from under a live
    // turn. This is also how a re-invocation announces itself: when the SDK hands
    // the parent a completed background task's result, the resumed turn's first
    // output arrives here — so cancel any grace reap that task's completion armed,
    // or we close the session out from under the turn it just started (#368).
    if (signal.kind === "activity") {
      managed.cancelPendingReap();
      managed.setAwaitingTasks(false);
      return;
    }

    // The agent ran a `CronDelete` this turn: explicitly retire the herdctl-owned
    // wake(s) it named, so a recurring wake stops firing. This is the only signal
    // that can express a delete — `reconcile` can't infer it on a resumed turn
    // (the session-only cron isn't re-armed, so its absence looks identical to a
    // delete) and so deliberately keeps recurring wakes (#409). Firing continues
    // regardless of the surrounding reap decision, so handle it and return.
    if (signal.kind === "cron_deleted") {
      for (const id of signal.deletedCronIds ?? []) {
        try {
          await this.registry.remove(id);
        } catch (error) {
          this.logger.warn(
            `Failed to retire wake ${id} after CronDelete in session ${signal.sessionId} (${managed.agent}): ${(error as Error).message}`,
          );
        }
      }
      return;
    }

    // Mid-session task-set change: only meaningful while the session is idle and
    // was being kept alive purely for background work. Do NOT reconcile crons —
    // this event doesn't report session_crons (dropping stale ones would delete
    // the pending wakeups).
    if (signal.kind === "background_tasks_changed") {
      if (!managed.isAwaitingTasks()) return;
      if (signal.backgroundTasks.length > 0) {
        // Still (or newly) holding live background work — keep the session and
        // drop any grace reap a prior drain-to-empty had armed.
        managed.cancelPendingReap();
        return;
      }
      // The task set drained to empty. A completing background task is normally
      // followed a beat later by a re-invocation turn (the SDK delivering its
      // result), which surfaces as an `activity` signal. Reaping synchronously
      // here closes the session out from under that re-invocation — the keeper
      // appears to "stop" the instant its background work finishes, never
      // consuming the result (#368). So arm a short grace reap: an `activity`
      // cancels it if a re-invocation arrives; otherwise (a genuine
      // fire-and-forget) it fires and reaps, so the session is never leaked.
      managed.armPendingReap(this.reinvocationGraceMs, () => this.reap(managed, signal.sessionId));
      return;
    }

    // turn_end: the authoritative snapshot supersedes any pending grace reap.
    managed.cancelPendingReap();

    // Capture pending crons first so they survive whatever we decide next. A
    // reconcile I/O failure loses that turn's capture but must NOT block the reap
    // — leaving the session alive is the leak this module exists to prevent — so
    // log and press on with the decision.
    try {
      await this.registry.reconcile(managed.agent, signal.sessionId, signal.sessionCrons);
    } catch (error) {
      this.logger.warn(
        `Failed to reconcile wakes for session ${signal.sessionId} (${managed.agent}): ${(error as Error).message}`,
      );
    }

    const decision = decideReap(signal);
    if (decision.action === "keepAlive") {
      this.logger.debug(
        `Keeping session ${signal.sessionId} (${managed.agent}) alive: ${decision.tasks.length} background task(s)`,
      );
      managed.setAwaitingTasks(true);
      this.notify(() =>
        this.onKeepAlive?.({
          agent: managed.agent,
          sessionId: signal.sessionId,
          tasks: decision.tasks,
        }),
      );
      return;
    }

    // A resume flagged with a turn-end reap grace may replay a stale pending
    // background-task backlog as its own turn (turn A) ahead of the caller's
    // queued prompt turn (turn B); reaping on turn A's `turn_end` closes the
    // session out from under turn B and interrupts it (`[Request interrupted by
    // user]`, losing the human message). Defer via a grace that turn B's
    // `activity` cancels — so B runs to completion — while a genuinely final turn's
    // grace still elapses and reaps. Mirrors the background-task-drain grace
    // (#368). See edspencer/herdctl#406.
    if (managed.turnEndReapGraceMs > 0) {
      this.logger.debug(
        `Deferring turn_end reap of session ${signal.sessionId} (${managed.agent}) by ` +
          `${managed.turnEndReapGraceMs}ms; an incoming turn's activity cancels it`,
      );
      managed.armPendingReap(managed.turnEndReapGraceMs, () =>
        this.reap(managed, signal.sessionId),
      );
      return;
    }

    this.reap(managed, signal.sessionId);
  }

  private reap(managed: ManagedSessionImpl, sessionId: string): void {
    if (!managed.isLive()) return;
    this.logger.info(`Reaping idle session ${sessionId} (${managed.agent})`);
    // Notify before closing, but never let a throwing consumer callback skip the
    // close() — that would leak the very session we decided to reap.
    this.notify(() => this.onReap?.({ agent: managed.agent, sessionId }));
    managed.scheduleClose();
  }

  /** Run a consumer callback, swallowing (and logging) any throw. */
  private notify(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.warn(`Session lifecycle callback threw: ${(error as Error).message}`);
    }
  }
}

/**
 * Per-session state. Serializes signals through a promise chain so a
 * `background_tasks_changed` re-check can't interleave with a Stop reconcile,
 * and defers `close()` out of the hook that requested it.
 */
class ManagedSessionImpl implements ManagedSession {
  readonly agent: string;
  /**
   * Grace (ms) to defer a `turn_end` reap so a following turn's `activity` can
   * cancel it; `0` reaps synchronously. See {@link ManageSessionOptions}.
   */
  readonly turnEndReapGraceMs: number;
  private readonly session: RuntimeSession;
  private readonly reaper: SessionReaper;
  private resolvedSessionId: string | undefined;
  private live = true;
  private closing = false;
  private awaitingTasks = false;
  private queue: Promise<void> = Promise.resolve();
  /** A deferred reap armed when the background-task set drained to empty (#368). */
  private pendingReapTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    session: RuntimeSession,
    agent: string,
    reaper: SessionReaper,
    turnEndReapGraceMs = 0,
  ) {
    this.session = session;
    this.agent = agent;
    this.reaper = reaper;
    this.turnEndReapGraceMs = turnEndReapGraceMs;
  }

  handleSignal(signal: SessionLifecycleSignal): Promise<void> {
    if (!this.live) return Promise.resolve();

    // Learn the session id from the first signal that carries one.
    if (signal.sessionId && this.resolvedSessionId !== signal.sessionId) {
      if (this.resolvedSessionId) this.reaper.unregisterLive(this.resolvedSessionId);
      this.resolvedSessionId = signal.sessionId;
      this.reaper.registerLive(signal.sessionId, this);
    }

    const result = this.queue.then(() => this.reaper.processSignal(this, signal));
    // Keep the internal queue always-resolving: a single rejected signal must
    // never poison the chain (which would skip every future signal and strand
    // the session unreaped). processSignal already swallows its own errors; this
    // is belt-and-suspenders against an unexpected throw.
    this.queue = result.then(undefined, () => undefined);
    return result;
  }

  isLive(): boolean {
    return this.live;
  }

  sessionId(): string | undefined {
    return this.resolvedSessionId;
  }

  /** True while the session is idle and held open solely for background work. */
  isAwaitingTasks(): boolean {
    return this.awaitingTasks;
  }

  setAwaitingTasks(value: boolean): void {
    this.awaitingTasks = value;
  }

  /**
   * Arm a deferred reap that a subsequent `activity` (a re-invocation) — or new
   * background work, or an authoritative turn_end — can cancel. Re-arming resets
   * the window. See {@link SessionReaper.processSignal} and #368.
   */
  armPendingReap(graceMs: number, fire: () => void): void {
    this.cancelPendingReap();
    this.pendingReapTimer = setTimeout(() => {
      this.pendingReapTimer = undefined;
      fire();
    }, graceMs);
    // Don't let a pending grace reap single-handedly hold the process open on a
    // clean shutdown (e.g. FleetManager.stop draining the event loop) — the timer
    // still fires while other work keeps the loop alive.
    this.pendingReapTimer.unref?.();
  }

  /** Cancel a pending grace reap, if one is armed. */
  cancelPendingReap(): void {
    if (this.pendingReapTimer !== undefined) {
      clearTimeout(this.pendingReapTimer);
      this.pendingReapTimer = undefined;
    }
  }

  detach(): void {
    this.markDone();
  }

  /** Reap: mark not-live and close the session after the current hook unwinds. */
  scheduleClose(): void {
    if (this.closing) return;
    this.closing = true;
    this.markDone();
    // Defer so close()'s q.return() never runs inside the Stop hook that asked
    // for it (re-entering the SDK generator mid-hook can wedge teardown).
    setTimeout(() => {
      void this.session.close().catch(() => {
        // Already closed / never started — nothing to clean up.
      });
    }, 0);
  }

  private markDone(): void {
    this.live = false;
    this.cancelPendingReap();
    if (this.resolvedSessionId) this.reaper.unregisterLive(this.resolvedSessionId);
  }
}
