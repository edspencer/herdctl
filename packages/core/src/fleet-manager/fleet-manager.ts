/**
 * FleetManager - High-level orchestration layer for autonomous agents
 *
 * The FleetManager class provides a simple interface for library consumers
 * to initialize and run agent fleets. It coordinates between:
 * - Configuration loading and validation
 * - State directory management
 * - Scheduler setup and lifecycle
 * - Event emission for monitoring
 *
 * @module fleet-manager
 */

import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type AgentConfig,
  ConfigError,
  ConfigNotFoundError,
  loadConfig,
  type ResolvedAgent,
  type ResolvedConfig,
  type Schedule,
} from "../config/index.js";
import type { RuntimeSession, SlashCommand } from "../runner/index.js";
import { getCliSessionFile, getDockerSessionFile } from "../runner/runtime/cli-session-path.js";
import { Scheduler, type TriggerInfo } from "../scheduler/index.js";
import {
  type ResolveInjectedMcpServers,
  SessionLifecycleManager,
  type SessionWakeHandler,
} from "../session/index.js";
import {
  type ChatMessage,
  type DiscoveredSession,
  initStateDirectory,
  SessionDiscoveryService,
  SessionMetadataStore,
  type SessionUsage,
  type StateDirectory,
} from "../state/index.js";
import { createLogger } from "../utils/logger.js";
import { type AddAgentOptions, AgentManagement } from "./agent-management.js";
import type { IChatManager } from "./chat-manager-interface.js";
import { ConfigReload, computeConfigChanges } from "./config-reload.js";
import type { FleetManagerContext } from "./context.js";
import {
  AgentNotFoundError,
  ConfigurationError,
  FleetManagerShutdownError,
  FleetManagerStateDirError,
  InvalidStateError,
} from "./errors.js";
import { emitAgentStarted, emitAgentStopped } from "./event-emitters.js";
import { JobControl } from "./job-control.js";
import { LogStreaming } from "./log-streaming.js";
import { ScheduleExecutor } from "./schedule-executor.js";
import { ScheduleManagement } from "./schedule-management.js";
// Module classes
import { StatusQueries } from "./status-queries.js";
import type {
  AgentInfo,
  CancelJobResult,
  ChatSessionOptions,
  ConfigChange,
  ConfigReloadedPayload,
  FleetConfigOverrides,
  FleetManagerLogger,
  FleetManagerOptions,
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerStopOptions,
  FleetStatus,
  ForkJobResult,
  JobModifications,
  LogEntry,
  LogStreamOptions,
  ScheduleInfo,
  ScheduleTriggerHandler,
  TriggerOptions,
  TriggerResult,
} from "./types.js";
import { resolveWorkingDirectory } from "./working-directory-helper.js";

const DEFAULT_CHECK_INTERVAL = 1000;

function createDefaultLogger(): FleetManagerLogger {
  return createLogger("fleet-manager");
}

/**
 * FleetManager provides high-level orchestration for autonomous agents
 *
 * Implements FleetManagerContext to provide clean access to internal state
 * for composed module classes.
 */
export class FleetManager extends EventEmitter implements FleetManagerContext {
  // Configuration
  private readonly configPath?: string;
  private readonly stateDir: string;
  private readonly logger: FleetManagerLogger;
  private readonly checkInterval: number;
  private readonly configOverrides?: FleetConfigOverrides;
  private readonly allowScheduleMutation: boolean;

  // Internal state
  private status: FleetManagerStatus = "uninitialized";
  private config: ResolvedConfig | null = null;
  private stateDirInfo: StateDirectory | null = null;
  private scheduler: Scheduler | null = null;
  private sessionLifecycle: SessionLifecycleManager | null = null;
  private sessionWakeHandler?: SessionWakeHandler;
  private resolveInjectedMcpServers?: ResolveInjectedMcpServers;
  private scheduleTriggerHandler?: ScheduleTriggerHandler;

  // Timing info
  private initializedAt: string | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastError: string | null = null;

  // Module class instances
  private statusQueries!: StatusQueries;
  private scheduleManagement!: ScheduleManagement;
  private configReloadModule!: ConfigReload;
  private agentManagement!: AgentManagement;
  private jobControl!: JobControl;
  private logStreaming!: LogStreaming;
  private scheduleExecutor!: ScheduleExecutor;

  // Lazily-created session discovery service (for getAgentSessions/* helpers)
  private sessionDiscovery: SessionDiscoveryService | null = null;

  // Lazily-created session metadata store, shared with sessionDiscovery so a
  // setSessionName() write is reflected by a subsequent getAgentSessions()
  // without a stale in-memory cache.
  private sessionMetadataStore: SessionMetadataStore | null = null;

  // Chat managers (Discord, Slack, etc.)
  // Key is platform name (e.g., "discord", "slack")
  private chatManagers: Map<string, IChatManager> = new Map();

  // In-memory registry of currently-running jobs → their AbortController, keyed
  // by job id. Shared across JobControl (manual triggers) and ScheduleExecutor
  // (scheduled jobs) so shutdown's bulk-cancel can interrupt BOTH kinds of
  // in-flight job. Keyed by id → concurrency-safe when max_concurrent > 1.
  // See edspencer/herdctl#324.
  private readonly runningJobControllers: Map<string, AbortController> = new Map();

  constructor(options: FleetManagerOptions) {
    super();
    this.configPath = options.configPath;
    this.stateDir = resolve(options.stateDir);
    this.logger = options.logger ?? createDefaultLogger();
    this.checkInterval = options.checkInterval ?? DEFAULT_CHECK_INTERVAL;
    this.configOverrides = options.configOverrides;
    this.allowScheduleMutation = options.allowScheduleMutation ?? false;

    // Initialize modules in constructor so they work before initialize() is called
    this.initializeModules();
  }

