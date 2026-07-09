/**
 * Ties a live streaming session to the reap decision.
 *
 * A managed session forwards its turn-boundary {@link SessionLifecycleSignal}s
 * here (via `RuntimeExecuteOptions.onLifecycleSignal`, wired in the SDK runtime).
 * On each signal the reaper (1) reconciles the session's pending crons into the
 * {@link WakeRegistry} so they survive the reap, then (2) applies the one-rule
 * {@link decideReap} policy: keep the process alive while continuous-class
 * background work runs, otherwise close it immediately.
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
}

/** A handle to a session the reaper is managing. */
export interface ManagedSession {
  /**
   * Feed a turn-boundary signal to the reaper. Wire into
   * `RuntimeExecuteOptions.onLifecycleSignal`. Returns a promise the caller may
   * await (the Stop hook does) so reconciliation completes before the turn fully
   * unwinds; the actual `close()` is deferred so it never re-enters the hook.
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

  /** Live managed sessions by resolved session id. */
  private readonly liveById = new Map<string, ManagedSessionImpl>();

  constructor(options: SessionReaperOptions) {
    this.registry = options.registry;
    this.logger = options.logger ?? createLogger("session-reaper");
    this.onReap = options.onReap;
    this.onKeepAlive = options.onKeepAlive;
  }

  /** Begin managing a session's lifecycle. */
  manage(session: RuntimeSession, agent: string): ManagedSession {
    const managed = new ManagedSessionImpl(session, agent, this);
    return managed;
  }

  /** True while any managed session with this id is open. Used by the registry. */
  isSessionLive(sessionId: string): boolean {
    return this.liveById.has(sessionId);
  }

  // --- internal, called by ManagedSessionImpl ---

  registerLive(sessionId: string, managed: ManagedSessionImpl): void {
    this.liveById.set(sessionId, managed);
  }

  unregisterLive(sessionId: string): void {
    this.liveById.delete(sessionId);
  }

  async processSignal(managed: ManagedSessionImpl, signal: SessionLifecycleSignal): Promise<void> {
    // A new turn is producing output — the session is no longer idle-waiting, so
    // a later background_tasks_changed must not reap it out from under a live turn.
    if (signal.kind === "activity") {
      managed.setAwaitingTasks(false);
      return;
    }

    // Mid-session task-set change: only meaningful while the session is idle and
    // was being kept alive purely for background work. Do NOT reconcile crons —
    // this event doesn't report session_crons (dropping stale ones would delete
    // the pending wakeups).
    if (signal.kind === "background_tasks_changed") {
      if (managed.isAwaitingTasks() && signal.backgroundTasks.length === 0) {
        this.reap(managed, signal.sessionId);
      }
      return;
    }

    // turn_end: authoritative snapshot. Capture pending crons first so they
    // survive whatever we decide next.
    await this.registry.reconcile(managed.agent, signal.sessionId, signal.sessionCrons);

    const decision = decideReap(signal);
    if (decision.action === "keepAlive") {
      this.logger.debug(
        `Keeping session ${signal.sessionId} (${managed.agent}) alive: ${decision.tasks.length} background task(s)`,
      );
      managed.setAwaitingTasks(true);
      this.onKeepAlive?.({
        agent: managed.agent,
        sessionId: signal.sessionId,
        tasks: decision.tasks,
      });
      return;
    }

    this.reap(managed, signal.sessionId);
  }

  private reap(managed: ManagedSessionImpl, sessionId: string): void {
    if (!managed.isLive()) return;
    this.logger.info(`Reaping idle session ${sessionId} (${managed.agent})`);
    this.onReap?.({ agent: managed.agent, sessionId });
    managed.scheduleClose();
  }
}

/**
 * Per-session state. Serializes signals through a promise chain so a
 * `background_tasks_changed` re-check can't interleave with a Stop reconcile,
 * and defers `close()` out of the hook that requested it.
 */
class ManagedSessionImpl implements ManagedSession {
  readonly agent: string;
  private readonly session: RuntimeSession;
  private readonly reaper: SessionReaper;
  private resolvedSessionId: string | undefined;
  private live = true;
  private closing = false;
  private awaitingTasks = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(session: RuntimeSession, agent: string, reaper: SessionReaper) {
    this.session = session;
    this.agent = agent;
    this.reaper = reaper;
  }

  handleSignal(signal: SessionLifecycleSignal): Promise<void> {
    if (!this.live) return Promise.resolve();

    // Learn the session id from the first signal that carries one.
    if (signal.sessionId && this.resolvedSessionId !== signal.sessionId) {
      if (this.resolvedSessionId) this.reaper.unregisterLive(this.resolvedSessionId);
      this.resolvedSessionId = signal.sessionId;
      this.reaper.registerLive(signal.sessionId, this);
    }

    this.queue = this.queue.then(() => this.reaper.processSignal(this, signal));
    return this.queue;
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
    if (this.resolvedSessionId) this.reaper.unregisterLive(this.resolvedSessionId);
  }
}
