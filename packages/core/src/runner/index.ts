/**
 * Agent Runner module
 *
 * Provides functionality to execute agents using the Claude Agent SDK
 * with proper configuration, permissions, MCP server support, and output handling.
 */

// Export types
export type {
  RunnerOptions,
  RunnerOptionsWithCallbacks,
  RunnerResult,
  RunnerErrorDetails,
  SDKMessage,
  MessageCallback,
  SDKQueryOptions,
  SDKMcpServerConfig,
  SDKSystemPrompt,
  ProcessedMessage,
} from "./types.js";

// Export error types and utilities
export {
  RunnerError,
  SDKInitializationError,
  SDKStreamingError,
  MalformedResponseError,
  buildErrorMessage,
  classifyError,
  wrapError,
  type ErrorExitReason,
} from "./errors.js";

// Export SDK adapter functions
export {
  toSDKOptions,
  transformMcpServers,
  transformMcpServer,
  buildSystemPrompt,
  type ToSDKOptionsParams,
} from "./sdk-adapter.js";

// Export message processor functions
export {
  processSDKMessage,
  isTerminalMessage,
  extractSummary,
} from "./message-processor.js";

// Export job executor
export {
  JobExecutor,
  executeJob,
  type JobExecutorLogger,
  type JobExecutorOptions,
  type SDKQueryFunction,
} from "./job-executor.js";

// Export runtime types and factory
export type { RuntimeInterface, RuntimeExecuteOptions } from "./runtime/index.js";
export { SDKRuntime, RuntimeFactory, type RuntimeType } from "./runtime/index.js";
