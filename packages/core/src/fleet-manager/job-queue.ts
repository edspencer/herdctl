/**
 * Job Queue module for concurrency control
 *
 * Provides a job queue with per-agent and fleet-wide concurrency limits.
 * Jobs queue when limits are reached and are processed FIFO within priority levels.
 *
 * @example
 * ```typescript
 * const queue = new JobQueue({
 *   defaultAgentConcurrency: 1,
 *   fleetConcurrency: 10,
 * });
 *
 * // Enqueue a job
 * const result = queue.enqueue({
 *   agentName: 'my-agent',
 *   scheduleName: 'hourly',
 *   priority: 5,
 * });
 *
 * if (result.queued) {
 *   console.log(`Job queued at position ${result.position}`);
 * } else {
 *   console.log(`Job ready to run: ${result.jobId}`);
 * }
 *
 * // Dequeue when ready
 * const job = queue.dequeue('my-agent');
 * ```
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/logger.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Priority level for queued jobs
 * Lower numbers = higher priority
 * Default priority is 5 (normal)
 */
export type JobPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Configuration options for the JobQueue
 */
export interface JobQueueOptions {
  /**
   * Default concurrency limit per agent
   * Can be overridden per-agent via setAgentConcurrency()
   * Default: 1
   */
  defaultAgentConcurrency?: number;

  /**
   * Fleet-wide concurrency limit (optional)
   * When set, limits total concurrent jobs across all agents
   * Default: undefined (no fleet-wide limit)
   */
  fleetConcurrency?: number;

  /**
   * Logger for queue operations
   */
  logger?: JobQueueLogger;
}

/**
 * Logger interface for job queue operations
 */
export interface JobQueueLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * A queued job entry
 */
export interface QueuedJob {
  /**
   * Unique ID for this queued job
   */
  id: string;

  /**
   * Name of the agent this job is for
   */
  agentName: string;

  /**
   * Name of the schedule that triggered this job (optional)
   */
  scheduleName?: string;

  /**
   * Job priority (1-10, lower = higher priority)
   * Default: 5 (normal)
   */
  priority: JobPriority;

  /**
   * ISO timestamp when the job was queued
   */
  queuedAt: string;

  /**
   * Prompt override for this job (optional)
   */
  prompt?: string;

  /**
   * Whether this is from a scheduled trigger
   */
  isScheduled: boolean;
}

/**
 * Options for enqueueing a job
 */
export interface EnqueueOptions {
  /**
   * Name of the agent to run
   */
  agentName: string;

  /**
   * Name of the schedule (optional)
   */
  scheduleName?: string;

  /**
   * Job priority (1-10, lower = higher priority)
   * Default: 5
   */
  priority?: JobPriority;

  /**
   * Prompt override (optional)
   */
  prompt?: string;

  /**
   * Whether this is from a scheduled trigger
   * Scheduled triggers are NOT queued - they emit schedule:skipped instead
   * Default: false
   */
  isScheduled?: boolean;
}

/**
 * Result of enqueueing a job
 */
export interface EnqueueResult {
  /**
   * The queued job ID
   */
  jobId: string;

  /**
   * Whether the job was actually queued (vs ready to run immediately)
   */
  queued: boolean;

  /**
   * Position in the queue (1-based) if queued
   * Undefined if not queued (ready to run)
   */
  position?: number;

  /**
   * Reason the job was queued, if applicable
   */
  reason?: "agent_at_capacity" | "fleet_at_capacity";
}

/**
 * Result when a scheduled job is skipped due to concurrency
 */
export interface ScheduleSkipResult {
  /**
   * The agent that was at capacity
   */
  agentName: string;

  /**
   * The schedule that was skipped
   */
  scheduleName?: string;

  /**
   * Reason for skipping
   */
  reason: "agent_at_capacity" | "fleet_at_capacity";

  /**
   * Current running count
   */
  currentRunning: number;

  /**
   * The limit that was hit
   */
  limit: number;
}

/**
 * Status of the job queue for a specific agent
 */
export interface AgentQueueStatus {
  /**
   * Name of the agent
   */
  agentName: string;

  /**
   * Number of jobs currently running for this agent
   */
  runningCount: number;

  /**
   * Maximum concurrent jobs allowed for this agent
   */
  maxConcurrent: number;

  /**
   * Number of jobs queued for this agent
   */
  queuedCount: number;

  /**
   * The queued jobs for this agent (in order)
   */
  queuedJobs: QueuedJob[];
}

/**
 * Overall queue status
 */
export interface QueueStatus {
  /**
   * Total jobs currently running across all agents
   */
  totalRunning: number;

  /**
   * Fleet-wide concurrency limit (if set)
   */
  fleetConcurrency: number | null;

