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
import { parseCLILine } from "./cli-output-parser.js";

// Use require for dockerode to work around TypeScript/NodeNext module resolution
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Dockerode = require("dockerode") as typeof import("dockerode");

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

      // Parse stdout line-by-line
      const rl = createInterface({
        input: stdout,
        crlfDelay: Infinity,
      });

      // Stream messages
      for await (const line of rl) {
        const message = parseCLILine(line);
        if (message) {
          yield message;
        }
      }

      // Check exec exit code
      const inspectData = await exec.inspect();
      if (inspectData.ExitCode !== 0) {
        yield {
          type: "error",
          error: {
            message: `Container execution failed with exit code ${inspectData.ExitCode}`,
          },
        } as SDKMessage;
      }

      // Cleanup old containers
      await this.manager.cleanupOldContainers(agent.name, this.config.maxContainers);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      yield {
        type: "error",
        error: {
          message: `Docker execution failed: ${errorMessage}`,
        },
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
