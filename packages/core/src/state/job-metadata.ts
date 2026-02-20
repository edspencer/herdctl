/**
 * Job metadata persistence operations
 *
 * Provides CRUD operations for job metadata files stored at
 * .herdctl/jobs/job-<id>.yaml
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { StateFileError } from "./errors.js";
import {
  type CreateJobOptions,
  createJobMetadata,
  generateJobId,
  type JobMetadata,
  JobMetadataSchema,
  type JobStatus,
} from "./schemas/job-metadata.js";
import { atomicWriteYaml } from "./utils/atomic.js";
import { buildSafeFilePath } from "./utils/path-safety.js";
import { safeReadYaml } from "./utils/reads.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for reading/writing job metadata
 */
export interface JobMetadataOptions {
  /** Logger for warnings */
  logger?: JobLogger;
}

/**
 * Logger interface for job operations
 */
export interface JobLogger {
  warn: (message: string) => void;
}

/**
 * Partial updates for job metadata
 */
export type JobMetadataUpdates = Partial<
  Omit<JobMetadata, "id" | "agent" | "trigger_type" | "started_at">
>;

/**
 * Filter options for listing jobs
 */
export interface ListJobsFilter {
  /** Filter by agent name */
  agent?: string;
  /** Filter by job status */
  status?: JobStatus;
  /** Filter jobs started on or after this date (ISO string or Date) */
  startedAfter?: string | Date;
  /** Filter jobs started on or before this date (ISO string or Date) */
  startedBefore?: string | Date;
}

/**
 * Result of listing jobs
 */