  /**
   * Default per-agent concurrency limit
   */
  defaultAgentConcurrency: number;

  /**
   * Total jobs queued across all agents
   */
  totalQueued: number;

  /**
   * Per-agent queue status
   */
  agents: Map<string, AgentQueueStatus>;
}

/**
 * Events emitted by the JobQueue
 */
export interface JobQueueEventMap {
  /**
   * Emitted when a job is enqueued
   */
  "job:queued": [job: QueuedJob, position: number];

  /**
   * Emitted when a job is dequeued and ready to run
   */
  "job:dequeued": [job: QueuedJob];

  /**
   * Emitted when a scheduled trigger is skipped due to concurrency
   */
  "schedule:skipped": [result: ScheduleSkipResult];

  /**
   * Emitted when a job completes and capacity becomes available
   */
  "capacity:available": [agentName: string, available: number];
}

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(): JobQueueLogger {
  return createLogger("job-queue");
}

// =============================================================================
// JobQueue Class
// =============================================================================

/**
 * Job queue with concurrency control
 *
 * Manages a FIFO queue (within priority levels) with:
 * - Per-agent concurrency limits
 * - Optional fleet-wide concurrency limit
 * - Priority-based ordering (lower number = higher priority)
 *
 * Scheduled triggers are NOT queued - instead, a schedule:skipped event
 * is emitted when the agent or fleet is at capacity.
 */
export class JobQueue extends EventEmitter {
  private readonly defaultAgentConcurrency: number;
  private readonly fleetConcurrency: number | null;
  private readonly logger: JobQueueLogger;

  // Per-agent concurrency limits (overrides default)
  private readonly agentConcurrencyLimits: Map<string, number> = new Map();

  // Currently running jobs per agent
  private readonly runningJobs: Map<string, Set<string>> = new Map();

  // Queued jobs per agent (ordered by priority then FIFO)
  private readonly queuedJobs: Map<string, QueuedJob[]> = new Map();

  // Total running jobs across fleet
  private totalRunningCount = 0;

  constructor(options: JobQueueOptions = {}) {
    super();
    this.defaultAgentConcurrency = options.defaultAgentConcurrency ?? 1;
    this.fleetConcurrency = options.fleetConcurrency ?? null;
    this.logger = options.logger ?? createDefaultLogger();
  }

  // ===========================================================================
  // Configuration Methods
  // ===========================================================================

  /**
   * Set the concurrency limit for a specific agent
   *
   * @param agentName - The agent name
   * @param limit - The concurrency limit (must be >= 1)
   */
  setAgentConcurrency(agentName: string, limit: number): void {
    if (limit < 1) {
      throw new Error(`Concurrency limit must be >= 1, got ${limit}`);
    }
    this.agentConcurrencyLimits.set(agentName, limit);
    this.logger.debug(
      `Set concurrency limit for agent "${agentName}" to ${limit}`
    );
  }

  /**
   * Get the concurrency limit for an agent
   *
   * @param agentName - The agent name
   * @returns The concurrency limit (agent-specific or default)
   */
  getAgentConcurrency(agentName: string): number {
    return (
      this.agentConcurrencyLimits.get(agentName) ?? this.defaultAgentConcurrency
    );
  }

  /**
   * Get the fleet-wide concurrency limit
   *
   * @returns The fleet concurrency limit or null if not set
   */
  getFleetConcurrency(): number | null {
    return this.fleetConcurrency;
  }

  /**
   * Get the default agent concurrency limit
   *
   * @returns The default agent concurrency limit
   */
  getDefaultAgentConcurrency(): number {
    return this.defaultAgentConcurrency;
  }

  // ===========================================================================
  // Queue Operations
  // ===========================================================================

  /**
   * Check if there's capacity to run a job for an agent
   *
   * @param agentName - The agent name
   * @returns Object with canRun boolean and reason if false
   */
  checkCapacity(agentName: string): {
    canRun: boolean;
    reason?: "agent_at_capacity" | "fleet_at_capacity";
    currentRunning: number;
    limit: number;
  } {
    const agentLimit = this.getAgentConcurrency(agentName);
    const agentRunning = this.getRunningCount(agentName);

    // Check agent-level capacity
    if (agentRunning >= agentLimit) {
      return {
        canRun: false,
        reason: "agent_at_capacity",
        currentRunning: agentRunning,
        limit: agentLimit,
      };
    }

    // Check fleet-level capacity
    if (
      this.fleetConcurrency !== null &&
      this.totalRunningCount >= this.fleetConcurrency
    ) {
      return {
        canRun: false,
        reason: "fleet_at_capacity",
        currentRunning: this.totalRunningCount,
        limit: this.fleetConcurrency,
      };
    }

    return {
      canRun: true,
      currentRunning: agentRunning,
      limit: agentLimit,
    };
  }

