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
import { resolve } from "node:path";

import {
  ConfigError,
  ConfigNotFoundError,
  loadConfig,
  type ResolvedAgent,
  type ResolvedConfig,
} from "../config/index.js";
import { Scheduler, type TriggerInfo } from "../scheduler/index.js";
import { initStateDirectory, type StateDirectory } from "../state/index.js";
import { createLogger } from "../utils/logger.js";
import type { IChatManager } from "./chat-manager-interface.js";
import { ConfigReload, computeConfigChanges } from "./config-reload.js";
import type { FleetManagerContext } from "./context.js";
import {
  ConfigurationError,
  FleetManagerShutdownError,
  FleetManagerStateDirError,
  InvalidStateError,
} from "./errors.js";
import { JobControl } from "./job-control.js";
import { LogStreaming } from "./log-streaming.js";
import { ScheduleExecutor } from "./schedule-executor.js";
import { ScheduleManagement } from "./schedule-management.js";
// Module classes
import { StatusQueries } from "./status-queries.js";
import type {
  AgentInfo,
  CancelJobResult,
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
  TriggerOptions,
  TriggerResult,
} from "./types.js";

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

  // Internal state
  private status: FleetManagerStatus = "uninitialized";
  private config: ResolvedConfig | null = null;
  private stateDirInfo: StateDirectory | null = null;
  private scheduler: Scheduler | null = null;

  // Timing info
  private initializedAt: string | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastError: string | null = null;

  // Module class instances
  private statusQueries!: StatusQueries;
  private scheduleManagement!: ScheduleManagement;
  private configReloadModule!: ConfigReload;
  private jobControl!: JobControl;
  private logStreaming!: LogStreaming;
  private scheduleExecutor!: ScheduleExecutor;

  // Chat managers (Discord, Slack, etc.)
  // Key is platform name (e.g., "discord", "slack")
  private chatManagers: Map<string, IChatManager> = new Map();

  constructor(options: FleetManagerOptions) {
    super();
    this.configPath = options.configPath;
    this.stateDir = resolve(options.stateDir);
    this.logger = options.logger ?? createDefaultLogger();
    this.checkInterval = options.checkInterval ?? DEFAULT_CHECK_INTERVAL;
    this.configOverrides = options.configOverrides;

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

      this.scheduler = new Scheduler({
        stateDir: this.stateDir,
        checkInterval: this.checkInterval,
        logger: this.logger,
        onTrigger: (info) => this.handleScheduleTrigger(info),
      });

      // Dynamically import and create chat managers for configured platforms
      await this.initializeChatManagers();

      // Initialize all chat managers
      for (const [platform, manager] of this.chatManagers) {
        this.logger.debug(`Initializing ${platform} chat manager...`);
        await manager.initialize();
      }

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

      // Start all chat managers
      for (const [platform, manager] of this.chatManagers) {
        this.logger.debug(`Starting ${platform} chat manager...`);
        await manager.start();
      }

      this.status = "running";
      this.startedAt = new Date().toISOString();
      this.stoppedAt = null;

      this.logger.info("Fleet manager started");
      this.emit("started");
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
        await manager.stop();
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

  // Job Control
  async trigger(
    agentName: string,
    scheduleName?: string,
    options?: TriggerOptions,
  ): Promise<TriggerResult> {
    return this.jobControl.trigger(agentName, scheduleName, options);
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
    this.scheduleManagement = new ScheduleManagement(this, () =>
      this.statusQueries.readFleetStateSnapshot(),
    );
    this.configReloadModule = new ConfigReload(
      this,
      () => this.loadConfiguration(),
      (config) => {
        this.config = config;
      },
    );
    this.jobControl = new JobControl(this, () => this.statusQueries.getAgentInfo());
    this.logStreaming = new LogStreaming(this);
    this.scheduleExecutor = new ScheduleExecutor(this);

    // Chat managers are created during initialize() via dynamic imports
    // to avoid hard dependencies on platform packages.
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
