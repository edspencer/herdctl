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
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage, InjectedMcpServerDef } from "../types.js";
import type { DockerConfig } from "./docker-config.js";
import { startMcpHttpBridge, type McpHttpBridge } from "./mcp-http-bridge.js";
import {
  ContainerManager,
  buildContainerMounts,
  buildContainerEnv,
} from "./container-manager.js";
import { CLIRuntime } from "./cli-runtime.js";
import { SDKRuntime } from "./sdk-runtime.js";
import { toSDKOptions } from "../sdk-adapter.js";
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
   * Creates or reuses container, then executes based on runtime type:
   * - CLI runtime: docker exec claude, watch session files on host
   * - SDK runtime: docker exec wrapper script, stream JSONL from stdout
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    const { agent } = options;

    // Ensure docker-sessions directory exists on host (for CLI runtime)
    const dockerSessionsDir = path.join(this.stateDir, "docker-sessions");
    await fs.mkdir(dockerSessionsDir, { recursive: true });

    // Build mounts and environment
    const mounts = buildContainerMounts(agent, this.config, this.stateDir);
    const env = buildContainerEnv(agent, this.config);

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

      // Handle CLI runtime with session file watching
      if (this.wrapped instanceof CLIRuntime) {
        yield* this.executeCLIRuntime(containerId, dockerSessionsDir, options);
      }
      // Handle SDK runtime with wrapper script
      else if (this.wrapped instanceof SDKRuntime) {
        yield* this.executeSDKRuntime(container, options);
      }
      // Unknown runtime type
      else {
        throw new Error(`Unsupported runtime type for Docker execution: ${this.wrapped.constructor.name}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      yield {
        type: "error",
        message: `Docker execution failed: ${errorMessage}`,
      } as SDKMessage;

      // Container cleanup happens in finally block
    } finally {
      // For ephemeral containers, stop immediately after execution
      // This triggers AutoRemove so the container is cleaned up automatically
      if (this.config.ephemeral) {
        try {
          await this.manager.stopContainer(container);
        } catch (stopError) {
          // Log but don't fail - container might already be stopped
          console.error('[ContainerRunner] Failed to stop ephemeral container:', stopError);
        }
      }

      // Always cleanup old containers, regardless of success/failure
      // This prevents container accumulation from failed executions
      try {
        await this.manager.cleanupOldContainers(agent.name, this.config.maxContainers);
      } catch (cleanupError) {
        // Log cleanup errors but don't fail the execution
        console.error('[ContainerRunner] Failed to cleanup old containers:', cleanupError);
      }
    }
  }

  /**
   * Execute CLI runtime inside Docker container
   *
   * Spawns claude CLI via docker exec and watches session files on host.
   */
  private async *executeCLIRuntime(
    containerId: string,
    dockerSessionsDir: string,
    options: RuntimeExecuteOptions
  ): AsyncIterable<SDKMessage> {
    // Create CLI runtime with Docker-specific spawner
    const cliRuntime = new CLIRuntime({
      processSpawner: (args, _cwd, prompt, signal) => {
        // Build docker exec command with prompt piped to stdin
        // Uses printf to avoid issues with newlines and special chars in prompt
        // Command: docker exec <container> sh -c 'cd /workspace && printf %s "prompt" | claude <args>'
        const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const claudeArgs = args.map(arg => {
          // Escape single quotes in arguments
          return `'${arg.replace(/'/g, "'\\''")}'`;
        }).join(" ");
        const claudeCommand = `cd /workspace && printf %s "${escapedPrompt}" | claude ${claudeArgs}`;

        console.log("[ContainerRunner] Executing docker command:", "docker", ["exec", containerId, "sh", "-c", claudeCommand]);
        console.log("[ContainerRunner] Prompt length:", prompt.length);

        // execa returns Subprocess directly (which is promise-like)
        return execa("docker", ["exec", containerId, "sh", "-c", claudeCommand], {
          cancelSignal: signal,
        });
      },
      // Session files are written inside container but mounted to host
      sessionDirOverride: dockerSessionsDir,
    });

    // Delegate to CLI runtime - it handles session watching, timeout, errors
    yield* cliRuntime.execute(options);
  }

  /**
   * Execute SDK runtime inside Docker container
   *
   * Runs docker-sdk-wrapper.js script which imports SDK and streams messages as JSONL.
   * If injected MCP servers are present, starts HTTP bridges on the Docker network
   * so the agent container can access them via `http://herdctl:<port>/mcp`.
   */
  private async *executeSDKRuntime(
    container: import("dockerode").Container,
    options: RuntimeExecuteOptions
  ): AsyncIterable<SDKMessage> {
    // Start HTTP bridges for injected MCP servers
    const bridges: McpHttpBridge[] = [];

    try {
      // Build SDK options
      const sdkOptions = toSDKOptions(options.agent, {
        resume: options.resume,
        fork: options.fork,
      });

      // Override cwd for Docker - workspace is always mounted at /workspace
      sdkOptions.cwd = "/workspace";

      // Start HTTP bridges for injected MCP servers and inject as HTTP configs
      if (options.injectedMcpServers && Object.keys(options.injectedMcpServers).length > 0) {
        const mcpServers = sdkOptions.mcpServers ?? {};

        for (const [name, def] of Object.entries(options.injectedMcpServers)) {
          const bridge = await startMcpHttpBridge(def);
          bridges.push(bridge);

          // Agent container connects via Docker DNS: herdctl is the hostname
          // of the herdctl container on the shared Docker network (herdctl-net)
          mcpServers[name] = {
            type: "http",
            url: `http://herdctl:${bridge.port}/mcp`,
          };

          console.log(`[ContainerRunner] Started MCP HTTP bridge for '${name}' on port ${bridge.port}`);
        }

        sdkOptions.mcpServers = mcpServers;

        // Auto-add injected MCP server tool patterns to allowedTools
        // Without this, agents with an allowedTools list can't call injected tools
        if (sdkOptions.allowedTools?.length) {
          for (const name of Object.keys(options.injectedMcpServers)) {
            sdkOptions.allowedTools.push(`mcp__${name}__*`);
          }
        }

        // File uploads via MCP tools can take longer than the default 60s timeout
        if (options.injectedMcpServers["herdctl-file-sender"]) {
          if (!process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
            process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "120000";
          }
        }
      }

      // Prepare options JSON for wrapper script
      const wrapperOptions = {
        prompt: options.prompt,
        sdkOptions,
      };

      // Create exec with environment variable
      // Use bash login shell to get full environment including PATH
      const optionsJson = JSON.stringify(wrapperOptions).replace(/'/g, "'\\''");
      const command = `export HERDCTL_SDK_OPTIONS='${optionsJson}' && node /usr/local/lib/docker-sdk-wrapper.js`;

      console.log("[ContainerRunner] SDK exec command:", command);
      console.log("[ContainerRunner] Options JSON length:", optionsJson.length);

      const exec = await container.exec({
        Cmd: [
          "bash",
          "-l",
          "-c",
          command,
        ],
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: false,
        Tty: false,
        WorkingDir: "/workspace",
      });

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
          console.error("[ContainerRunner] SDK stderr:", trimmed);
          stderrLines.push(trimmed);
        }
      });

      // Parse stdout line-by-line as JSONL
      const rl = createInterface({
        input: stdout,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const message = JSON.parse(trimmed) as SDKMessage;
          yield message;
        } catch (error) {
          console.warn(
            `[ContainerRunner] Failed to parse SDK output: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      // Check exec exit code
      const inspectData = await exec.inspect();
      const exitCode = inspectData.ExitCode ?? 0;
      if (exitCode !== 0) {
        const stderr = stderrLines.join("\n");
        yield {
          type: "error",
          message: `SDK wrapper exited with code ${exitCode}${stderr ? `\n\nStderr:\n${stderr}` : ""}`,
        } as SDKMessage;
      }
    } finally {
      // Always close HTTP bridges to prevent port leaks
      for (const bridge of bridges) {
        try {
          await bridge.close();
        } catch (err) {
          console.error("[ContainerRunner] Failed to close MCP HTTP bridge:", err);
        }
      }
    }
  }
}
