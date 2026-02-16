/**
 * Runtime module barrel export
 *
 * Exports all public runtime types and classes for easy importing:
 * - RuntimeInterface and RuntimeExecuteOptions types
 * - SDKRuntime and CLIRuntime implementations
 * - RuntimeFactory for runtime instantiation
 * - RuntimeType for type identification
 * - CLI session path utilities
 */

export type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
export { SDKRuntime } from "./sdk-runtime.js";
export { CLIRuntime } from "./cli-runtime.js";
export { RuntimeFactory, type RuntimeType } from "./factory.js";
export {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
} from "./cli-session-path.js";
export {
  CLISessionWatcher,
  watchSessionFile,
} from "./cli-session-watcher.js";

// Docker configuration
export {
  type DockerConfig,
  type PathMapping,
  type NetworkMode,
  type VolumeMode,
  parseMemoryToBytes,
  parseVolumeMount,
  getHostUser,
  resolveDockerConfig,
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_MEMORY_LIMIT,
  DEFAULT_MAX_CONTAINERS,
} from "./docker-config.js";

// Container execution
export { ContainerRunner } from "./container-runner.js";
export {
  ContainerManager,
  buildContainerMounts,
  buildContainerEnv,
} from "./container-manager.js";

// MCP HTTP bridge for Docker
export { startMcpHttpBridge, type McpHttpBridge } from "./mcp-http-bridge.js";
