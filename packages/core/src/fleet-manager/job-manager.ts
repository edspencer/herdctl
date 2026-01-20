/**
 * JobManager class for job management (US-4)
 *
 * Provides job history queries, real-time output streaming,
 * and job retention management.
 */

import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import { createReadStream } from "node:fs";
import { stat, readdir, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

import {
  getJob as getJobFromState,
  listJobs as listJobsFromState,
  deleteJob as deleteJobFromState,
  type ListJobsFilter,
  type JobMetadataOptions,
} from "../state/index.js";
import type { JobMetadata, JobStatus } from "../state/schemas/job-metadata.js";
import {
  readJobOutput,
  readJobOutputAll,
  getJobOutputPath,
} from "../state/job-output.js";
import type { JobOutputMessage } from "../state/schemas/job-output.js";
import { JobNotFoundError } from "./errors.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Job filter options for querying jobs
 *
 * Extends the base filter with additional options for the JobManager API.
 */
export interface JobFilter {
  /** Filter by agent name */
  agent?: string;
  /** Filter by job status */
  status?: JobStatus;
  /** Filter jobs started on or after this date (ISO string or Date) */
  startedAfter?: string | Date;
  /** Filter jobs started on or before this date (ISO string or Date) */
  startedBefore?: string | Date;
  /** Limit the number of results returned */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * A complete job including metadata and optional output
 */
export interface Job extends JobMetadata {
  /** Job output messages (only populated when requested) */
  output?: JobOutputMessage[];
}

/**
 * Result of listing jobs
 */
export interface JobListResult {
  /** Array of jobs matching the filter */
  jobs: Job[];
  /** Total count of matching jobs (before pagination) */
  total: number;
  /** Number of jobs that failed to parse */
  errors: number;
}

/**
 * Options for retrieving a single job
 */
export interface GetJobOptions {
  /** Include full output in the response */
  includeOutput?: boolean;
}

/**
 * Job retention configuration
 */
export interface JobRetentionConfig {
  /**
   * Maximum number of jobs to keep per agent
   * Default: 100
   */
  maxJobsPerAgent?: number;

  /**
   * Maximum total jobs to keep fleet-wide (optional cap)
   * If set, oldest jobs will be removed when this limit is exceeded
   */
  maxTotalJobs?: number;
}

/**
 * Options for creating a JobManager
 */
export interface JobManagerOptions {
  /** Path to the jobs directory (.herdctl/jobs) */
  jobsDir: string;

  /** Logger for warnings and errors */
  logger?: JobManagerLogger;

  /** Job retention configuration */
  retention?: JobRetentionConfig;
}

/**
 * Logger interface for job manager operations
 */
export interface JobManagerLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
}

/**
 * Events emitted by the job output stream
 */
export interface JobOutputStreamEvents {
  /** Emitted when a new output message is available */
  message: [message: JobOutputMessage];
  /** Emitted when the job completes */
  end: [];
  /** Emitted when an error occurs */
  error: [error: Error];
}

/**
 * Stream for real-time job output
 */
export interface JobOutputStream {
  /** Stop watching for new output */
  stop(): void;
  /** Subscribe to output events */
  on<K extends keyof JobOutputStreamEvents>(
    event: K,
    listener: (...args: JobOutputStreamEvents[K]) => void
  ): this;
  /** Unsubscribe from output events */
  off<K extends keyof JobOutputStreamEvents>(
    event: K,
    listener: (...args: JobOutputStreamEvents[K]) => void
  ): this;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_JOBS_PER_AGENT = 100;

// =============================================================================
// JobManager Class
// =============================================================================

/**
 * JobManager provides job history queries and real-time output streaming
 *
 * This class manages job history, provides filtering and pagination,
 * and enables real-time streaming of job output for running jobs.
 *
 * @example
 * ```typescript
 * const jobManager = new JobManager({
 *   jobsDir: '.herdctl/jobs',
 *   retention: { maxJobsPerAgent: 100, maxTotalJobs: 1000 }
 * });
 *
 * // Get all jobs for an agent
 * const result = await jobManager.getJobs({ agent: 'my-agent' });
 *
 * // Get a specific job with output
 * const job = await jobManager.getJob('job-2024-01-15-abc123', {
 *   includeOutput: true
 * });
 *
 * // Stream output from a running job
 * const stream = await jobManager.streamJobOutput('job-2024-01-15-abc123');
 * stream.on('message', (msg) => console.log(msg));
 * ```
 */
export class JobManager {
  private readonly jobsDir: string;
  private readonly logger: JobManagerLogger;
  private readonly retention: Required<JobRetentionConfig>;

  constructor(options: JobManagerOptions) {
    this.jobsDir = options.jobsDir;
    this.logger = options.logger ?? { warn: console.warn };
    this.retention = {
      maxJobsPerAgent: options.retention?.maxJobsPerAgent ?? DEFAULT_MAX_JOBS_PER_AGENT,
      maxTotalJobs: options.retention?.maxTotalJobs ?? 0,
    };
  }

  // ===========================================================================
  // Public Query Methods
  // ===========================================================================

  /**
   * Get a list of jobs with optional filtering
   *
   * Jobs are returned sorted by started_at in descending order (most recent first).
   *
   * @param filter - Optional filter criteria
   * @returns List of jobs matching the filter
   *
   * @example
   * ```typescript
   * // Get all jobs
   * const { jobs } = await jobManager.getJobs();
   *
   * // Filter by agent
   * const { jobs } = await jobManager.getJobs({ agent: 'my-agent' });
   *
   * // Filter by status with pagination
   * const { jobs, total } = await jobManager.getJobs({
   *   status: 'completed',
   *   limit: 10,
   *   offset: 0
   * });
   *
   * // Filter by date range
   * const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
   * const { jobs } = await jobManager.getJobs({
   *   startedAfter: yesterday
   * });
   * ```
   */
  async getJobs(filter: JobFilter = {}): Promise<JobListResult> {
    // Map our filter to the state module's filter
    const stateFilter: ListJobsFilter = {
      agent: filter.agent,
      status: filter.status,
      startedAfter: filter.startedAfter,
      startedBefore: filter.startedBefore,
    };

    const result = await listJobsFromState(this.jobsDir, stateFilter, {
      logger: this.logger,
    });

    // Apply pagination
    const total = result.jobs.length;
    let jobs = result.jobs;

    if (filter.offset !== undefined && filter.offset > 0) {
      jobs = jobs.slice(filter.offset);
    }

    if (filter.limit !== undefined && filter.limit > 0) {
      jobs = jobs.slice(0, filter.limit);
    }

    return {
      jobs,
      total,
      errors: result.errors,
    };
  }

  /**
   * Get a specific job by ID
   *
   * @param jobId - The job ID to retrieve
   * @param options - Options for retrieving the job
   * @returns The job with optional output
   * @throws {JobNotFoundError} If the job doesn't exist
   *
   * @example
   * ```typescript
   * // Get job metadata only
   * const job = await jobManager.getJob('job-2024-01-15-abc123');
   *
   * // Get job with full output
   * const job = await jobManager.getJob('job-2024-01-15-abc123', {
   *   includeOutput: true
   * });
   * if (job.output) {
   *   for (const msg of job.output) {
   *     console.log(msg);
   *   }
   * }
   * ```
   */
  async getJob(jobId: string, options: GetJobOptions = {}): Promise<Job> {
    const jobMetadata = await getJobFromState(this.jobsDir, jobId, {
      logger: this.logger,
    });

    if (!jobMetadata) {
      throw new JobNotFoundError(jobId);
    }

    const job: Job = { ...jobMetadata };

    if (options.includeOutput) {
      job.output = await readJobOutputAll(this.jobsDir, jobId, {
        skipInvalidLines: true,
        logger: this.logger,
      });
    }

    return job;
  }

  // ===========================================================================
  // Output Streaming
  // ===========================================================================

  /**
   * Stream output from a running job in real-time
   *
   * This method returns a stream that emits new output messages as they
   * are written to the job's output file. The stream continues until
   * the job completes or `stop()` is called.
   *
   * For completed jobs, this will replay all existing output and then
   * emit 'end'.
   *
   * @param jobId - The job ID to stream output from
   * @returns A stream that emits output messages
   * @throws {JobNotFoundError} If the job doesn't exist
   *
   * @example
   * ```typescript
   * const stream = await jobManager.streamJobOutput('job-2024-01-15-abc123');
   *
   * stream.on('message', (msg) => {
   *   if (msg.type === 'assistant') {
   *     process.stdout.write(msg.content ?? '');
   *   }
   * });
   *
   * stream.on('end', () => {
   *   console.log('Job completed');
   * });
   *
   * stream.on('error', (err) => {
   *   console.error('Error:', err);
   * });
   *
   * // Later, stop streaming
   * stream.stop();
   * ```
   */
  async streamJobOutput(jobId: string): Promise<JobOutputStream> {
    // Verify job exists
    const job = await getJobFromState(this.jobsDir, jobId, {
      logger: this.logger,
    });

    if (!job) {
      throw new JobNotFoundError(jobId);
    }

    const outputPath = getJobOutputPath(this.jobsDir, jobId);
    const emitter = new EventEmitter() as EventEmitter & JobOutputStream;
    let stopped = false;
    let watcher: FSWatcher | null = null;
    let lastReadPosition = 0;

    // Add stop method
    emitter.stop = () => {
      stopped = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    };

    // Start streaming in the background
    this.startOutputStream(
      emitter,
      job,
      outputPath,
      () => stopped,
      (w) => {
        watcher = w;
      },
      () => lastReadPosition,
      (pos) => {
        lastReadPosition = pos;
      }
    ).catch((error) => {
      if (!stopped) {
        emitter.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });

    return emitter;
  }

  /**
   * Internal: Start the output stream
   */
  private async startOutputStream(
    emitter: EventEmitter,
    job: JobMetadata,
    outputPath: string,
    isStopped: () => boolean,
    setWatcher: (w: FSWatcher | null) => void,
    getPosition: () => number,
    setPosition: (pos: number) => void
  ): Promise<void> {
    // First, read all existing output
    try {
      const stats = await stat(outputPath);
      await this.readOutputFromPosition(
        emitter,
        outputPath,
        0,
        isStopped
      );
      setPosition(stats.size);
    } catch (error) {
      // File doesn't exist yet - that's fine for running jobs
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    // If job is already completed, emit end
    if (job.status !== "running" && job.status !== "pending") {
      emitter.emit("end");
      return;
    }

    // Watch for changes to the output file
    try {
      const watcher = watch(outputPath, async (eventType) => {
        if (isStopped()) return;

        if (eventType === "change") {
          try {
            const currentStats = await stat(outputPath);
            const currentPosition = getPosition();

            if (currentStats.size > currentPosition) {
              // New data available
              await this.readOutputFromPosition(
                emitter,
                outputPath,
                currentPosition,
                isStopped
              );
              setPosition(currentStats.size);
            }
          } catch (err) {
            if (!isStopped()) {
              this.logger.warn(
                `Error reading output file: ${(err as Error).message}`
              );
            }
          }
        }
      });

      setWatcher(watcher);

      // Also poll for job completion
      this.pollJobCompletion(emitter, job.id, isStopped, () => {
        watcher.close();
        setWatcher(null);
      });
    } catch (error) {
      // Can't watch file - might not exist yet
      // For running jobs, we'll just poll for completion
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.pollJobCompletion(emitter, job.id, isStopped, () => {});
      } else {
        throw error;
      }
    }
  }

  /**
   * Internal: Read output from a specific position in the file
   */
  private async readOutputFromPosition(
    emitter: EventEmitter,
    outputPath: string,
    startPosition: number,
    isStopped: () => boolean
  ): Promise<void> {
    const fileStream = createReadStream(outputPath, {
      encoding: "utf-8",
      start: startPosition,
    });

    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        if (isStopped()) break;

        const trimmedLine = line.trim();
        if (trimmedLine === "") continue;

        try {
          const parsed = JSON.parse(trimmedLine) as JobOutputMessage;
          emitter.emit("message", parsed);
        } catch {
          // Skip malformed lines
          this.logger.warn?.(`Skipping malformed JSON in output file`);
        }
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }
  }

  /**
   * Internal: Poll for job completion
   */
  private pollJobCompletion(
    emitter: EventEmitter,
    jobId: string,
    isStopped: () => boolean,
    onComplete: () => void
  ): void {
    const pollInterval = setInterval(async () => {
      if (isStopped()) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const job = await getJobFromState(this.jobsDir, jobId, {
          logger: this.logger,
        });

        if (!job || (job.status !== "running" && job.status !== "pending")) {
          clearInterval(pollInterval);
          onComplete();
          emitter.emit("end");
        }
      } catch (error) {
        this.logger.warn?.(`Error polling job status: ${(error as Error).message}`);
      }
    }, 1000);
  }

  // ===========================================================================
  // Job Retention
  // ===========================================================================

  /**
   * Apply retention policy to remove old jobs
   *
   * This method removes jobs that exceed the configured retention limits.
   * It should be called periodically (e.g., after job completion) to
   * maintain the job history size.
   *
   * @returns Number of jobs deleted
   *
   * @example
   * ```typescript
   * const deleted = await jobManager.applyRetention();
   * console.log(`Deleted ${deleted} old jobs`);
   * ```
   */
  async applyRetention(): Promise<number> {
    let totalDeleted = 0;

    // Get all jobs grouped by agent
    const result = await listJobsFromState(this.jobsDir, {}, {
      logger: this.logger,
    });

    // Group jobs by agent
    const jobsByAgent = new Map<string, JobMetadata[]>();
    for (const job of result.jobs) {
      const agentJobs = jobsByAgent.get(job.agent) ?? [];
      agentJobs.push(job);
      jobsByAgent.set(job.agent, agentJobs);
    }

    // Apply per-agent retention
    for (const [agent, jobs] of jobsByAgent) {
      // Jobs are already sorted by started_at descending (most recent first)
      if (jobs.length > this.retention.maxJobsPerAgent) {
        const toDelete = jobs.slice(this.retention.maxJobsPerAgent);
        for (const job of toDelete) {
          const deleted = await this.deleteJobAndOutput(job.id);
          if (deleted) {
            totalDeleted++;
            this.logger.debug?.(
              `Deleted old job ${job.id} for agent ${agent} (retention)`
            );
          }
        }
      }
    }

    // Apply fleet-wide retention if configured
    if (this.retention.maxTotalJobs > 0) {
      // Re-fetch remaining jobs
      const remainingResult = await listJobsFromState(this.jobsDir, {}, {
        logger: this.logger,
      });

      if (remainingResult.jobs.length > this.retention.maxTotalJobs) {
        const toDelete = remainingResult.jobs.slice(this.retention.maxTotalJobs);
        for (const job of toDelete) {
          const deleted = await this.deleteJobAndOutput(job.id);
          if (deleted) {
            totalDeleted++;
            this.logger.debug?.(
              `Deleted old job ${job.id} (fleet-wide retention)`
            );
          }
        }
      }
    }

    return totalDeleted;
  }

  /**
   * Get the current retention configuration
   */
  getRetentionConfig(): Required<JobRetentionConfig> {
    return { ...this.retention };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Delete a job and its output file
   */
  private async deleteJobAndOutput(jobId: string): Promise<boolean> {
    // Delete the metadata file
    const deleted = await deleteJobFromState(this.jobsDir, jobId);

    // Also delete the output file if it exists
    const outputPath = getJobOutputPath(this.jobsDir, jobId);
    try {
      await unlink(outputPath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn(`Failed to delete output file ${outputPath}: ${(error as Error).message}`);
      }
    }

    return deleted;
  }
}
