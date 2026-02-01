/**
 * CLI session file watcher - monitors CLI session files for new messages
 *
 * This module provides file-based message streaming as an alternative to stdout
 * streaming. It's useful for:
 * - Session replay: Read historical session data from disk
 * - Robustness: Session files persist even if process crashes
 * - Debugging: Inspect raw CLI session output
 *
 * Uses chokidar with awaitWriteFinish to handle atomic writes and prevent
 * partial JSON reads during rapid file updates.
 */

import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import type { SDKMessage } from "../types.js";
import { parseCLILine } from "./cli-output-parser.js";

/**
 * Watches a CLI session file and yields new messages as they're written
 *
 * Tracks the number of processed lines to avoid re-processing on each file change.
 * Uses chokidar's awaitWriteFinish to debounce rapid writes and ensure complete
 * JSON lines are read.
 *
 * @example
 * ```typescript
 * const watcher = new CLISessionWatcher('/path/to/session.jsonl');
 *
 * for await (const message of watcher.watch()) {
 *   console.log('New message:', message);
 * }
 *
 * // Later: stop watching
 * watcher.stop();
 * ```
 */
export class CLISessionWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private lastLineCount = 0;
  private sessionFilePath: string;

  /**
   * Create a new session file watcher
   *
   * @param sessionFilePath - Absolute path to CLI session JSONL file
   */
  constructor(sessionFilePath: string) {
    this.sessionFilePath = sessionFilePath;
  }

  /**
   * Start watching the session file and yield new messages
   *
   * This is an async generator that yields SDKMessage objects as new lines
   * are written to the session file. It tracks the last processed line count
   * to avoid re-processing existing content.
   *
   * The watcher uses chokidar's awaitWriteFinish with:
   * - stabilityThreshold: 500ms - wait for 500ms of no writes before reading
   * - pollInterval: 100ms - check for stability every 100ms
   *
   * This prevents reading partial JSON lines during rapid CLI writes.
   *
   * @yields SDKMessage - Each new message written to the session file
   */
  async *watch(): AsyncIterable<SDKMessage> {
    // Configure chokidar with debouncing to prevent partial reads
    this.watcher = chokidar.watch(this.sessionFilePath, {
      awaitWriteFinish: {
        stabilityThreshold: 500, // Wait 500ms after last write
        pollInterval: 100, // Check every 100ms if stable
      },
      // Don't emit events for initial add (we'll handle existing content separately)
      ignoreInitial: false,
    });

    // Process existing content on first 'add' event (file exists)
    let initialProcessed = false;

    // Create promise-based event handling for async iteration
    const messageQueue: SDKMessage[] = [];
    let resolveNext: ((value: IteratorResult<SDKMessage>) => void) | null =
      null;
    let finished = false;

    const processFile = async (): Promise<void> => {
      try {
        const content = await readFile(this.sessionFilePath, "utf-8");
        const lines = content.split("\n");

        // Process only new lines since last read
        const newLines = lines.slice(this.lastLineCount);
        this.lastLineCount = lines.length;

        // Parse and queue valid messages
        for (const line of newLines) {
          const message = parseCLILine(line);
          if (message) {
            if (resolveNext) {
              // Iterator is waiting for next value
              resolveNext({ value: message, done: false });
              resolveNext = null;
            } else {
              // Queue for later retrieval
              messageQueue.push(message);
            }
          }
        }
      } catch (error) {
        // File might not exist yet or be unreadable
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(
            `[CLISessionWatcher] Error reading session file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    };

    // Handle both 'add' (initial) and 'change' events
    this.watcher.on("add", async () => {
      if (!initialProcessed) {
        initialProcessed = true;
        await processFile();
      }
    });

    this.watcher.on("change", async () => {
      await processFile();
    });

    this.watcher.on("error", (error: unknown) => {
      console.error(
        `[CLISessionWatcher] Watcher error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    // Async iterator implementation
    try {
      while (!finished) {
        // If we have queued messages, yield them
        if (messageQueue.length > 0) {
          const message = messageQueue.shift()!;
          yield message;
        } else {
          // Wait for next message
          await new Promise<void>((resolve) => {
            resolveNext = (result) => {
              if (!result.done) {
                // We'll yield this message in the next iteration
                messageQueue.push(result.value);
              }
              resolve();
            };

            // Set a timeout to check periodically if we should continue
            setTimeout(() => {
              resolveNext = null;
              resolve();
            }, 100);
          });
        }
      }
    } finally {
      this.stop();
    }
  }

  /**
   * Stop watching the session file
   *
   * Closes the file watcher and releases resources. Should be called when
   * done watching to prevent resource leaks.
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

/**
 * Watch a CLI session file for new messages
 *
 * Convenience function that creates a CLISessionWatcher and yields messages.
 * Automatically stops watching when the iteration is aborted via signal.
 *
 * @example
 * ```typescript
 * const abortController = new AbortController();
 *
 * for await (const message of watchSessionFile(
 *   '/path/to/session.jsonl',
 *   abortController.signal
 * )) {
 *   console.log('Message:', message);
 * }
 *
 * // Later: stop watching
 * abortController.abort();
 * ```
 *
 * @param sessionFilePath - Absolute path to CLI session JSONL file
 * @param signal - Optional AbortSignal to stop watching
 * @yields SDKMessage - Each new message written to the session file
 */
export async function* watchSessionFile(
  sessionFilePath: string,
  signal?: AbortSignal,
): AsyncIterable<SDKMessage> {
  const watcher = new CLISessionWatcher(sessionFilePath);

  try {
    for await (const message of watcher.watch()) {
      if (signal?.aborted) {
        break;
      }
      yield message;
    }
  } finally {
    watcher.stop();
  }
}
