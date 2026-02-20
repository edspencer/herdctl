/**
 * Type definitions for the FleetManager module
 *
 * Provides interfaces for fleet manager configuration, state tracking,
 * and event definitions.
 */

import type { SchedulerLogger } from "../scheduler/types.js";
import type { WorkItem } from "../work-sources/types.js";

// Re-export event types from dedicated event-types module
export type {
  AgentStartedPayload,
  AgentStoppedPayload,
  ConfigChange,
  ConfigReloadedPayload,
  FleetManagerEventListener,
  FleetManagerEventMap,
  FleetManagerEventName,
  FleetManagerEventPayload,
  // Job control events (US-6)
  JobCancelledPayload,
  JobCompletedPayload,
  JobCreatedPayload,
  JobFailedPayload,
  JobForkedPayload,
  JobOutputPayload,
  ScheduleSkippedPayload,
  ScheduleTriggeredPayload,
  SlackErrorPayload,
  SlackMessageErrorPayload,
  // Slack manager events
  SlackMessageHandledPayload,
  SlackSessionLifecyclePayload,
} from "./event-types.js";

// =============================================================================
// Fleet Manager Options
// =============================================================================

/**
 * Logger interface for fleet manager operations
 * Reuses the same interface as the scheduler for consistency
 */
export type FleetManagerLogger = SchedulerLogger;

/**
 * Options for configuring the FleetManager
 *
 * @example
 * ```typescript
 * const options: FleetManagerOptions = {
 *   configPath: './herdctl.yaml',
 *   stateDir: './.herdctl',
 * };
 * ```
 */
export interface FleetManagerOptions {
  /**
   * Path to the herdctl.yaml configuration file
   *
   * Can be:
   * - An absolute path to the config file
   * - A relative path to the config file
   * - A directory path (will search for herdctl.yaml/herdctl.yml)
   *
   * If not provided, will auto-discover by searching up from cwd.
   */
  configPath?: string;

  /**
   * Path to the state directory (e.g., .herdctl)
   *
   * This directory stores:
   * - Job artifacts and outputs
   * - Session state
   * - Schedule state
   * - Logs
   *
   * Will be created if it doesn't exist.
   */
  stateDir: string;

  /**
   * Logger for fleet manager operations
   *
   * Default: console-based logger with [fleet-manager] prefix
   */
  logger?: FleetManagerLogger;

  /**
   * Interval in milliseconds between scheduler checks
   *
   * Default: 1000 (1 second)
   */
  checkInterval?: number;

  /**
   * Runtime overrides for fleet configuration
   *
   * These overrides are applied after loading and parsing the configuration file,
   * allowing CLI flags or programmatic callers to override specific config values.
   *
   * Currently supports overriding fleet-level settings like `web`.
   */
  configOverrides?: FleetConfigOverrides;
}

/**
 * Runtime overrides for fleet configuration
 *
 * Allows CLI flags or programmatic callers to override specific fleet config values
 * after the config file has been loaded and parsed.
 */
export interface FleetConfigOverrides {
  /** Override web dashboard configuration */
  web?: {
    /** Enable/disable the web dashboard */
    enabled?: boolean;
    /** Override the web dashboard port */
    port?: number;
    /** Override the web dashboard host */
    host?: string;
  };
}

// =============================================================================
// Fleet Manager State
// =============================================================================

/**
 * Current status of the fleet manager
 */
export type FleetManagerStatus =
  | "uninitialized" // Initial state, before initialize() is called
  | "initialized" // After initialize(), ready to start
  | "starting" // During start(), transitioning to running
  | "running" // Scheduler is active, processing schedules
  | "stopping" // During stop(), shutting down gracefully
  | "stopped" // After stop(), fully shut down
  | "error"; // An error occurred during operation

/**
 * Detailed fleet manager state for monitoring
 */
export interface FleetManagerState {
  /**
   * Current fleet manager status
   */
  status: FleetManagerStatus;

  /**
   * ISO timestamp of when the fleet manager was initialized
   */
  initializedAt: string | null;

  /**
   * ISO timestamp of when the fleet manager was started
   */
  startedAt: string | null;

  /**
   * ISO timestamp of when the fleet manager was stopped
   */
  stoppedAt: string | null;

