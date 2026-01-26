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
  loadConfig,
  type ResolvedConfig,
  type ResolvedAgent,
  ConfigNotFoundError,
  ConfigError,
} from "../config/index.js";
import { initStateDirectory, type StateDirectory } from "../state/index.js";
import { Scheduler, type TriggerInfo } from "../scheduler/index.js";

import type { FleetManagerContext } from "./context.js";
import type {
  FleetManagerOptions,
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerLogger,
  FleetManagerStopOptions,
  FleetStatus,
  AgentInfo,
  ScheduleInfo,
  TriggerOptions,
  TriggerResult,
  JobModifications,
  CancelJobResult,
  ForkJobResult,
  LogEntry,
  LogStreamOptions,
  ConfigChange,
  ConfigReloadedPayload,
} from "./types.js";
import {
  InvalidStateError,
  ConfigurationError,
  FleetManagerStateDirError,
  FleetManagerShutdownError,
} from "./errors.js";

// Module classes
import { StatusQueries } from "./status-queries.js";
import { ScheduleManagement } from "./schedule-management.js";
import { ConfigReload, computeConfigChanges } from "./config-reload.js";
import { JobControl } from "./job-control.js";
import { LogStreaming } from "./log-streaming.js";
import { ScheduleExecutor } from "./schedule-executor.js";

const DEFAULT_CHECK_INTERVAL = 1000;