  /**
   * Enqueue a job or return immediately if capacity is available
   *
   * For scheduled triggers (isScheduled: true), jobs are NOT queued.
   * Instead, a schedule:skipped event is emitted and null is returned.
   *
   * @param options - Enqueue options
   * @returns EnqueueResult if job is queued/ready, or null if scheduled and at capacity
   */
  enqueue(options: EnqueueOptions): EnqueueResult | null {
    const {
      agentName,
      scheduleName,
      priority = 5,
      prompt,
      isScheduled = false,
    } = options;

    const capacity = this.checkCapacity(agentName);

    // If we have capacity, the job can run immediately
    if (capacity.canRun) {
      const jobId = this.generateJobId();
      this.logger.debug(
        `Job ${jobId} for agent "${agentName}" can run immediately`
      );
      return {
        jobId,
        queued: false,
      };
    }

    // At capacity - handle scheduled vs manual triggers differently
    if (isScheduled) {
      // Scheduled triggers are NOT queued - emit skip event
      const skipResult: ScheduleSkipResult = {
        agentName,
        scheduleName,
        reason: capacity.reason!,
        currentRunning: capacity.currentRunning,
        limit: capacity.limit,
      };

      this.logger.info(
        `Schedule "${scheduleName}" for agent "${agentName}" skipped: ${capacity.reason} (${capacity.currentRunning}/${capacity.limit})`
      );

      this.emit("schedule:skipped", skipResult);
      return null;
    }

    // Manual triggers get queued
    const job: QueuedJob = {
      id: this.generateJobId(),
      agentName,
      scheduleName,
      priority: priority as JobPriority,
      queuedAt: new Date().toISOString(),
      prompt,
      isScheduled: false,
    };

    // Get or create the agent's queue
    if (!this.queuedJobs.has(agentName)) {
      this.queuedJobs.set(agentName, []);
    }
    const agentQueue = this.queuedJobs.get(agentName)!;

    // Insert job in priority order (lower priority number = higher priority)
    // Within same priority, FIFO order is maintained
    let insertIndex = agentQueue.length;
    for (let i = 0; i < agentQueue.length; i++) {
      if (agentQueue[i].priority > job.priority) {
        insertIndex = i;
        break;
      }
    }
    agentQueue.splice(insertIndex, 0, job);

    const position = insertIndex + 1;
    this.logger.info(
      `Job ${job.id} for agent "${agentName}" queued at position ${position} (${capacity.reason})`
    );

    this.emit("job:queued", job, position);

    return {
      jobId: job.id,
      queued: true,
      position,
      reason: capacity.reason,
    };
  }

  /**
   * Dequeue the next job for an agent
   *
   * Returns the next queued job if one exists, otherwise null.
   * Does NOT check capacity - caller should check capacity first.
   *
   * @param agentName - The agent name
   * @returns The next queued job or null
   */
  dequeue(agentName: string): QueuedJob | null {
    const agentQueue = this.queuedJobs.get(agentName);
    if (!agentQueue || agentQueue.length === 0) {
      return null;
    }

    const job = agentQueue.shift()!;
    this.logger.debug(
      `Dequeued job ${job.id} for agent "${agentName}" (${agentQueue.length} remaining)`
    );

    this.emit("job:dequeued", job);
    return job;
  }

  /**
   * Peek at the next job in the queue without removing it
   *
   * @param agentName - The agent name
   * @returns The next queued job or null
   */
  peek(agentName: string): QueuedJob | null {
    const agentQueue = this.queuedJobs.get(agentName);
    if (!agentQueue || agentQueue.length === 0) {
      return null;
    }
    return agentQueue[0];
  }

  /**
   * Remove a specific job from the queue
   *
   * @param jobId - The job ID to remove
   * @returns true if the job was found and removed
   */
  remove(jobId: string): boolean {
    for (const [agentName, queue] of this.queuedJobs) {
      const index = queue.findIndex((job) => job.id === jobId);
      if (index !== -1) {
        queue.splice(index, 1);
        this.logger.debug(
          `Removed job ${jobId} from agent "${agentName}" queue`
        );
        return true;
      }
    }
    return false;
  }

  // ===========================================================================
  // Running Job Tracking
  // ===========================================================================

  /**
   * Mark a job as running for an agent
   *
   * @param agentName - The agent name
   * @param jobId - The job ID
   */
  markRunning(agentName: string, jobId: string): void {
    if (!this.runningJobs.has(agentName)) {
      this.runningJobs.set(agentName, new Set());
    }
    this.runningJobs.get(agentName)!.add(jobId);
    this.totalRunningCount++;

    this.logger.debug(
      `Marked job ${jobId} as running for agent "${agentName}" (total: ${this.totalRunningCount})`
    );
  }