  // ===========================================================================
  // FleetManagerContext Implementation
  // ===========================================================================

  getConfig(): ResolvedConfig | null {
    return this.config;
  }
  getStateDir(): string {
    return this.stateDir;
  }
  getStateDirInfo(): StateDirectory | null {
    return this.stateDirInfo;
  }
  getLogger(): FleetManagerLogger {
    return this.logger;
  }
  getScheduler(): Scheduler | null {
    return this.scheduler;
  }
  getSessionLifecycle(): SessionLifecycleManager | null {
    return this.sessionLifecycle;
  }
  registerJob(jobId: string, controller: AbortController): void {
    this.runningJobControllers.set(jobId, controller);
  }
  unregisterJob(jobId: string): void {
    this.runningJobControllers.delete(jobId);
  }
  getJobController(jobId: string): AbortController | undefined {
    return this.runningJobControllers.get(jobId);
  }
  getRunningJobIds(): string[] {
    return Array.from(this.runningJobControllers.keys());
  }
  getStatus(): FleetManagerStatus {
    return this.status;
  }
  getInitializedAt(): string | null {
    return this.initializedAt;
  }
  getStartedAt(): string | null {
    return this.startedAt;
  }
  getStoppedAt(): string | null {
    return this.stoppedAt;
  }
  getLastError(): string | null {
    return this.lastError;
  }
  getCheckInterval(): number {
    return this.checkInterval;
  }
  getEmitter(): EventEmitter {
    return this;
  }

  /**
   * Get a chat manager by platform name
   */
  getChatManager(platform: string): IChatManager | undefined {
    return this.chatManagers.get(platform);
  }

  /**
   * Get all registered chat managers
   */
  getChatManagers(): Map<string, IChatManager> {
    return this.chatManagers;
  }

  // ===========================================================================
  // Public State Accessors
  // ===========================================================================

  get state(): FleetManagerState {
    return {
      status: this.status,
      initializedAt: this.initializedAt,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      agentCount: this.config?.agents.length ?? 0,
      lastError: this.lastError,
    };
  }

