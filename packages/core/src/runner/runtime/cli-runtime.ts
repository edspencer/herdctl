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
import { createLogger } from "../../utils/logger.js";
import { transformMcpServers } from "../sdk-adapter.js";
import type { SDKMessage } from "../types.js";
import { getCliSessionDir, getCliSessionFile, waitForNewSessionFile } from "./cli-session-path.js";
import { CLISessionWatcher } from "./cli-session-watcher.js";
import type { RuntimeExecuteOptions, RuntimeInterface } from "./interface.js";
import { type McpHttpBridge, startMcpHttpBridge } from "./mcp-http-bridge.js";

const logger = createLogger("CLIRuntime");

/**
 * Process spawner function type
 *
 * Spawns a claude CLI process and returns a subprocess handle.
 * Used to allow custom process spawning (e.g., inside Docker containers).
 *
 * Returns Subprocess directly (not wrapped in Promise) - execa returns
 * a special promise-like object (Subprocess) that has extra properties.
 *
 * @param args - CLI arguments (without prompt)
 * @param cwd - Working directory
 * @param prompt - Prompt text to provide via stdin (required for -p mode)
 * @param signal - AbortSignal for cancellation
 */
type ProcessSpawner = (
  args: string[],
  cwd: string,
  prompt: string,
  signal?: AbortSignal,
) => Subprocess;

/**
 * CLI runtime configuration options
 */
interface CLIRuntimeOptions {
  /**
   * Custom process spawner for claude CLI execution
   *
   * Defaults to local execa spawning. Provide custom spawner for Docker execution.
   */
  processSpawner?: ProcessSpawner;

  /**
   * Custom session directory override
   *
   * For Docker execution, this should be the host-side mount point where
   * container session files are visible (e.g., .herdctl/docker-sessions).
   */
  sessionDirOverride?: string;
}

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
 * Supports both local and Docker execution via configurable process spawning.
 *
 * @example
 * ```typescript
 * // Local execution
 * const runtime = new CLIRuntime();
 *
 * // Docker execution
 * const runtime = new CLIRuntime({
 *   processSpawner: async (args, cwd, signal) => {
 *     return execa("docker", ["exec", containerId, "sh", "-c",
 *                             `cd /workspace && claude ${args.join(" ")}`],
 *                  { cancelSignal: signal });
 *   },
 *   sessionDirOverride: "/path/to/.herdctl/docker-sessions"
 * });
 * ```
 */
export class CLIRuntime implements RuntimeInterface {
  private processSpawner: ProcessSpawner;
  private sessionDirOverride?: string;

  constructor(options?: CLIRuntimeOptions) {
    // Default to local execa spawning with prompt via stdin
    this.processSpawner =
      options?.processSpawner ??
      ((args, cwd, prompt, signal) =>
        execa("claude", args, {
          cwd,
          input: prompt, // Provide prompt via stdin (required for -p mode)
          cancelSignal: signal,
        }));

    this.sessionDirOverride = options?.sessionDirOverride;
  }
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
    // Note: -p is --print mode (print response and exit)
    // Prompt is provided via stdin, not as a CLI argument
    const args: string[] = ["-p"];

    // Add permission mode from agent config (defaults to acceptEdits)
    const permissionMode = options.agent.permission_mode ?? "acceptEdits";
    args.push("--permission-mode", permissionMode);

    // Add model if specified
    if (options.agent.model) {
      args.push("--model", options.agent.model);
    }

    // Add system prompt if specified, with optional append for chat platforms
    if (options.agent.system_prompt && options.systemPromptAppend) {
      args.push(
        "--system-prompt",
        options.agent.system_prompt + "\n\n" + options.systemPromptAppend,
      );
    } else if (options.agent.system_prompt) {
      args.push("--system-prompt", options.agent.system_prompt);
    } else if (options.systemPromptAppend) {
      args.push("--system-prompt", options.systemPromptAppend);
    }