  /**
   * Number of agents loaded from configuration
   */
  agentCount: number;

  /**
   * Last error message if status is 'error'
   */
  lastError: string | null;
}

// =============================================================================
// Fleet Status Query Types (US-3)
// =============================================================================

/**
 * Schedule information within an AgentInfo
 *
 * Combines static schedule configuration with runtime state.
 */
export interface ScheduleInfo {
  /**
   * Name of the schedule
   */
  name: string;

  /**
   * Name of the agent this schedule belongs to
   */
  agentName: string;

  /**
   * Schedule type (interval, cron, webhook, chat)
   */
  type: string;

  /**
   * Interval expression (e.g., "5m", "1h") for interval schedules
   */
  interval?: string;

  /**
   * Cron expression for cron schedules
   */
  expression?: string;

  /**
   * Current schedule status (idle, running, disabled)
   */
  status: "idle" | "running" | "disabled";

  /**
   * ISO timestamp of when this schedule last ran
   */
  lastRunAt: string | null;

  /**
   * ISO timestamp of when this schedule will next run
   */
  nextRunAt: string | null;

  /**
   * Last error message if the schedule encountered an error
   */
  lastError: string | null;
}

/**
 * Information about a single agent for status queries
 *
 * Combines static configuration with runtime state.
 *
 * @example
 * ```typescript
 * const agent = manager.getAgent('my-agent');
 * console.log(`Agent: ${agent.name}`);
 * console.log(`Status: ${agent.status}`);
 * console.log(`Schedules: ${agent.scheduleCount}`);
 * ```
 */
/**
 * Chat connector status within AgentInfo
 *
 * This is a unified type that works for all chat platforms (Discord, Slack, etc.).
 */
export interface AgentChatStatus {
  /**
   * Whether this agent has this chat platform configured
   */
  configured: boolean;

  /**
   * Connection status (only present if configured)
   */
  connectionStatus?:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnecting"
    | "error";

  /**
   * Bot username (only present if connected)
   */
  botUsername?: string;

  /**
   * Last error message (only present if status is 'error')
   */
  lastError?: string;
}

export interface AgentInfo {
  /**
   * Agent local name (display name within its fleet)
   */
  name: string;

  /**
   * Dot-separated qualified name (e.g., "herdctl.security-auditor")
   * For root-level agents, equals the local name.
   * This is the primary key used for lookups throughout the system.
   */
  qualifiedName: string;

  /**
   * Fleet hierarchy path segments (e.g., ["herdctl"] or ["other-project", "frontend"])
   * Empty array for agents directly in the root fleet.
   */
  fleetPath: string[];

  /**
   * Agent description from configuration
   */
  description?: string;

  /**
   * Current agent status
   */
  status: "idle" | "running" | "error";

  /**
   * ID of the currently running job, if any
   */
  currentJobId: string | null;

  /**
   * ID of the last completed job
   */
  lastJobId: string | null;

  /**
   * Maximum concurrent instances allowed for this agent
   */
  maxConcurrent: number;

  /**
   * Number of currently running instances
   */
  runningCount: number;

  /**
   * Error message if status is 'error'
   */
  errorMessage: string | null;

  /**
   * Number of schedules configured for this agent
   */
  scheduleCount: number;

  /**
   * Detailed information about each schedule
   */
  schedules: ScheduleInfo[];

  /**
   * Model configured for this agent (if any)
   */
  model?: string;

  /**
   * Working directory path for this agent
   */
  working_directory?: string;

  /**
   * Chat connector statuses by platform
   *
   * Keys are platform names (e.g., "discord", "slack").
   * Values are the connector status for that platform.
   */
  chat?: Record<string, AgentChatStatus>;
}

/**
 * Summary counts for quick fleet overview
 */
export interface FleetCounts {
  /**
   * Total number of configured agents
   */
  totalAgents: number;

  /**
   * Number of agents currently idle
   */
  idleAgents: number;

  /**
   * Number of agents currently running jobs
   */
  runningAgents: number;

  /**
   * Number of agents in error state
   */
  errorAgents: number;

  /**
   * Total number of schedules across all agents
   */
  totalSchedules: number;

