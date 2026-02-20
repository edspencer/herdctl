/**
 * Docker container lifecycle management
 *
 * Handles container creation, security configuration, and cleanup.
 * Uses dockerode for Docker API communication.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Container, ContainerCreateOptions, Exec, HostConfig } from "dockerode";
import Dockerode from "dockerode";
import type { ResolvedAgent } from "../../config/index.js";
import { createLogger } from "../../utils/logger.js";
import type { DockerConfig, PathMapping } from "./docker-config.js";

const logger = createLogger("ContainerManager");

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
    env: string[],
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
    env: string[],
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
      Binds: mounts.map((m) => `${m.hostPath}:${m.containerPath}:${m.mode}`),

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
    workDir: string = "/workspace",
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
  async cleanupOldContainers(agentName: string, maxContainers: number): Promise<void> {
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
  stateDir: string,
): PathMapping[] {
  const mounts: PathMapping[] = [];

  // Working directory mount
  const working_directory = agent.working_directory;
  if (working_directory) {
    const working_directoryRoot =
      typeof working_directory === "string" ? working_directory : working_directory.root;
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

const CLAUDE_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// Refresh 5 minutes before expiry to avoid race conditions
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Read Claude OAuth credentials from the mounted credentials file.
 * Returns the parsed claudeAiOauth object or null if unavailable.
 */
function readCredentialsFile(): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  [key: string]: unknown;
} | null {
  const credsPath = path.join(os.homedir(), ".claude", ".credentials.json");
  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
    return creds.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

/**
 * Write updated OAuth tokens back to the credentials file.
 */
function writeCredentialsFile(oauth: Record<string, unknown>): void {
  const credsPath = path.join(os.homedir(), ".claude", ".credentials.json");
  try {
    let creds: Record<string, unknown> = {};
    try {
      creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    creds.claudeAiOauth = oauth;
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
  } catch (err) {
    logger.error(`Failed to write credentials file: ${err}`);
  }
}

/**
 * Refresh the Claude OAuth access token using the refresh token.
 * Updates the credentials file with the new tokens.
 * Returns the updated oauth object, or null on failure.
 */
async function refreshClaudeOAuthToken(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number } | null> {
  try {
    logger.info("Refreshing Claude OAuth token...");
    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      logger.error(`Token refresh failed: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const oauth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    writeCredentialsFile(oauth);
    logger.info(`Token refreshed, expires in ${Math.round(data.expires_in / 3600)}h`);
    return oauth;
  } catch (err) {
    logger.error(`Token refresh error: ${err}`);
    return null;
  }
}

/**
 * Build environment variables for container
 *
 * Reads OAuth tokens from the mounted credentials file and refreshes
 * them if expired. This ensures agents always get valid tokens without
 * requiring manual herdctl restarts.
 *
 * @param agent - Resolved agent configuration
 * @param config - Docker configuration (for custom env vars)
 * @returns Array of "KEY=value" strings
 */
export async function buildContainerEnv(
  _agent: ResolvedAgent,
  config?: DockerConfig,
): Promise<string[]> {
  const env: string[] = [];

  // Pass through API key if available (preferred over mounted auth)
  if (process.env.ANTHROPIC_API_KEY) {
    env.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
  }

  // Read fresh OAuth tokens from mounted credentials file on each spawn.
  let oauth = readCredentialsFile();

  // Refresh if token is expired or about to expire
  if (oauth?.refreshToken && oauth?.expiresAt) {
    const now = Date.now();
    if (now >= oauth.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      const refreshed = await refreshClaudeOAuthToken(oauth.refreshToken);
      if (refreshed) {
        oauth = refreshed;
      }
    }
  }

  if (oauth) {
    if (oauth.accessToken) {
      env.push(`CLAUDE_CODE_OAUTH_TOKEN=${oauth.accessToken}`);
    }
    if (oauth.refreshToken) {
      env.push(`CLAUDE_REFRESH_TOKEN=${oauth.refreshToken}`);
    }
    if (oauth.expiresAt) {
      env.push(`CLAUDE_EXPIRES_AT=${oauth.expiresAt}`);
    }
  } else {
    // Fall back to env vars if credentials file not available
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env.push(`CLAUDE_CODE_OAUTH_TOKEN=${process.env.CLAUDE_CODE_OAUTH_TOKEN}`);
    }
    if (process.env.CLAUDE_REFRESH_TOKEN) {
      env.push(`CLAUDE_REFRESH_TOKEN=${process.env.CLAUDE_REFRESH_TOKEN}`);
    }
    if (process.env.CLAUDE_EXPIRES_AT) {
      env.push(`CLAUDE_EXPIRES_AT=${process.env.CLAUDE_EXPIRES_AT}`);
    }
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
