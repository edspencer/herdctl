/**
 * SDK Adapter for transforming agent configuration to SDK options
 *
 * Transforms ResolvedAgent configuration to the format expected by
 * the Claude Agent SDK's query function.
 */

import type { McpServer, ResolvedAgent } from "../config/index.js";
import type { SDKMcpServerConfig, SDKQueryOptions, SDKSystemPrompt } from "./types.js";

// =============================================================================
// Constants
// =============================================================================

/**
 * Default permission mode when not specified in agent config
 */
const DEFAULT_PERMISSION_MODE = "acceptEdits" as const;

/**
 * Default setting sources for SDK initialization
 * Empty by default - autonomous agents should NOT load project/local settings
 * (like CLAUDE.md) which are meant for interactive Claude Code usage
 */
const DEFAULT_SETTING_SOURCES: string[] = [];

/**
 * Default preset when no system prompt is specified
 */
const _DEFAULT_PRESET = "claude_code";

// =============================================================================
// MCP Server Transformation
// =============================================================================

/**
 * Transform a single MCP server configuration to SDK format
 *
 * @param server - MCP server configuration from agent config
 * @returns SDK-formatted MCP server configuration
 */
export function transformMcpServer(server: McpServer): SDKMcpServerConfig {
  const result: SDKMcpServerConfig = {};

  // HTTP-based MCP server
  if (server.url) {
    result.type = "http";
    result.url = server.url;
  }

  // Process-based MCP server
  if (server.command) {
    result.command = server.command;
  }

  if (server.args && server.args.length > 0) {
    result.args = server.args;
  }

  if (server.env && Object.keys(server.env).length > 0) {
    result.env = server.env;
  }

  return result;
}

/**
 * Transform MCP servers configuration to SDK format
 *
 * @param mcpServers - MCP servers configuration from agent config
 * @returns SDK-formatted MCP servers map (empty object if no servers configured)
 */
export function transformMcpServers(
  mcpServers: Record<string, McpServer> | undefined,
): Record<string, SDKMcpServerConfig> {
  const result: Record<string, SDKMcpServerConfig> = {};

  if (!mcpServers) {
    return result;
  }

  for (const [name, server] of Object.entries(mcpServers)) {
    result[name] = transformMcpServer(server);
  }

  return result;
}

// =============================================================================
// System Prompt Transformation
// =============================================================================

/**
 * Build the system prompt configuration for SDK
 *
 * The SDK accepts either:
 * - A plain string for custom prompts
 * - An object with type: 'preset' for using Claude Code's default prompt
 *
 * @param agent - Resolved agent configuration
 * @returns System prompt configuration for SDK
 */
export function buildSystemPrompt(agent: ResolvedAgent): SDKSystemPrompt {
  // If agent has a custom system prompt, return it as a plain string
  if (agent.system_prompt) {
    return agent.system_prompt;
  }

  // Default to claude_code preset
  return {
    type: "preset",
    preset: "claude_code",
  };
}

// =============================================================================
// Main Transformation Function
// =============================================================================

/**
 * Options for SDK transformation
 */
export interface ToSDKOptionsParams {
  /** Session ID to resume */
  resume?: string;
  /** Whether to fork the session */
  fork?: boolean;
}

/**
 * Transform agent configuration to SDK query options
 *
 * This function converts a ResolvedAgent configuration to the format
 * expected by the Claude Agent SDK's query function.
 *
 * @param agent - Fully resolved agent configuration
 * @param options - Additional options for resume/fork
 * @returns SDK query options ready for use with the SDK
 *
 * @example
 * ```typescript
 * const agent = await loadConfig().then(c => c.agents[0]);
 * const sdkOptions = toSDKOptions(agent);
 *
 * for await (const message of query({ prompt, options: sdkOptions })) {
 *   console.log(message);
 * }
 * ```
 */
export function toSDKOptions(
  agent: ResolvedAgent,
  options: ToSDKOptionsParams = {},
): SDKQueryOptions {
  const result: SDKQueryOptions = {};

  // Permission mode (defaults to acceptEdits)
  result.permissionMode = agent.permission_mode ?? DEFAULT_PERMISSION_MODE;

  // Allowed and denied tools (direct passthrough to SDK)
  if (agent.allowed_tools?.length) {
    result.allowedTools = agent.allowed_tools;
  }

  if (agent.denied_tools?.length) {
    result.deniedTools = agent.denied_tools;
  }

  // System prompt
  result.systemPrompt = buildSystemPrompt(agent);

  // Setting sources for proper settings discovery
  // Can be explicitly configured via setting_sources, or defaults based on working_directory:
  // - With working_directory: ["project"] - inherit CLAUDE.md, skills, commands from working directory
  // - Without working_directory: [] - don't load settings from wherever herdctl is running
  const working_directory = agent.working_directory;
  if (agent.setting_sources !== undefined) {
    // Explicit configuration takes precedence
    result.settingSources = [...agent.setting_sources];
  } else if (working_directory) {
    // Default for project-embedded agents
    result.settingSources = ["project"];
  } else {
    // Default for standalone agents
    result.settingSources = [...DEFAULT_SETTING_SOURCES];
  }

  // MCP servers (always include, even if empty)
  result.mcpServers = transformMcpServers(agent.mcp_servers);

  // Max turns limit (agent-level or session-level)
  const maxTurns = agent.max_turns ?? agent.session?.max_turns;
  if (maxTurns !== undefined) {
    result.maxTurns = maxTurns;
  }

  // Session resume/fork
  if (options.resume) {
    result.resume = options.resume;
  }

  if (options.fork) {
    result.forkSession = true;
  }

  // Working directory (from working_directory config)
  // Note: working_directory variable already declared above for settingSources
  if (working_directory) {
    // working_directory can be a string path or an object with root property
    result.cwd = typeof working_directory === "string" ? working_directory : working_directory.root;
  }

  // Model selection
  if (agent.model) {
    result.model = agent.model;
  }

  return result;
}