    // Add allowed tools if specified (direct passthrough to CLI)
    // Note: --allowedTools accepts "comma or space-separated" but space-separated consumes
    // all following args, so we must use comma-separated
    if (options.agent.allowed_tools?.length) {
      args.push("--allowedTools", options.agent.allowed_tools.join(","));
    }

    // Add denied tools if specified (direct passthrough to CLI)
    if (options.agent.denied_tools?.length) {
      args.push("--disallowedTools", options.agent.denied_tools.join(","));
    }

    // Add setting sources if specified (comma-separated)
    if (options.agent.setting_sources?.length) {
      args.push("--setting-sources", options.agent.setting_sources.join(","));
    }

    // Add MCP servers if specified
    // Transform agent config format to SDK format and serialize to JSON
    // Claude CLI expects: {"mcpServers": { ... }} (same shape as .mcp.json)
    if (options.agent.mcp_servers && Object.keys(options.agent.mcp_servers).length > 0) {
      const mcpServers = transformMcpServers(options.agent.mcp_servers);
      const mcpConfig = JSON.stringify({ mcpServers });
      args.push("--mcp-config", mcpConfig);
    }

    // Track env mutation so we can restore it (see CLAUDE_CODE_STREAM_CLOSE_TIMEOUT below)
    let savedStreamCloseTimeout: string | undefined | null = null; // null = not mutated

    // Start HTTP bridges for injected MCP servers (e.g., file sender)
    // Same pattern as container-runner: expose in-process handlers via HTTP,
    // then pass as HTTP-type MCP servers in --mcp-config
    const bridges: McpHttpBridge[] = [];
    if (options.injectedMcpServers && Object.keys(options.injectedMcpServers).length > 0) {
      for (const [name, def] of Object.entries(options.injectedMcpServers)) {
        let bridge: McpHttpBridge;
        try {
          bridge = await startMcpHttpBridge(def);
        } catch (bridgeError) {
          // Clean up any bridges that started successfully before this failure
          for (const b of bridges) {
            try {
              await b.close();
            } catch {
              // best-effort cleanup
            }
          }
          bridges.length = 0;
          throw bridgeError;
        }
        bridges.push(bridge);

        // Build or extend the --mcp-config to include this HTTP server
        // Find existing --mcp-config arg index to merge with it
        const mcpConfigIdx = args.indexOf("--mcp-config");
        let mcpConfig: { mcpServers: Record<string, unknown> };

        if (mcpConfigIdx !== -1 && mcpConfigIdx + 1 < args.length) {
          // Parse existing config and add the bridge
          mcpConfig = JSON.parse(args[mcpConfigIdx + 1]);
        } else {
          mcpConfig = { mcpServers: {} };
        }

        mcpConfig.mcpServers[name] = {
          type: "http",
          url: `http://127.0.0.1:${bridge.port}/mcp`,
        };

        const configJson = JSON.stringify(mcpConfig);
        if (mcpConfigIdx !== -1) {
          args[mcpConfigIdx + 1] = configJson;
        } else {
          args.push("--mcp-config", configJson);
        }

        logger.debug(`Started MCP HTTP bridge for '${name}' on port ${bridge.port}`);
      }

      // Auto-add injected MCP tool patterns to allowedTools.
      // Only needed when the agent has an explicit allowlist — without one, all tools
      // (including injected MCP tools) are allowed by default.
      const allowedToolsIdx = args.indexOf("--allowedTools");
      if (allowedToolsIdx !== -1 && allowedToolsIdx + 1 < args.length) {
        const existing = args[allowedToolsIdx + 1];
        const injectedPatterns = Object.keys(options.injectedMcpServers).map(
          (name) => `mcp__${name}__*`,
        );
        args[allowedToolsIdx + 1] = [existing, ...injectedPatterns].join(",");
      }

      // File uploads via MCP tools can take longer than the default 60s timeout.
      // Save the original value so we can restore it in `finally` to avoid leaking
      // state across concurrent jobs.
      if (options.injectedMcpServers["herdctl-file-sender"]) {
        if (!process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
          savedStreamCloseTimeout = undefined; // marker: was not set
          process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "120000";
        }
      }
    }