function createDefaultLogger(): FleetManagerLogger {
  return {
    debug: (message: string) => console.debug(`[fleet-manager] ${message}`),
    info: (message: string) => console.info(`[fleet-manager] ${message}`),
    warn: (message: string) => console.warn(`[fleet-manager] ${message}`),
    error: (message: string) => console.error(`[fleet-manager] ${message}`),
  };
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

  constructor(options: FleetManagerOptions) {
    super();
    this.configPath = options.configPath;
    this.stateDir = resolve(options.stateDir);
    this.logger = options.logger ?? createDefaultLogger();
    this.checkInterval = options.checkInterval ?? DEFAULT_CHECK_INTERVAL;

    // Initialize modules in constructor so they work before initialize() is called
    this.initializeModules();
  }

  // ===========================================================================
  // FleetManagerContext Implementation
  // ===========================================================================

  getConfig(): ResolvedConfig | null { return this.config; }
  getStateDir(): string { return this.stateDir; }
  getStateDirInfo(): StateDirectory | null { return this.stateDirInfo; }
  getLogger(): FleetManagerLogger { return this.logger; }
  getScheduler(): Scheduler | null { return this.scheduler; }
  getStatus(): FleetManagerStatus { return this.status; }
  getInitializedAt(): string | null { return this.initializedAt; }
  getStartedAt(): string | null { return this.startedAt; }
  getStoppedAt(): string | null { return this.stoppedAt; }
  getLastError(): string | null { return this.lastError; }
  getCheckInterval(): number { return this.checkInterval; }
  getEmitter(): EventEmitter { return this; }

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

  getAgents(): ResolvedAgent[] { return this.config?.agents ?? []; }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.status !== "uninitialized" && this.status !== "stopped") {
      throw new InvalidStateError("initialize", this.status, ["uninitialized", "stopped"]);
    }

    this.logger.info("Initializing fleet manager...");

    try {
      this.config = await this.loadConfiguration();
      this.logger.info(`Loaded ${this.config.agents.length} agent(s) from config`);

      this.stateDirInfo = await this.initializeStateDir();
      this.logger.debug("State directory initialized");

      this.scheduler = new Scheduler({
        stateDir: this.stateDir,
        checkInterval: this.checkInterval,
        logger: this.logger,
        onTrigger: (info) => this.handleScheduleTrigger(info),
      });

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

    this.logger.info("Starting fleet manager...");
    this.status = "starting";

    try {
      this.startSchedulerAsync(this.config!.agents);
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

    const { waitForJobs = true, timeout = 30000, cancelOnTimeout = false, cancelTimeout = 10000 } = options ?? {};

    this.logger.info("Stopping fleet manager...");
    this.status = "stopping";

    try {
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
  async getFleetStatus(): Promise<FleetStatus> { return this.statusQueries.getFleetStatus(); }
  async getAgentInfo(): Promise<AgentInfo[]> { return this.statusQueries.getAgentInfo(); }
  async getAgentInfoByName(name: string): Promise<AgentInfo> { return this.statusQueries.getAgentInfoByName(name); }

  // Schedule Management
  async getSchedules(): Promise<ScheduleInfo[]> { return this.scheduleManagement.getSchedules(); }
  async getSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> { return this.scheduleManagement.getSchedule(agentName, scheduleName); }
  async enableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> { return this.scheduleManagement.enableSchedule(agentName, scheduleName); }
  async disableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> { return this.scheduleManagement.disableSchedule(agentName, scheduleName); }

  // Config Reload
  async reload(): Promise<ConfigReloadedPayload> { return this.configReloadModule.reload(); }
  computeConfigChanges(oldConfig: ResolvedConfig | null, newConfig: ResolvedConfig): ConfigChange[] { return computeConfigChanges(oldConfig, newConfig); }

  // Job Control
  async trigger(agentName: string, scheduleName?: string, options?: TriggerOptions): Promise<TriggerResult> { return this.jobControl.trigger(agentName, scheduleName, options); }
  async cancelJob(jobId: string, options?: { timeout?: number }): Promise<CancelJobResult> { return this.jobControl.cancelJob(jobId, options); }
  async forkJob(jobId: string, modifications?: JobModifications): Promise<ForkJobResult> { return this.jobControl.forkJob(jobId, modifications); }
  async getJobFinalOutput(jobId: string): Promise<string> { return this.jobControl.getJobFinalOutput(jobId); }

  // Log Streaming
  async *streamLogs(options?: LogStreamOptions): AsyncIterable<LogEntry> { yield* this.logStreaming.streamLogs(options); }
  async *streamJobOutput(jobId: string): AsyncIterable<LogEntry> { yield* this.logStreaming.streamJobOutput(jobId); }
  async *streamAgentLogs(agentName: string): AsyncIterable<LogEntry> { yield* this.logStreaming.streamAgentLogs(agentName); }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private initializeModules(): void {
    this.statusQueries = new StatusQueries(this);
    this.scheduleManagement = new ScheduleManagement(this, () => this.statusQueries.readFleetStateSnapshot());
    this.configReloadModule = new ConfigReload(this, () => this.loadConfiguration(), (config) => { this.config = config; });
    this.jobControl = new JobControl(this, () => this.statusQueries.getAgentInfo());
    this.logStreaming = new LogStreaming(this);
    this.scheduleExecutor = new ScheduleExecutor(this);
  }

  private async loadConfiguration(): Promise<ResolvedConfig> {
    try {
      return await loadConfig(this.configPath);
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        throw new ConfigurationError(`Configuration file not found. ${error.message}`, { configPath: this.configPath, cause: error });
      }
      if (error instanceof ConfigError) {
        throw new ConfigurationError(`Invalid configuration: ${error.message}`, { configPath: this.configPath, cause: error });
      }
      throw new ConfigurationError(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`, { configPath: this.configPath, cause: error instanceof Error ? error : undefined });
    }
  }

  private async initializeStateDir(): Promise<StateDirectory> {
    try {
      return await initStateDirectory({ path: this.stateDir });
    } catch (error) {
      throw new FleetManagerStateDirError(`Failed to initialize state directory: ${error instanceof Error ? error.message : String(error)}`, this.stateDir, { cause: error instanceof Error ? error : undefined });
    }
  }

  private startSchedulerAsync(agents: ResolvedAgent[]): void {
    this.scheduler!.start(agents).catch((error) => {
      if (this.status === "running" || this.status === "starting") {
        this.logger.error(`Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
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
    const updatedState = { ...currentState, fleet: { ...currentState.fleet, stoppedAt: new Date().toISOString() } };

    try {
      await writeFleetState(this.stateDirInfo.stateFile, updatedState);
      this.logger.debug("Fleet state persisted");
    } catch (error) {
      this.logger.warn(`Failed to persist fleet state: ${(error as Error).message}`);
    }
  }
}
