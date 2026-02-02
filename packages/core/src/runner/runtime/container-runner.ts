/**
 * ContainerRunner - Docker container decorator for RuntimeInterface
 *
 * Wraps any runtime (SDK or CLI) and transparently executes inside Docker containers.
 * Handles path translation, mount configuration, and container lifecycle.
 *
 * @example
 * ```typescript
 * const baseRuntime = new CLIRuntime();
 * const dockerRuntime = new ContainerRunner(baseRuntime, dockerConfig);
 *
 * // Execution happens inside Docker container
 * for await (const message of dockerRuntime.execute(options)) {
 *   console.log(message);
 * }
 * ```
 */

import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage } from "../types.js";
import type { DockerConfig } from "./docker-config.js";
import {
  ContainerManager,
  buildContainerMounts,
  buildContainerEnv,
} from "./container-manager.js";
import Dockerode from "dockerode";

/**
 * Container runtime decorator
 *
 * Decorates any RuntimeInterface to execute inside Docker containers.
 * The wrapped runtime's execute logic runs via `docker exec` inside the container.
 */
export class ContainerRunner implements RuntimeInterface {
  private manager: ContainerManager;
  private stateDir: string;

  /**
   * Create a new ContainerRunner
   *
   * @param wrapped - The underlying runtime to execute inside containers
   * @param config - Docker configuration
   * @param stateDir - herdctl state directory (.herdctl/)
   * @param docker - Optional Docker client for testing
   */
  constructor(
    private wrapped: RuntimeInterface,
    private config: DockerConfig,
    stateDir: string,
    docker?: import("dockerode")
  ) {
    this.manager = new ContainerManager(docker);
    this.stateDir = stateDir;
  }

  /**
   * Execute agent inside Docker container
   *
   * Creates or reuses container, translates paths, and streams output.
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    const { agent } = options;

    // Ensure docker-sessions directory exists
    const dockerSessionsDir = path.join(this.stateDir, "docker-sessions");
    await fs.mkdir(dockerSessionsDir, { recursive: true });

    // Build mounts and environment
    const mounts = buildContainerMounts(agent, this.config, this.stateDir);
    const env = buildContainerEnv(agent);

    // Get or create container
    const container = await this.manager.getOrCreateContainer(
      agent.name,
      this.config,
      mounts,
      env
    );

    try {
      // Build the claude command for container execution
      const claudeCommand = this.buildClaudeCommand(options);

      // Execute claude inside container
      const exec = await this.manager.execInContainer(
        container,
        claudeCommand,
        "/workspace"
      );

      // Start exec and get stream
      const stream = await exec.start({ hijack: true, stdin: false });

      // Demultiplex stdout/stderr
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const modem = new Dockerode().modem;
      modem.demuxStream(stream, stdout, stderr);

      // Collect stderr for error diagnosis
      const stderrLines: string[] = [];
      const stderrRl = createInterface({
        input: stderr,
        crlfDelay: Infinity,
      });

      stderrRl.on("line", (line) => {
        const trimmed = line.trim();
        if (trimmed) {
          stderrLines.push(trimmed);
        }
      });

      // Parse stdout line-by-line
      const rl = createInterface({
        input: stdout,
        crlfDelay: Infinity,
      });

      // Timeout detection: if no output after 30 seconds, assume hang
      let outputReceived = false;
      const TIMEOUT_MS = 30000; // 30 seconds

      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => {
          if (!outputReceived) {
            resolve("timeout");
          }
        }, TIMEOUT_MS);
      });

      // Helper to get first line with timeout
      const firstLinePromise = new Promise<string | "timeout">((resolve) => {
        let resolved = false;

        // Timeout handler
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve("timeout");
          }
        }, TIMEOUT_MS);

        // First line handler
        rl.once("line", (line) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            outputReceived = true;
            resolve(line);
          }
        });

        // Handle stream end before any line
        rl.once("close", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve("timeout");
          }
        });
      });

      const firstLine = await firstLinePromise;

      if (firstLine === "timeout") {
        // No output received - likely authentication issue
        const errorMessage = this.buildAuthenticationErrorMessage(stderrLines);
        yield {
          type: "error",
          message: errorMessage,
        } as SDKMessage;
        return;
      }

      // Process first line if we got one
      const trimmed = firstLine.trim();
      if (trimmed) {
        try {
          const message = JSON.parse(trimmed) as SDKMessage;
          yield message;
        } catch (error) {
          // Skip invalid JSON lines (CLI may output non-JSON)
          console.warn(
            `[ContainerRunner] Failed to parse line: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Continue streaming remaining messages
      for await (const line of rl) {
        const lineTrimmed = line.trim();
        if (!lineTrimmed) continue;

        try {
          const message = JSON.parse(lineTrimmed) as SDKMessage;
          yield message;
        } catch (error) {
          // Skip invalid JSON lines (CLI may output non-JSON)
          console.warn(
            `[ContainerRunner] Failed to parse line: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Check exec exit code
      const inspectData = await exec.inspect();
      const exitCode = inspectData.ExitCode ?? 0;
      if (exitCode !== 0) {
        const errorMessage = this.buildExitErrorMessage(
          exitCode,
          stderrLines
        );
        yield {
          type: "error",
          message: errorMessage,
        } as SDKMessage;
      }

      // Cleanup old containers
      await this.manager.cleanupOldContainers(agent.name, this.config.maxContainers);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      yield {
        type: "error",
        message: `Docker execution failed: ${errorMessage}`,
      } as SDKMessage;

      // If container startup failed, try to clean up
      if (this.config.ephemeral) {
        try {
          await this.manager.stopContainer(container);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Build actionable error message for authentication failures
   */
  private buildAuthenticationErrorMessage(stderrLines: string[]): string {
    const stderr = stderrLines.join("\n");

    let message = "Docker container execution timed out (no output after 30 seconds).\n\n";
    message += "This usually indicates an authentication problem. Claude CLI requires one of:\n\n";
    message += "1. ANTHROPIC_API_KEY environment variable (for API key users)\n";
    message += "   - Set in your shell: export ANTHROPIC_API_KEY='your-key-here'\n";
    message += "   - Or add to .env file in your project root\n\n";
    message += "2. Claude Max web authentication (session token in system keychain)\n";
    message += "   - Run 'claude' outside Docker first to authenticate\n";
    message += "   - Note: macOS Keychain is not accessible from Docker containers\n";
    message += "   - You may need to use ANTHROPIC_API_KEY instead\n";

    if (stderr) {
      message += "\n\nContainer stderr output:\n" + stderr;
    }

    return message;
  }

  /**
   * Build error message from exit code and stderr
   */
  private buildExitErrorMessage(
    exitCode: number,
    stderrLines: string[]
  ): string {
    const stderr = stderrLines.join("\n");

    let message = `Container execution failed with exit code ${exitCode}`;

    if (stderr) {
      message += "\n\nContainer stderr output:\n" + stderr;
    }

    return message;
  }

  /**
   * Build claude CLI command for container execution
   *
   * Translates options to CLI arguments for execution inside container.
   */
  private buildClaudeCommand(options: RuntimeExecuteOptions): string[] {
    const { prompt, resume, fork } = options;

    const args: string[] = [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    // Add session resume options
    if (resume) {
      args.push("--resume", resume);
    }

    if (fork) {
      args.push("--fork-session");
    }

    return args;
  }
}
