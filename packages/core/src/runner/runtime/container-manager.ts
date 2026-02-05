/**
 * Docker container lifecycle management
 *
 * Handles container creation, security configuration, and cleanup.
 * Uses dockerode for Docker API communication.
 */

import type { Container, ContainerCreateOptions, Exec, HostConfig } from "dockerode";
import Dockerode from "dockerode";
import * as path from "node:path";
import * as os from "node:os";
import type { DockerConfig, PathMapping } from "./docker-config.js";
import type { ResolvedAgent } from "../../config/index.js";

/**
 * Container manager for herdctl Docker execution
 */
export class ContainerManager {
  private docker: import("dockerode");
  private runningContainers = new Map<string, Container>();

  constructor(docker?: import("dockerode")) {
    this.docker = docker ?? new Dockerode();
  }

  /**
   * Get or create a container for an agent
   *
   * For persistent containers (ephemeral: false), reuses existing running container.
   * For ephemeral containers, always creates a new container with AutoRemove.
   *
   * @param agentName - Name of the agent
   * @param config - Docker configuration
   * @param mounts - Volume mounts
   * @param env - Environment variables
   * @returns Docker container
   */
  async getOrCreateContainer(
    agentName: string,
    config: DockerConfig,
    mounts: PathMapping[],
    env: string[]
  ): Promise<Container> {
    // For persistent containers, check if already running
    if (!config.ephemeral) {
      const existing = this.runningContainers.get(agentName);
      if (existing) {
        try {
          const info = await existing.inspect();
          if (info.State.Running) {
            return existing;
          }
        } catch {
          // Container no longer exists, remove from map
          this.runningContainers.delete(agentName);
        }
      }
    }

    // Create new container
    const container = await this.createContainer(agentName, config, mounts, env);

    // Start the container
    await container.start();

    // Track persistent containers
    if (!config.ephemeral) {
      this.runningContainers.set(agentName, container);
    }

    return container;
  }

  /**
   * Create a new Docker container with security hardening
   */
  private async createContainer(
    agentName: string,
    config: DockerConfig,
    mounts: PathMapping[],
    env: string[]
  ): Promise<Container> {
    const containerName = `herdctl-${agentName}-${Date.now()}`;

    // Build port bindings for HostConfig
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, object> = {};
    for (const port of config.ports) {
      const containerPortKey = `${port.containerPort}/tcp`;
      portBindings[containerPortKey] = [{ HostPort: String(port.hostPort) }];
      exposedPorts[containerPortKey] = {};
    }

    // Build tmpfs mounts for HostConfig
    const tmpfsMounts: Record<string, string> = {};
    for (const tmpfs of config.tmpfs) {
      tmpfsMounts[tmpfs.path] = tmpfs.options ?? "";
    }

    // Build our translated HostConfig
    const translatedHostConfig: HostConfig = {
      // Resource limits
      Memory: config.memoryBytes,
      MemorySwap: config.memoryBytes, // Same as Memory = no swap
      CpuShares: config.cpuShares, // undefined = no limit (full CPU access)
      CpuPeriod: config.cpuPeriod, // CPU period in microseconds
      CpuQuota: config.cpuQuota, // CPU quota in microseconds per period
      PidsLimit: config.pidsLimit, // Max processes (prevents fork bombs)

      // Network isolation
      NetworkMode: config.network,

      // Port bindings
      PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,

      // Volume mounts
      Binds: mounts.map(
        (m) => `${m.hostPath}:${m.containerPath}:${m.mode}`
      ),

      // Tmpfs mounts
      Tmpfs: Object.keys(tmpfsMounts).length > 0 ? tmpfsMounts : undefined,

      // Security hardening
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      ReadonlyRootfs: false, // Claude needs to write temp files

      // Cleanup
      AutoRemove: config.ephemeral,
    };

    // SECURITY: hostConfigOverride allows fleet operators to customize Docker
    // host config beyond the safe defaults above. This can override security
    // settings like CapDrop and SecurityOpt if needed for specific use cases.
    //
    // This is intentionally only available at fleet-level config (not agent-level)
    // to prevent untrusted agent configs from weakening container security.
    // Fleet operators are trusted to understand the security implications.
    //
    // See .security/THREAT-MODEL.md for full security analysis.
    const finalHostConfig: HostConfig = config.hostConfigOverride
      ? { ...translatedHostConfig, ...config.hostConfigOverride }
      : translatedHostConfig;

    const createOptions: ContainerCreateOptions = {
      Image: config.image,
      name: containerName,
      Tty: false,
      OpenStdin: true,
      StdinOnce: false,

      // Keep container running for exec commands
      Cmd: ["sleep", "infinity"],

      WorkingDir: "/workspace",

      Env: env,

      // Exposed ports (required for port bindings)
      ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,

      // Container labels
      Labels: Object.keys(config.labels).length > 0 ? config.labels : undefined,

      HostConfig: finalHostConfig,

      // Non-root user
      User: config.user,
    };

    return this.docker.createContainer(createOptions);
  }

