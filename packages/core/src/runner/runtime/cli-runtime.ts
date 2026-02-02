/**
 * CLI Runtime implementation
 *
 * Executes Claude agents via the Claude CLI instead of the SDK, enabling Max plan
 * pricing for agent execution. This runtime spawns the `claude` CLI command and
 * watches the session file for messages (since claude only outputs to TTY).
 *
 * Requirements:
 * - Claude CLI must be installed (`brew install claude-ai/tap/claude`)
 * - CLI must be authenticated (`claude login`)
 * - Uses Max plan pricing when available
 *
 * The CLIRuntime provides identical streaming interface to SDKRuntime, allowing
 * seamless runtime switching via agent configuration.
 */

import { execa, type Subprocess } from "execa";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage } from "../types.js";
import {
  getCliSessionDir,
  getCliSessionFile,
  waitForNewSessionFile,
} from "./cli-session-path.js";
import { CLISessionWatcher } from "./cli-session-watcher.js";

/**
 * CLI runtime implementation
 *
 * This runtime uses the Claude CLI to execute agents, providing an alternative
 * backend to the SDK runtime. It spawns `claude` CLI and watches the session file
 * for new messages (since claude only outputs stream-json to TTY).
 *
 * The CLI runtime enables:
 * - Max plan pricing (cost savings vs SDK/API pricing)
 * - Full Claude Code capabilities (identical to manual CLI usage)
 * - AbortController support for process cancellation
 *
 * @example
 * ```typescript
 * const runtime = new CLIRuntime();
 * const messages = runtime.execute({
 *   prompt: "Fix the bug in auth.ts",
 *   agent: resolvedAgent,
 * });
 *
 * for await (const message of messages) {
 *   console.log(message.type, message.content);
 * }
 * ```
 */
