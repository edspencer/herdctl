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
import type { InjectedMcpServerDef } from "../runner/types.js";
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
  /**
   * In-process MCP servers to re-establish on the resumed turn.
   *
   * These are per-call runtime values (in-memory `createSdkMcpServer` handlers)
   * that the original human/consumer-driven turn supplied but that herdctl does
   * not persist. Without them, the resumed `claude` subprocess still lists the
   * injected `mcp__…__*` patterns in `--allowedTools` but has no server behind
   * them, so the tools vanish from the model's catalog for the whole autonomous
   * stretch (edspencer/herdctl#390). Populated by
   * {@link SessionLifecycleManagerOptions.resolveInjectedMcpServers} when a
   * consumer registers one; otherwise omitted (the pre-existing behavior).
   */
  injectedMcpServers?: Record<string, InjectedMcpServerDef>;
}

/**
 * Reconstructs the in-process injected MCP servers for a wake-fired turn.
 *
 * A consumer (e.g. Paddock) registers this so that when herdctl re-fires an idle
 * session's wake it can re-supply the same in-process `createSdkMcpServer`
 * servers the original turn had — keyed off the wake's agent + sessionId. This
 * keeps injection *policy* (depth/gating/builders) in the consumer while herdctl
 * owns the *wiring*. Returning `undefined` (or leaving it unregistered) preserves
 * the original no-injection wake behavior. See edspencer/herdctl#390.
 */
export type ResolveInjectedMcpServers = (
  entry: SessionWakeEntry,
) => Record<string, InjectedMcpServerDef> | undefined;

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
  /**
   * Consumer factory that re-supplies a wake's in-process injected MCP servers.
   * Called by `fire()` before opening the resumed session so its injected
   * `mcp__…__*` tools stay backed across autonomous wake turns
   * (edspencer/herdctl#390). Omit to preserve the pre-existing behavior (no
   * injection re-established on wakes).
   */
  resolveInjectedMcpServers?: ResolveInjectedMcpServers;
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
  private resolveInjectedMcpServers?: ResolveInjectedMcpServers;

  constructor(options: SessionLifecycleManagerOptions) {
    this.openChatSession = options.openChatSession;
    this.logger = options.logger ?? createLogger("session-lifecycle");
    this.sessionWakeHandler = options.sessionWakeHandler;
    this.resolveInjectedMcpServers = options.resolveInjectedMcpServers;

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
   * Register (or clear) the factory that re-supplies a wake's injected MCP
   * servers. Mirrors {@link setSessionWakeHandler}; see edspencer/herdctl#390.
   */
  setResolveInjectedMcpServers(resolve: ResolveInjectedMcpServers | undefined): void {
    this.resolveInjectedMcpServers = resolve;
  }

  /**
   * Resume the wake's session and inject its prompt, then either hand the live
   * session to the registered consumer or drain it to completion. The resumed
   * session is opened with `manageLifecycle`, so its own Stop hook re-captures
   * any new wakeups and reaps it when idle.
   */
  private async fire(entry: SessionWakeEntry): Promise<void> {
    // Re-establish the in-process injected MCP servers this session had, if a
    // consumer registered a resolver. herdctl doesn't persist these per-call
    // servers, so without this the resumed subprocess lists the injected
    // `mcp__…__*` patterns in `--allowedTools` but has nothing behind them and
    // the tools vanish for the whole autonomous stretch (edspencer/herdctl#390).
    let injectedMcpServers: Record<string, InjectedMcpServerDef> | undefined;
    try {
      injectedMcpServers = this.resolveInjectedMcpServers?.(entry);
    } catch (error) {
      // A resolver throw must not wedge the wake — fire without injection, as a
      // consumer that registered none would.
      this.logger.warn(
        `resolveInjectedMcpServers threw for ${entry.agent} (${entry.sessionId}): ${(error as Error).message}`,
      );
    }

    const session = await this.openChatSession(entry.agent, {
      resume: entry.sessionId,
      prompt: entry.prompt,
      manageLifecycle: true,
      injectedMcpServers,
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