  /**
   * Execute a command inside a container
   *
   * @param container - Docker container
   * @param command - Command and arguments
   * @param workDir - Working directory inside container
   * @returns Exec instance for stream access
   */
  async execInContainer(
    container: Container,
    command: string[],
    workDir: string = "/workspace"
  ): Promise<Exec> {
    return container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: false,
      Tty: false,
      WorkingDir: workDir,
    });
  }

  /**
   * Clean up old containers for an agent
   *
   * Removes oldest containers when count exceeds maxContainers.
   *
   * @param agentName - Name of the agent
   * @param maxContainers - Maximum containers to keep
   */
  async cleanupOldContainers(
    agentName: string,
    maxContainers: number
  ): Promise<void> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        name: [`herdctl-${agentName}-`],
      },
    });

    // Sort by creation time, oldest first
    const sorted = containers.sort((a, b) => a.Created - b.Created);

    // Remove oldest until under limit
    const toRemove = sorted.slice(0, Math.max(0, sorted.length - maxContainers));

    for (const info of toRemove) {
      const container = this.docker.getContainer(info.Id);
      try {
        await container.remove({ force: true });
      } catch {
        // Ignore errors for already-removed containers
      }
    }
  }

  /**
   * Stop and remove a specific container
   */
  async stopContainer(container: Container): Promise<void> {
    try {
      await container.stop({ t: 5 }); // 5 second timeout
    } catch {
      // Container may already be stopped
    }

    try {
      const info = await container.inspect();
      if (!info.HostConfig?.AutoRemove) {
        await container.remove({ force: true });
      }
    } catch {
      // Container may already be removed
    }
  }
}

/**
 * Build volume mounts for container execution
 *
 * Creates mounts for working directory, auth files, and Docker sessions.
 *
 * @param agent - Resolved agent configuration
 * @param dockerConfig - Docker configuration
 * @param stateDir - herdctl state directory (.herdctl/)
 * @returns Array of path mappings
 */
export function buildContainerMounts(
  agent: ResolvedAgent,
  dockerConfig: DockerConfig,
  stateDir: string
): PathMapping[] {
  const mounts: PathMapping[] = [];

  // Working directory mount
  const working_directory = agent.working_directory;
  if (working_directory) {
    const working_directoryRoot =
      typeof working_directory === "string"
        ? working_directory
        : working_directory.root;
    mounts.push({
      hostPath: working_directoryRoot,
      containerPath: "/workspace",
      mode: dockerConfig.workspaceMode,
    });
  }

  // Docker sessions directory (separate from host sessions)
  // Claude CLI writes sessions to ~/.claude/projects/<encoded-workspace>/
  // Inside container, working dir is /workspace → encoded as "-workspace"
  // Mount docker-sessions to this location so we can watch files from host
  // Note: Authentication uses ANTHROPIC_API_KEY env var, so no auth mount needed
  const dockerSessionsDir = path.join(stateDir, "docker-sessions");
  mounts.push({
    hostPath: dockerSessionsDir,
    containerPath: "/home/claude/.claude/projects/-workspace",
    mode: "rw",
  });

  // Custom volumes from config
  mounts.push(...dockerConfig.volumes);

  return mounts;
}

/**
 * Build environment variables for container
 *
 * @param agent - Resolved agent configuration
 * @param config - Docker configuration (for custom env vars)
 * @returns Array of "KEY=value" strings
 */
export function buildContainerEnv(
  agent: ResolvedAgent,
  config?: DockerConfig
): string[] {
  const env: string[] = [];

  // Pass through API key if available (preferred over mounted auth)
  if (process.env.ANTHROPIC_API_KEY) {
    env.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
  }

  // Pass through OAuth token if available (for Claude Max web authentication)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    env.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);
  }

  // Add custom environment variables from docker config
  if (config?.env) {
    for (const [key, value] of Object.entries(config.env)) {
      env.push(`${key}=${value}`);
    }
  }

  // Terminal support
  env.push("TERM=xterm-256color");

  // HOME directory for claude user
  env.push("HOME=/home/claude");

  return env;
}