  /**
   * Mark a job as completed for an agent
   *
   * This frees up capacity and may allow queued jobs to run.
   *
   * @param agentName - The agent name
   * @param jobId - The job ID
   */
  markCompleted(agentName: string, jobId: string): void {
    const agentJobs = this.runningJobs.get(agentName);
    if (agentJobs?.has(jobId)) {
      agentJobs.delete(jobId);
      this.totalRunningCount--;

      const available = this.getAgentConcurrency(agentName) - agentJobs.size;
      this.logger.debug(
        `Marked job ${jobId} as completed for agent "${agentName}" (${available} slots available)`
      );

      this.emit("capacity:available", agentName, available);
    }
  }

  /**
   * Get the number of running jobs for an agent
   *
   * @param agentName - The agent name
   * @returns Number of currently running jobs
   */
  getRunningCount(agentName: string): number {
    return this.runningJobs.get(agentName)?.size ?? 0;
  }

  /**
   * Get the total number of running jobs across all agents
   *
   * @returns Total running job count
   */
  getTotalRunningCount(): number {
    return this.totalRunningCount;
  }

  /**
   * Get the IDs of running jobs for an agent
   *
   * @param agentName - The agent name
   * @returns Set of running job IDs
   */
  getRunningJobIds(agentName: string): Set<string> {
    return this.runningJobs.get(agentName) ?? new Set();
  }

  // ===========================================================================
  // Status Queries
  // ===========================================================================

  /**
   * Get the queue status for a specific agent
   *
   * @param agentName - The agent name
   * @returns Agent queue status
   */
  getAgentQueueStatus(agentName: string): AgentQueueStatus {
    const queuedJobs = this.queuedJobs.get(agentName) ?? [];
    return {
      agentName,
      runningCount: this.getRunningCount(agentName),
      maxConcurrent: this.getAgentConcurrency(agentName),
      queuedCount: queuedJobs.length,
      queuedJobs: [...queuedJobs], // Return a copy
    };
  }

  /**
   * Get the overall queue status
   *
   * @returns Overall queue status with per-agent details
   */
  getQueueStatus(): QueueStatus {
    const agents = new Map<string, AgentQueueStatus>();

    // Collect all known agent names from both running and queued
    const allAgentNames = new Set<string>([
      ...this.runningJobs.keys(),
      ...this.queuedJobs.keys(),
    ]);

    let totalQueued = 0;
    for (const agentName of allAgentNames) {
      const status = this.getAgentQueueStatus(agentName);
      agents.set(agentName, status);
      totalQueued += status.queuedCount;
    }

    return {
      totalRunning: this.totalRunningCount,
      fleetConcurrency: this.fleetConcurrency,
      defaultAgentConcurrency: this.defaultAgentConcurrency,
      totalQueued,
      agents,
    };
  }

  /**
   * Get the queue depth (number of queued jobs) for an agent
   *
   * @param agentName - The agent name
   * @returns Number of queued jobs
   */
  getQueueDepth(agentName: string): number {
    return this.queuedJobs.get(agentName)?.length ?? 0;
  }

  /**
   * Get the total queue depth across all agents
   *
   * @returns Total number of queued jobs
   */
  getTotalQueueDepth(): number {
    let total = 0;
    for (const queue of this.queuedJobs.values()) {
      total += queue.length;
    }
    return total;
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Clear all queued jobs (does not affect running jobs)
   */
  clearQueue(): void {
    const totalCleared = this.getTotalQueueDepth();
    this.queuedJobs.clear();
    this.logger.info(`Cleared ${totalCleared} queued jobs`);
  }

  /**
   * Clear queued jobs for a specific agent
   *
   * @param agentName - The agent name
   * @returns Number of jobs cleared
   */
  clearAgentQueue(agentName: string): number {
    const queue = this.queuedJobs.get(agentName);
    if (!queue) return 0;

    const count = queue.length;
    this.queuedJobs.delete(agentName);
    this.logger.debug(`Cleared ${count} queued jobs for agent "${agentName}"`);
    return count;
  }

  /**
   * Reset all state (running jobs, queued jobs, concurrency limits)
   */
  reset(): void {
    this.runningJobs.clear();
    this.queuedJobs.clear();
    this.agentConcurrencyLimits.clear();
    this.totalRunningCount = 0;
    this.logger.info("Job queue reset");
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Generate a unique job ID
   */
  private generateJobId(): string {
    const date = new Date().toISOString().slice(0, 10);
    const uuid = randomUUID().slice(0, 8);
    return `queued-${date}-${uuid}`;
  }
}