  getAgents(): ResolvedAgent[] {
    return this.config?.agents ?? [];
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize FleetManager in web-only mode without a configuration file
   *
   * Creates a minimal config with zero agents and web enabled, allowing
   * the web dashboard to serve session data from ~/.claude/ without
   * requiring a herdctl.yaml fleet configuration.
   *
   * @param options - Optional overrides for the minimal web config
   */
  async initializeWebOnly(options?: { port?: number; host?: string }): Promise<void> {
    if (this.status !== "uninitialized" && this.status !== "stopped" && this.status !== "error") {
      throw new InvalidStateError("initializeWebOnly", this.status, [
        "uninitialized",
        "stopped",
        "error",
      ]);
    }

    this.logger.debug("Initializing fleet manager in web-only mode...");

    try {
      // Build a minimal ResolvedConfig with web enabled and zero agents
      this.config = {
        fleet: {
          version: 1,
          fleet: { name: "herdctl" },
          agents: [],
          fleets: [],
          web: {
            enabled: true,
            port: options?.port ?? 3232,
            host: options?.host ?? "localhost",
            session_expiry_hours: 24,
            open_browser: false,
            tool_results: true,
            message_grouping: "separate",
          },
        },
        agents: [],
        configPath: "",
        configDir: process.cwd(),
      };

      // Apply any CLI config overrides (e.g., --web-port)
      if (this.configOverrides) {
        this.config = this.applyConfigOverrides(this.config);
      }

      this.stateDirInfo = await this.initializeStateDir();
      this.logger.debug("State directory initialized");

      this.sessionLifecycle = this.createSessionLifecycle();
      this.scheduler = new Scheduler({
        stateDir: this.stateDir,
        checkInterval: this.checkInterval,
        logger: this.logger,
        onTrigger: (info) => this.handleScheduleTrigger(info),
        // Reuse the scheduler loop to fire due session wakes (#307).
        onTick: async () => {
          await this.sessionLifecycle?.dispatchDue();
        },
      });

      // Initialize chat managers (web will be picked up since config.fleet.web.enabled = true)
      await this.initializeChatManagers();

      await Promise.allSettled(
        Array.from(this.chatManagers.entries()).map(async ([platform, manager]) => {
          this.logger.debug(`Initializing ${platform} chat manager...`);
          try {
            await manager.initialize();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to initialize ${platform} chat manager: ${errorMessage}`);
            this.chatManagers.delete(platform);
          }
        }),
      );

      this.status = "initialized";
      this.initializedAt = new Date().toISOString();
      this.lastError = null;

      this.logger.info("Fleet manager initialized in web-only mode");
      this.emit("initialized");
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (this.status !== "uninitialized" && this.status !== "stopped") {
      throw new InvalidStateError("initialize", this.status, ["uninitialized", "stopped"]);
    }

    this.logger.debug("Initializing fleet manager...");

    try {
      this.config = await this.loadConfiguration();
      this.logger.debug(`Loaded ${this.config.agents.length} agent(s) from config`);

      // Validate agent names are unique
      this.validateUniqueAgentNames(this.config.agents);

      this.stateDirInfo = await this.initializeStateDir();
      this.logger.debug("State directory initialized");

      this.sessionLifecycle = this.createSessionLifecycle();
      this.scheduler = new Scheduler({
        stateDir: this.stateDir,
        checkInterval: this.checkInterval,
        logger: this.logger,
        onTrigger: (info) => this.handleScheduleTrigger(info),
        // Reuse the scheduler loop to fire due session wakes (#307).
        onTick: async () => {
          await this.sessionLifecycle?.dispatchDue();
        },
      });

      // Dynamically import and create chat managers for configured platforms
      await this.initializeChatManagers();

      // Initialize all chat managers in parallel — platforms are independent
      // and shouldn't block each other during startup
      await Promise.allSettled(
        Array.from(this.chatManagers.entries()).map(async ([platform, manager]) => {
          this.logger.debug(`Initializing ${platform} chat manager...`);
          try {
            await manager.initialize();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to initialize ${platform} chat manager: ${errorMessage}`);
            // Remove failed manager so start() won't attempt to start it
            this.chatManagers.delete(platform);
          }
        }),
      );

      this.status = "initialized";
      this.initializedAt = new Date().toISOString();
      this.lastError = null;

      this.logger.info("Fleet manager initialized successfully");
      this.emit("initialized");
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.status !== "initialized") {
      throw new InvalidStateError("start", this.status, "initialized");
    }

    this.logger.debug("Starting fleet manager...");
    this.status = "starting";

    try {
      this.startSchedulerAsync(this.config!.agents);

      // Start all chat managers in parallel — platforms are independent
      // and shouldn't block each other (e.g. slow Slack connect shouldn't delay web server)
      await Promise.allSettled(
        Array.from(this.chatManagers.entries()).map(async ([platform, manager]) => {
          this.logger.debug(`Starting ${platform} chat manager...`);
          try {
            await manager.start();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to start ${platform} chat manager: ${errorMessage}`);
            // A single platform failure should not prevent the fleet from running
          }
        }),
      );

      this.status = "running";
      this.startedAt = new Date().toISOString();
      this.stoppedAt = null;

      this.logger.info("Fleet manager started");
      this.emit("started");

      // Announce each configured agent as started now that the scheduler is
      // monitoring its schedules and chat managers (event subscribers) are up.
      const startTimestamp = new Date().toISOString();
      for (const agent of this.config?.agents ?? []) {
        emitAgentStarted(this, { agent, timestamp: startTimestamp });
      }
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async stop(options?: FleetManagerStopOptions): Promise<void> {
    if (this.status !== "running" && this.status !== "starting") {
      this.logger.debug(`Stop called but status is '${this.status}', ignoring`);
      return;
    }

    const {
      waitForJobs = true,
      timeout = 30000,
      cancelOnTimeout = false,
      cancelTimeout = 10000,
    } = options ?? {};

    this.logger.info("Stopping fleet manager...");
    this.status = "stopping";

    try {
      // Stop all chat managers first (graceful disconnect)
      for (const [platform, manager] of this.chatManagers) {
        this.logger.debug(`Stopping ${platform} chat manager...`);
        try {
          await manager.stop();
        } catch (error) {
          this.logger.error(
            `Failed to stop ${platform} chat manager: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (this.scheduler) {
        try {
          await this.scheduler.stop({ waitForJobs, timeout });
        } catch (error) {
          if (error instanceof Error && error.name === "SchedulerShutdownError") {
            if (cancelOnTimeout) {
              this.logger.info("Timeout reached, cancelling running jobs...");
              await this.jobControl.cancelRunningJobs(cancelTimeout);
            } else {
              this.status = "error";
              this.lastError = error.message;
              throw new FleetManagerShutdownError(error.message, { timedOut: true, cause: error });
            }
          } else {
            throw error;
          }
        }
      }

      await this.persistShutdownState();
      this.status = "stopped";
      this.stoppedAt = new Date().toISOString();

      // Announce each configured agent as stopped — the scheduler is no longer
      // monitoring its schedules.
      const stopTimestamp = new Date().toISOString();
      for (const agent of this.config?.agents ?? []) {
        emitAgentStopped(this, {
          agentName: agent.qualifiedName,
          timestamp: stopTimestamp,
          reason: "shutdown",
        });
      }

      this.logger.info("Fleet manager stopped");
      this.emit("stopped");
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  // ===========================================================================
  // Public API - One-liner delegations to module classes
  // ===========================================================================

  // Status Queries
  async getFleetStatus(): Promise<FleetStatus> {
    return this.statusQueries.getFleetStatus();
  }
  async getAgentInfo(): Promise<AgentInfo[]> {
    return this.statusQueries.getAgentInfo();
  }
  async getAgentInfoByName(name: string): Promise<AgentInfo> {
    return this.statusQueries.getAgentInfoByName(name);
  }

  // Schedule Management
  async getSchedules(): Promise<ScheduleInfo[]> {
    return this.scheduleManagement.getSchedules();
  }
  async getSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    return this.scheduleManagement.getSchedule(agentName, scheduleName);
  }
  async enableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    return this.scheduleManagement.enableSchedule(agentName, scheduleName);
  }
  async disableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    return this.scheduleManagement.disableSchedule(agentName, scheduleName);
  }

  /**
   * Add or replace a single schedule on an existing agent at runtime.
   *
   * The programmatic counterpart to editing an agent's `schedules` in
   * `herdctl.yaml` and calling `reload()`, for one schedule. The definition is
   * validated against `ScheduleSchema`, set on the stored agent, and re-pushed to
   * the scheduler so it is immediately eligible to fire — no whole-agent
   * `addAgent(replace)` (which leaves stale state) needed. Gated behind the
   * `allowScheduleMutation` deployment option (edspencer/herdctl#376).
   *
   * @param agentName - Qualified or local name of an existing agent
   * @param scheduleName - The schedule key to set
   * @param schedule - The schedule definition
   * @throws {ScheduleMutationDisabledError} If `allowScheduleMutation` is not set
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ConfigurationError} If the schedule fails validation
   */
  async setAgentSchedule(
    agentName: string,
    scheduleName: string,
    schedule: Schedule | Record<string, unknown>,
  ): Promise<ScheduleInfo> {
    return this.scheduleManagement.setAgentSchedule(agentName, scheduleName, schedule);
  }

  /**
   * Remove a single schedule from an agent at runtime.
   *
   * Deletes the schedule from the stored agent and the scheduler, prunes its
   * persisted state (so a re-added name doesn't inherit stale `last_run_at` /
   * `disabled` status), and clears the scheduler's in-memory tracking for it.
   * Gated behind the `allowScheduleMutation` deployment option
   * (edspencer/herdctl#376).
   *
   * @param agentName - Qualified or local name of an existing agent
   * @param scheduleName - The schedule key to remove
   * @returns `true` if a schedule was removed, `false` if there was none to remove
   * @throws {ScheduleMutationDisabledError} If `allowScheduleMutation` is not set
   * @throws {AgentNotFoundError} If the agent doesn't exist
   */
  async removeAgentSchedule(agentName: string, scheduleName: string): Promise<boolean> {
    return this.scheduleManagement.removeAgentSchedule(agentName, scheduleName);
  }

  // Config Reload
  async reload(): Promise<ConfigReloadedPayload> {
    return this.configReloadModule.reload();
  }
  computeConfigChanges(
    oldConfig: ResolvedConfig | null,
    newConfig: ResolvedConfig,
  ): ConfigChange[] {
    return computeConfigChanges(oldConfig, newConfig);
  }

  // Programmatic Agent Management

  /**
   * Register an agent at runtime without writing YAML or calling `reload()`.
   *
   * The config is validated, merged with fleet defaults, normalized (working
   * directory resolved to an absolute path), and wired into the running fleet
   * so it is immediately triggerable and appears in fleet status. A
   * `config:reloaded` event is emitted describing the change.
   *
   * This is the programmatic counterpart to editing `herdctl.yaml` and calling
   * `reload()` — useful for apps that manage agents in memory rather than on
   * disk.
   *
   * @param agent - The agent configuration to register (must include `name`)
   * @param options - Resolution options (base dir, defaults merge, replace)
   * @returns Info for the newly registered agent
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {ConfigurationError} If validation fails or the name collides
   *
   * @example
   * ```typescript
   * await fleet.addAgent({
   *   name: "keeper-myproject",
   *   working_directory: "/abs/projects/myproject",
   *   runtime: "cli",
   *   permission_mode: "acceptEdits",
   * });
   * await fleet.trigger("keeper-myproject", undefined, { prompt: "Hello" });
   * ```
   */
  async addAgent(
    agent: AgentConfig | (Record<string, unknown> & { name: string }),
    options?: AddAgentOptions,
  ): Promise<AgentInfo> {
    return this.agentManagement.addAgent(agent, options);
  }

  /**
   * Unregister an agent at runtime.
   *
   * Removes the agent from the in-memory config and the scheduler. Accepts a
   * qualified name or a local name. Running jobs are unaffected.
   *
   * @param name - The agent qualified name or local name to remove
   * @returns `true` if an agent was removed, `false` if no match was found
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   */
  async removeAgent(name: string): Promise<boolean> {
    return this.agentManagement.removeAgent(name);
  }

  // Session Access (convenience wrappers over SessionDiscoveryService)

  /**
   * List discovered Claude Code sessions for an agent.
   *
   * Derives the agent's working directory and Docker mode from the loaded
   * config, so consumers don't have to map agent → working directory by hand.
   * Sessions are returned sorted by modification time (newest first).
   *
   * Note: sessions are keyed by working directory. This method uses the agent's
   * *configured* `working_directory`. If you triggered the agent with a
   * per-trigger `workingDirectory` override (see {@link TriggerOptions}), the
   * resulting sessions live under that override directory and will NOT appear
   * here — list them by scanning that directory instead (e.g. the directory
   * grouped `getAllSessions` view on the underlying `SessionDiscoveryService`).
   *
   * @param name - The agent qualified name or local name
   * @param options - Optional `limit` for top-N enrichment
   * @returns Array of discovered sessions (empty if the agent has no working
   *   directory or no sessions yet)
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async getAgentSessions(name: string, options?: { limit?: number }): Promise<DiscoveredSession[]> {
    const { agent, workingDirectory, dockerEnabled } = this.resolveAgentForSessions(
      name,
      "getAgentSessions",
    );
    if (!workingDirectory) {
      return [];
    }
    return this.getSessionDiscovery().getAgentSessions(
      agent.qualifiedName,
      workingDirectory,
      dockerEnabled,
      options,
    );
  }

  /**
   * Resolve an agent's configured working directory to an absolute path.
   *
   * Normalizes the `working_directory` config (string or `{ root }`) the same
   * way session access does, so consumers (e.g. the web dashboard's file-
   * serving route) can map an agent name to its on-disk working directory
   * without reaching into config internals.
   *
   * @param name - The agent qualified name or local name
   * @returns The absolute working directory, or `undefined` if the agent has
   *   none configured
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  getAgentWorkingDirectory(name: string): string | undefined {
    const { workingDirectory } = this.resolveAgentForSessions(name, "getAgentWorkingDirectory");
    return workingDirectory;
  }

  /**
   * Get the parsed chat messages for one of an agent's sessions.
   *
   * Derives the working directory and Docker mode from the loaded config.
   *
   * @param name - The agent qualified name or local name
   * @param sessionId - The session ID to read
   * @returns Array of chat messages (empty if the agent has no working directory)
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async getAgentSessionMessages(name: string, sessionId: string): Promise<ChatMessage[]> {
    const { workingDirectory, dockerEnabled } = this.resolveAgentForSessions(
      name,
      "getAgentSessionMessages",
    );
    if (!workingDirectory) {
      return [];
    }
    return this.getSessionDiscovery().getSessionMessages(workingDirectory, sessionId, {
      dockerEnabled,
    });
  }

  /**
   * Get token-usage data for one of an agent's sessions.
   *
   * Reads the session transcript and returns the most recent context-window
   * fill level (last assistant turn's input + cache tokens) plus a turn count.
   * Lets a UI show "context used" for a chat loaded from history — before any
   * new turn streams a fresh `usage` value. Derives the working directory and
   * Docker mode from the loaded config.
   *
   * @param name - The agent qualified name or local name
   * @param sessionId - The session ID to read
   * @returns Session usage (`hasData: false` if the agent has no working
   *   directory or the transcript has no usage data)
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async getAgentSessionUsage(name: string, sessionId: string): Promise<SessionUsage> {
    const { workingDirectory, dockerEnabled } = this.resolveAgentForSessions(
      name,
      "getAgentSessionUsage",
    );
    if (!workingDirectory) {
      return { inputTokens: 0, turnCount: 0, hasData: false };
    }
    return this.getSessionDiscovery().getSessionUsage(workingDirectory, sessionId, {
      dockerEnabled,
      // Enables the persistent, mtime-keyed usage cache so a chat list doesn't
      // re-stream every transcript on each read.
      agentName: name,
    });
  }

  /**
   * Delete one of an agent's Claude Code session transcripts from disk.
   *
   * Resolves the agent's working directory and Docker mode from the loaded
   * config, computes the CLI (or Docker) transcript file path with the same
   * encoder Claude Code uses, deletes it, and invalidates the session-discovery
   * cache so a subsequent {@link getAgentSessions} no longer lists it.
   *
   * The `sessionId` is validated (only `[A-Za-z0-9-]` is allowed) to prevent
   * path traversal before any filesystem access.
   *
   * @param name - The agent qualified name or local name
   * @param sessionId - The session ID whose transcript should be removed
   * @returns `true` if a file was removed, `false` if no transcript existed (or
   *   the agent has no working directory)
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   * @throws {Error} If `sessionId` contains invalid characters
   */
  async deleteSession(name: string, sessionId: string): Promise<boolean> {
    const { workingDirectory, dockerEnabled } = this.resolveAgentForSessions(name, "deleteSession");
    if (!workingDirectory) {
      return false;
    }

    // Compute the transcript path. getCliSessionFile/getDockerSessionFile both
    // reject a sessionId containing anything other than [A-Za-z0-9-], so this
    // throws before touching the filesystem when traversal is attempted.
    const sessionFile = dockerEnabled
      ? getDockerSessionFile(this.stateDir, sessionId)
      : getCliSessionFile(workingDirectory, sessionId);

    let removed: boolean;
    try {
      await rm(sessionFile);
      removed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // No transcript on disk — nothing to remove.
        removed = false;
      } else {
        throw error;
      }
    }

    // Invalidate the discovery cache so the deleted session disappears from
    // subsequent listings even within the cache TTL window.
    this.getSessionDiscovery().invalidateCache(workingDirectory, { dockerEnabled });

    this.logger.debug(
      `deleteSession: ${removed ? "removed" : "no file for"} session "${sessionId}" of agent "${name}"`,
    );
    return removed;
  }

  /**
   * Set (or clear) the custom display name for one of an agent's sessions.
   *
   * Writes through this fleet's shared {@link SessionMetadataStore} — the same
   * store the session-discovery service reads — so a subsequent
   * {@link getAgentSessions} reflects the new `customName` immediately. Passing
   * `null` or an empty/whitespace string clears any existing custom name.
   *
   * @param name - The agent qualified name or local name
   * @param sessionId - The session ID to (re)name
   * @param customName - The custom name to set, or `null`/empty to clear it
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  async setSessionName(name: string, sessionId: string, customName: string | null): Promise<void> {
    // Resolve to validate state + agent existence and to key metadata by the
    // agent's qualified name (consistent with how discovery stores custom names).
    const { agent } = this.resolveAgentForSessions(name, "setSessionName");

    const store = this.getSessionMetadataStore();
    const trimmed = customName?.trim();
    if (trimmed) {
      await store.setCustomName(agent.qualifiedName, sessionId, trimmed);
      this.logger.debug(
        `setSessionName: set custom name for session "${sessionId}" of agent "${agent.qualifiedName}"`,
      );
    } else {
      await store.removeCustomName(agent.qualifiedName, sessionId);
      this.logger.debug(
        `setSessionName: cleared custom name for session "${sessionId}" of agent "${agent.qualifiedName}"`,
      );
    }

    // Custom names are read live (not part of the directory listing cache), and
    // the metadata store is shared with discovery, so the change is already
    // visible. Invalidate the directory listing too for safety/consistency.
    const workingDirectory = resolveWorkingDirectory(agent);
    if (workingDirectory) {
      this.getSessionDiscovery().invalidateCache(workingDirectory, {
        dockerEnabled: agent.docker?.enabled === true,
      });
    }
  }

  /**
   * Drop the cached session listing for an agent so the next
   * {@link getAgentSessions} call rebuilds it from disk.
   *
   * The underlying {@link SessionDiscoveryService} caches each working
   * directory's listing for up to its TTL (default 30s). That cache is now
   * mtime-aware, so a *newly created* transcript file is normally picked up
   * immediately. Call this when you want to force a fresh listing regardless —
   * e.g. after each chat turn, or on filesystems whose directory mtime has
   * coarse (1-second) granularity where a same-second create might otherwise be
   * masked until the TTL expires. It also drops the attribution index so a
   * session created this turn (whose job record was just written) is attributed.
   *
   * Resolves the agent's working directory and Docker mode from the loaded
   * config (no override directories — see {@link getAgentSessions}). A no-op
   * when the agent has no working directory.
   *
   * @param name - The agent qualified name or local name
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  invalidateSessions(name: string): void {
    const { workingDirectory, dockerEnabled } = this.resolveAgentForSessions(
      name,
      "invalidateSessions",
    );
    if (!workingDirectory) {
      return;
    }
    this.getSessionDiscovery().invalidateWorkingDirectory(workingDirectory, { dockerEnabled });
    this.logger.debug(`invalidateSessions: cleared session cache for agent "${name}"`);
  }

  // Job Control
  async trigger(
    agentName: string,
    scheduleName?: string,
    options?: TriggerOptions,
  ): Promise<TriggerResult> {
    return this.jobControl.trigger(agentName, scheduleName, options);
  }
  /**
   * Open a long-lived streaming chat session for an agent.
   *
   * Returns a live {@link RuntimeSession} the caller drives across turns —
   * sending messages, running slash commands (e.g. `/compact`) as user turns,
   * interrupting, and listing available commands. See
   * {@link JobControl.openChatSession} for details and thrown errors. Always runs
   * on the SDK runtime (works for `cli`-configured agents too; Docker-wrapped
   * agents are unsupported).
   */
  async openChatSession(agentName: string, options?: ChatSessionOptions): Promise<RuntimeSession> {
    return this.jobControl.openChatSession(agentName, options);
  }
  /**
   * List the slash commands available to an agent in one shot.
   *
   * A convenience wrapper that opens a streaming session, reads its command list,
   * and always closes the session — so callers get a `SlashCommand[]` (for a
   * command palette / autocomplete) without managing a live `claude` subprocess.
   * See {@link JobControl.listAgentCommands} for details, cost, and thrown errors
   * (including {@link StreamingSessionUnsupportedError} for Docker-wrapped agents).
   */
  async listAgentCommands(
    agentName: string,
    options?: ChatSessionOptions,
  ): Promise<SlashCommand[]> {
    return this.jobControl.listAgentCommands(agentName, options);
  }
  async cancelJob(jobId: string, options?: { timeout?: number }): Promise<CancelJobResult> {
    return this.jobControl.cancelJob(jobId, options);
  }
  async forkJob(jobId: string, modifications?: JobModifications): Promise<ForkJobResult> {
    return this.jobControl.forkJob(jobId, modifications);
  }
  async getJobFinalOutput(jobId: string): Promise<string> {
    return this.jobControl.getJobFinalOutput(jobId);
  }

  // Log Streaming
  async *streamLogs(options?: LogStreamOptions): AsyncIterable<LogEntry> {
    yield* this.logStreaming.streamLogs(options);
  }
  async *streamJobOutput(jobId: string): AsyncIterable<LogEntry> {
    yield* this.logStreaming.streamJobOutput(jobId);
  }
  async *streamAgentLogs(agentName: string): AsyncIterable<LogEntry> {
    yield* this.logStreaming.streamAgentLogs(agentName);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private initializeModules(): void {
    this.statusQueries = new StatusQueries(this);
    this.scheduleManagement = new ScheduleManagement(
      this,
      () => this.statusQueries.readFleetStateSnapshot(),
      (config) => {
        this.config = config;
      },
      () => this.allowScheduleMutation,
    );
    this.configReloadModule = new ConfigReload(
      this,
      () => this.loadConfiguration(),
      (config) => {
        this.config = config;
      },
    );
    this.agentManagement = new AgentManagement(
      this,
      (config) => {
        this.config = config;
      },
      (name) => this.statusQueries.getAgentInfoByName(name),
    );
    this.jobControl = new JobControl(this);
    this.logStreaming = new LogStreaming(this);
    this.scheduleExecutor = new ScheduleExecutor(this);

    // Chat managers are created during initialize() via dynamic imports
    // to avoid hard dependencies on platform packages.
  }

  /**
   * Build the session-lifecycle manager (reaper + wake registry) for #307.
   *
   * The registry fires due wakes by resuming the session and injecting the
   * stored prompt through {@link openChatSession} (with `manageLifecycle` so the
   * resumed turn is itself reaped and re-captured). Any consumer-registered
   * {@link SessionWakeHandler} drives the woken turn; otherwise it runs headless.
   */
  private createSessionLifecycle(): SessionLifecycleManager {
    return new SessionLifecycleManager({
      stateDir: this.stateDir,
      openChatSession: (agent, opts) => this.openChatSession(agent, opts),
      sessionWakeHandler: this.sessionWakeHandler,
      resolveInjectedMcpServers: this.resolveInjectedMcpServers,
    });
  }

  /**
   * Register (or clear) the consumer that drives herdctl-fired session wakes.
   *
   * A consumer (e.g. Paddock) sets this to receive the resumed, already-managed
   * session on its hub/attribution path; without it, woken turns run headless so
   * recurring wakeups still fire. Safe to call before or after initialize().
   */
  setSessionWakeHandler(handler: SessionWakeHandler | undefined): void {
    this.sessionWakeHandler = handler;
    this.sessionLifecycle?.setSessionWakeHandler(handler);
  }

  /**
   * Register (or clear) the factory that re-supplies a session wake's in-process
   * injected MCP servers.
   *
   * herdctl does not persist the per-call `injectedMcpServers` a consumer passes
   * into {@link openChatSession}, so when the reaper closes an idle session and
   * the wake registry re-fires it, the resumed `claude` subprocess loses those
   * in-process servers — the injected `mcp__…__*` tools stay in `--allowedTools`
   * but have no server behind them and vanish from the model's catalog for the
   * whole autonomous stretch (edspencer/herdctl#390). A consumer (e.g. Paddock)
   * registers this factory alongside {@link setSessionWakeHandler}, keyed off the
   * wake's agent + sessionId, to rebuild the same servers on each fire. Without
   * it, wakes fire with no injection (the pre-existing behavior). Safe to call
   * before or after initialize().
   */
  setResolveInjectedMcpServers(resolve: ResolveInjectedMcpServers | undefined): void {
    this.resolveInjectedMcpServers = resolve;
    this.sessionLifecycle?.setResolveInjectedMcpServers(resolve);
  }

  /**
   * Register (or clear) the consumer that owns execution of fired schedules.
   *
   * Mirrors {@link setSessionWakeHandler}. A consumer (e.g. paddock) sets this to
   * take over running scheduled turns — resuming/streaming them on its own hub and
   * attribution path — instead of the built-in headless {@link ScheduleExecutor}.
   * The scheduler's cron/interval timing is unchanged; only the execution of a due
   * trigger is intercepted (edspencer/herdctl#375). Without a handler, schedules
   * run headless so recurring fires keep working. Safe to call before or after
   * initialize(); pass `undefined` to restore headless execution.
   */
  setScheduleTriggerHandler(handler: ScheduleTriggerHandler | undefined): void {
    this.scheduleTriggerHandler = handler;
  }

  /**
   * Dynamically import and initialize chat managers for platforms
   * that have agents configured.
   *
   * This allows FleetManager to work without platform packages installed,
   * and only loads the packages when they're actually needed.
   */
  private async initializeChatManagers(): Promise<void> {
    if (!this.config) return;

    // Check if any agents have Discord configured
    const hasDiscordAgents = this.config.agents.some((agent) => agent.chat?.discord !== undefined);

    if (hasDiscordAgents) {
      try {
        // Dynamic import of @herdctl/discord
        // Use `as string` to prevent TypeScript from resolving types at compile time
        // This allows core to build without discord installed (optional peer dependency)
        const mod = (await import("@herdctl/discord" as string)) as unknown as {
          DiscordManager: new (ctx: FleetManagerContext) => IChatManager;
        };
        const manager = new mod.DiscordManager(this);
        this.chatManagers.set("discord", manager);
        this.logger.debug("Discord chat manager created");
      } catch {
        // Package not installed - warn since Discord is explicitly configured
        this.logger.warn(
          "@herdctl/discord not installed, skipping Discord integration — install it with: pnpm add @herdctl/discord",
        );
      }
    }

    // Check if any agents have Slack configured
    const hasSlackAgents = this.config.agents.some((agent) => agent.chat?.slack !== undefined);

    if (hasSlackAgents) {
      try {
        // Dynamic import of @herdctl/slack
        // Use `as string` to prevent TypeScript from resolving types at compile time
        // This allows core to build without slack installed (optional peer dependency)
        const mod = (await import("@herdctl/slack" as string)) as unknown as {
          SlackManager: new (ctx: FleetManagerContext) => IChatManager;
        };
        const manager = new mod.SlackManager(this);
        this.chatManagers.set("slack", manager);
        this.logger.debug("Slack chat manager created");
      } catch {
        // Package not installed - warn since Slack is explicitly configured
        this.logger.warn(
          "@herdctl/slack not installed, skipping Slack integration — install it with: pnpm add @herdctl/slack",
        );
      }
    }

    // Check if web UI is configured (web config is at fleet level, not per-agent)
    if (this.config.fleet.web?.enabled) {
      try {
        // Dynamic import of @herdctl/web
        // Use `as string` to prevent TypeScript from resolving types at compile time
        // This allows core to build without web installed (optional peer dependency)
        const mod = (await import("@herdctl/web" as string)) as unknown as {
          WebManager: new (ctx: FleetManagerContext) => IChatManager;
        };
        const manager = new mod.WebManager(this);
        this.chatManagers.set("web", manager);
        this.logger.debug("Web chat manager created");
      } catch {
        // Package not installed - warn since web is explicitly enabled in config
        this.logger.warn(
          "@herdctl/web not installed, skipping web dashboard — install it with: pnpm add @herdctl/web",
        );
      }
    }
  }

  private async loadConfiguration(): Promise<ResolvedConfig> {
    let config: ResolvedConfig;
    try {
      config = await loadConfig(this.configPath);
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        throw new ConfigurationError(`Configuration file not found. ${error.message}`, {
          configPath: this.configPath,
          cause: error,
        });
      }
      if (error instanceof ConfigError) {
        throw new ConfigurationError(`Invalid configuration: ${error.message}`, {
          configPath: this.configPath,
          cause: error,
        });
      }
      throw new ConfigurationError(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
        { configPath: this.configPath, cause: error instanceof Error ? error : undefined },
      );
    }

    // Apply runtime config overrides (e.g., from CLI flags)
    if (this.configOverrides) {
      config = this.applyConfigOverrides(config);
    }

    return config;
  }

  /**
   * Apply runtime configuration overrides to the loaded config
   *
   * This enables CLI flags like --web and --web-port to override
   * values from the config file.
   */
  private applyConfigOverrides(config: ResolvedConfig): ResolvedConfig {
    const overrides = this.configOverrides;
    if (!overrides) return config;

    // Deep clone the fleet config to avoid mutating the original
    const fleet = { ...config.fleet };

    // Apply web overrides
    if (overrides.web) {
      const existingWeb = fleet.web ?? {
        enabled: false,
        port: 3232,
        host: "localhost",
        session_expiry_hours: 24,
        open_browser: false,
        tool_results: true,
        message_grouping: "separate",
      };

      fleet.web = {
        ...existingWeb,
        ...(overrides.web.enabled !== undefined && { enabled: overrides.web.enabled }),
        ...(overrides.web.port !== undefined && { port: overrides.web.port }),
        ...(overrides.web.host !== undefined && { host: overrides.web.host }),
      };
    }

    return { ...config, fleet };
  }

  /**
   * Validate that all agent qualified names are unique
   *
   * Qualified names are used as primary keys throughout the system (state storage,
   * scheduler, Discord connectors, session storage, job identification, etc.).
   * Duplicate qualified names cause silent overwrites and unpredictable behavior.
   *
   * Error format examples:
   * - Single duplicate: Duplicate agent qualified name "project-a.security-auditor". Agent names must be unique within a fleet.
   * - Multiple duplicates: Duplicate agent qualified names found: "project-a.foo", "project-b.bar". Agent names must be unique within a fleet.
   *
   * @param agents - Array of resolved agents to validate
   * @throws ConfigurationError if duplicate qualified names are found
   */
  private validateUniqueAgentNames(agents: ResolvedAgent[]): void {
    const nameCount = new Map<string, number>();

    // Count occurrences of each qualified name
    for (const agent of agents) {
      nameCount.set(agent.qualifiedName, (nameCount.get(agent.qualifiedName) || 0) + 1);
    }

    // Find duplicates
    const duplicates = Array.from(nameCount.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    if (duplicates.length === 1) {
      // Single duplicate - use spec format with "found" for backward compatibility
      throw new ConfigurationError(
        `Duplicate agent qualified name found: "${duplicates[0]}". Agent names must be unique within a fleet.`,
      );
    } else if (duplicates.length > 1) {
      // Multiple duplicates - list all of them
      const duplicateList = duplicates.map((name) => `"${name}"`).join(", ");
      throw new ConfigurationError(
        `Duplicate agent qualified names found: ${duplicateList}. Agent names must be unique within a fleet.`,
      );
    }
  }

  /**
   * Get (lazily creating) the shared SessionMetadataStore bound to this fleet's
   * state directory. Shared with the SessionDiscoveryService so metadata writes
   * (e.g. {@link setSessionName}) and reads (during discovery) use one cache.
   */
  private getSessionMetadataStore(): SessionMetadataStore {
    if (!this.sessionMetadataStore) {
      this.sessionMetadataStore = new SessionMetadataStore(this.stateDir);
    }
    return this.sessionMetadataStore;
  }

  /**
   * Get (lazily creating) the SessionDiscoveryService bound to this fleet's
   * state directory. Reused across calls so its caches are shared. The
   * service shares this fleet's {@link SessionMetadataStore} so custom-name
   * writes are immediately visible to discovery.
   */
  private getSessionDiscovery(): SessionDiscoveryService {
    if (!this.sessionDiscovery) {
      this.sessionDiscovery = new SessionDiscoveryService({
        stateDir: this.stateDir,
        sessionMetadataStore: this.getSessionMetadataStore(),
      });
    }
    return this.sessionDiscovery;
  }

  /**
   * Look up an agent by qualified or local name and derive the inputs the
   * SessionDiscoveryService needs (working directory + Docker mode).
   *
   * @param name - The agent qualified name or local name
   * @param operation - The public operation name, used for the
   *   {@link InvalidStateError} message when the fleet is uninitialized
   * @throws {InvalidStateError} If the fleet manager is not yet initialized
   * @throws {AgentNotFoundError} If no agent with that name exists
   */
  private resolveAgentForSessions(
    name: string,
    operation: string,
  ): {
    agent: ResolvedAgent;
    workingDirectory: string | undefined;
    dockerEnabled: boolean;
  } {
    // Guard against pre-init calls. Without this, an uninitialized fleet has a
    // null config, so the agent lookup below would throw AgentNotFoundError —
    // masking the real cause and contradicting the documented behavior (these
    // helpers throw InvalidStateError before initialize()).
    if (this.status === "uninitialized" || !this.config) {
      throw new InvalidStateError(operation, this.status, [
        "initialized",
        "starting",
        "running",
        "stopping",
        "stopped",
      ]);
    }

    const agents = this.config.agents;
    const agent =
      agents.find((a) => a.qualifiedName === name) ?? agents.find((a) => a.name === name);

    if (!agent) {
      throw new AgentNotFoundError(name);
    }

    return {
      agent,
      workingDirectory: resolveWorkingDirectory(agent),
      dockerEnabled: agent.docker?.enabled === true,
    };
  }

  private async initializeStateDir(): Promise<StateDirectory> {
    try {
      return await initStateDirectory({ path: this.stateDir });
    } catch (error) {
      throw new FleetManagerStateDirError(
        `Failed to initialize state directory: ${error instanceof Error ? error.message : String(error)}`,
        this.stateDir,
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  private startSchedulerAsync(agents: ResolvedAgent[]): void {
    this.scheduler!.start(agents).catch((error) => {
      if (this.status === "running" || this.status === "starting") {
        this.logger.error(
          `Scheduler error: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.status = "error";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async handleScheduleTrigger(info: TriggerInfo): Promise<void> {
    // Host-execution seam (edspencer/herdctl#375): when a consumer registers a
    // handler it owns execution — running the turn on its own resume/hub path and
    // streaming it into its UI — so we route the trigger there and skip the
    // built-in headless executor. Every scheduler-fired trigger (interval, cron,
    // and a forced immediate fire) funnels through here, so a "trigger now" flows
    // through the handler path too. Without a handler, schedules run headless via
    // ScheduleExecutor exactly as before.
    if (this.scheduleTriggerHandler) {
      await this.scheduleTriggerHandler(info);
      return;
    }
    await this.scheduleExecutor.executeSchedule(info);
  }

  private async persistShutdownState(): Promise<void> {
    if (!this.stateDirInfo) return;

    const { writeFleetState } = await import("../state/fleet-state.js");
    const currentState = await this.statusQueries.readFleetStateSnapshot();
    const updatedState = {
      ...currentState,
      fleet: { ...currentState.fleet, stoppedAt: new Date().toISOString() },
    };

    try {
      await writeFleetState(this.stateDirInfo.stateFile, updatedState);
      this.logger.debug("Fleet state persisted");
    } catch (error) {
      this.logger.warn(`Failed to persist fleet state: ${(error as Error).message}`);
    }
  }
}
