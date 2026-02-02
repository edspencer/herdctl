/**
 * CLI session file watcher - monitors CLI session files for new messages
 *
 * Event-driven watcher that yields messages as they're written to the session file.
 * No polling, no timeouts - just clean async/await.
 */

import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import type { SDKMessage } from "../types.js";

/**
 * Watches a CLI session file and yields new messages as they're written
 */
export class CLISessionWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private lastLineCount = 0;
  private sessionFilePath: string;
  private messageQueue: SDKMessage[] = [];
  private pendingMessageResolve: (() => void) | null = null;
  private stopped = false;

  constructor(sessionFilePath: string) {
    this.sessionFilePath = sessionFilePath;
  }

  /**
   * Initialize watcher by reading existing file content
   *
   * When resuming a session, call this before watch() to skip existing
   * messages and only process new content appended after this point.
   */
  async initialize(): Promise<void> {
    try {
      const content = await readFile(this.sessionFilePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");
      this.lastLineCount = lines.length;
      console.log(`[CLISessionWatcher] Initialized at line ${this.lastLineCount}, will skip existing content`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist yet - that's fine for new sessions
        console.log(`[CLISessionWatcher] File doesn't exist yet, starting from line 0`);
      } else {
        console.warn(
          `[CLISessionWatcher] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Process file and queue any new messages
   */
  private async processFile(): Promise<void> {
    try {
      const content = await readFile(this.sessionFilePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");

      // Process only new lines since last read
      const newLines = lines.slice(this.lastLineCount);
      this.lastLineCount = lines.length;

      console.log(`[CLISessionWatcher] Processing ${newLines.length} new lines`);

      // Parse and queue valid messages
      for (const line of newLines) {
        try {
          const message = JSON.parse(line) as SDKMessage;
          console.log(`[CLISessionWatcher] Queued message type: ${message.type}`);
          this.messageQueue.push(message);
        } catch (error) {
          // Skip invalid JSON lines (CLI may output non-JSON)
          console.warn(
            `[CLISessionWatcher] Failed to parse line: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // If someone is waiting for a message and we have one, wake them up
      if (this.pendingMessageResolve && this.messageQueue.length > 0) {
        console.log(`[CLISessionWatcher] Waking up waiting iterator`);
        this.pendingMessageResolve();
        this.pendingMessageResolve = null;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(
          `[CLISessionWatcher] Error reading session file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Watch session file and yield messages as they arrive
   *
   * This is event-driven - it waits (blocks) until messages are available.
   * No polling, no timeouts.
   */
  async *watch(): AsyncIterable<SDKMessage> {
    // Configure chokidar
    this.watcher = chokidar.watch(this.sessionFilePath, {
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      ignoreInitial: false,
    });

    this.watcher.on("add", async () => {
      console.log("[CLISessionWatcher] File 'add' event");
      await this.processFile();
    });

    this.watcher.on("change", async () => {
      console.log("[CLISessionWatcher] File 'change' event");
      await this.processFile();
    });

    this.watcher.on("error", (error: unknown) => {
      console.error(
        `[CLISessionWatcher] Watcher error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    try {
      while (!this.stopped) {
        // If we have queued messages, yield them
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift()!;
          console.log(`[CLISessionWatcher] Yielding message type: ${message.type}`);
          yield message;
        }

        // No messages - wait for chokidar to add one
        console.log(`[CLISessionWatcher] No messages, waiting for chokidar event`);
        await new Promise<void>((resolve) => {
          this.pendingMessageResolve = resolve;

          // Also wake up if stopped
          if (this.stopped) {
            resolve();
          }
        });
        console.log(`[CLISessionWatcher] Woke up (stopped: ${this.stopped}, queue: ${this.messageQueue.length})`);

        // Check if we should exit
        if (this.stopped) {
          break;
        }
      }
    } finally {
      console.log(`[CLISessionWatcher] Generator exiting`);
      this.stop();
    }
  }

  /**
   * Process any remaining messages in the file
   *
   * Called when the CLI process exits to ensure we don't miss final messages
   * that haven't triggered a chokidar event yet.
   *
   * @returns Array of any remaining messages found
   */
  async flushRemainingMessages(): Promise<SDKMessage[]> {
    console.log(`[CLISessionWatcher] Flushing remaining messages from file`);
    await this.processFile();

    // Return all queued messages
    const messages = [...this.messageQueue];
    this.messageQueue = [];

    console.log(`[CLISessionWatcher] Flushed ${messages.length} remaining message(s)`);
    return messages;
  }

  /**
   * Stop watching
   */
  stop(): void {
    console.log(`[CLISessionWatcher] stop() called`);
    this.stopped = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    // Wake up any waiting iterator
    if (this.pendingMessageResolve) {
      this.pendingMessageResolve();
      this.pendingMessageResolve = null;
    }
  }
}

/**
 * Convenience function to watch a session file
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
