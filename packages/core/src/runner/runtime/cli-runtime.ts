/**
 * CLI Runtime implementation
 *
 * Executes Claude agents via the Claude CLI instead of the SDK, enabling Max plan
 * pricing for agent execution. This runtime spawns the `claude` CLI command with
 * stream-json output format and parses stdout into SDKMessage format.
 *
 * Requirements:
 * - Claude CLI must be installed (`brew install claude-ai/tap/claude`)
 * - CLI must be authenticated (`claude login`)
 * - Uses Max plan pricing when available
 *
 * The CLIRuntime provides identical streaming interface to SDKRuntime, allowing
 * seamless runtime switching via agent configuration.
 */

import { execa } from "execa";
import { createInterface } from "node:readline";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage } from "../types.js";
import { parseCLILine } from "./cli-output-parser.js";

/**
 * CLI runtime implementation
 *
 * This runtime uses the Claude CLI to execute agents, providing an alternative
 * backend to the SDK runtime. It spawns `claude` with stream-json output and
 * parses the JSONL stdout stream into SDKMessage format.
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
   * Spawns `claude` CLI with stream-json output format and streams parsed
   * messages. Handles process lifecycle, cancellation, and error scenarios.
   *
   * Process flow:
   * 1. Build CLI arguments from execution options
   * 2. Spawn claude subprocess with execa
   * 3. Stream and parse stdout lines into SDKMessage
   * 4. Track session_id from first message for resume support
   * 5. Handle process completion and exit codes
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // Build CLI arguments
    // Note: -p is a boolean flag for print mode, prompt goes at the end as positional arg
    const args: string[] = [
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
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

    // Track session ID for debugging
    let sessionId: string | undefined;
    let hasError = false;

    try {
      // Determine working directory root for cwd
      const working_directory = options.agent.working_directory;
      const cwd = working_directory
        ? typeof working_directory === "string"
          ? working_directory
          : working_directory.root
        : undefined;

      // Spawn claude subprocess
      const subprocess = execa("claude", args, {
        cwd,
        cancelSignal: options.abortController?.signal,
      });

      // Ensure stdout exists (should always be true with execa)
      if (!subprocess.stdout) {
        yield {
          type: "error",
          message: "Failed to capture CLI stdout",
        };
        return;
      }

      // Create readline interface for line-by-line processing
      const rl = createInterface({
        input: subprocess.stdout,
        crlfDelay: Infinity,
      });

      // Stream and parse stdout lines
      for await (const line of rl) {
        const message = parseCLILine(line);
        if (message) {
          // Track session ID from first message that includes it
          if (message.session_id && !sessionId) {
            sessionId = message.session_id;
          }

          // Track if we've seen an error message
          if (message.type === "error") {
            hasError = true;
          }

          yield message;
        }
      }

      // Wait for process to complete
      const { exitCode } = await subprocess;

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
    }
  }
}
