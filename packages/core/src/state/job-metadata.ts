/**
 * Job metadata persistence operations
 *
 * Provides CRUD operations for job metadata files stored at
 * .herdctl/jobs/job-<id>.yaml
 */

import { join } from "node:path";
import { StateFileError } from "./errors.js";
import { type JobIndexRecord, mapWithConcurrency, refreshJobIndex } from "./job-index.js";
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
  /**
   * Maximum number of jobs to return, applied after filtering and sorting.
   *
   * Prefer this over slicing the result: only the jobs actually returned are
   * read and parsed in full, so a small page costs a small amount of work.
   */
  limit?: number;
  /** Number of matching jobs to skip before applying `limit` */
  offset?: number;
}

/**
 * Result of listing jobs
 */
export interface ListJobsResult {
  /** Array of job metadata */
  jobs: JobMetadata[];
  /** Number of jobs that failed to parse */
  errors: number;
  /**
   * Number of jobs matching the filter before `limit`/`offset` were applied.
   *
   * Always populated by {@link listJobs}; optional so that hand-constructed
   * results (test doubles, adapters) remain valid.
   */
  total?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Maximum number of job records read concurrently when hydrating a page. */
const HYDRATE_CONCURRENCY = 32;

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
 * Filtering, sorting and pagination run against a cached, mtime-keyed index of
 * each job file's `agent`/`status`/`started_at` (see `job-index.ts`), so only the
 * records actually returned are read and parsed in full. Passing `limit` is
 * therefore much cheaper than slicing the result.
 *
 * @param jobsDir - Path to the jobs directory
 * @param filter - Optional filter criteria
 * @param options - Optional operation options
 * @returns Matching jobs, the pre-pagination match count, and the count of parse errors
 *
 * @example
 * ```typescript
 * // List all jobs for an agent
 * const { jobs } = await listJobs('/path/to/.herdctl/jobs', {
 *   agent: 'my-agent'
 * });
 *
 * // Most recent 20 failed jobs from the last 24 hours
 * const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
 * const { jobs, total } = await listJobs('/path/to/.herdctl/jobs', {
 *   status: 'failed',
 *   startedAfter: yesterday,
 *   limit: 20
 * });
 * ```
 */
export async function listJobs(
  jobsDir: string,
  filter: ListJobsFilter = {},
  options: JobMetadataOptions = {},
): Promise<ListJobsResult> {
  const { logger = console } = options;

  // Parse date filters once
  const startedAfter = filter.startedAfter ? toDate(filter.startedAfter).getTime() : undefined;
  const startedBefore = filter.startedBefore ? toDate(filter.startedBefore).getTime() : undefined;

  const matches = (record: JobIndexRecord): boolean => {
    if (filter.agent && record.agent !== filter.agent) return false;
    if (filter.status && record.status !== filter.status) return false;
    if (startedAfter !== undefined && record.startedAtMs < startedAfter) return false;
    if (startedBefore !== undefined && record.startedAtMs > startedBefore) return false;
    return true;
  };

  // On a cold pass the index refresh parses records anyway, so hold on to the
  // ones that could be returned instead of reading them twice. When a page was
  // requested we can't yet tell which records make the page, and holding every
  // match to keep a handful would defeat the point — re-read the page instead.
  const retain = filter.limit === undefined ? matches : () => false;

  let index: Awaited<ReturnType<typeof refreshJobIndex>>;
  try {
    index = await refreshJobIndex(jobsDir, { retain });
  } catch (error) {
    // Directory doesn't exist - return empty list
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { jobs: [], errors: 0, total: 0 };
    }
    throw new StateFileError(
      `Failed to read jobs directory: ${(error as Error).message}`,
      jobsDir,
      "read",
      error as Error,
    );
  }

  let errors = 0;

  // Filter on the index — no large-record parsing needed to decide what to keep.
  const candidates: { file: string; record: JobIndexRecord }[] = [];
  for (const entry of index.entries) {
    if (!entry.record) {
      logger.warn(entry.warning ?? `Failed to read job file ${join(jobsDir, entry.file)}`);
      errors++;
      continue;
    }
    if (matches(entry.record)) {
      candidates.push({ file: entry.file, record: entry.record });
    }
  }

  const total = candidates.length;

  // Sort by started_at descending (most recent first). Array.sort is stable, so
  // equal timestamps keep directory order, as they did when sorting records.
  candidates.sort((a, b) => b.record.startedAtMs - a.record.startedAtMs);

  const offset = filter.offset !== undefined && filter.offset > 0 ? filter.offset : 0;
  const end =
    filter.limit !== undefined && filter.limit > 0 ? offset + filter.limit : candidates.length;
  const page = candidates.slice(offset, end);

  // Read the full records for this page only, reusing any parse the index refresh
  // already paid for.
  const hydrated = await mapWithConcurrency(
    page,
    HYDRATE_CONCURRENCY,
    async ({ file }): Promise<JobMetadata | string> => {
      const alreadyParsed = index.fresh.get(file);
      if (alreadyParsed) return alreadyParsed;

      const filePath = join(jobsDir, file);
      const result = await safeReadYaml<unknown>(filePath);
      if (!result.success) {
        return `Failed to read job file ${filePath}: ${result.error.message}`;
      }

      const parseResult = JobMetadataSchema.safeParse(result.data);
      if (!parseResult.success) {
        return `Corrupted job file ${filePath}: ${parseResult.error.message}`;
      }

      return parseResult.data;
    },
  );

  const jobs: JobMetadata[] = [];
  for (const outcome of hydrated) {
    // A job file can change between being indexed and being read. Re-checking the
    // filter against the record we actually return keeps the guarantee that every
    // returned job satisfies the filter.
    if (typeof outcome === "string") {
      logger.warn(outcome);
      errors++;
    } else if (
      matches({
        agent: outcome.agent,
        status: outcome.status,
        startedAtMs: new Date(outcome.started_at).getTime(),
      })
    ) {
      jobs.push(outcome);
    }
  }

  jobs.sort((a, b) => {
    const dateA = new Date(a.started_at).getTime();
    const dateB = new Date(b.started_at).getTime();
    return dateB - dateA;
  });

  return { jobs, errors, total };
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
