/**
 * Zod schemas for job metadata (job-<id>.yaml)
 *
 * Defines the schema for tracking individual job execution metadata
 * including timing, status, and execution context.
 */

import { z } from "zod";

// =============================================================================
// Job Status Schemas
// =============================================================================

/**
 * Possible states for a job
 */
export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * How the job was triggered
 */
export const TriggerTypeSchema = z.enum([
  "manual",
  "schedule",
  "webhook",
  "chat",
  "fork",
]);

/**
 * Reason why a job exited
 */
export const ExitReasonSchema = z.enum([
  "success",
  "error",
  "timeout",
  "cancelled",
  "max_turns",
]);

// =============================================================================
// Job Metadata Schema
// =============================================================================

/**
 * Job metadata schema for individual job files
 *
 * Each job is stored as .herdctl/jobs/job-<id>.yaml
 */
export const JobMetadataSchema = z.object({
  /** Unique job identifier (format: job-YYYY-MM-DD-<random6>) */
  id: z.string().regex(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/, {
    message: "Job ID must match format: job-YYYY-MM-DD-<random6>",
  }),

  /** Name of the agent that executed this job */
  agent: z.string().min(1),

  /** Schedule name that triggered the job (if applicable) */
  schedule: z.string().nullable().optional(),

  /** How the job was triggered */
  trigger_type: TriggerTypeSchema,

  /** Current status of the job */
  status: JobStatusSchema,

  /** Reason the job exited (only set when status is completed/failed/cancelled) */
  exit_reason: ExitReasonSchema.nullable().optional(),

  /** Session ID for the Claude agent session */
  session_id: z.string().nullable().optional(),

  /** Job ID this was forked from (if trigger_type is 'fork') */
  forked_from: z
    .string()
    .regex(/^job-\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/)
    .nullable()
    .optional(),

  /** ISO timestamp when the job started */
  started_at: z.string(),

  /** ISO timestamp when the job finished (null if still running) */
  finished_at: z.string().nullable().optional(),

  /** Duration of the job in seconds (calculated when finished) */
  duration_seconds: z.number().nonnegative().nullable().optional(),

  /** The prompt that was given to the agent */
  prompt: z.string().nullable().optional(),

  /** Brief summary of what the job accomplished */
  summary: z.string().nullable().optional(),

  /** Path to the output file containing full session output */
  output_file: z.string().nullable().optional(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type JobStatus = z.infer<typeof JobStatusSchema>;
export type TriggerType = z.infer<typeof TriggerTypeSchema>;
export type ExitReason = z.infer<typeof ExitReasonSchema>;
export type JobMetadata = z.infer<typeof JobMetadataSchema>;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Options for creating a new job
 */
export interface CreateJobOptions {
  /** Name of the agent executing the job */
  agent: string;
  /** How the job was triggered */
  trigger_type: TriggerType;
  /** Schedule name (for scheduled jobs) */
  schedule?: string | null;
  /** The prompt given to the agent */
  prompt?: string | null;
  /** Parent job ID (for forked jobs) */
  forked_from?: string | null;
}

/**
 * Generate a unique job ID with format: job-YYYY-MM-DD-<random6>
 *
 * @param date - Optional date to use (defaults to now)
 * @param randomFn - Optional random function for testing
 */
export function generateJobId(
  date: Date = new Date(),
  randomFn: () => string = () => Math.random().toString(36).slice(2, 8)
): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const random = randomFn().slice(0, 6).padEnd(6, "0");

  return `job-${year}-${month}-${day}-${random}`;
}

/**
 * Create initial job metadata for a new job
 *
 * @param options - Job creation options
 * @param idGenerator - Optional function to generate job ID (for testing)
 */
export function createJobMetadata(
  options: CreateJobOptions,
  idGenerator: () => string = generateJobId
): JobMetadata {
  const now = new Date().toISOString();

  return {
    id: idGenerator(),
    agent: options.agent,
    schedule: options.schedule ?? null,
    trigger_type: options.trigger_type,
    status: "pending",
    exit_reason: null,
    session_id: null,
    forked_from: options.forked_from ?? null,
    started_at: now,
    finished_at: null,
    duration_seconds: null,
    prompt: options.prompt ?? null,
    summary: null,
    output_file: null,
  };
}