  /**
   * Number of schedules currently running
   */
  runningSchedules: number;

  /**
   * Total number of jobs currently running
   */
  runningJobs: number;
}

/**
 * Overall fleet status information
 *
 * Provides a comprehensive snapshot of the fleet state for CLI `herdctl status`.
 *
 * @example
 * ```typescript
 * const status = manager.getStatus();
 * console.log(`Fleet: ${status.state}`);
 * console.log(`Uptime: ${status.uptimeSeconds}s`);
 * console.log(`Agents: ${status.counts.totalAgents}`);
 * console.log(`Running jobs: ${status.counts.runningJobs}`);
 * ```
 */
export interface FleetStatus {
  /**
   * Current fleet manager state
   */
  state: FleetManagerStatus;

  /**
   * Fleet uptime in seconds (time since started)
   * Null if fleet has never been started
   */
  uptimeSeconds: number | null;

  /**
   * ISO timestamp of when the fleet was initialized
   */
  initializedAt: string | null;

  /**
   * ISO timestamp of when the fleet was started
   */
  startedAt: string | null;

  /**
   * ISO timestamp of when the fleet was stopped
   */
  stoppedAt: string | null;

  /**
   * Summary counts for agents and jobs
   */
  counts: FleetCounts;

  /**
   * Scheduler state information
   */
  scheduler: {
    /**
     * Scheduler status (stopped, running, stopping)
     */
    status: "stopped" | "running" | "stopping";

    /**
     * Total number of schedule checks performed
     */
    checkCount: number;

    /**
     * Total number of triggers fired
     */
    triggerCount: number;

    /**
     * ISO timestamp of last schedule check
     */
    lastCheckAt: string | null;

    /**
     * Check interval in milliseconds
     */
    checkIntervalMs: number;
  };

  /**
   * Last error message if state is 'error'
   */
  lastError: string | null;
}

// =============================================================================
// Trigger Options (US-5)
// =============================================================================

/**
 * Options for manually triggering an agent
 *
 * These options allow overriding agent defaults and passing runtime
 * configuration when triggering an agent outside its normal schedule.
 *
 * @example
 * ```typescript
 * // Trigger with default schedule settings
 * const job = await manager.trigger('my-agent');
 *
 * // Trigger a specific schedule
 * const job = await manager.trigger('my-agent', 'hourly');
 *
 * // Trigger with runtime options
 * const job = await manager.trigger('my-agent', 'hourly', {
 *   prompt: 'Review the latest PR',
 *   workItems: [{ id: '123', title: 'Bug fix PR' }],
 * });
 * ```
 */
export interface TriggerOptions {
  /**
   * How this trigger was initiated
   *
   * Connectors should set this to identify the source platform:
   * - `"discord"` — triggered from Discord
   * - `"slack"` — triggered from Slack
   * - `"web"` — triggered from the web chat UI
   * - `"manual"` — triggered from CLI or API (default)
   */
  triggerType?: string;

  /**
   * Override the prompt for this trigger
   *
   * This prompt will be used instead of the schedule's configured prompt
   * or the agent's default prompt.
   */
  prompt?: string;

  /**
   * Session ID to resume for conversation continuity
   *
   * When provided, the Claude Agent SDK will resume the conversation
   * from this session, maintaining context from previous interactions.
   * This is typically used for chat-based triggers like Discord/Slack.
   *
   * - `string` — resume this specific session
   * - `null` — explicitly start a fresh session (skip agent-level fallback)
   * - `undefined` — use agent-level session fallback (for CLI/schedule use)
   */
  resume?: string | null;

  /**
   * Work items to process during this trigger
   *
   * These work items will be passed to the agent instead of fetching
   * from the configured work source.
   */
  workItems?: WorkItem[];

  /**
   * Whether to bypass concurrency limits for this trigger
   *
   * When true, the agent will be triggered even if it's at max_concurrent.
   * Use with caution - this can lead to resource contention.
   *
   * Default: false
   */
  bypassConcurrencyLimit?: boolean;

