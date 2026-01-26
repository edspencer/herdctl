/**
 * Shell Hook Runner
 *
 * Executes shell commands with HookContext JSON piped to stdin.
 * Used for integrating with custom scripts, logging, and external tooling.
 */

import { spawn } from "node:child_process";
import type { HookContext, HookResult, ShellHookConfigInput } from "../types.js";

/**
 * Default timeout for shell hooks in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Maximum output buffer size in bytes (1MB)
 * Prevents memory issues with verbose scripts
 */
const MAX_OUTPUT_SIZE = 1024 * 1024;

/**
 * Logger interface for ShellHookRunner
 */
export interface ShellHookRunnerLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Options for ShellHookRunner
 */
export interface ShellHookRunnerOptions {
  /**
   * Logger for hook execution output
   */
  logger?: ShellHookRunnerLogger;

  /**
   * Working directory for shell commands
   */
  cwd?: string;

  /**
   * Additional environment variables to pass to the shell
   */
  env?: Record<string, string>;
}

/**
 * ShellHookRunner executes shell commands with HookContext on stdin
 *
 * @example
 * ```typescript
 * const runner = new ShellHookRunner({ logger: console });
 *
 * const result = await runner.execute(
 *   { type: 'shell', command: './scripts/log-job.sh' },
 *   hookContext
 * );
 *
 * if (result.success) {
 *   console.log('Hook completed:', result.output);
 * } else {
 *   console.error('Hook failed:', result.error);
 * }
 * ```
 */
export class ShellHookRunner {
  private logger: ShellHookRunnerLogger;
  private cwd?: string;
  private env?: Record<string, string>;

  constructor(options: ShellHookRunnerOptions = {}) {
    this.logger = options.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.cwd = options.cwd;
    this.env = options.env;
  }

  /**
   * Execute a shell hook with the given context
   *
   * @param config - Shell hook configuration (accepts input type with optional fields)
   * @param context - Hook context to pass to the script
   * @returns Promise resolving to the hook result
   */
  async execute(config: ShellHookConfigInput, context: HookContext): Promise<HookResult> {
    const startTime = Date.now();
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    this.logger.debug(`Executing shell hook: ${config.command}`);

    try {
      const result = await this.runCommand(config.command, context, timeout);

      const durationMs = Date.now() - startTime;

      if (result.exitCode === 0) {
        this.logger.info(
          `Shell hook completed successfully in ${durationMs}ms: ${config.command}`
        );
        return {
          success: true,
          hookType: "shell",
          durationMs,
          output: result.stdout,
          exitCode: result.exitCode,
        };
      } else {
        this.logger.warn(
          `Shell hook failed with exit code ${result.exitCode}: ${config.command}`
        );
        return {
          success: false,
          hookType: "shell",
          durationMs,
          error: `Exit code ${result.exitCode}: ${result.stderr || "No error output"}`,
          output: result.stdout,
          exitCode: result.exitCode,
        };
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Shell hook error: ${errorMessage}`);

      return {
        success: false,
        hookType: "shell",
        durationMs,
        error: errorMessage,
      };
    }
  }

  /**
   * Run the shell command and capture output
   */
  private runCommand(
    command: string,
    context: HookContext,
    timeout: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const contextJson = JSON.stringify(context);

      // Spawn shell process
      const proc = spawn(command, {
        shell: true,
        cwd: this.cwd,
        env: {
          ...process.env,
          ...this.env,
        },
        // Don't inherit stdio - we want to capture output
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");

        // Force kill after 1 second if SIGTERM doesn't work
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 1000);
      }, timeout);

      // Capture stdout
      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= MAX_OUTPUT_SIZE) {
          stdout += chunk;
        }
      });

      // Capture stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= MAX_OUTPUT_SIZE) {
          stderr += chunk;
        }
      });

      // Handle process exit
      proc.on("close", (code) => {
        clearTimeout(timeoutHandle);

        if (killed) {
          reject(new Error(`Hook timed out after ${timeout}ms`));
          return;
        }

        resolve({
          exitCode: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      // Handle spawn errors
      proc.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });

      // Write context to stdin and close it
      // Handle EPIPE errors that occur if process exits before we finish writing
      if (proc.stdin) {
        proc.stdin.on("error", (err: NodeJS.ErrnoException) => {
          // EPIPE is expected if process exits early - ignore it
          if (err.code !== "EPIPE") {
            this.logger.warn(`stdin error: ${err.message}`);
          }
        });
        proc.stdin.write(contextJson);
        proc.stdin.end();
      }
    });
  }
}
