/**
 * FleetManager class for library consumers
 *
 * Provides a simple, high-level API to initialize and run a fleet of agents
 * with minimal configuration. Handles config loading, state directory setup,
 * and scheduler orchestration internally.
 *
 * @example
 * ```typescript
 * import { FleetManager } from '@herdctl/core';
 *
 * const manager = new FleetManager({
 *   configPath: './herdctl.yaml',
 *   stateDir: './.herdctl',
 * });
 *
 * await manager.initialize();
 * await manager.start();
 *
 * // Later...
 * await manager.stop();
 * ```
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
import { initStateDirectory, type StateDirectory, createJob, getJob, updateJob, listJobs } from "../state/index.js";
import type { JobMetadata } from "../state/schemas/job-metadata.js";
import { Scheduler, type TriggerInfo } from "../scheduler/index.js";
import { join } from "node:path";
import type {
  FleetManagerOptions,
  FleetManagerState,
  FleetManagerStatus,
  FleetManagerLogger,
  ConfigChange,
  ConfigReloadedPayload,
  AgentStartedPayload,
  AgentStoppedPayload,
  ScheduleTriggeredPayload,
  ScheduleSkippedPayload,
  JobCreatedPayload,
  JobOutputPayload,
  JobCompletedPayload,
  JobFailedPayload,
  // Job control event types (US-6)
  JobCancelledPayload,
  JobForkedPayload,
  // Status query types (US-3)
  FleetStatus,
  AgentInfo,
  ScheduleInfo,
  FleetCounts,
  // Trigger types (US-5)
  TriggerOptions,
  TriggerResult,
  // Job control types (US-6)
  JobModifications,
  CancelJobResult,
  ForkJobResult,
  // Stop options (US-8)
  FleetManagerStopOptions,
  // Log streaming types (US-11)
  LogLevel,
  LogEntry,
  LogStreamOptions,
} from "./types.js";
import {
  FleetManagerStateError,
  FleetManagerConfigError,
  FleetManagerStateDirError,
  FleetManagerShutdownError,
  AgentNotFoundError,
  ScheduleNotFoundError,
  ConcurrencyLimitError,
  InvalidStateError,
  // Job control errors (US-6)
  JobCancelError,
  JobForkError,
  JobNotFoundError,
} from "./errors.js";
import { readFleetState } from "../state/fleet-state.js";
import type { AgentState } from "../state/schemas/fleet-state.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default check interval in milliseconds (1 second)
 */
const DEFAULT_CHECK_INTERVAL = 1000;


// =============================================================================
// Default Logger
// =============================================================================

/**
 * Create a default console-based logger
 */
function createDefaultLogger(): FleetManagerLogger {
  return {
    debug: (message: string) => console.debug(`[fleet-manager] ${message}`),
    info: (message: string) => console.info(`[fleet-manager] ${message}`),
    warn: (message: string) => console.warn(`[fleet-manager] ${message}`),
    error: (message: string) => console.error(`[fleet-manager] ${message}`),
  };
}

// =============================================================================
// FleetManager Class
// =============================================================================

/**
 * FleetManager provides a simple API to manage a fleet of agents
 *
 * This class is the primary entry point for library consumers who want to
 * run herdctl programmatically. It handles:
 *
 * - Configuration loading and validation
 * - State directory initialization
 * - Scheduler lifecycle management
 * - Event emission for monitoring
 *
 * ## Lifecycle
 *
 * 1. **Construction**: Create with options (configPath, stateDir)
 * 2. **Initialize**: Call `initialize()` to load config and prepare state
 * 3. **Start**: Call `start()` to begin scheduler and process schedules
 * 4. **Stop**: Call `stop()` to gracefully shut down
 *
 * ## Events
 *
 * The FleetManager emits events for monitoring:
 * - `initialized` - After successful initialization
 * - `started` - When the scheduler starts running
 * - `stopped` - When the scheduler stops
 * - `error` - When an error occurs
 * - `schedule:trigger` - When a schedule triggers an agent
 * - `schedule:complete` - When an agent run completes
 * - `schedule:error` - When an agent run fails
 *
 * ## Typed Events (US-2)
 *
 * The FleetManager also supports strongly-typed events via TypeScript:
 * - `config:reloaded` - When configuration is hot-reloaded
 * - `agent:started` - When an agent is started
 * - `agent:stopped` - When an agent is stopped
 * - `schedule:triggered` - When a schedule triggers (with payload)
 * - `schedule:skipped` - When a schedule is skipped
 * - `job:created` - When a job is created
 * - `job:output` - When a job produces output
 * - `job:completed` - When a job completes successfully
 * - `job:failed` - When a job fails
 *
 * @example
 * ```typescript
 * // Subscribe to typed events
 * manager.on('job:created', (payload) => {
 *   console.log(`Job ${payload.job.id} created for ${payload.agentName}`);
 * });
 *
 * manager.on('job:output', (payload) => {
 *   process.stdout.write(payload.output);
 * });
 *
 * manager.on('job:completed', (payload) => {
 *   console.log(`Job completed in ${payload.durationSeconds}s`);
 * });
 * ```
 */
export class FleetManager extends EventEmitter {
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

  /**
   * Create a new FleetManager instance
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * // Minimal configuration
   * const manager = new FleetManager({
   *   configPath: './herdctl.yaml',
   *   stateDir: './.herdctl',
   * });
   *
   * // With custom logger
   * const manager = new FleetManager({
   *   configPath: './herdctl.yaml',
   *   stateDir: './.herdctl',
   *   logger: myLogger,
   *   checkInterval: 5000, // 5 seconds
   * });
   * ```
   */
  constructor(options: FleetManagerOptions) {
    super();
    this.configPath = options.configPath;
    this.stateDir = resolve(options.stateDir);
    this.logger = options.logger ?? createDefaultLogger();
    this.checkInterval = options.checkInterval ?? DEFAULT_CHECK_INTERVAL;
  }

  // ===========================================================================
  // Public State Accessors
  // ===========================================================================

  /**
   * Get the current fleet manager state
   *
   * This provides a snapshot of the fleet manager's current status and
   * configuration for monitoring purposes.
   */
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

  /**
   * Get the loaded configuration
   *
   * @returns The resolved configuration, or null if not initialized
   */
  getConfig(): ResolvedConfig | null {
    return this.config;
  }

  /**
   * Get the loaded agents
   *
   * @returns Array of resolved agents, or empty array if not initialized
   */
  getAgents(): ResolvedAgent[] {
    return this.config?.agents ?? [];
  }

  // ===========================================================================
  // Fleet Status Query Methods (US-3)
  // ===========================================================================