export interface ListJobsResult {
  /** Array of job metadata */
  jobs: JobMetadata[];
  /** Number of jobs that failed to parse */
  errors: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the file path for a job
 *
 * Uses buildSafeFilePath for defense-in-depth against path traversal attacks.
 * Job IDs are also validated at the schema level with a strict regex pattern,
 * but this provides an additional safety check at the point of file path construction.
 */
function getJobFilePath(jobsDir: string, jobId: string): string {
  return buildSafeFilePath(jobsDir, jobId, ".yaml");
}

/**
 * Parse an ISO date string or Date to a Date object
 */
function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Calculate duration in seconds between two ISO timestamps
 */
function calculateDuration(startedAt: string, finishedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  return Math.round((end - start) / 1000);
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Create a new job and persist it to disk
 *
 * Creates a job metadata file at .herdctl/jobs/job-<id>.yaml
 *
 * @param jobsDir - Path to the jobs directory
 * @param options - Job creation options
 * @returns The created job metadata
 * @throws StateFileError if the file cannot be written
 *
 * @example
 * ```typescript
 * const job = await createJob('/path/to/.herdctl/jobs', {
 *   agent: 'my-agent',
 *   trigger_type: 'manual',
 *   prompt: 'Fix the bug in auth.ts'
 * });
 * console.log(job.id); // 'job-2024-01-15-abc123'
 * ```
 */
export async function createJob(jobsDir: string, options: CreateJobOptions): Promise<JobMetadata> {
  const job = createJobMetadata(options, generateJobId);

  // Validate the generated job metadata
  const validated = JobMetadataSchema.parse(job);

  const filePath = getJobFilePath(jobsDir, validated.id);

  try {
    await atomicWriteYaml(filePath, validated);
  } catch (error) {
    throw new StateFileError(
      `Failed to create job file: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error,
    );
  }

  return validated;
}

/**
 * Update an existing job's metadata
 *
 * Uses atomic writes to prevent corruption. Automatically calculates
 * duration_seconds when finished_at is set.
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - The job ID to update
 * @param updates - Partial updates to apply
 * @returns The updated job metadata
 * @throws StateFileError if the file cannot be read or written
 *
 * @example
 * ```typescript
 * const job = await updateJob('/path/to/.herdctl/jobs', 'job-2024-01-15-abc123', {
 *   status: 'completed',
 *   exit_reason: 'success',
 *   finished_at: new Date().toISOString(),
 *   summary: 'Fixed the auth bug'
 * });
 * ```
 */
export async function updateJob(
  jobsDir: string,
  jobId: string,
  updates: JobMetadataUpdates,
): Promise<JobMetadata> {
  const filePath = getJobFilePath(jobsDir, jobId);

  // Read existing job
  const result = await safeReadYaml<unknown>(filePath);

  if (!result.success) {
    throw new StateFileError(
      `Failed to read job file for update: ${result.error.message}`,
      filePath,
      "read",
      result.error,
    );
  }

  // Parse and validate existing job
  const parseResult = JobMetadataSchema.safeParse(result.data);
  if (!parseResult.success) {
    throw new StateFileError(
      `Job file is corrupted: ${parseResult.error.message}`,
      filePath,
      "read",
    );
  }

  const existingJob = parseResult.data;

  // Apply updates
  const updatedJob: JobMetadata = {
    ...existingJob,
    ...updates,
  };

  // Auto-calculate duration if finished_at is being set
  if (updates.finished_at && !updates.duration_seconds) {
    updatedJob.duration_seconds = calculateDuration(existingJob.started_at, updates.finished_at);
  }

  // Validate the updated job
  const validated = JobMetadataSchema.parse(updatedJob);

  // Write atomically
  try {
    await atomicWriteYaml(filePath, validated);
  } catch (error) {
    throw new StateFileError(
      `Failed to update job file: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error,
    );
  }

  return validated;
}

/**
 * Get a job by its ID
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - The job ID to retrieve
 * @returns The job metadata, or null if not found
 * @throws StateFileError if the file exists but cannot be parsed
 *
 * @example
 * ```typescript
 * const job = await getJob('/path/to/.herdctl/jobs', 'job-2024-01-15-abc123');
 * if (job) {
 *   console.log(job.status); // 'running'
 * }
 * ```
 */
export async function getJob(
  jobsDir: string,
  jobId: string,
  options: JobMetadataOptions = {},
): Promise<JobMetadata | null> {
  const { logger = console } = options;
  const filePath = getJobFilePath(jobsDir, jobId);

  const result = await safeReadYaml<unknown>(filePath);

  if (!result.success) {
    // File not found is not an error - return null
    if (result.error.code === "ENOENT") {
      return null;
    }

    throw new StateFileError(
      `Failed to read job file: ${result.error.message}`,
      filePath,
      "read",
      result.error,
    );
  }

  // Parse and validate
  const parseResult = JobMetadataSchema.safeParse(result.data);
  if (!parseResult.success) {
    logger.warn(`Corrupted job file ${filePath}: ${parseResult.error.message}. Skipping.`);
    return null;
  }

  return parseResult.data;
}

/**
 * List all jobs, optionally filtered
 *
 * Supports filtering by agent, status, and date range. Returns jobs
 * sorted by started_at in descending order (most recent first).
 *
 * @param jobsDir - Path to the jobs directory
 * @param filter - Optional filter criteria
 * @param options - Optional operation options
 * @returns List of matching jobs and count of parse errors
 *
 * @example
 * ```typescript
 * // List all jobs for an agent
 * const { jobs } = await listJobs('/path/to/.herdctl/jobs', {
 *   agent: 'my-agent'
 * });
 *
 * // List failed jobs from the last 24 hours
 * const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
 * const { jobs } = await listJobs('/path/to/.herdctl/jobs', {
 *   status: 'failed',
 *   startedAfter: yesterday
 * });
 * ```
 */
export async function listJobs(
  jobsDir: string,
  filter: ListJobsFilter = {},
  options: JobMetadataOptions = {},
): Promise<ListJobsResult> {
  const { logger = console } = options;

  // Read directory
  let files: string[];
  try {
    files = await readdir(jobsDir);
  } catch (error) {
    // Directory doesn't exist - return empty list
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { jobs: [], errors: 0 };
    }
    throw new StateFileError(
      `Failed to read jobs directory: ${(error as Error).message}`,
      jobsDir,
      "read",
      error as Error,
    );
  }

  // Filter to job YAML files
  const jobFiles = files.filter((f) => f.startsWith("job-") && f.endsWith(".yaml"));

  const jobs: JobMetadata[] = [];
  let errors = 0;

  // Parse date filters once
  const startedAfter = filter.startedAfter ? toDate(filter.startedAfter) : undefined;
  const startedBefore = filter.startedBefore ? toDate(filter.startedBefore) : undefined;

  // Read and filter each job
  for (const file of jobFiles) {
    const filePath = join(jobsDir, file);
    const result = await safeReadYaml<unknown>(filePath);

    if (!result.success) {
      logger.warn(`Failed to read job file ${filePath}: ${result.error.message}`);
      errors++;
      continue;
    }

    const parseResult = JobMetadataSchema.safeParse(result.data);
    if (!parseResult.success) {
      logger.warn(`Corrupted job file ${filePath}: ${parseResult.error.message}`);
      errors++;
      continue;
    }

    const job = parseResult.data;

    // Apply filters
    if (filter.agent && job.agent !== filter.agent) {
      continue;
    }

    if (filter.status && job.status !== filter.status) {
      continue;
    }

    if (startedAfter) {
      const jobDate = new Date(job.started_at);
      if (jobDate < startedAfter) {
        continue;
      }
    }

    if (startedBefore) {
      const jobDate = new Date(job.started_at);
      if (jobDate > startedBefore) {
        continue;
      }
    }

    jobs.push(job);
  }

  // Sort by started_at descending (most recent first)
  jobs.sort((a, b) => {
    const dateA = new Date(a.started_at).getTime();
    const dateB = new Date(b.started_at).getTime();
    return dateB - dateA;
  });

  return { jobs, errors };
}

/**
 * Delete a job's metadata file
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - The job ID to delete
 * @returns true if deleted, false if not found
 *
 * @example
 * ```typescript
 * const deleted = await deleteJob('/path/to/.herdctl/jobs', 'job-2024-01-15-abc123');
 * if (deleted) {
 *   console.log('Job deleted');
 * }
 * ```
 */
export async function deleteJob(jobsDir: string, jobId: string): Promise<boolean> {
  const { unlink } = await import("node:fs/promises");
  const filePath = getJobFilePath(jobsDir, jobId);

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw new StateFileError(
      `Failed to delete job file: ${(error as Error).message}`,
      filePath,
      "write",
      error as Error,
    );
  }
}
