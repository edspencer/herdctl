/**
 * Agent Runner module
 *
 * Provides functionality to execute agents using the Claude Agent SDK
 * with proper configuration, permissions, MCP server support, and output handling.
 */

// Export error types and utilities
export {
  buildErrorMessage,
  classifyError,
  type ErrorExitReason,
  MalformedResponseError,
  RunnerError,
  SDKInitializationError,
  SDKStreamingError,
  wrapError,
} from "./errors.js";
// Export file sender MCP
export {
  createFileSenderDef,
  type FileSenderContext,
  type FileUploadParams,
  type FileUploadResult,
} from "./file-sender-mcp.js";
// Export job executor
export {
  executeJob,
  JobExecutor,
  type JobExecutorLogger,
  type JobExecutorOptions,
  type SDKQueryFunction,
} from "./job-executor.js";

// Export message processor functions
export {
  extractSummary,
  isTerminalMessage,
  processSDKMessage,
} from "./message-processor.js";
// Export runtime types and factory
export type { RuntimeExecuteOptions, RuntimeInterface, RuntimeSession } from "./runtime/index.js";
export {
  encodePathForCli,
  getCliSessionDir,
  getCliSessionFile,
  getDockerSessionDir,
  getDockerSessionFile,
  MessageQueue,
  RuntimeFactory,
  type RuntimeType,
  readSessionCwd,
  SDKRuntime,
  sessionBelongsToWorkingDirectory,
} from "./runtime/index.js";
// Export SDK adapter functions
export {
  buildSystemPrompt,
  type ToSDKOptionsParams,
  toSDKOptions,
  transformMcpServer,
  transformMcpServers,
} from "./sdk-adapter.js";
// Export types
export type {
  InjectedMcpServerDef,
  InjectedMcpToolDef,
  McpToolCallResult,
  MessageCallback,
  ProcessedMessage,
  RunnerErrorDetails,
  RunnerOptions,
  RunnerOptionsWithCallbacks,
  RunnerResult,
  SDKMcpServerConfig,
  SDKMessage,
  SDKQueryOptions,
  SDKSystemPrompt,
} from "./types.js";