export class CLIRuntime implements RuntimeInterface {
  /**
   * Execute an agent using the Claude CLI
   *
   * Spawns `claude` CLI and watches the session file for messages. The session
   * file approach is used because claude only outputs stream-json to TTY, not
   * to pipes.
   *
   * Process flow:
   * 1. Build CLI arguments from execution options
   * 2. Spawn claude subprocess (output is ignored)
   * 3. Find the CLI session directory for the workspace
   * 4. Wait briefly for session file to be created
   * 5. Find the newest .jsonl file (the one just created)
   * 6. Watch that file and stream messages as they're appended
   * 7. Handle process completion and exit codes
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // Build CLI arguments
    // Note: -p is --print mode (print response and exit), prompt goes as positional arg
    const args: string[] = [
      "-p",
      "--dangerously-skip-permissions",
    ];

    // Add session options
    if (options.resume) {
      args.push("--resume", options.resume);
    }
    if (options.fork) {
      args.push("--fork-session");
    }

    // Add prompt as positional argument at the end
    args.push(options.prompt);

    // DEBUG: Log the command being executed
    console.log("[CLIRuntime] Executing command:", "claude", args);
    console.log("[CLIRuntime] Prompt:", options.prompt);

    // Track process and watcher for cleanup
    let subprocess: Subprocess | undefined;
    let watcher: CLISessionWatcher | undefined;
    let hasError = false;

    try {
      // Determine working directory root for cwd
      const working_directory = options.agent.working_directory;
      const cwd = working_directory
        ? typeof working_directory === "string"
          ? working_directory
          : working_directory.root
        : process.cwd();

      console.log("[CLIRuntime] Working directory:", cwd);
      console.log("[CLIRuntime] Agent working_directory config:", working_directory);

      // Get the CLI session directory where files will be written
      const sessionDir = getCliSessionDir(cwd);
      console.log("[CLIRuntime] Session directory:", sessionDir);

      // Record start time before spawning process
      const processStartTime = Date.now();

      // Spawn claude subprocess (we won't read its output)
      // Set stdin to 'ignore' so Claude doesn't wait for input
      subprocess = execa("claude", args, {
        cwd,
        stdin: "ignore",
        cancelSignal: options.abortController?.signal,
      });

      console.log("[CLIRuntime] Subprocess spawned, PID:", subprocess.pid);

      // Log subprocess output for debugging
      subprocess.stdout?.on("data", (data) => {
        console.log("[CLIRuntime] stdout:", data.toString());
      });
      subprocess.stderr?.on("data", (data) => {
        console.error("[CLIRuntime] stderr:", data.toString());
      });

      // Track subprocess completion for later
      const processExitPromise = (async () => {
        try {
          return await subprocess;
        } catch (error) {
          console.error("[CLIRuntime] Process failed:", error);
          throw error;
        }
      })();

      // Monitor subprocess completion in background (for logging only)
      processExitPromise.then(
        (result) => {
          console.log("[CLIRuntime] Process completed with exit code:", result.exitCode);
        },
        () => {
          // Error already logged above
        }
      );

      // Determine which session file to watch
      let sessionFilePath: string;
      if (options.resume) {
        // When resuming, use the known session ID
        sessionFilePath = getCliSessionFile(cwd, options.resume);
        console.log("[CLIRuntime] Resuming session, watching file:", sessionFilePath);
      } else {
        // When starting new session, wait for a NEW file created after process start
        console.log("[CLIRuntime] Waiting for new session file (timeout: 15s)...");
        sessionFilePath = await waitForNewSessionFile(sessionDir, processStartTime, {
          timeoutMs: 15000, // Increase timeout to 15 seconds for debugging
          pollIntervalMs: 200,
        });
        console.log("[CLIRuntime] New session, watching newly created file:", sessionFilePath);
      }

      // Extract session ID from filename (basename without .jsonl extension)
      // For CLI runtime, the session ID is the filename - this matches SDK runtime behavior
      const sessionFileName = sessionFilePath.split("/").pop() || "";
      const extractedSessionId = sessionFileName.replace(/\.jsonl$/, "");
      console.log("[CLIRuntime] Extracted session ID:", extractedSessionId);

      // Watch the session file for messages
      watcher = new CLISessionWatcher(sessionFilePath);

      // When resuming, initialize watcher to skip existing content
      // This prevents replaying the entire conversation history on each message
      if (options.resume) {
        await watcher.initialize();
        console.log("[CLIRuntime] Watcher initialized for resume, will skip existing content");
      }

      // Set up abort handling
      if (options.abortController) {
        options.abortController.signal.addEventListener("abort", () => {
          subprocess?.kill();
          watcher?.stop();
        });
      }

      // Set up process completion handler - stop watcher when process exits
      // This allows the for-await loop to exit naturally
      processExitPromise.then(
        () => {
          console.log("[CLIRuntime] Process completed, stopping watcher to exit loop");
          watcher?.stop();
        },
        (error) => {
          console.log("[CLIRuntime] Process failed, stopping watcher");
          watcher?.stop();
        }
      );

      // Stream messages from the session file
      // Just iterate naturally - the watcher handles all the waiting
      console.log("[CLIRuntime] Starting to stream messages from watcher");

      // Yield synthetic system message with session ID (matches SDK runtime behavior)
      // This allows the message processor to extract the session ID for persistence
      yield {
        type: "system",
        subtype: "init",
        session_id: extractedSessionId,
        content: "CLI session initialized",
      };
      console.log("[CLIRuntime] Yielded synthetic system message with session ID");

      // Stream messages from the watcher as they arrive
      for await (const message of watcher.watch()) {
        console.log(`[CLIRuntime] Received message type: ${message.type}`);
        yield message;

        // Track errors
        if (message.type === "error") {
          hasError = true;
        }

        // If this is a result message, we're done
        if (message.type === "result") {
          console.log("[CLIRuntime] Got result message, stopping");
          break;
        }
      }

      console.log("[CLIRuntime] Watcher iteration complete");

      // Wait for process to complete
      const { exitCode } = await processExitPromise;
      console.log("[CLIRuntime] Process completed, flushing any remaining messages");

      // After process exits, explicitly flush the file one more time
      // This catches any final messages that hadn't triggered chokidar events yet
      const remainingMessages = await watcher.flushRemainingMessages();
      console.log(`[CLIRuntime] Found ${remainingMessages.length} remaining message(s) after process exit`);

      // Stop the watcher now - we've flushed everything we need
      console.log("[CLIRuntime] Stopping watcher after flush");
      watcher.stop();

      // Yield any remaining messages
      for (const message of remainingMessages) {
        console.log(`[CLIRuntime] Yielding remaining message type: ${message.type}`);
        yield message;

        // Track errors
        if (message.type === "error") {
          hasError = true;
        }
      }

      // If process failed and we didn't yield an error message, create one
      if (exitCode !== 0 && !hasError) {
        yield {
          type: "error",
          message: `Claude CLI exited with code ${exitCode}`,
          code: `EXIT_${exitCode}`,
        };
      }
    } catch (error) {
      // Handle process errors
      if (error && typeof error === "object" && "code" in error) {
        const execaError = error as { code?: string; message: string };

        // CLI not found
        if (execaError.code === "ENOENT") {
          yield {
            type: "error",
            message:
              "Claude CLI not found. Install with: brew install claude-ai/tap/claude",
            code: "CLI_NOT_FOUND",
          };
          return;
        }

        // Process was killed (likely by AbortController)
        if (execaError.code === "ABORT_ERR") {
          yield {
            type: "error",
            message: "Claude CLI execution was cancelled",
            code: "CANCELLED",
          };
          return;
        }
      }

      // Generic error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      yield {
        type: "error",
        message: `CLI execution failed: ${errorMessage}`,
      };
    } finally {
      // Cleanup
      watcher?.stop();
    }
  }
}
