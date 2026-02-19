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

export { CLIRuntime } from "./cli-runtime.js";
export {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
} from "./cli-session-path.js";
export {
  CLISessionWatcher,
  watchSessionFile,
} from "./cli-session-watcher.js";
export {
  buildContainerEnv,
  buildContainerMounts,
  ContainerManager,
} from "./container-manager.js";
// Container execution
export { ContainerRunner } from "./container-runner.js";
// Docker configuration
export {
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_MAX_CONTAINERS,
  DEFAULT_MEMORY_LIMIT,
  type DockerConfig,
  getHostUser,
  type NetworkMode,
  type PathMapping,
  parseMemoryToBytes,
  parseVolumeMount,
  resolveDockerConfig,
  type VolumeMode,
} from "./docker-config.js";
export { RuntimeFactory, type RuntimeType } from "./factory.js";
export type { RuntimeExecuteOptions, RuntimeInterface } from "./interface.js";
// MCP HTTP bridge for Docker
export { type McpHttpBridge, startMcpHttpBridge } from "./mcp-http-bridge.js";
export { SDKRuntime } from "./sdk-runtime.js";
