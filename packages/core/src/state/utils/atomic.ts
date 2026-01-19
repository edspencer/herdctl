/**
 * Atomic file write utilities
 *
 * Provides atomic write operations to prevent file corruption during writes.
 * Uses the standard pattern of writing to a temp file then renaming.
 */

import { writeFile, rename, unlink, appendFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";

/**
 * Error thrown when an atomic write operation fails
 */
export class AtomicWriteError extends Error {
  public readonly path: string;
  public readonly tempPath?: string;

  constructor(message: string, path: string, tempPath?: string, cause?: Error) {
    super(message);
    this.name = "AtomicWriteError";
    this.path = path;
    this.tempPath = tempPath;
    this.cause = cause;
  }
}

/**
 * Generate a temp file path in the same directory as the target.
 * Uses pattern: .<filename>.tmp.<random>
 *
 * Writing to the same directory ensures the temp file is on the same
 * filesystem, which is required for atomic rename.
 */
export function generateTempPath(targetPath: string): string {
  const dir = dirname(targetPath);
  const filename = basename(targetPath);
  const random = randomBytes(8).toString("hex");
  return join(dir, `.${filename}.tmp.${random}`);
}

/**
 * Options for rename with retry
 * @internal
 */
export interface RenameRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  /** Injectable rename function for testing */
  renameFn?: (oldPath: string, newPath: string) => Promise<void>;
}

/**
 * Rename with retry logic for Windows compatibility.
 *
 * On Windows, rename can fail with EACCES or EPERM if another process
 * has the file open. We retry a few times with backoff to handle this.
 *
 * @internal Exported for testing purposes
 */
export async function renameWithRetry(
  oldPath: string,
  newPath: string,
  options: RenameRetryOptions = {}
): Promise<void> {
  const {
    maxRetries = 3,
    baseDelayMs = 50,
    renameFn = rename,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await renameFn(oldPath, newPath);
      return;
    } catch (error) {
      lastError = error as Error;
      const code = (error as NodeJS.ErrnoException).code;

      // Only retry on Windows-specific errors
      if (code !== "EACCES" && code !== "EPERM") {
        throw error;
      }

      // Don't delay on the last attempt
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Safely clean up a temp file, ignoring errors if the file doesn't exist.
 */
async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch (error) {
    // Ignore ENOENT - file may not exist if write failed before creating it
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Log but don't throw - cleanup is best-effort
      // In production, we might want to log this
    }
  }
}

/**
 * Write content to a file atomically.
 *
 * Uses the pattern:
 * 1. Write to temp file in same directory (.<filename>.tmp.<random>)
 * 2. Rename temp file to target (atomic on POSIX)
 * 3. Clean up temp file on failure
 *
 * On Windows, uses retry logic for the rename operation for best-effort
 * atomicity.
 *
 * @param filePath - Target file path
 * @param content - Content to write
 * @param encoding - File encoding (default: utf-8)
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf-8"
): Promise<void> {
  const tempPath = generateTempPath(filePath);

  try {
    // Step 1: Write to temp file
    await writeFile(tempPath, content, encoding);

    // Step 2: Atomically rename to target
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    // Step 3: Clean up temp file on failure
    await cleanupTempFile(tempPath);

    throw new AtomicWriteError(
      `Failed to atomically write to ${filePath}: ${(error as Error).message}`,
      filePath,
      tempPath,
      error as Error
    );
  }
}

/**
 * Write a JavaScript object to a YAML file atomically.
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as YAML
 * @param options - YAML stringify options
 */
export async function atomicWriteYaml(
  filePath: string,
  data: unknown,
  options?: {
    indent?: number;
    lineWidth?: number;
  }
): Promise<void> {
  const yamlContent = stringifyYaml(data, {
    indent: options?.indent ?? 2,
    lineWidth: options?.lineWidth ?? 120,
  });

  await atomicWriteFile(filePath, yamlContent);
}

/**
 * Write a JavaScript object to a JSON file atomically.
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as JSON
 * @param options - JSON stringify options
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  options?: {
    indent?: number;
  }
): Promise<void> {
  const jsonContent = JSON.stringify(data, null, options?.indent ?? 2) + "\n";
  await atomicWriteFile(filePath, jsonContent);
}

/**
 * Append a line to a JSONL file.
 *
 * Uses fs.appendFile which is atomic at the message level on most systems.
 * Each call appends a single JSON object followed by a newline.
 *
 * @param filePath - Target JSONL file path
 * @param data - Data to serialize as a single JSON line
 */
export async function appendJsonl(
  filePath: string,
  data: unknown
): Promise<void> {
  const line = JSON.stringify(data) + "\n";

  try {
    await appendFile(filePath, line, "utf-8");
  } catch (error) {
    throw new AtomicWriteError(
      `Failed to append to JSONL file ${filePath}: ${(error as Error).message}`,
      filePath,
      undefined,
      error as Error
    );
  }
}