  /**
   * Callback for receiving messages during execution
   *
   * This callback is invoked for each message received from the SDK during
   * agent execution, enabling real-time streaming of output to the caller.
   *
   * @example
   * ```typescript
   * await manager.trigger('my-agent', undefined, {
   *   onMessage: (message) => {
   *     if (message.type === 'assistant' && message.content) {
   *       console.log(message.content);
   *     }
   *   },
   * });
   * ```
   */
  onMessage?: (message: import("../runner/types.js").SDKMessage) => void | Promise<void>;

  /**
   * MCP servers to inject into the agent's runtime session
   *
   * These servers are merged with the agent's config-declared MCP servers
   * at execution time. Used for runtime tool injection (e.g., file sending).
   *
   * Each runtime handles transport conversion:
   * - SDKRuntime: in-process MCP via createSdkMcpServer()
   * - ContainerRunner: HTTP MCP bridge over Docker network
   */
  injectedMcpServers?: Record<string, import("../runner/types.js").InjectedMcpServerDef>;
}

/**
 * Result of a manual trigger operation
 *
 * Contains information about the job that was created.
 */
export interface TriggerResult {
  /**
   * Unique identifier for the created job
   */
  jobId: string;

  /**
   * Name of the agent that was triggered
   */
  agentName: string;

  /**
   * Name of the schedule used (if any)
   */
  scheduleName: string | null;

  /**
   * ISO timestamp when the job was created
   */
  startedAt: string;

  /**
   * The prompt that was used for the trigger
   */
  prompt?: string;

  /**
   * Whether the job completed successfully
   */
  success: boolean;

  /**
   * Session ID from the Claude Agent SDK
   *
   * This can be used for subsequent requests to resume
   * the conversation with context preserved.
   *
   * Note: Only trust this session ID if `success` is true.
   * Failed jobs may return session IDs that are invalid.
   */
  sessionId?: string;

  /**
   * Error if the job failed
   */
  error?: Error;

  /**
   * Detailed error information for programmatic access
   */
  errorDetails?: import("../runner/types.js").RunnerErrorDetails;
}

// =============================================================================
// Stop Options (US-8)
// =============================================================================

/**
 * Options for stopping the FleetManager gracefully
 *
 * These options control how the fleet manager handles running jobs
 * during shutdown.
 *
 * @example
 * ```typescript
 * // Stop with default options (wait for jobs, 30s timeout)
 * await manager.stop();
 *
 * // Stop with custom timeout
 * await manager.stop({ timeout: 60000 });
 *
 * // Stop immediately without waiting for jobs
 * await manager.stop({ waitForJobs: false });
 *
 * // Force cancel jobs after timeout
 * await manager.stop({
 *   timeout: 30000,
 *   cancelOnTimeout: true,
 * });
 * ```
 */
export interface FleetManagerStopOptions {
  /**
   * Whether to wait for running jobs to complete before stopping
   *
   * When true, the stop operation will wait for all currently running
   * jobs to complete before finishing the shutdown. When false, the
   * fleet manager will stop immediately, leaving jobs running in the
   * background (not recommended).
   *
   * Default: true
   */
  waitForJobs?: boolean;

  /**
   * Maximum time in milliseconds to wait for running jobs to complete
   *
   * Only applies when waitForJobs is true. After this timeout:
   * - If cancelOnTimeout is true, running jobs will be cancelled
   * - If cancelOnTimeout is false (default), a FleetManagerShutdownError is thrown
   *
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Whether to cancel jobs that are still running after the timeout
   *
   * When true, jobs that don't complete within the timeout will be
   * cancelled via the cancelJob method. The fleet manager will wait
   * for the cancellation to complete before emitting 'stopped'.
   *
   * When false, a FleetManagerShutdownError is thrown if jobs are
   * still running after timeout.
   *
   * Default: false
   */
  cancelOnTimeout?: boolean;

  /**
   * Timeout in milliseconds for cancelling individual jobs
   *
   * Only applies when cancelOnTimeout is true. This is the time
   * given to each job to respond to SIGTERM before being forcefully
   * killed with SIGKILL.
   *
   * Default: 10000 (10 seconds)
   */
  cancelTimeout?: number;
}

// =============================================================================
// Job Control Types (US-6)
// =============================================================================

// =============================================================================
// Log Streaming Types (US-11)
// =============================================================================

/**
 * Log levels for filtering log entries
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Source type for log entries
 */