  /**
   * Get overall fleet status
   *
   * Returns a comprehensive snapshot of the fleet state including:
   * - Current state and uptime
   * - Agent counts (total, idle, running, error)
   * - Job counts
   * - Scheduler information
   *
   * This method works whether the fleet is running or stopped.
   *
   * @returns A consistent FleetStatus snapshot
   *
   * @example
   * ```typescript
   * const status = await manager.getFleetStatus();
   * console.log(`Fleet: ${status.state}`);
   * console.log(`Uptime: ${status.uptimeSeconds}s`);
   * console.log(`Running jobs: ${status.counts.runningJobs}`);
   * ```
   */
  async getFleetStatus(): Promise<FleetStatus> {
    // Get agent info to compute counts
    const agentInfoList = await this.getAgentInfo();

    // Compute counts from agent info
    const counts = this.computeFleetCounts(agentInfoList);

    // Compute uptime
    let uptimeSeconds: number | null = null;
    if (this.startedAt) {
      const startTime = new Date(this.startedAt).getTime();
      const endTime = this.stoppedAt
        ? new Date(this.stoppedAt).getTime()
        : Date.now();
      uptimeSeconds = Math.floor((endTime - startTime) / 1000);
    }

    // Get scheduler state
    const schedulerState = this.scheduler?.getState();

    return {
      state: this.status,
      uptimeSeconds,
      initializedAt: this.initializedAt,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      counts,
      scheduler: {
        status: schedulerState?.status ?? "stopped",
        checkCount: schedulerState?.checkCount ?? 0,
        triggerCount: schedulerState?.triggerCount ?? 0,
        lastCheckAt: schedulerState?.lastCheckAt ?? null,
        checkIntervalMs: this.checkInterval,
      },
      lastError: this.lastError,
    };
  }

  /**
   * Get information about all configured agents
   *
   * Returns detailed information for each agent including:
   * - Current status and job information
   * - Schedule details with runtime state
   * - Configuration details
   *
   * This method works whether the fleet is running or stopped.
   *
   * @returns Array of AgentInfo objects with current state
   *
   * @example
   * ```typescript
   * const agents = await manager.getAgentInfo();
   * for (const agent of agents) {
   *   console.log(`${agent.name}: ${agent.status}`);
   *   console.log(`  Schedules: ${agent.scheduleCount}`);
   * }
   * ```
   */
  async getAgentInfo(): Promise<AgentInfo[]> {
    const agents = this.config?.agents ?? [];

    // Read fleet state for runtime information
    const fleetState = await this.readFleetStateSnapshot();

    return agents.map((agent) => {
      const agentState = fleetState.agents[agent.name];
      return this.buildAgentInfo(agent, agentState);
    });
  }

  /**
   * Get information about a specific agent by name
   *
   * Returns detailed information for the specified agent including:
   * - Current status and job information
   * - Schedule details with runtime state
   * - Configuration details
   *
   * This method works whether the fleet is running or stopped.
   *
   * @param name - The agent name to look up
   * @returns AgentInfo for the specified agent
   * @throws {AgentNotFoundError} If no agent with that name exists
   *
   * @example
   * ```typescript
   * const agent = await manager.getAgentInfoByName('my-agent');
   * console.log(`Agent: ${agent.name}`);
   * console.log(`Status: ${agent.status}`);
   * console.log(`Running: ${agent.runningCount}/${agent.maxConcurrent}`);
   * ```
   */
  async getAgentInfoByName(name: string): Promise<AgentInfo> {
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === name);

    if (!agent) {
      throw new AgentNotFoundError(name);
    }

    // Read fleet state for runtime information
    const fleetState = await this.readFleetStateSnapshot();
    const agentState = fleetState.agents[name];

