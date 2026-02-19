/**
 * Safe concurrent read utilities
 *
 * Provides read operations that handle concurrent access safely.
 * Read operations don't require locks - multiple readers can access
 * files simultaneously. These utilities handle edge cases like:
 * - Files being written to during read (retry on partial read)
 * - Empty or truncated YAML files
 * - Incomplete last lines in JSONL files
 */

import { readFile } from "node:fs/promises";
import { parse as parseYaml, YAMLParseError } from "yaml";

/**
 * Error thrown when a safe read operation fails
 */
export class SafeReadError extends Error {
  public readonly path: string;
  public readonly code?: string;

  constructor(message: string, path: string, cause?: Error) {
    super(message);
    this.name = "SafeReadError";
    this.path = path;
    this.cause = cause;
    this.code = (cause as NodeJS.ErrnoException | undefined)?.code;
  }
}

/**
 * Options for safe read operations
 */
export interface SafeReadOptions {
  /**
   * Maximum number of retry attempts for transient failures.
   * Default: 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds between retries.
   * Uses exponential backoff: delay = baseDelayMs * 2^attempt
   * Default: 10
   */
  baseDelayMs?: number;

  /**
   * Injectable read function for testing
   * @internal
   */
  readFn?: (path: string, encoding: BufferEncoding) => Promise<string>;
}

/**
 * Options for safeReadJsonl
 */
export interface SafeReadJsonlOptions extends SafeReadOptions {
  /**
   * Whether to skip invalid JSON lines instead of failing.
   * Default: false - only skips truly incomplete last line
   */
  skipInvalidLines?: boolean;
}

/**
 * Result type for safe YAML read operations
 */
export type SafeReadYamlResult<T> =
  | { success: true; data: T }
  | { success: false; error: SafeReadError };

/**
 * Result type for safe JSONL read operations
 */
export type SafeReadJsonlResult<T> =
  | { success: true; data: T[]; skippedLines: number }
  | { success: false; error: SafeReadError };

/**
 * Check if an error is likely a transient read error that should be retried.
 * This happens when reading a file while it's being written atomically.
 *
 * We treat YAML parse errors as potentially transient because:
 * 1. If a read occurs during an atomic write, the file might be empty or partially written
 * 2. The retry gives time for the atomic rename to complete
 * 3. Non-transient errors (like truly malformed YAML) will fail consistently
 */
function isTransientReadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // All YAML parse errors are potentially transient - they could indicate
  // a partial read during an atomic write operation
  if (error instanceof YAMLParseError) {
    return true;
  }

  // JSON parse errors for incomplete content
  if (error instanceof SyntaxError) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("unexpected end") ||
      msg.includes("unexpected token") ||
      msg.includes("unterminated")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Wait for a delay using exponential backoff
 */
