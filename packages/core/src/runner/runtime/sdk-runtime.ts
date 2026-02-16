/**
 * SDK Runtime implementation
 *
 * Wraps the Claude Agent SDK behind the RuntimeInterface, providing
 * a unified execution interface for the SDK backend.
 *
 * This adapter delegates to the SDK's query() function and converts
 * agent configuration to SDK options using the existing toSDKOptions adapter.
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toSDKOptions } from "../sdk-adapter.js";
import type { RuntimeInterface, RuntimeExecuteOptions } from "./interface.js";
import type { SDKMessage, InjectedMcpServerDef } from "../types.js";

/**
 * Convert a JSON Schema property to a Zod schema.
 *
 * Handles the property types used by injected MCP tools (string, number, boolean).
 * Falls back to z.unknown() for unrecognized types.
 */
function jsonPropertyToZod(prop: Record<string, unknown>, isRequired: boolean) {
  let schema: z.ZodTypeAny;
  const description = prop.description as string | undefined;

  switch (prop.type) {
    case "string":
      schema = description ? z.string().describe(description) : z.string();
      break;
    case "number":
    case "integer":
      schema = description ? z.number().describe(description) : z.number();
      break;
    case "boolean":
      schema = description ? z.boolean().describe(description) : z.boolean();
      break;
    default:
      schema = description ? z.unknown().describe(description) : z.unknown();
  }

  return isRequired ? schema : schema.optional();
}

/**
 * Convert an InjectedMcpServerDef to an in-process SDK MCP server.
 *
 * Uses the Claude Agent SDK's tool() + createSdkMcpServer() to build
 * a real MCP server from the transport-agnostic definition.
 */
function defToSdkMcpServer(def: InjectedMcpServerDef) {
  const sdkTools = def.tools.map((toolDef) => {
    const properties = (toolDef.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const requiredFields = (toolDef.inputSchema.required ?? []) as string[];

    // Build Zod shape from JSON Schema properties
    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
      zodShape[key] = jsonPropertyToZod(prop, requiredFields.includes(key));
    }

    return tool(
      toolDef.name,
      toolDef.description,
      zodShape,
      toolDef.handler,
    );
  });

  return createSdkMcpServer({
    name: def.name,
    version: def.version,
    tools: sdkTools,
  });
}

/**
 * SDK runtime implementation
 *
 * This runtime uses the Claude Agent SDK to execute agents. It wraps the SDK's
 * query() function and provides the standard RuntimeInterface.
 *
 * The SDKRuntime is the default runtime when no runtime type is specified in
 * agent configuration.
 *
 * @example
 * ```typescript
 * const runtime = new SDKRuntime();
 * const messages = runtime.execute({
 *   prompt: "Fix the bug in auth.ts",
 *   agent: resolvedAgent,
 * });
 *
 * for await (const message of messages) {
 *   console.log(message.type, message.content);
 * }
 * ```
 */
export class SDKRuntime implements RuntimeInterface {
  /**
   * Execute an agent using the Claude Agent SDK
   *
   * Converts agent configuration to SDK options and delegates to the SDK's
   * query() function. Yields each message from the SDK stream.
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    // Convert agent configuration to SDK options
    const sdkOptions = toSDKOptions(options.agent, {
      resume: options.resume,
      fork: options.fork,
    });

    // Convert injected MCP server defs to in-process SDK MCP servers
    if (options.injectedMcpServers && Object.keys(options.injectedMcpServers).length > 0) {
      const configServers = sdkOptions.mcpServers ?? {};
      const injectedServers: Record<string, unknown> = {};

      for (const [name, def] of Object.entries(options.injectedMcpServers)) {
        injectedServers[name] = defToSdkMcpServer(def);
      }

      // SDK accepts both plain configs and McpSdkServerConfigWithInstance objects.
      // The latter contains a live McpServer instance which doesn't match SDKMcpServerConfig.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkOptions.mcpServers = { ...configServers, ...injectedServers } as any;

      // File uploads via MCP tools can take longer than the default 60s timeout.
      // Set a safe default if not already configured by the user.
      if (options.injectedMcpServers["herdctl-file-sender"] && !process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT) {
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "120000";
      }
    }

    // Execute via SDK query()
    // Note: SDK does not currently support AbortController for cancellation
    // This is tracked for future enhancement when SDK adds support
    const messages = query({
      prompt: options.prompt,
      options: sdkOptions as Record<string, unknown>,
    });

    // Stream messages from SDK
    for await (const message of messages) {
      yield message as SDKMessage;
    }
  }
}