export type LogSource = "fleet" | "agent" | "job" | "scheduler";

/**
 * A single log entry from the fleet
 *
 * @example
 * ```typescript
 * const entry: LogEntry = {
 *   timestamp: '2024-01-15T10:30:00.000Z',
 *   level: 'info',
 *   source: 'agent',
 *   agentName: 'my-agent',
 *   jobId: 'job-2024-01-15-abc123',
 *   message: 'Processing work item',
 *   data: { itemId: '456' },
 * };
 * ```
 */
export interface LogEntry {
  /**
   * ISO timestamp when the log was generated
   */
  timestamp: string;

  /**
   * Log level
   */
  level: LogLevel;

  /**
   * Source of the log entry
   */
  source: LogSource;

  /**
   * Agent name (if applicable)
   */
  agentName?: string;

  /**
   * Job ID (if applicable)
   */
  jobId?: string;

  /**
   * Schedule name (if applicable)
   */
  scheduleName?: string;

  /**
   * Log message
   */
  message: string;

  /**
   * Additional structured data
   */
  data?: Record<string, unknown>;
}

/**
 * Options for streaming logs
 *
 * @example
 * ```typescript
 * // Stream all logs at info level and above
 * const stream = manager.streamLogs({ level: 'info' });
 *
 * // Stream only error logs for a specific agent
 * const stream = manager.streamLogs({
 *   level: 'error',
 *   agentName: 'my-agent',
 * });
 * ```
 */
export interface LogStreamOptions {
  /**
   * Minimum log level to include
   *
   * Filters logs to only include entries at this level or higher severity.
   * Severity order: debug < info < warn < error
   *
   * Default: 'info'
   */
  level?: LogLevel;

  /**
   * Filter logs to a specific agent
   */
  agentName?: string;

  /**
   * Filter logs to a specific job
   */
  jobId?: string;

  /**
   * Whether to include historical logs before streaming new ones
   *
   * When true, completed jobs will replay their history before
   * streaming ends. When false, only new logs are streamed.
   *
   * Default: true
   */
  includeHistory?: boolean;

  /**
   * Maximum number of historical entries to include
   *
   * Only applies when includeHistory is true.
   *
   * Default: 1000
   */
  historyLimit?: number;
}

/**
 * Modifications to apply when forking a job
 *
 * Allows overriding specific configuration when creating a new job
 * based on an existing one. Any field not specified will be copied
 * from the original job.
 *
 * @example
 * ```typescript
 * // Fork with a modified prompt
 * const newJob = await manager.forkJob('job-2024-01-15-abc123', {
 *   prompt: 'Retry the previous task with more detailed logging',
 * });
 *
 * // Fork to a different schedule
 * const newJob = await manager.forkJob('job-2024-01-15-abc123', {
 *   schedule: 'daily',
 * });
 * ```
 */
export interface JobModifications {
  /**
   * Override the prompt for the forked job
   */
  prompt?: string;

  /**
   * Override the schedule name for the forked job
   */
  schedule?: string;

  /**
   * Work items to process in the forked job
   * (replaces work items from the original job)
   */
  workItems?: WorkItem[];
}

/**
 * Result of canceling a job
 */
export interface CancelJobResult {
  /**
   * ID of the job that was canceled
   */
  jobId: string;

  /**
   * Whether the cancellation was successful
   */
  success: boolean;

  /**
   * How the job was terminated
   * - 'graceful': Job responded to SIGTERM and exited cleanly
   * - 'forced': Job was killed with SIGKILL after timeout
   * - 'already_stopped': Job was not running when cancel was called
   */
  terminationType: "graceful" | "forced" | "already_stopped";

  /**
   * ISO timestamp when the job was canceled
   */
  canceledAt: string;
}

/**
 * Result of forking a job
 */
export interface ForkJobResult {
  /**
   * ID of the newly created job
   */
  jobId: string;

  /**
   * ID of the job that was forked
   */
  forkedFromJobId: string;

  /**
   * Name of the agent executing the new job
   */
  agentName: string;

  /**
   * ISO timestamp when the forked job was created
   */
  startedAt: string;

  /**
   * The prompt that was used for the forked job
   */
  prompt?: string;
}