async function backoffDelay(attempt: number, baseDelayMs: number): Promise<void> {
  const delay = baseDelayMs * Math.pow(2, attempt);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Read and parse a YAML file safely with retry logic.
 *
 * This function handles:
 * - Files being written to during read (retries on parse failure)
 * - Empty files (returns null/undefined based on YAML spec)
 * - Truncated files (retries then fails gracefully)
 *
 * Read operations don't require locks - multiple concurrent reads are safe.
 * The retry logic handles the case where a read occurs during an atomic write.
 *
 * @param filePath - Path to the YAML file
 * @param options - Read options including retry configuration
 * @returns Promise resolving to SafeReadYamlResult with success/failure
 *
 * @example
 * ```typescript
 * const result = await safeReadYaml<MyConfig>('/path/to/config.yaml');
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export async function safeReadYaml<T = unknown>(
  filePath: string,
  options: SafeReadOptions = {},
): Promise<SafeReadYamlResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 10,
    readFn = (path, encoding) => readFile(path, encoding),
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const content = await readFn(filePath, "utf-8");

      // Handle empty file - YAML spec says empty doc is null
      if (content.trim() === "") {
        return { success: true, data: null as T };
      }

      const parsed = parseYaml(content) as T;
      return { success: true, data: parsed };
    } catch (error) {
      lastError = error as Error;

      // File not found or permission errors are not transient
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
        return {
          success: false,
          error: new SafeReadError(
            `Failed to read YAML file ${filePath}: ${(error as Error).message}`,
            filePath,
            error as Error,
          ),
        };
      }

      // Check if this is a transient error worth retrying
      if (isTransientReadError(error) && attempt < maxRetries) {
        await backoffDelay(attempt, baseDelayMs);
        continue;
      }

      // Non-transient error or retries exhausted
      return {
        success: false,
        error: new SafeReadError(
          `Failed to parse YAML file ${filePath}: ${(error as Error).message}`,
          filePath,
          error as Error,
        ),
      };
    }
  }

  // Should not reach here, but handle it just in case
  return {
    success: false,
    error: new SafeReadError(
      `Failed to read YAML file ${filePath} after ${maxRetries + 1} attempts`,
      filePath,
      lastError,
    ),
  };
}

/**
 * Read and parse a JSONL file safely, handling incomplete last lines.
 *
 * This function handles:
 * - Incomplete last line (truncates to last valid line)
 * - Empty files (returns empty array)
 * - Files being written to during read (retries on failure)
 *
 * JSONL (JSON Lines) format has one JSON object per line. When reading
 * a file that's being appended to, the last line may be incomplete.
 * This function safely truncates to the last complete line.
 *
 * Read operations don't require locks - multiple concurrent reads are safe.
 *
 * @param filePath - Path to the JSONL file
 * @param options - Read options including retry configuration
 * @returns Promise resolving to SafeReadJsonlResult with array of parsed objects
 *
 * @example
 * ```typescript
 * const result = await safeReadJsonl<LogEntry>('/path/to/events.jsonl');
 * if (result.success) {
 *   console.log(`Read ${result.data.length} entries, skipped ${result.skippedLines}`);
 * }
 * ```
 */
export async function safeReadJsonl<T = unknown>(
  filePath: string,
  options: SafeReadJsonlOptions = {},
): Promise<SafeReadJsonlResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 10,
    skipInvalidLines = false,
    readFn = (path, encoding) => readFile(path, encoding),
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const content = await readFn(filePath, "utf-8");

      // Handle empty file
      if (content.trim() === "") {
        return { success: true, data: [], skippedLines: 0 };
      }

      const result = parseJsonlContent<T>(content, skipInvalidLines);
      return { success: true, ...result };
    } catch (error) {
      lastError = error as Error;

      // File not found or permission errors are not transient
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
        return {
          success: false,
          error: new SafeReadError(
            `Failed to read JSONL file ${filePath}: ${(error as Error).message}`,
            filePath,
            error as Error,
          ),
        };
      }

      // Retry on transient errors
      if (attempt < maxRetries) {
        await backoffDelay(attempt, baseDelayMs);
        continue;
      }
    }
  }

  return {
    success: false,
    error: new SafeReadError(
      `Failed to read JSONL file ${filePath} after ${maxRetries + 1} attempts`,
      filePath,
      lastError,
    ),
  };
}

/**
 * Parse JSONL content, handling incomplete last line.
 *
 * @internal
 */
function parseJsonlContent<T>(
  content: string,
  skipInvalidLines: boolean,
): { data: T[]; skippedLines: number } {
  const lines = content.split("\n");
  const result: T[] = [];
  let skippedLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (line === "") {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as T;
      result.push(parsed);
    } catch (error) {
      // Last line may be incomplete - always skip it silently
      if (i === lines.length - 1 || i === lines.length - 2) {
        // Could be the actual last line or second-to-last if file ends with \n
        skippedLines++;
        continue;
      }

      // For middle lines, either skip or fail based on option
      if (skipInvalidLines) {
        skippedLines++;
        continue;
      }

      // Re-throw for non-last-line errors when not skipping
      throw new SafeReadError(
        `Invalid JSON on line ${i + 1}: ${(error as Error).message}`,
        "",
        error as Error,
      );
    }
  }

  return { data: result, skippedLines };
}

/**
 * Read a YAML file with retry logic, throwing on failure.
 *
 * This is a convenience wrapper around safeReadYaml that throws
 * instead of returning a result object.
 *
 * @param filePath - Path to the YAML file
 * @param options - Read options
 * @returns Promise resolving to parsed YAML content
 * @throws SafeReadError on failure
 */
export async function readYaml<T = unknown>(
  filePath: string,
  options: SafeReadOptions = {},
): Promise<T> {
  const result = await safeReadYaml<T>(filePath, options);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * Read a JSONL file, handling incomplete last line, throwing on failure.
 *
 * This is a convenience wrapper around safeReadJsonl that throws
 * instead of returning a result object.
 *
 * @param filePath - Path to the JSONL file
 * @param options - Read options
 * @returns Promise resolving to array of parsed objects
 * @throws SafeReadError on failure
 */
export async function readJsonl<T = unknown>(
  filePath: string,
  options: SafeReadJsonlOptions = {},
): Promise<T[]> {
  const result = await safeReadJsonl<T>(filePath, options);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/**
 * Result type for safe JSON read operations
 */
export type SafeReadJsonResult<T> =
  | { success: true; data: T }
  | { success: false; error: SafeReadError };

/**
 * Read and parse a JSON file safely with retry logic.
 *
 * This function handles:
 * - Files being written to during read (retries on parse failure)
 * - Empty files (returns null)
 * - Truncated files (retries then fails gracefully)
 *
 * Read operations don't require locks - multiple concurrent reads are safe.
 * The retry logic handles the case where a read occurs during an atomic write.
 *
 * @param filePath - Path to the JSON file
 * @param options - Read options including retry configuration
 * @returns Promise resolving to SafeReadJsonResult with success/failure
 *
 * @example
 * ```typescript
 * const result = await safeReadJson<MyConfig>('/path/to/config.json');
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export async function safeReadJson<T = unknown>(
  filePath: string,
  options: SafeReadOptions = {},
): Promise<SafeReadJsonResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 10,
    readFn = (path, encoding) => readFile(path, encoding),
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const content = await readFn(filePath, "utf-8");

      // Handle empty file
      if (content.trim() === "") {
        return { success: true, data: null as T };
      }

      const parsed = JSON.parse(content) as T;
      return { success: true, data: parsed };
    } catch (error) {
      lastError = error as Error;

      // File not found or permission errors are not transient
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EACCES" || code === "EPERM") {
        return {
          success: false,
          error: new SafeReadError(
            `Failed to read JSON file ${filePath}: ${(error as Error).message}`,
            filePath,
            error as Error,
          ),
        };
      }

      // Check if this is a transient error worth retrying
      if (isTransientReadError(error) && attempt < maxRetries) {
        await backoffDelay(attempt, baseDelayMs);
        continue;
      }

      // Non-transient error or retries exhausted
      return {
        success: false,
        error: new SafeReadError(
          `Failed to parse JSON file ${filePath}: ${(error as Error).message}`,
          filePath,
          error as Error,
        ),
      };
    }
  }

  // Should not reach here, but handle it just in case
  return {
    success: false,
    error: new SafeReadError(
      `Failed to read JSON file ${filePath} after ${maxRetries + 1} attempts`,
      filePath,
      lastError,
    ),
  };
}

/**
 * Read a JSON file with retry logic, throwing on failure.
 *
 * This is a convenience wrapper around safeReadJson that throws
 * instead of returning a result object.
 *
 * @param filePath - Path to the JSON file
 * @param options - Read options
 * @returns Promise resolving to parsed JSON content
 * @throws SafeReadError on failure
 */
export async function readJson<T = unknown>(
  filePath: string,
  options: SafeReadOptions = {},
): Promise<T> {
  const result = await safeReadJson<T>(filePath, options);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}
