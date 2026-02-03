/**
 * Docker configuration types and utilities
 *
 * This module provides TypeScript types for Docker container configuration
 * and utility functions for path mapping and container management.
 */

import type { Docker, DockerInput } from "../../config/schema.js";

/**
 * Network isolation modes for Docker containers
 */
export type NetworkMode = "none" | "bridge" | "host";

/**
 * Volume mount mode
 */
export type VolumeMode = "ro" | "rw";

/**
 * Path mapping between host and container
 */
export interface PathMapping {
  /** Absolute path on the host system */
  hostPath: string;
  /** Path inside the container */
  containerPath: string;
  /** Mount mode: read-only or read-write */
  mode: VolumeMode;
}

/**
 * Port binding configuration
 */
export interface PortBinding {
  /** Port on the host */
  hostPort: number;
  /** Port in the container */
  containerPort: number;
}

/**
 * Tmpfs mount configuration
 */
export interface TmpfsMount {
  /** Path inside the container */
  path: string;
  /** Mount options (e.g., "size=100m,mode=1777") */
  options?: string;
}

/**
 * Resolved Docker configuration with defaults applied
 */
export interface DockerConfig {
  /** Whether Docker is enabled */
  enabled: boolean;
  /** Use ephemeral containers (fresh per job) vs persistent (reuse across jobs) */
  ephemeral: boolean;
  /** Docker image to use */
  image: string;
  /** Network isolation mode */
  network: NetworkMode;
  /** Memory limit in bytes */
  memoryBytes: number;
  /** CPU shares (relative weight) */
  cpuShares?: number;
  /** CPU period in microseconds (for hard CPU limits) */
  cpuPeriod?: number;
  /** CPU quota in microseconds per period (for hard CPU limits) */
  cpuQuota?: number;
  /** Container user as "UID:GID" string */
  user: string;
  /** Maximum containers to keep per agent */
  maxContainers: number;
  /** Additional volume mounts */
  volumes: PathMapping[];
  /** Workspace mount mode */
  workspaceMode: VolumeMode;
  /** Environment variables to pass to the container */
  env: Record<string, string>;
  /** Port bindings */
  ports: PortBinding[];
  /** Tmpfs mounts */
  tmpfs: TmpfsMount[];
  /** Maximum number of processes (PIDs) */
  pidsLimit?: number;
  /** Container labels */
  labels: Record<string, string>;
}

/**
 * Default Docker image for Claude Code containers
 *
 * Users must build this image locally using the Dockerfile in the repository root:
 *   docker build -t herdctl/runtime:latest .
 */
export const DEFAULT_DOCKER_IMAGE = "herdctl/runtime:latest";

/**
 * Default memory limit (2GB)
 */
export const DEFAULT_MEMORY_LIMIT = "2g";

/**
 * Default max containers to keep per agent
 */
export const DEFAULT_MAX_CONTAINERS = 5;

/**
 * Parse memory string (e.g., "2g", "512m") to bytes
 *
 * @param memory - Memory string with unit suffix
 * @returns Memory in bytes
 * @throws Error if format is invalid
 */
export function parseMemoryToBytes(memory: string): number {
  const match = memory.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i);
  if (!match) {
    throw new Error(
      `Invalid memory format: "${memory}". Use format like "2g", "512m", "1024k", or "2048" (bytes).`
    );
  }

  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase() ?? "";

  const multipliers: Record<string, number> = {
    "": 1,
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
    t: 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * multipliers[unit]);
}

/**
 * Parse port binding string to PortBinding
 *
 * @param port - Port string in format "hostPort:containerPort" or "containerPort"
 * @returns PortBinding object
 * @throws Error if format is invalid
 */
export function parsePortBinding(port: string): PortBinding {
  const parts = port.split(":");

  if (parts.length === 1) {
    // Just container port - use same port on host
    const containerPort = parseInt(parts[0], 10);
    return { hostPort: containerPort, containerPort };
  }

  if (parts.length === 2) {
    const hostPort = parseInt(parts[0], 10);
    const containerPort = parseInt(parts[1], 10);
    return { hostPort, containerPort };
  }

  throw new Error(
    `Invalid port format: "${port}". Use "hostPort:containerPort" or "containerPort".`
  );
}

/**
 * Parse tmpfs mount string to TmpfsMount
 *
 * @param tmpfs - Tmpfs string in format "/path" or "/path:options"
 * @returns TmpfsMount object
 * @throws Error if format is invalid
 */
export function parseTmpfsMount(tmpfs: string): TmpfsMount {
  const colonIndex = tmpfs.indexOf(":");

  if (colonIndex === -1) {
    // Just path, no options
    return { path: tmpfs };
  }

  const path = tmpfs.slice(0, colonIndex);
  const options = tmpfs.slice(colonIndex + 1);

  return { path, options };
}

/**
 * Parse volume mount string to PathMapping
 *
 * @param volume - Volume mount string in format "host:container" or "host:container:mode"
 * @returns PathMapping object
 * @throws Error if format is invalid
 */
export function parseVolumeMount(volume: string): PathMapping {
  const parts = volume.split(":");

  if (parts.length < 2 || parts.length > 3) {
    throw new Error(
      `Invalid volume format: "${volume}". Use "host:container" or "host:container:ro|rw".`
    );
  }

  const [hostPath, containerPath, modeStr] = parts;
  const mode: VolumeMode =
    modeStr === "ro" ? "ro" : modeStr === "rw" || !modeStr ? "rw" : "rw";

  if (modeStr && modeStr !== "ro" && modeStr !== "rw") {
    throw new Error(
      `Invalid volume mode: "${modeStr}". Use "ro" (read-only) or "rw" (read-write).`
    );
  }

  return { hostPath, containerPath, mode };
}

/**
 * Get the current user's UID:GID for container user mapping
 *
 * @returns User string in "UID:GID" format
 */
export function getHostUser(): string {
  // process.getuid() and process.getgid() are available on POSIX systems
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  return `${uid}:${gid}`;
}

/**
 * Resolve Docker config from agent configuration
 *
 * Applies defaults and parses string values to typed equivalents.
 *
 * @param docker - Docker configuration from agent config (may be partial)
 * @returns Fully resolved DockerConfig
 */
export function resolveDockerConfig(docker?: DockerInput): DockerConfig {
  return {
    enabled: docker?.enabled ?? false,
    ephemeral: docker?.ephemeral ?? true,
    image: docker?.image ?? docker?.base_image ?? DEFAULT_DOCKER_IMAGE,
    network: docker?.network ?? "bridge",
    memoryBytes: parseMemoryToBytes(docker?.memory ?? DEFAULT_MEMORY_LIMIT),
    cpuShares: docker?.cpu_shares,
    cpuPeriod: docker?.cpu_period,
    cpuQuota: docker?.cpu_quota,
    user: docker?.user ?? getHostUser(),
    maxContainers: docker?.max_containers ?? DEFAULT_MAX_CONTAINERS,
    volumes: docker?.volumes?.map(parseVolumeMount) ?? [],
    workspaceMode: docker?.workspace_mode ?? "rw",
    env: docker?.env ?? {},
    ports: docker?.ports?.map(parsePortBinding) ?? [],
    tmpfs: docker?.tmpfs?.map(parseTmpfsMount) ?? [],
    pidsLimit: docker?.pids_limit,
    labels: docker?.labels ?? {},
  };
}