    // Add session options
    if (options.resume) {
      args.push("--resume", options.resume);
    }
    if (options.fork) {
      args.push("--fork-session");
    }

    // Note: Prompt is NOT added to args - it's provided via stdin (see processSpawner call below)

    // DEBUG: Log the command being executed
    logger.debug(`Executing command: claude ${args.join(" ")}`);
    logger.debug(`Prompt: ${options.prompt}`);

    // Track process and watcher for cleanup
    let subprocess: Subprocess | undefined;
    let watcher: CLISessionWatcher | undefined;
    let hasError = false;

    // Track usage stats across all assistant turns for synthetic result message
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let numTurns = 0;
    let lastAssistantText = "";

    // Helper to accumulate usage from each assistant message
    const trackAssistantUsage = (message: SDKMessage) => {
      numTurns++;
      const msg = message as {
        message?: {
          content?: Array<{ type: string; text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
      const usage = msg.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens ?? 0;
        totalOutputTokens += usage.output_tokens ?? 0;
      }
      // Capture last text content for result fallback
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        const textParts = content.filter((b) => b.type === "text" && b.text).map((b) => b.text!);
        if (textParts.length > 0) {
          lastAssistantText = textParts.join("");
        }
      }
    };

    try {
      // Determine working directory root for cwd
      const working_directory = options.agent.working_directory;
      const cwd = working_directory
        ? typeof working_directory === "string"
          ? working_directory
          : working_directory.root
        : process.cwd();

      logger.debug(`Working directory: ${cwd}`);
      logger.debug(`Agent working_directory config: ${JSON.stringify(working_directory)}`);

      // Get the CLI session directory where files will be written
      // Use override if provided (for Docker execution with mounted sessions)
      const sessionDir = this.sessionDirOverride ?? getCliSessionDir(cwd);
      logger.debug(`Session directory: ${sessionDir}`);

      // Record start time before spawning process
      const processStartTime = Date.now();

      // Spawn claude subprocess with prompt via stdin
      // Uses custom spawner if provided (e.g., for Docker execution)
      // Note: processSpawner returns Subprocess directly (which is promise-like)
      subprocess = this.processSpawner(args, cwd, options.prompt, options.abortController?.signal);

      logger.debug(`Subprocess spawned, PID: ${subprocess.pid}`);

      // Log subprocess output for debugging
      subprocess.stdout?.on("data", (data) => {
        logger.info(data.toString());
      });
      subprocess.stderr?.on("data", (data) => {
        logger.warn(data.toString());
      });

      // Track subprocess completion for later
      const processExitPromise = (async () => {
        try {
          return await subprocess;
        } catch (error) {
          logger.error(`Process failed: ${error}`);
          throw error;
        }
      })();

      // Monitor subprocess completion in background (for logging only)
      processExitPromise.then(
        (result) => {
          logger.debug(`Process completed with exit code: ${result.exitCode}`);
        },
        () => {
          // Error already logged above
        },
      );

      // Determine which session file to watch
      let sessionFilePath: string;
      if (options.resume) {
        // When resuming, use sessionDirOverride if provided (for Docker execution)
        // Otherwise fall back to native CLI path
        if (this.sessionDirOverride) {
          sessionFilePath = `${this.sessionDirOverride}/${options.resume}.jsonl`;
        } else {
          sessionFilePath = getCliSessionFile(cwd, options.resume);
        }
        logger.debug(`Resuming session, watching file: ${sessionFilePath}`);
      } else {
        // When starting new session, wait for a NEW file created after process start
        logger.debug("Waiting for new session file...");
        sessionFilePath = await waitForNewSessionFile(sessionDir, processStartTime, {
          timeoutMs: 60000, // Allow up to 60s for MCP servers to initialize
          pollIntervalMs: 200,
        });
        logger.debug(`New session, watching newly created file: ${sessionFilePath}`);
      }

      // Extract session ID from filename (basename without .jsonl extension)
      // For CLI runtime, the session ID is the filename - this matches SDK runtime behavior
      const sessionFileName = sessionFilePath.split("/").pop() || "";
      const extractedSessionId = sessionFileName.replace(/\.jsonl$/, "");
      logger.debug(`Extracted session ID: ${extractedSessionId}`);

      // Watch the session file for messages
      watcher = new CLISessionWatcher(sessionFilePath);

      // When resuming, initialize watcher to skip existing content
      // This prevents replaying the entire conversation history on each message
      if (options.resume) {
        await watcher.initialize();
        logger.debug("Watcher initialized for resume, will skip existing content");
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
          logger.debug("Process completed, stopping watcher to exit loop");
          watcher?.stop();
        },
        () => {
          logger.debug("Process failed, stopping watcher");
          watcher?.stop();
        },
      );

      // Stream messages from the session file
      // Just iterate naturally - the watcher handles all the waiting
      logger.debug("Starting to stream messages from watcher");

      // Yield synthetic system message with session ID (matches SDK runtime behavior)
      // This allows the message processor to extract the session ID for persistence
      yield {
        type: "system",
        subtype: "init",
        session_id: extractedSessionId,
        content: "CLI session initialized",
      };
      logger.debug("Yielded synthetic system message with session ID");

      // Stream messages from the watcher as they arrive
      let gotResultMessage = false;
      for await (const message of watcher.watch()) {
        logger.debug(`Received message type: ${message.type}`);
        yield message;

        // Track assistant turn usage for synthetic result message
        if (message.type === "assistant") {
          trackAssistantUsage(message);
        }

        // Track errors
        if (message.type === "error") {
          hasError = true;
        }

        // If this is a result message, we're done
        if (message.type === "result") {
          logger.debug("Got result message, stopping");
          gotResultMessage = true;
          break;
        }
      }

      logger.debug("Watcher iteration complete");

      // Wait for process to complete
      const { exitCode } = await processExitPromise;
      logger.debug("Process completed, flushing any remaining messages");

      // After process exits, explicitly flush the file one more time
      // This catches any final messages that hadn't triggered chokidar events yet
      const remainingMessages = await watcher.flushRemainingMessages();
      logger.debug(`Found ${remainingMessages.length} remaining message(s) after process exit`);

      // Stop the watcher now - we've flushed everything we need
      logger.debug("Stopping watcher after flush");
      watcher.stop();

      // Yield any remaining messages
      for (const message of remainingMessages) {
        logger.debug(`Yielding remaining message type: ${message.type}`);
        yield message;

        // Track assistant turn usage for synthetic result message
        if (message.type === "assistant") {
          trackAssistantUsage(message);
        }

        // Track errors
        if (message.type === "error") {
          hasError = true;
        }

        if (message.type === "result") {
          gotResultMessage = true;
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

      // Synthesize a result message for CLI runtime
      // The Claude CLI doesn't emit "result" messages like the SDK does,
      // so we aggregate usage stats from assistant turns and emit one.
      if (!gotResultMessage) {
        const durationMs = Date.now() - processStartTime;
        logger.debug(
          `Emitting synthetic result: ${numTurns} turns, ${totalInputTokens}+${totalOutputTokens} tokens, ${durationMs}ms`,
        );
        yield {
          type: "result",
          result: lastAssistantText || "",
          is_error: hasError,
          duration_ms: durationMs,
          num_turns: numTurns,
          usage: {
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
          },
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
            message: "Claude CLI not found. Install with: brew install claude-ai/tap/claude",
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield {
        type: "error",
        message: `CLI execution failed: ${errorMessage}`,
      };
    } finally {
      // Cleanup
      watcher?.stop();

      // Restore process.env if we mutated it
      if (savedStreamCloseTimeout !== null) {
        if (savedStreamCloseTimeout === undefined) {
          delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
        } else {
          process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = savedStreamCloseTimeout;
        }
      }

      // Close HTTP bridges for injected MCP servers
      for (const bridge of bridges) {
        try {
          await bridge.close();
        } catch (err) {
          logger.error(`Failed to close MCP HTTP bridge: ${err}`);
        }
      }
    }
  }
}
