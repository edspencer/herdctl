/**
 * Type definitions for the agent runner module
 *
 * Defines options, results, and SDK-related types for agent execution
 */

import type { ResolvedAgent } from "../config/index.js";
import type { JobOutputInput, TriggerType } from "../state/index.js";

// =============================================================================
// Runner Options Types
// =============================================================================

/**
 * Options for running an agent
 */
export interface RunnerOptions {
  /** Fully resolved agent configuration */
  agent: ResolvedAgent;
  /** The prompt to send to the agent */
  prompt: string;
  /** Path to the .herdctl directory */
  stateDir: string;
  /** How this run was triggered */
  triggerType?: TriggerType;
  /** Schedule name (if triggered by schedule) */
  schedule?: string;
  /** Session ID to resume (mutually exclusive with fork) */
  resume?: string;
  /** Fork from this session ID */
  fork?: string;
  /** Parent job ID when forking (used with fork option) */
  forkedFrom?: string;
  /** When true, job output is also written to .herdctl/jobs/{jobId}/output.log (default: false) */
  outputToFile?: boolean;
  /** AbortController for canceling the execution */
  abortController?: AbortController;
  /** MCP servers to inject at runtime (SDK and Docker runtimes) */
  injectedMcpServers?: Record<string, InjectedMcpServerDef>;
}

/**
 * SDK message types (as received from Claude Agent SDK)
 *
 * The SDK sends various message types:
 * - system: System messages (init, status, compact_boundary, etc.)
 * - assistant: Complete assistant messages with nested API message
 * - stream_event: Partial streaming content with RawMessageStreamEvent
 * - result: Final query result with summary and usage stats
 * - user: User messages with nested API message, may contain tool_use_result
 * - tool_progress: Progress updates for long-running tools
 * - auth_status: Authentication status updates
 * - error: Error messages
 *
 * Legacy types (for backwards compatibility with tests):
 * - tool_use: Tool invocation (now part of assistant content blocks)
 * - tool_result: Tool result (now part of user messages)
 */
export interface SDKMessage {
  type:
    | "system"
    | "assistant"
    | "stream_event"
    | "result"
    | "user"
    | "tool_progress"
    | "auth_status"
    | "error"
    // Legacy types for backwards compatibility
    | "tool_use"
    | "tool_result";
  subtype?: string;
  content?: string;
  session_id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  tool_name?: string;
  tool_use_result?: unknown;
  message?: unknown; // Can be string (for errors) or nested API message
  event?: unknown; // For stream_event messages
  result?: unknown; // For result messages
  success?: boolean; // For tool_result messages
  code?: string;
  // Allow additional SDK-specific fields
  [key: string]: unknown;
}

/**
 * Callback for receiving messages during execution
 */
export type MessageCallback = (message: SDKMessage) => void | Promise<void>;

/**
 * Callback for when a job is created (before execution starts)
 */
export type JobCreatedCallback = (jobId: string) => void;

/**
 * Extended options including callbacks
 */
export interface RunnerOptionsWithCallbacks extends RunnerOptions {
  /** Called for each message from the SDK */
  onMessage?: MessageCallback;
  /** Called when the job is created, before execution starts */
  onJobCreated?: JobCreatedCallback;
}

// =============================================================================
// Runner Result Types
// =============================================================================

/**
 * Detailed error information for failed runs
 */
export interface RunnerErrorDetails {
  /** The error message */
  message: string;
  /** Error code if available (e.g., ETIMEDOUT, ECONNREFUSED) */
  code?: string;
  /** The type of error (for categorization) */
  type?: "initialization" | "streaming" | "malformed_response" | "unknown";
  /** Whether this error is potentially recoverable (e.g., rate limit, network) */
  recoverable?: boolean;
  /** Number of messages received before error (for streaming errors) */
  messagesReceived?: number;
  /** Stack trace if available */
  stack?: string;
}

/**
 * Result of running an agent
 */
export interface RunnerResult {
  /** Whether the run completed successfully */
  success: boolean;
  /** The job ID for this run */
  jobId: string;
  /** The session ID (for resume/fork) */
  sessionId?: string;
  /** Brief summary of what was accomplished */
  summary?: string;
  /** Error if the run failed */
  error?: Error;
  /** Detailed error information for programmatic access */
  errorDetails?: RunnerErrorDetails;
  /** Duration in seconds */
  durationSeconds?: number;
}

// =============================================================================
// Injected MCP Server Types
// =============================================================================

/**
 * Tool call result from an MCP tool handler
 */
export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * A single tool definition for an injected MCP server.
 *
 * Contains the tool metadata, JSON schema for HTTP transport, and
 * the handler function for executing the tool.
 */
export interface InjectedMcpToolDef {
  /** Tool name as it appears to the agent */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Handler function that executes the tool */
  handler: (args: Record<string, unknown>) => Promise<McpToolCallResult>;
}

/**
 * Definition for an MCP server to inject at runtime.
 *
 * Contains tool definitions with handlers that each runtime converts to
 * the appropriate transport:
 * - SDKRuntime: in-process MCP server via createSdkMcpServer()
 * - ContainerRunner: HTTP MCP bridge accessible over Docker network
 */
export interface InjectedMcpServerDef {
  /** Server name (e.g., "herdctl-file-sender") */
  name: string;
  /** Server version */
  version?: string;
  /** Tool definitions provided by this server */
  tools: InjectedMcpToolDef[];
}

// =============================================================================
// SDK Option Types
// =============================================================================

/**
 * MCP server configuration for SDK
 */
export interface SDKMcpServerConfig {
  type?: "http";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * System prompt configuration for SDK
 *
 * The SDK accepts either:
 * - A plain string for custom prompts
 * - An object with type: 'preset' for using Claude Code's default prompt
 */
export type SDKSystemPrompt = string | { type: "preset"; preset: "claude_code"; append?: string };

/**
 * SDK query options (matching Claude Agent SDK types)
 */
export interface SDKQueryOptions {
  allowedTools?: string[];
  deniedTools?: string[];
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "delegate"
    | "dontAsk";
  systemPrompt?: SDKSystemPrompt;
  settingSources?: string[];
  mcpServers?: Record<string, SDKMcpServerConfig>;
  resume?: string;
  forkSession?: boolean;
  /** Maximum number of agentic turns before stopping */
  maxTurns?: number;
  /** Current working directory for the session */
  cwd?: string;
  /** Model to use for the session */
  model?: string;
}

// =============================================================================
// Message Processing Types
// =============================================================================

/**
 * Result of processing an SDK message
 */
export interface ProcessedMessage {
  /** The message transformed for job output */
  output: JobOutputInput;
  /** Session ID if this was an init message */
  sessionId?: string;
  /** Whether this is the final message */
  isFinal?: boolean;
}