    return this.buildAgentInfo(agent, agentState);
  }

  // ===========================================================================
  // Private Status Query Helpers
  // ===========================================================================

  /**
   * Read fleet state from disk for status queries
   *
   * This provides a consistent snapshot of the fleet state.
   */
  private async readFleetStateSnapshot() {
    if (!this.stateDirInfo) {
      // Not initialized yet, return empty state
      return { fleet: {}, agents: {} };
    }

    return await readFleetState(this.stateDirInfo.stateFile, {
      logger: { warn: this.logger.warn },
    });
  }

  /**
   * Build AgentInfo from configuration and state
   */
  private buildAgentInfo(
    agent: ResolvedAgent,
    agentState?: AgentState
  ): AgentInfo {
    // Build schedule info
    const schedules = this.buildScheduleInfoList(agent, agentState);

    // Get running count from scheduler or state
    const runningCount = this.scheduler?.getRunningJobCount(agent.name) ?? 0;

    // Determine workspace path
    let workspace: string | undefined;
    if (typeof agent.workspace === "string") {
      workspace = agent.workspace;
    } else if (agent.workspace?.root) {
      workspace = agent.workspace.root;
    }

    return {
      name: agent.name,
      description: agent.description,
      status: agentState?.status ?? "idle",
      currentJobId: agentState?.current_job ?? null,
      lastJobId: agentState?.last_job ?? null,
      maxConcurrent: agent.instances?.max_concurrent ?? 1,
      runningCount,
      errorMessage: agentState?.error_message ?? null,
      scheduleCount: schedules.length,
      schedules,
      model: agent.model,
      workspace,
    };
  }

  /**
   * Build schedule info list from agent configuration and state
   */
  private buildScheduleInfoList(
    agent: ResolvedAgent,
    agentState?: AgentState
  ): ScheduleInfo[] {
    if (!agent.schedules) {
      return [];
    }

    return Object.entries(agent.schedules).map(([name, schedule]) => {
      const scheduleState = agentState?.schedules?.[name];

      return {
        name,
        agentName: agent.name,
        type: schedule.type,
        interval: schedule.interval,
        expression: schedule.expression,
        status: scheduleState?.status ?? "idle",
        lastRunAt: scheduleState?.last_run_at ?? null,
        nextRunAt: scheduleState?.next_run_at ?? null,
        lastError: scheduleState?.last_error ?? null,
      };
    });
  }

  /**
   * Compute fleet counts from agent info list
   */
  private computeFleetCounts(agentInfoList: AgentInfo[]): FleetCounts {
    let idleAgents = 0;
    let runningAgents = 0;
    let errorAgents = 0;
    let totalSchedules = 0;
    let runningSchedules = 0;
    let runningJobs = 0;

    for (const agent of agentInfoList) {
      switch (agent.status) {
        case "idle":
          idleAgents++;
          break;
        case "running":
          runningAgents++;
          break;
        case "error":
          errorAgents++;
          break;
      }

      totalSchedules += agent.scheduleCount;
      runningJobs += agent.runningCount;

      for (const schedule of agent.schedules) {
        if (schedule.status === "running") {
          runningSchedules++;
        }
      }
    }

    return {
      totalAgents: agentInfoList.length,
      idleAgents,
      runningAgents,
      errorAgents,
      totalSchedules,
      runningSchedules,
      runningJobs,
    };
  }

  // ===========================================================================
  // Schedule Management Methods (US-7)
  // ===========================================================================

  /**
   * Get all schedules across all agents
   *
   * Returns a list of all configured schedules with their current state,
   * including next trigger times.
   *
   * @returns Array of ScheduleInfo objects with current state
   *
   * @example
   * ```typescript
   * const schedules = await manager.getSchedules();
   * for (const schedule of schedules) {
   *   console.log(`${schedule.agentName}/${schedule.name}: ${schedule.status}`);
   *   console.log(`  Next run: ${schedule.nextRunAt}`);
   * }
   * ```
   */
  async getSchedules(): Promise<ScheduleInfo[]> {
    const agents = this.config?.agents ?? [];
    const fleetState = await this.readFleetStateSnapshot();

    const allSchedules: ScheduleInfo[] = [];

    for (const agent of agents) {
      const agentState = fleetState.agents[agent.name];
      const schedules = this.buildScheduleInfoList(agent, agentState);
      allSchedules.push(...schedules);
    }

    return allSchedules;
  }

  /**
   * Get a specific schedule by agent name and schedule name
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The schedule info with current state
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   *
   * @example
   * ```typescript
   * const schedule = await manager.getSchedule('my-agent', 'hourly');
   * console.log(`Status: ${schedule.status}`);
   * console.log(`Last run: ${schedule.lastRunAt}`);
   * console.log(`Next run: ${schedule.nextRunAt}`);
   * ```
   */
  async getSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    const fleetState = await this.readFleetStateSnapshot();
    const agentState = fleetState.agents[agentName];
    const schedule = agent.schedules[scheduleName];
    const scheduleState = agentState?.schedules?.[scheduleName];

    return {
      name: scheduleName,
      agentName,
      type: schedule.type,
      interval: schedule.interval,
      expression: schedule.expression,
      status: scheduleState?.status ?? "idle",
      lastRunAt: scheduleState?.last_run_at ?? null,
      nextRunAt: scheduleState?.next_run_at ?? null,
      lastError: scheduleState?.last_error ?? null,
    };
  }

  /**
   * Enable a disabled schedule
   *
   * Enables a schedule that was previously disabled, allowing it to trigger
   * again on its configured interval. The enabled state is persisted to the
   * state directory and survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   *
   * @example
   * ```typescript
   * // Enable a previously disabled schedule
   * const schedule = await manager.enableSchedule('my-agent', 'hourly');
   * console.log(`Schedule status: ${schedule.status}`); // 'idle'
   * ```
   */
  async enableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    // Validate the agent and schedule exist
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to enabled (idle)
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      this.stateDir,
      agentName,
      scheduleName,
      { status: "idle" },
      { logger: { warn: this.logger.warn } }
    );

    this.logger.info(`Enabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
  }

  /**
   * Disable a schedule
   *
   * Disables a schedule, preventing it from triggering on its configured
   * interval. The schedule remains in the configuration but won't run until
   * re-enabled. The disabled state is persisted to the state directory and
   * survives restarts.
   *
   * @param agentName - The name of the agent
   * @param scheduleName - The name of the schedule
   * @returns The updated schedule info
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the schedule doesn't exist
   *
   * @example
   * ```typescript
   * // Disable a schedule temporarily
   * const schedule = await manager.disableSchedule('my-agent', 'hourly');
   * console.log(`Schedule status: ${schedule.status}`); // 'disabled'
   *
   * // Later, re-enable it
   * await manager.enableSchedule('my-agent', 'hourly');
   * ```
   */
  async disableSchedule(agentName: string, scheduleName: string): Promise<ScheduleInfo> {
    // Validate the agent and schedule exist
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    if (!agent.schedules || !(scheduleName in agent.schedules)) {
      const availableSchedules = agent.schedules
        ? Object.keys(agent.schedules)
        : [];
      throw new ScheduleNotFoundError(agentName, scheduleName, {
        availableSchedules,
      });
    }

    // Update schedule state to disabled
    const { updateScheduleState } = await import("../scheduler/schedule-state.js");
    await updateScheduleState(
      this.stateDir,
      agentName,
      scheduleName,
      { status: "disabled" },
      { logger: { warn: this.logger.warn } }
    );

    this.logger.info(`Disabled schedule ${agentName}/${scheduleName}`);

    // Return the updated schedule info
    return this.getSchedule(agentName, scheduleName);
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Initialize the fleet manager
   *
   * This method:
   * 1. Loads and validates the configuration file
   * 2. Initializes the state directory structure
   * 3. Prepares the scheduler (but does not start it)
   *
   * After initialization, the fleet manager is ready to start.
   *
   * @throws {FleetManagerStateError} If already initialized or running
   * @throws {FleetManagerConfigError} If configuration is invalid or not found
   * @throws {FleetManagerStateDirError} If state directory cannot be created
   *
   * @example
   * ```typescript
   * const manager = new FleetManager({ ... });
   * await manager.initialize();
   * console.log(`Loaded ${manager.state.agentCount} agents`);
   * ```
   */
  async initialize(): Promise<void> {
    // Validate current state
    if (this.status !== "uninitialized" && this.status !== "stopped") {
      throw new FleetManagerStateError(
        "initialize",
        this.status,
        ["uninitialized", "stopped"]
      );
    }

    this.logger.info("Initializing fleet manager...");

    try {
      // Load configuration
      this.logger.debug(
        this.configPath
          ? `Loading config from: ${this.configPath}`
          : "Auto-discovering config..."
      );

      this.config = await this.loadConfiguration();
      this.logger.info(`Loaded ${this.config.agents.length} agent(s) from config`);

      // Initialize state directory
      this.logger.debug(`Initializing state directory: ${this.stateDir}`);
      this.stateDirInfo = await this.initializeStateDir();
      this.logger.debug("State directory initialized");

      // Create scheduler (but don't start it)
      this.scheduler = new Scheduler({
        stateDir: this.stateDir,
        checkInterval: this.checkInterval,
        logger: this.logger,
        onTrigger: (info) => this.handleScheduleTrigger(info),
      });

      // Update state
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

  /**
   * Start the fleet manager
   *
   * This begins the scheduler, which will:
   * 1. Check agent schedules at the configured interval
   * 2. Trigger agents when their schedules are due
   * 3. Track schedule state in the state directory
   *
   * @throws {FleetManagerStateError} If not initialized
   *
   * @example
   * ```typescript
   * await manager.initialize();
   * await manager.start();
   *
   * // The manager is now running and processing schedules
   * manager.on('schedule:trigger', (agent, schedule) => {
   *   console.log(`Triggered ${agent}/${schedule}`);
   * });
   * ```
   */
  async start(): Promise<void> {
    // Validate current state
    if (this.status !== "initialized") {
      throw new FleetManagerStateError("start", this.status, "initialized");
    }

    this.logger.info("Starting fleet manager...");
    this.status = "starting";

    try {
      // Start the scheduler with loaded agents
      const agents = this.config!.agents;

      // Start scheduler in background (don't await the loop)
      this.startSchedulerAsync(agents);

      // Update state
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

  /**
   * Stop the fleet manager gracefully
   *
   * This will:
   * 1. Signal the scheduler to stop accepting new triggers
   * 2. Wait for running jobs to complete (with timeout)
   * 3. If timeout is reached and cancelOnTimeout is true, cancel remaining jobs
   * 4. Persist all state before shutdown completes
   * 5. Emit 'stopped' event when complete
   *
   * @param options - Stop options for controlling shutdown behavior
   * @throws {FleetManagerShutdownError} If shutdown times out and cancelOnTimeout is false
   *
   * @example
   * ```typescript
   * // Normal shutdown - wait for jobs with default 30s timeout
   * await manager.stop();
   *
   * // Shutdown with custom timeout
   * await manager.stop({ timeout: 60000 });
   *
   * // Shutdown without waiting for jobs (not recommended)
   * await manager.stop({ waitForJobs: false });
   *
   * // Cancel jobs if they don't complete in time
   * await manager.stop({
   *   timeout: 30000,
   *   cancelOnTimeout: true,
   *   cancelTimeout: 10000,
   * });
   * ```
   */
  async stop(options?: FleetManagerStopOptions): Promise<void> {
    if (this.status !== "running" && this.status !== "starting") {
      this.logger.debug(`Stop called but status is '${this.status}', ignoring`);
      return;
    }

    const waitForJobs = options?.waitForJobs ?? true;
    const timeout = options?.timeout ?? 30000;
    const cancelOnTimeout = options?.cancelOnTimeout ?? false;
    const cancelTimeout = options?.cancelTimeout ?? 10000;

    this.logger.info("Stopping fleet manager...");
    this.status = "stopping";

    try {
      // Stop the scheduler - don't wait for jobs here, we'll handle it ourselves
      // This stops new triggers from being accepted
      if (this.scheduler) {
        try {
          await this.scheduler.stop({
            waitForJobs,
            timeout,
          });
        } catch (error) {
          // Check if it's a scheduler shutdown timeout
          if (error instanceof Error && error.name === "SchedulerShutdownError") {
            if (cancelOnTimeout) {
              // Cancel all running jobs
              this.logger.info("Timeout reached, cancelling running jobs...");
              await this.cancelRunningJobs(cancelTimeout);
            } else {
              // Re-throw the error
              this.status = "error";
              this.lastError = error.message;
              throw new FleetManagerShutdownError(error.message, {
                timedOut: true,
                cause: error,
              });
            }
          } else {
            throw error;
          }
        }
      }

      // Persist fleet state before completing shutdown
      await this.persistShutdownState();

      // Update state
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

  /**
   * Reload configuration without restarting the fleet
   *
   * This method provides hot configuration reload capability:
   * 1. Loads and validates the new configuration
   * 2. If validation fails, keeps the old configuration (fails gracefully)
   * 3. Running jobs continue with their original configuration
   * 4. New jobs will use the new configuration
   * 5. Updates the scheduler with new agent definitions and schedules
   * 6. Emits a 'config:reloaded' event with a list of changes
   *
   * @returns The reload result with change details
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {FleetManagerConfigError} If the new configuration is invalid (re-thrown after logging)
   *
   * @example
   * ```typescript
   * // Reload configuration
   * const result = await manager.reload();
   * console.log(`Reloaded with ${result.changes.length} changes`);
   *
   * // Subscribe to reload events
   * manager.on('config:reloaded', (payload) => {
   *   console.log(`Config reloaded: ${payload.changes.length} changes`);
   *   for (const change of payload.changes) {
   *     console.log(`  ${change.type} ${change.category}: ${change.name}`);
   *   }
   * });
   * ```
   */
  async reload(): Promise<ConfigReloadedPayload> {
    // Validate state - must be at least initialized
    if (this.status === "uninitialized") {
      throw new InvalidStateError(
        "reload",
        this.status,
        ["initialized", "starting", "running", "stopping", "stopped"]
      );
    }

    this.logger.info("Reloading configuration...");

    // Store old config for comparison
    const oldConfig = this.config;

    // Try to load new configuration
    let newConfig: ResolvedConfig;
    try {
      newConfig = await this.loadConfiguration();
    } catch (error) {
      // Log the error but don't update config - fail gracefully
      this.logger.error(
        `Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`
      );
      this.logger.info("Keeping existing configuration");

      // Re-throw so caller knows reload failed
      throw error;
    }

    // Compute changes between old and new config
    const changes = this.computeConfigChanges(oldConfig, newConfig);

    // Update the stored configuration
    this.config = newConfig;

    // Update the scheduler with new agents (if scheduler exists and is running)
    if (this.scheduler) {
      this.scheduler.setAgents(newConfig.agents);
      this.logger.debug(`Updated scheduler with ${newConfig.agents.length} agents`);
    }

    const timestamp = new Date().toISOString();

    // Build the reload payload
    const payload: ConfigReloadedPayload = {
      agentCount: newConfig.agents.length,
      agentNames: newConfig.agents.map((a) => a.name),
      configPath: newConfig.configPath,
      changes,
      timestamp,
    };

    // Emit the config:reloaded event
    this.emit("config:reloaded", payload);

    this.logger.info(
      `Configuration reloaded: ${newConfig.agents.length} agents, ${changes.length} changes`
    );

    return payload;
  }

  /**
   * Compute the list of changes between old and new configuration
   */
  private computeConfigChanges(
    oldConfig: ResolvedConfig | null,
    newConfig: ResolvedConfig
  ): ConfigChange[] {
    const changes: ConfigChange[] = [];

    const oldAgents = oldConfig?.agents ?? [];
    const newAgents = newConfig.agents;

    const oldAgentNames = new Set(oldAgents.map((a) => a.name));
    const newAgentNames = new Set(newAgents.map((a) => a.name));

    // Find added agents
    for (const agent of newAgents) {
      if (!oldAgentNames.has(agent.name)) {
        changes.push({
          type: "added",
          category: "agent",
          name: agent.name,
          details: agent.description,
        });

        // Also add all schedules for new agents
        if (agent.schedules) {
          for (const scheduleName of Object.keys(agent.schedules)) {
            changes.push({
              type: "added",
              category: "schedule",
              name: `${agent.name}/${scheduleName}`,
            });
          }
        }
      }
    }

    // Find removed agents
    for (const agent of oldAgents) {
      if (!newAgentNames.has(agent.name)) {
        changes.push({
          type: "removed",
          category: "agent",
          name: agent.name,
        });

        // Also mark all schedules as removed
        if (agent.schedules) {
          for (const scheduleName of Object.keys(agent.schedules)) {
            changes.push({
              type: "removed",
              category: "schedule",
              name: `${agent.name}/${scheduleName}`,
            });
          }
        }
      }
    }

    // Find modified agents and schedules
    for (const newAgent of newAgents) {
      const oldAgent = oldAgents.find((a) => a.name === newAgent.name);
      if (!oldAgent) {
        continue; // Already handled as "added"
      }

      // Check for agent-level modifications
      const agentModified = this.isAgentModified(oldAgent, newAgent);
      if (agentModified) {
        changes.push({
          type: "modified",
          category: "agent",
          name: newAgent.name,
          details: agentModified,
        });
      }

      // Check for schedule changes
      const oldScheduleNames = new Set(
        oldAgent.schedules ? Object.keys(oldAgent.schedules) : []
      );
      const newScheduleNames = new Set(
        newAgent.schedules ? Object.keys(newAgent.schedules) : []
      );

      // Added schedules
      for (const scheduleName of newScheduleNames) {
        if (!oldScheduleNames.has(scheduleName)) {
          changes.push({
            type: "added",
            category: "schedule",
            name: `${newAgent.name}/${scheduleName}`,
          });
        }
      }

      // Removed schedules
      for (const scheduleName of oldScheduleNames) {
        if (!newScheduleNames.has(scheduleName)) {
          changes.push({
            type: "removed",
            category: "schedule",
            name: `${newAgent.name}/${scheduleName}`,
          });
        }
      }

      // Modified schedules
      for (const scheduleName of newScheduleNames) {
        if (oldScheduleNames.has(scheduleName)) {
          const oldSchedule = oldAgent.schedules![scheduleName];
          const newSchedule = newAgent.schedules![scheduleName];

          if (this.isScheduleModified(oldSchedule, newSchedule)) {
            changes.push({
              type: "modified",
              category: "schedule",
              name: `${newAgent.name}/${scheduleName}`,
              details: this.getScheduleModificationDetails(oldSchedule, newSchedule),
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Check if an agent configuration has been modified
   * Returns a description of what changed, or null if not modified
   */
  private isAgentModified(
    oldAgent: ResolvedAgent,
    newAgent: ResolvedAgent
  ): string | null {
    const modifications: string[] = [];

    // Check key properties
    if (oldAgent.description !== newAgent.description) {
      modifications.push("description");
    }
    if (oldAgent.model !== newAgent.model) {
      modifications.push("model");
    }
    if (oldAgent.max_turns !== newAgent.max_turns) {
      modifications.push("max_turns");
    }
    if (oldAgent.system_prompt !== newAgent.system_prompt) {
      modifications.push("system_prompt");
    }

    // Check workspace
    const oldWorkspace =
      typeof oldAgent.workspace === "string"
        ? oldAgent.workspace
        : oldAgent.workspace?.root;
    const newWorkspace =
      typeof newAgent.workspace === "string"
        ? newAgent.workspace
        : newAgent.workspace?.root;
    if (oldWorkspace !== newWorkspace) {
      modifications.push("workspace");
    }

    // Check instances
    const oldMaxConcurrent = oldAgent.instances?.max_concurrent ?? 1;
    const newMaxConcurrent = newAgent.instances?.max_concurrent ?? 1;
    if (oldMaxConcurrent !== newMaxConcurrent) {
      modifications.push("max_concurrent");
    }

    return modifications.length > 0 ? modifications.join(", ") : null;
  }

  /**
   * Check if a schedule configuration has been modified
   */
  private isScheduleModified(
    oldSchedule: { type: string; interval?: string; expression?: string; prompt?: string },
    newSchedule: { type: string; interval?: string; expression?: string; prompt?: string }
  ): boolean {
    return (
      oldSchedule.type !== newSchedule.type ||
      oldSchedule.interval !== newSchedule.interval ||
      oldSchedule.expression !== newSchedule.expression ||
      oldSchedule.prompt !== newSchedule.prompt
    );
  }

  /**
   * Get a description of what changed in a schedule
   */
  private getScheduleModificationDetails(
    oldSchedule: { type: string; interval?: string; expression?: string; prompt?: string },
    newSchedule: { type: string; interval?: string; expression?: string; prompt?: string }
  ): string {
    const details: string[] = [];

    if (oldSchedule.type !== newSchedule.type) {
      details.push(`type: ${oldSchedule.type} → ${newSchedule.type}`);
    }
    if (oldSchedule.interval !== newSchedule.interval) {
      details.push(`interval: ${oldSchedule.interval ?? "none"} → ${newSchedule.interval ?? "none"}`);
    }
    if (oldSchedule.expression !== newSchedule.expression) {
      details.push(`expression: ${oldSchedule.expression ?? "none"} → ${newSchedule.expression ?? "none"}`);
    }
    if (oldSchedule.prompt !== newSchedule.prompt) {
      details.push("prompt changed");
    }

    return details.join("; ");
  }

  /**
   * Cancel all running jobs during shutdown
   *
   * @param cancelTimeout - Timeout for each job cancellation
   */
  private async cancelRunningJobs(cancelTimeout: number): Promise<void> {
    const jobsDir = join(this.stateDir, "jobs");

    // Get all running jobs from the fleet status
    const agentInfoList = await this.getAgentInfo();

    const runningJobIds: string[] = [];
    for (const agent of agentInfoList) {
      if (agent.currentJobId) {
        runningJobIds.push(agent.currentJobId);
      }
    }

    if (runningJobIds.length === 0) {
      this.logger.debug("No running jobs to cancel");
      return;
    }

    this.logger.info(`Cancelling ${runningJobIds.length} running job(s)...`);

    // Cancel all jobs in parallel
    const cancelPromises = runningJobIds.map(async (jobId) => {
      try {
        const result = await this.cancelJob(jobId, { timeout: cancelTimeout });
        this.logger.debug(
          `Cancelled job ${jobId}: ${result.terminationType}`
        );
      } catch (error) {
        this.logger.warn(
          `Failed to cancel job ${jobId}: ${(error as Error).message}`
        );
      }
    });

    await Promise.all(cancelPromises);
    this.logger.info("All jobs cancelled");
  }

  /**
   * Persist shutdown state to ensure all state is saved before completing
   */
  private async persistShutdownState(): Promise<void> {
    if (!this.stateDirInfo) {
      return;
    }

    // Persist fleet state
    const { writeFleetState } = await import("../state/fleet-state.js");

    // Read current state and update with stopped status
    const currentState = await this.readFleetStateSnapshot();

    // Update fleet-level state
    const updatedState = {
      ...currentState,
      fleet: {
        ...currentState.fleet,
        stoppedAt: new Date().toISOString(),
      },
    };

    try {
      await writeFleetState(this.stateDirInfo.stateFile, updatedState);
      this.logger.debug("Fleet state persisted");
    } catch (error) {
      this.logger.warn(`Failed to persist fleet state: ${(error as Error).message}`);
    }
  }

  // ===========================================================================
  // Manual Triggering (US-5)
  // ===========================================================================

  /**
   * Manually trigger an agent outside its normal schedule
   *
   * This method allows you to trigger an agent on-demand for testing or
   * handling urgent situations. You can optionally specify a schedule to use
   * for configuration (prompt, work source, etc.) or pass runtime options
   * to override defaults.
   *
   * @param agentName - Name of the agent to trigger
   * @param scheduleName - Optional schedule name to use for configuration
   * @param options - Optional runtime options to override defaults
   * @returns The created job information
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {AgentNotFoundError} If the agent doesn't exist
   * @throws {ScheduleNotFoundError} If the specified schedule doesn't exist
   * @throws {ConcurrencyLimitError} If the agent is at capacity and bypassConcurrencyLimit is false
   *
   * @example
   * ```typescript
   * // Trigger with agent defaults
   * const job = await manager.trigger('my-agent');
   *
   * // Trigger a specific schedule
   * const job = await manager.trigger('my-agent', 'hourly');
   *
   * // Trigger with custom prompt
   * const job = await manager.trigger('my-agent', undefined, {
   *   prompt: 'Review the latest security updates',
   * });
   *
   * // Force trigger even at capacity
   * const job = await manager.trigger('my-agent', undefined, {
   *   bypassConcurrencyLimit: true,
   * });
   * ```
   */
  async trigger(
    agentName: string,
    scheduleName?: string,
    options?: TriggerOptions
  ): Promise<TriggerResult> {
    // Validate state - must be at least initialized
    if (this.status === "uninitialized") {
      throw new InvalidStateError(
        "trigger",
        this.status,
        ["initialized", "running", "stopped"]
      );
    }

    // Find the agent
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    // If a schedule name is provided, validate it exists
    let schedule: { type: string; prompt?: string } | undefined;
    if (scheduleName) {
      if (!agent.schedules || !(scheduleName in agent.schedules)) {
        const availableSchedules = agent.schedules
          ? Object.keys(agent.schedules)
          : [];
        throw new ScheduleNotFoundError(agentName, scheduleName, {
          availableSchedules,
        });
      }
      schedule = agent.schedules[scheduleName];
    }

    // Check concurrency limits unless bypassed
    if (!options?.bypassConcurrencyLimit) {
      const maxConcurrent = agent.instances?.max_concurrent ?? 1;
      const runningCount = this.scheduler?.getRunningJobCount(agentName) ?? 0;

      if (runningCount >= maxConcurrent) {
        throw new ConcurrencyLimitError(agentName, runningCount, maxConcurrent);
      }
    }

    // Determine the prompt to use (priority: options > schedule > agent default)
    const prompt = options?.prompt ?? schedule?.prompt ?? undefined;

    // Create the job
    const jobsDir = join(this.stateDir, "jobs");
    const job = await createJob(jobsDir, {
      agent: agentName,
      trigger_type: "manual",
      schedule: scheduleName ?? null,
      prompt: prompt ?? null,
    });

    const timestamp = new Date().toISOString();

    this.logger.info(
      `Manually triggered ${agentName}${scheduleName ? `/${scheduleName}` : ""} - job ${job.id}`
    );

    // Emit job:created event
    this.emit("job:created", {
      job,
      agentName,
      scheduleName: scheduleName ?? null,
      timestamp,
    });

    // Build and return the result
    const result: TriggerResult = {
      jobId: job.id,
      agentName,
      scheduleName: scheduleName ?? null,
      startedAt: job.started_at,
      prompt,
    };

    return result;
  }

  // ===========================================================================
  // Job Control (US-6)
  // ===========================================================================

  /**
   * Cancel a running job gracefully
   *
   * This method cancels a running job by first sending SIGTERM to allow
   * graceful shutdown. If the job doesn't terminate within the timeout,
   * it will be forcefully killed with SIGKILL.
   *
   * @param jobId - ID of the job to cancel
   * @param options - Optional cancellation options
   * @param options.timeout - Time in ms to wait for graceful shutdown (default: 10000)
   * @returns Result of the cancellation operation
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {JobNotFoundError} If the job doesn't exist
   *
   * @example
   * ```typescript
   * // Cancel with default timeout
   * const result = await manager.cancelJob('job-2024-01-15-abc123');
   * console.log(`Job cancelled: ${result.terminationType}`);
   *
   * // Cancel with custom timeout
   * const result = await manager.cancelJob('job-2024-01-15-abc123', {
   *   timeout: 30000, // 30 seconds
   * });
   * ```
   */
  async cancelJob(
    jobId: string,
    options?: { timeout?: number }
  ): Promise<CancelJobResult> {
    // Validate state - must be at least initialized
    if (this.status === "uninitialized") {
      throw new InvalidStateError(
        "cancelJob",
        this.status,
        ["initialized", "running", "stopped"]
      );
    }

    const jobsDir = join(this.stateDir, "jobs");
    const timeout = options?.timeout ?? 10000; // Default 10 seconds

    // Get the job to verify it exists and check its status
    const job = await getJob(jobsDir, jobId, { logger: this.logger });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const timestamp = new Date().toISOString();
    let terminationType: 'graceful' | 'forced' | 'already_stopped';
    let durationSeconds: number | undefined;

    // If job is already not running, return early
    if (job.status !== "running" && job.status !== "pending") {
      this.logger.info(
        `Job ${jobId} is already ${job.status}, no cancellation needed`
      );

      terminationType = 'already_stopped';

      // Calculate duration if we have finished_at
      if (job.finished_at) {
        const startTime = new Date(job.started_at).getTime();
        const endTime = new Date(job.finished_at).getTime();
        durationSeconds = Math.round((endTime - startTime) / 1000);
      }

      return {
        jobId,
        success: true,
        terminationType,
        canceledAt: timestamp,
      };
    }

    // Calculate duration
    const startTime = new Date(job.started_at).getTime();
    const endTime = new Date(timestamp).getTime();
    durationSeconds = Math.round((endTime - startTime) / 1000);

    // Try to cancel via the scheduler if it has process tracking
    // For now, we'll update the job status directly since we don't have
    // direct process control yet. In a full implementation, this would
    // send SIGTERM to the process, wait, then SIGKILL if needed.

    // Note: The scheduler/executor would need to track job processes
    // and provide an API to cancel them. For this implementation,
    // we'll update the job state and emit events, assuming the executor
    // monitors the job status and handles cancellation.

    this.logger.info(`Cancelling job ${jobId} for agent ${job.agent}`);

    // Update job status to cancelled
    try {
      await updateJob(jobsDir, jobId, {
        status: "cancelled",
        exit_reason: "cancelled",
        finished_at: timestamp,
      });

      // Assume graceful termination for now
      // In a full implementation, this would be determined by whether
      // the process responded to SIGTERM or required SIGKILL
      terminationType = 'graceful';

    } catch (error) {
      this.logger.error(
        `Failed to update job status: ${(error as Error).message}`
      );
      throw new JobCancelError(jobId, 'process_error', {
        cause: error as Error,
      });
    }

    // Emit job:cancelled event
    const updatedJob = await getJob(jobsDir, jobId, { logger: this.logger });
    if (updatedJob) {
      this.emit("job:cancelled", {
        job: updatedJob,
        agentName: job.agent,
        terminationType,
        durationSeconds,
        timestamp,
      });
    }

    this.logger.info(
      `Job ${jobId} cancelled (${terminationType}) after ${durationSeconds}s`
    );

    return {
      jobId,
      success: true,
      terminationType,
      canceledAt: timestamp,
    };
  }

  /**
   * Fork a job to create a new job based on an existing one
   *
   * This method creates a new job that is based on an existing job's
   * configuration. The new job will have the same agent and can optionally
   * have modifications applied (different prompt, schedule, etc.).
   *
   * If the original job has a session ID, the new job will fork from that
   * session, preserving conversation context.
   *
   * @param jobId - ID of the job to fork
   * @param modifications - Optional modifications to apply to the forked job
   * @returns Result of the fork operation including the new job ID
   * @throws {InvalidStateError} If the fleet manager is not initialized
   * @throws {JobNotFoundError} If the original job doesn't exist
   * @throws {JobForkError} If the job cannot be forked (e.g., no session)
   *
   * @example
   * ```typescript
   * // Fork with same configuration
   * const result = await manager.forkJob('job-2024-01-15-abc123');
   * console.log(`Forked to: ${result.jobId}`);
   *
   * // Fork with modified prompt
   * const result = await manager.forkJob('job-2024-01-15-abc123', {
   *   prompt: 'Continue the previous task but focus on testing',
   * });
   *
   * // Fork with different schedule
   * const result = await manager.forkJob('job-2024-01-15-abc123', {
   *   schedule: 'nightly',
   * });
   * ```
   */
  async forkJob(
    jobId: string,
    modifications?: JobModifications
  ): Promise<ForkJobResult> {
    // Validate state - must be at least initialized
    if (this.status === "uninitialized") {
      throw new InvalidStateError(
        "forkJob",
        this.status,
        ["initialized", "running", "stopped"]
      );
    }

    const jobsDir = join(this.stateDir, "jobs");

    // Get the original job
    const originalJob = await getJob(jobsDir, jobId, { logger: this.logger });

    if (!originalJob) {
      throw new JobForkError(jobId, 'job_not_found');
    }

    // Verify the agent exists in config
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === originalJob.agent);

    if (!agent) {
      throw new JobForkError(jobId, 'agent_not_found', {
        message: `Agent "${originalJob.agent}" for job "${jobId}" not found in current configuration`,
      });
    }

    // Determine the prompt to use (priority: modifications > original job)
    const prompt = modifications?.prompt ?? originalJob.prompt ?? undefined;

    // Determine the schedule to use
    const scheduleName = modifications?.schedule ?? originalJob.schedule ?? undefined;

    // Create the new job
    const timestamp = new Date().toISOString();
    const newJob = await createJob(jobsDir, {
      agent: originalJob.agent,
      trigger_type: "fork",
      schedule: scheduleName ?? null,
      prompt: prompt ?? null,
      forked_from: jobId,
    });

    this.logger.info(
      `Forked job ${jobId} to new job ${newJob.id} for agent ${originalJob.agent}`
    );

    // Emit job:created event
    this.emit("job:created", {
      job: newJob,
      agentName: originalJob.agent,
      scheduleName: scheduleName ?? undefined,
      timestamp,
    });

    // Emit job:forked event
    this.emit("job:forked", {
      job: newJob,
      originalJob,
      agentName: originalJob.agent,
      timestamp,
    });

    return {
      jobId: newJob.id,
      forkedFromJobId: jobId,
      agentName: originalJob.agent,
      startedAt: newJob.started_at,
      prompt,
    };
  }

  // ===========================================================================
  // Log Streaming (US-11)
  // ===========================================================================

  /**
   * Stream all fleet logs as an async iterable
   *
   * Provides a unified stream of logs from all sources in the fleet including
   * agents, jobs, and the scheduler. Logs can be filtered by level and optionally
   * by agent or job.
   *
   * For completed jobs, this will replay their history (if includeHistory is true)
   * before streaming new logs from running jobs.
   *
   * @param options - Options for filtering and configuring the stream
   * @returns An async iterable of LogEntry objects
   *
   * @example
   * ```typescript
   * // Stream all info+ logs
   * for await (const log of manager.streamLogs()) {
   *   console.log(`[${log.level}] ${log.message}`);
   * }
   *
   * // Stream only errors for a specific agent
   * for await (const log of manager.streamLogs({
   *   level: 'error',
   *   agentName: 'my-agent',
   * })) {
   *   console.error(log.message);
   * }
   * ```
   */
  async *streamLogs(options?: LogStreamOptions): AsyncIterable<LogEntry> {
    const level = options?.level ?? "info";
    const includeHistory = options?.includeHistory ?? true;
    const historyLimit = options?.historyLimit ?? 1000;
    const agentFilter = options?.agentName;
    const jobFilter = options?.jobId;

    const jobsDir = join(this.stateDir, "jobs");
    const { readJobOutputAll } = await import("../state/job-output.js");

    // Replay historical logs if requested
    if (includeHistory) {
      // Get jobs to replay history from
      const jobsResult = await listJobs(
        jobsDir,
        agentFilter ? { agent: agentFilter } : {},
        { logger: this.logger }
      );

      // Filter by job ID if specified
      let jobs = jobsResult.jobs;
      if (jobFilter) {
        jobs = jobs.filter((j) => j.id === jobFilter);
      }

      // Sort by started_at ascending to replay in chronological order
      jobs.sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      );

      let yielded = 0;
      for (const job of jobs) {
        if (yielded >= historyLimit) break;

        // Read job output and convert to log entries
        const output = await readJobOutputAll(jobsDir, job.id, {
          skipInvalidLines: true,
          logger: this.logger,
        });

        for (const msg of output) {
          if (yielded >= historyLimit) break;

          const logEntry = this.jobOutputToLogEntry(job, msg);
          if (this.shouldYieldLog(logEntry, level, agentFilter, jobFilter)) {
            yield logEntry;
            yielded++;
          }
        }
      }
    }

    // For running jobs, subscribe to job:output events
    const outputQueue: LogEntry[] = [];
    let resolveWait: (() => void) | null = null;
    let stopped = false;

    const outputHandler = (payload: JobOutputPayload) => {
      if (stopped) return;

      const logEntry: LogEntry = {
        timestamp: payload.timestamp,
        level: "info",
        source: "job",
        agentName: payload.agentName,
        jobId: payload.jobId,
        message: payload.output,
      };

      if (this.shouldYieldLog(logEntry, level, agentFilter, jobFilter)) {
        outputQueue.push(logEntry);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      }
    };

    this.on("job:output", outputHandler);

    try {
      // Yield queued entries as they arrive
      while (!stopped) {
        while (outputQueue.length > 0) {
          const entry = outputQueue.shift()!;
          yield entry;
        }

        // Wait for more entries
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          // Add timeout to prevent hanging forever
          setTimeout(resolve, 1000);
        });
      }
    } finally {
      stopped = true;
      this.off("job:output", outputHandler);
    }
  }

  /**
   * Stream output from a specific job as an async iterable
   *
   * Provides a stream of log entries for a specific job. For completed jobs,
   * this will replay the job's history and then complete. For running jobs,
   * it will continue streaming until the job completes.
   *
   * @param jobId - The ID of the job to stream output from
   * @returns An async iterable of LogEntry objects
   * @throws {JobNotFoundError} If the job doesn't exist
   *
   * @example
   * ```typescript
   * // Stream job output
   * for await (const log of manager.streamJobOutput('job-2024-01-15-abc123')) {
   *   console.log(`[${log.level}] ${log.message}`);
   * }
   * ```
   */
  async *streamJobOutput(jobId: string): AsyncIterable<LogEntry> {
    const jobsDir = join(this.stateDir, "jobs");

    // Verify job exists
    const job = await getJob(jobsDir, jobId, { logger: this.logger });
    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const { readJobOutputAll, getJobOutputPath } = await import(
      "../state/job-output.js"
    );
    const { watch } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");

    const outputPath = getJobOutputPath(jobsDir, jobId);

    // First, replay all existing output
    const existingOutput = await readJobOutputAll(jobsDir, jobId, {
      skipInvalidLines: true,
      logger: this.logger,
    });

    for (const msg of existingOutput) {
      yield this.jobOutputToLogEntry(job, msg);
    }

    // If job is already completed, we're done
    if (job.status !== "running" && job.status !== "pending") {
      return;
    }

    // For running jobs, watch for new output
    const outputQueue: LogEntry[] = [];
    let resolveWait: (() => void) | null = null;
    let stopped = false;
    let lastReadPosition = 0;

    // Get current file position
    try {
      const stats = await stat(outputPath);
      lastReadPosition = stats.size;
    } catch {
      // File doesn't exist yet
    }

    // Watch for file changes
    let watcher: import("node:fs").FSWatcher | null = null;
    try {
      watcher = watch(outputPath, async (eventType) => {
        if (stopped || eventType !== "change") return;

        try {
          const currentStats = await stat(outputPath);
          if (currentStats.size > lastReadPosition) {
            // Read new content
            const fileStream = createReadStream(outputPath, {
              encoding: "utf-8",
              start: lastReadPosition,
            });

            const rl = createInterface({
              input: fileStream,
              crlfDelay: Infinity,
            });

            for await (const line of rl) {
              if (stopped) break;
              const trimmedLine = line.trim();
              if (trimmedLine === "") continue;

              try {
                const parsed = JSON.parse(trimmedLine);
                const logEntry = this.jobOutputToLogEntry(job, parsed);
                outputQueue.push(logEntry);
                if (resolveWait) {
                  resolveWait();
                  resolveWait = null;
                }
              } catch {
                // Skip malformed lines
              }
            }

            rl.close();
            fileStream.destroy();
            lastReadPosition = currentStats.size;
          }
        } catch (err) {
          this.logger.warn(
            `Error reading output file: ${(err as Error).message}`
          );
        }
      });
    } catch {
      // Can't watch file - might not exist yet
    }

    // Poll for job completion
    const checkJobComplete = async (): Promise<boolean> => {
      const currentJob = await getJob(jobsDir, jobId, { logger: this.logger });
      return (
        !currentJob ||
        (currentJob.status !== "running" && currentJob.status !== "pending")
      );
    };

    try {
      // Yield queued entries as they arrive
      while (!stopped) {
        while (outputQueue.length > 0) {
          const entry = outputQueue.shift()!;
          yield entry;
        }

        // Check if job is complete
        if (await checkJobComplete()) {
          stopped = true;
          break;
        }

        // Wait for more entries
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
          setTimeout(resolve, 1000);
        });
      }
    } finally {
      stopped = true;
      if (watcher) {
        watcher.close();
      }
    }
  }

  /**
   * Stream logs for a specific agent as an async iterable
   *
   * Provides a stream of log entries for all jobs belonging to a specific agent.
   * For completed jobs, this will replay their history. For running jobs, it
   * will continue streaming until the iterator is stopped.
   *
   * @param agentName - The name of the agent to stream logs for
   * @returns An async iterable of LogEntry objects
   * @throws {AgentNotFoundError} If the agent doesn't exist in the configuration
   *
   * @example
   * ```typescript
   * // Stream all logs for an agent
   * for await (const log of manager.streamAgentLogs('my-agent')) {
   *   console.log(`[${log.jobId}] ${log.message}`);
   * }
   * ```
   */
  async *streamAgentLogs(agentName: string): AsyncIterable<LogEntry> {
    // Verify agent exists
    const agents = this.config?.agents ?? [];
    const agent = agents.find((a) => a.name === agentName);

    if (!agent) {
      throw new AgentNotFoundError(agentName, {
        availableAgents: agents.map((a) => a.name),
      });
    }

    // Delegate to streamLogs with agent filter
    yield* this.streamLogs({
      agentName,
      includeHistory: true,
    });
  }

  // ===========================================================================
  // Log Streaming Helpers (US-11)
  // ===========================================================================

  /**
   * Convert a job output message to a LogEntry
   */
  private jobOutputToLogEntry(
    job: JobMetadata,
    msg: { type: string; content?: string; timestamp?: string }
  ): LogEntry {
    // Determine log level based on message type
    let level: LogLevel = "info";
    if (msg.type === "error") {
      level = "error";
    } else if (msg.type === "system") {
      level = "debug";
    }

    return {
      timestamp: msg.timestamp ?? new Date().toISOString(),
      level,
      source: "job",
      agentName: job.agent,
      jobId: job.id,
      scheduleName: job.schedule ?? undefined,
      message: msg.content ?? "",
      data: { type: msg.type },
    };
  }

  /**
   * Determine if a log entry should be yielded based on filters
   */
  private shouldYieldLog(
    entry: LogEntry,
    minLevel: LogLevel,
    agentFilter?: string,
    jobFilter?: string
  ): boolean {
    // Check log level
    const levelOrder: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    if (levelOrder[entry.level] < levelOrder[minLevel]) {
      return false;
    }

    // Check agent filter
    if (agentFilter && entry.agentName !== agentFilter) {
      return false;
    }

    // Check job filter
    if (jobFilter && entry.jobId !== jobFilter) {
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Load configuration with proper error handling
   */
  private async loadConfiguration(): Promise<ResolvedConfig> {
    try {
      return await loadConfig(this.configPath);
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        throw new FleetManagerConfigError(
          `Configuration file not found. ${error.message}`,
          this.configPath,
          { cause: error }
        );
      }

      if (error instanceof ConfigError) {
        throw new FleetManagerConfigError(
          `Invalid configuration: ${error.message}`,
          this.configPath,
          { cause: error }
        );
      }

      throw new FleetManagerConfigError(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`,
        this.configPath,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Initialize state directory with proper error handling
   */
  private async initializeStateDir(): Promise<StateDirectory> {
    try {
      return await initStateDirectory({ path: this.stateDir });
    } catch (error) {
      throw new FleetManagerStateDirError(
        `Failed to initialize state directory: ${error instanceof Error ? error.message : String(error)}`,
        this.stateDir,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Start the scheduler asynchronously (don't block on the loop)
   */
  private startSchedulerAsync(agents: ResolvedAgent[]): void {
    // Start the scheduler loop in the background
    // The scheduler.start() method runs the loop and returns when stopped
    this.scheduler!.start(agents).catch((error) => {
      // Only handle errors if we're still supposed to be running
      if (this.status === "running" || this.status === "starting") {
        this.logger.error(`Scheduler error: ${error instanceof Error ? error.message : String(error)}`);
        this.status = "error";
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Handle schedule trigger callback from scheduler
   */
  private async handleScheduleTrigger(info: TriggerInfo): Promise<void> {
    const { agent, scheduleName, schedule } = info;
    const timestamp = new Date().toISOString();

    this.logger.info(`Triggering ${agent.name}/${scheduleName}`);

    // Emit legacy event for backwards compatibility
    this.emit("schedule:trigger", agent.name, scheduleName);

    // Emit new typed event with full payload
    this.emit("schedule:triggered", {
      agentName: agent.name,
      scheduleName,
      schedule,
      timestamp,
    });

    try {
      // For now, just log the trigger
      // In future PRDs, this will actually run the agent via the runner
      this.logger.debug(
        `Schedule ${scheduleName} triggered for agent ${agent.name} ` +
          `(type: ${schedule.type}, prompt: ${schedule.prompt ?? "default"})`
      );

      // Emit legacy completion event for backwards compatibility
      this.emit("schedule:complete", agent.name, scheduleName);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Error in ${agent.name}/${scheduleName}: ${err.message}`);
      // Emit legacy error event for backwards compatibility
      this.emit("schedule:error", agent.name, scheduleName, err);
      throw error;
    }
  }

  // ===========================================================================
  // Event Emission Helpers (US-2)
  // ===========================================================================

  /**
   * Emit a config:reloaded event
   *
   * Called when configuration is hot-reloaded.
   */
  emitConfigReloaded(payload: ConfigReloadedPayload): void {
    this.emit("config:reloaded", payload);
  }

  /**
   * Emit an agent:started event
   *
   * Called when an agent is started/registered with the fleet.
   */
  emitAgentStarted(payload: AgentStartedPayload): void {
    this.emit("agent:started", payload);
  }

  /**
   * Emit an agent:stopped event
   *
   * Called when an agent is stopped/unregistered from the fleet.
   */
  emitAgentStopped(payload: AgentStoppedPayload): void {
    this.emit("agent:stopped", payload);
  }

  /**
   * Emit a schedule:skipped event
   *
   * Called when a schedule check is skipped (already running, disabled, etc.).
   */
  emitScheduleSkipped(payload: ScheduleSkippedPayload): void {
    this.emit("schedule:skipped", payload);
  }

  /**
   * Emit a job:created event
   *
   * Called when a new job is created.
   */
  emitJobCreated(payload: JobCreatedPayload): void {
    this.emit("job:created", payload);
  }

  /**
   * Emit a job:output event
   *
   * Called when a job produces output during execution.
   * This enables real-time streaming of output to UIs.
   */
  emitJobOutput(payload: JobOutputPayload): void {
    this.emit("job:output", payload);
  }

  /**
   * Emit a job:completed event
   *
   * Called when a job completes successfully.
   */
  emitJobCompleted(payload: JobCompletedPayload): void {
    this.emit("job:completed", payload);
  }

  /**
   * Emit a job:failed event
   *
   * Called when a job fails.
   */
  emitJobFailed(payload: JobFailedPayload): void {
    this.emit("job:failed", payload);
  }

  /**
   * Emit a job:cancelled event (US-6)
   *
   * Called when a job is cancelled.
   */
  emitJobCancelled(payload: JobCancelledPayload): void {
    this.emit("job:cancelled", payload);
  }

  /**
   * Emit a job:forked event (US-6)
   *
   * Called when a job is forked to create a new job.
   */
  emitJobForked(payload: JobForkedPayload): void {
    this.emit("job:forked", payload);
  }
}
