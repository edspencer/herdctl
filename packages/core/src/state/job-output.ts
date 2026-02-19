/**
 * Job output logging operations
 *
 * Provides functions for streaming job output to JSONL files.
 * Supports real-time monitoring with immediate writes (no buffering).
 *
 * Output files are stored at: .herdctl/jobs/job-<id>.jsonl
 */

import { join } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { appendJsonl } from "./utils/atomic.js";
import { StateFileError } from "./errors.js";
import {
  type JobOutputMessage,
  type JobOutputInput,
  isValidJobOutputInput,
  JobOutputMessageSchema,
} from "./schemas/job-output.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Logger interface for job output operations
 */
export interface JobOutputLogger {
  warn: (message: string) => void;
}

/**
 * Options for job output operations
 */
export interface JobOutputOptions {
  /** Logger for warnings and errors */
  logger?: JobOutputLogger;
}

/**
 * Options for reading job output
 */
export interface ReadJobOutputOptions extends JobOutputOptions {
  /** Whether to skip invalid lines instead of failing */
  skipInvalidLines?: boolean;
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Get the path to a job's output file
 *
 * @param jobsDir - Path to the jobs directory (.herdctl/jobs)
 * @param jobId - Job ID (e.g., job-2024-01-15-abc123)
 * @returns Path to the JSONL output file
 */
export function getJobOutputPath(jobsDir: string, jobId: string): string {
  return join(jobsDir, `${jobId}.jsonl`);
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Append a single message to a job's output log
 *
 * Writes immediately to disk for real-time monitoring (no buffering).
 * Uses append mode which is safe for concurrent appends.
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - Job ID
 * @param message - Message to append (timestamp added automatically)
 * @throws StateFileError if write fails or message is invalid
 *
 * @example
 * ```typescript
 * await appendJobOutput(jobsDir, jobId, {
 *   type: "assistant",
 *   content: "Hello, world!"
 * });
 * ```
 */
export async function appendJobOutput(
  jobsDir: string,
  jobId: string,
  message: JobOutputInput,
): Promise<void> {
  // Validate message structure
  if (!isValidJobOutputInput(message)) {
    throw new StateFileError(
      `Invalid job output message: must have a valid 'type' field`,
      getJobOutputPath(jobsDir, jobId),
      "write",
    );
  }

  const outputPath = getJobOutputPath(jobsDir, jobId);

  // Add timestamp to message
  const messageWithTimestamp: JobOutputMessage = {
    ...message,
    timestamp: new Date().toISOString(),
  } as JobOutputMessage;

  try {
    await appendJsonl(outputPath, messageWithTimestamp);
  } catch (error) {
    throw new StateFileError(
      `Failed to append to job output: ${(error as Error).message}`,
      outputPath,
      "write",
      error as Error,
    );
  }
}

/**
 * Append multiple messages to a job's output log
 *
 * Writes all messages immediately in sequence.
 * Each message is validated before writing begins.
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - Job ID
 * @param messages - Messages to append (timestamps added automatically)
 * @throws StateFileError if write fails or any message is invalid
 *
 * @example
 * ```typescript
 * await appendJobOutputBatch(jobsDir, jobId, [
 *   { type: "tool_use", tool_name: "read_file", input: { path: "/etc/hosts" } },
 *   { type: "tool_result", result: "127.0.0.1 localhost", success: true }
 * ]);
 * ```
 */
export async function appendJobOutputBatch(
  jobsDir: string,
  jobId: string,
  messages: JobOutputInput[],
): Promise<void> {
  const outputPath = getJobOutputPath(jobsDir, jobId);

  // Validate all messages first
  for (let i = 0; i < messages.length; i++) {
    if (!isValidJobOutputInput(messages[i])) {
      throw new StateFileError(
        `Invalid job output message at index ${i}: must have a valid 'type' field`,
        outputPath,
        "write",
      );
    }
  }

  // Write all messages
  const timestamp = new Date().toISOString();
  for (const message of messages) {
    const messageWithTimestamp: JobOutputMessage = {
      ...message,
      timestamp,
    } as JobOutputMessage;

    try {
      await appendJsonl(outputPath, messageWithTimestamp);
    } catch (error) {
      throw new StateFileError(
        `Failed to append to job output: ${(error as Error).message}`,
        outputPath,
        "write",
        error as Error,
      );
    }
  }
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Read job output as an async generator for streaming reads
 *
 * Yields messages one at a time, allowing for memory-efficient
 * processing of large output files.
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - Job ID
 * @param options - Read options
 * @yields JobOutputMessage objects
 * @throws StateFileError if file cannot be read (except ENOENT which yields nothing)
 *
 * @example
 * ```typescript
 * for await (const message of readJobOutput(jobsDir, jobId)) {
 *   console.log(`[${message.type}] ${message.timestamp}`);
 * }
 * ```
 */
export async function* readJobOutput(
  jobsDir: string,
  jobId: string,
  options: ReadJobOutputOptions = {},
): AsyncGenerator<JobOutputMessage, void, undefined> {
  const { skipInvalidLines = false, logger = console } = options;
  const outputPath = getJobOutputPath(jobsDir, jobId);

  // Check if file exists
  try {
    await stat(outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist - yield nothing
      return;
    }
    throw new StateFileError(
      `Failed to read job output: ${(error as Error).message}`,
      outputPath,
      "read",
      error as Error,
    );
  }

  // Create readline interface for streaming
  const fileStream = createReadStream(outputPath, { encoding: "utf-8" });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  try {
    for await (const line of rl) {
      lineNumber++;

      // Skip empty lines
      const trimmedLine = line.trim();
      if (trimmedLine === "") {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmedLine);
        const validated = JobOutputMessageSchema.safeParse(parsed);

        if (validated.success) {
          yield validated.data;
        } else if (skipInvalidLines) {
          logger.warn(
            `[herdctl] Skipping invalid message at line ${lineNumber} in ${outputPath}: ${validated.error.message}`,
          );
        } else {
          throw new StateFileError(
            `Invalid job output message at line ${lineNumber}: ${validated.error.message}`,
            outputPath,
            "read",
          );
        }
      } catch (error) {
        if (error instanceof StateFileError) {
          throw error;
        }

        if (skipInvalidLines) {
          logger.warn(
            `[herdctl] Skipping malformed JSON at line ${lineNumber} in ${outputPath}: ${(error as Error).message}`,
          );
        } else {
          throw new StateFileError(
            `Failed to parse job output at line ${lineNumber}: ${(error as Error).message}`,
            outputPath,
            "read",
            error as Error,
          );
        }
      }
    }
  } finally {
    // Ensure resources are cleaned up
    rl.close();
    fileStream.destroy();
  }
}

/**
 * Read all job output messages into an array
 *
 * Convenience function that collects all messages from readJobOutput.
 * For large files, prefer using readJobOutput directly as a generator.
 *
 * @param jobsDir - Path to the jobs directory
 * @param jobId - Job ID
 * @param options - Read options
 * @returns Array of all job output messages
 *
 * @example
 * ```typescript
 * const messages = await readJobOutputAll(jobsDir, jobId);
 * console.log(`Total messages: ${messages.length}`);
 * ```
 */
export async function readJobOutputAll(
  jobsDir: string,
  jobId: string,
  options: ReadJobOutputOptions = {},
): Promise<JobOutputMessage[]> {
  const messages: JobOutputMessage[] = [];
  for await (const message of readJobOutput(jobsDir, jobId, options)) {
    messages.push(message);
  }
  return messages;
}
