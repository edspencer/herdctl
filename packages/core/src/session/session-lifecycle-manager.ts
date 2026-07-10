/**
 * The integration facade that wires the session reaper + wake registry to a
 * fleet's `openChatSession` and scheduler loop.
 *
 * FleetManager constructs one of these, passes `dispatchDue` as the scheduler's
 * `onTick`, and lets `JobControl.openChatSession` register managed sessions via
 * {@link manage}. All the moving parts (persistence, cron resolution, the
 * resume-and-inject fire path) are assembled here so FleetManager only holds a
 * single reference. See edspencer/herdctl#307 (part 2).
 */

import type { RuntimeSession } from "../runner/runtime/interface.js";
import { calculateNextCronTrigger } from "../scheduler/cron.js";
import { createLogger } from "../utils/logger.js";
import { FleetStateWakePersistence } from "./fleet-state-wake-persistence.js";
import { type ManagedSession, SessionReaper } from "./session-reaper.js";
import type { BackgroundTaskSummary, SessionWakeEntry } from "./types.js";
import { WakeRegistry } from "./wake-registry.js";
import type { NextRunResolver } from "./wake-store.js";

type Logger = ReturnType<typeof createLogger>;

/** Options a fired wake passes to `openChatSession` to resume-and-inject. */
export interface SessionWakeChatOptions {
  resume: string;
  prompt: string;
  manageLifecycle: true;
}

/**
 * Drives the woken turn. If a consumer (e.g. Paddock) registers one, it receives
 * the resumed, already-managed session and is responsible for consuming it;
 * otherwise the manager drains it headlessly so recurring wakes keep firing.
 */
export type SessionWakeHandler = (
  session: RuntimeSession,
  entry: SessionWakeEntry,
) => void | Promise<void>;

export interface SessionLifecycleManagerOptions {
  /** State directory (`.herdctl`) backing the durable wake set. */
  stateDir: string;
  /**
   * Opens (resumes) a managed chat session and injects the wake's prompt. Wired
   * to `FleetManager.openChatSession`; must set `manageLifecycle: true` so the
   * resumed turn is itself reaped and its crons re-captured.
   */
  openChatSession: (agent: string, options: SessionWakeChatOptions) => Promise<RuntimeSession>;
  /** Max concurrent wake fires per tick (gap 2). */
  concurrency?: number;
  /** Override the cron resolver (defaults to `scheduler/cron.ts`, host-local tz). */
  resolveNextRun?: NextRunResolver;
  /** Consumer hook for delivering the woken turn (attribution/hub path). */
  sessionWakeHandler?: SessionWakeHandler;
  logger?: Logger;
  onReap?: (info: { agent: string; sessionId: string }) => void;
  onKeepAlive?: (info: {
    agent: string;
    sessionId: string;
    tasks: BackgroundTaskSummary[];
  }) => void;
}

/**
 * Default cron resolver for session-only wakes.
 *
 * The SDK/native harness serializes a relative one-shot `ScheduleWakeup` (and
 * `CronCreate` schedules) as a wall-clock cron expression in the **host's local
 * timezone** — e.g. a "+60s" wake at 19:08 local becomes `"10 19 * * *"`. So the
 * cron must be resolved back in that same local timezone, not UTC: resolving
 * `"10 19 * * *"` as UTC while the host is behind UTC rolls `nextRunAt` to
 * tomorrow, and the wake silently sits idle for ~24h (edspencer/herdctl#311).
 *
 * `calculateNextCronTrigger` resolves in the host's system timezone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`), which is exactly the
 * timezone the harness serialized the cron in — and matches how the rest of the
 * scheduler (`scheduler.ts`, `schedule-runner.ts`) resolves fleet crons.
 */
export function defaultResolveNextRun(schedule: string, from: Date): Date {
  return calculateNextCronTrigger(schedule, from);
}

export class SessionLifecycleManager {
  readonly registry: WakeRegistry;
  readonly reaper: SessionReaper;

  private readonly openChatSession: (
    agent: string,
    options: SessionWakeChatOptions,
  ) => Promise<RuntimeSession>;
  private readonly logger: Logger;
  private sessionWakeHandler?: SessionWakeHandler;

  constructor(options: SessionLifecycleManagerOptions) {
    this.openChatSession = options.openChatSession;
    this.logger = options.logger ?? createLogger("session-lifecycle");
    this.sessionWakeHandler = options.sessionWakeHandler;

    // The registry needs `isSessionLive` from the reaper, and the reaper needs
    // the registry — build the registry first with a late-bound reference.
    this.registry = new WakeRegistry({
      persistence: new FleetStateWakePersistence({ stateDir: options.stateDir }),
      resolveNextRun: options.resolveNextRun ?? defaultResolveNextRun,
      fire: (entry) => this.fire(entry),
      isSessionLive: (id) => this.reaper.isSessionLive(id),
      concurrency: options.concurrency,
      logger: this.logger,
    });
    this.reaper = new SessionReaper({
      registry: this.registry,
      logger: this.logger,
      onReap: options.onReap,
      onKeepAlive: options.onKeepAlive,
    });
  }

  /** Begin managing a freshly-opened streaming session's lifecycle. */
  manage(session: RuntimeSession, agent: string): ManagedSession {
    return this.reaper.manage(session, agent);
  }

  /** Fire every wake now due. Wire as the scheduler's `onTick`. */
  dispatchDue(now: Date = new Date()): Promise<SessionWakeEntry[]> {
    return this.registry.dispatchDue(now);
  }

  /** Register the consumer that drives woken turns (else they run headless). */
  setSessionWakeHandler(handler: SessionWakeHandler | undefined): void {
    this.sessionWakeHandler = handler;
  }

  /**
   * Resume the wake's session and inject its prompt, then either hand the live
   * session to the registered consumer or drain it to completion. The resumed
   * session is opened with `manageLifecycle`, so its own Stop hook re-captures
   * any new wakeups and reaps it when idle.
   */
  private async fire(entry: SessionWakeEntry): Promise<void> {
    const session = await this.openChatSession(entry.agent, {
      resume: entry.sessionId,
      prompt: entry.prompt,
      manageLifecycle: true,
    });

    if (this.sessionWakeHandler) {
      await this.sessionWakeHandler(session, entry);
      return;
    }

    // Headless: consume the stream so the turn actually runs. The reaper closes
    // the session when the turn goes idle, which ends this iteration.
    for await (const _message of session.messages) {
      // Drain — output delivery is the consumer's job when a handler is set.
    }
  }
}
