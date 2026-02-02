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

import { execa } from "execa";
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
import { CLIRuntime } from "./cli-runtime.js";

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
   * Creates or reuses container, then delegates to CLIRuntime with Docker-specific
   * process spawning. Session files are written inside the container but watched
   * from the host via mounted docker-sessions directory.
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    const { agent } = options;

    // Ensure docker-sessions directory exists on host
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
      // Get container ID for docker exec
      const containerInfo = await container.inspect();
      const containerId = containerInfo.Id;

      // Create CLI runtime with Docker-specific spawner
      // The spawner runs claude inside the container via docker exec
      const cliRuntime = new CLIRuntime({
        processSpawner: (args, _cwd, signal) => {
          // Build docker exec command: docker exec <container> sh -c 'cd /workspace && claude <args>'
          const claudeCommand = `cd /workspace && claude ${args.map(arg => {
            // Escape single quotes in arguments
            return `'${arg.replace(/'/g, "'\\''")}'`;
          }).join(" ")}`;

          console.log("[ContainerRunner] Executing docker command:", "docker", ["exec", containerId, "sh", "-c", claudeCommand]);
          console.log("[ContainerRunner] Full command string:", claudeCommand);

          // execa returns Subprocess directly (which is promise-like)
          // Don't use -i flag - we don't need interactive stdin
          return execa("docker", ["exec", containerId, "sh", "-c", claudeCommand], {
            stdin: "ignore",
            cancelSignal: signal,
          });
        },
        // Session files are written to /home/claude/.herdctl/sessions inside container
        // but mounted to .herdctl/docker-sessions on host - watch from host side
        sessionDirOverride: dockerSessionsDir,
      });

      // Delegate to CLI runtime - it handles session watching, timeout, errors, etc.
      yield* cliRuntime.execute(options);

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
}
