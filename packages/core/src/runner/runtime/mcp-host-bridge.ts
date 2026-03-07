/**
 * MCP Host Bridge
 *
 * Spawns an MCP server process on the host and wraps it as an InjectedMcpServerDef.
 * Used by ContainerRunner to run `host: true` MCP servers outside Docker while
 * making their tools available to the containerized agent via HTTP bridge.
 *
 * Uses the MCP SDK Client with StdioClientTransport to communicate with the
 * spawned process. Discovers tools via tools/list and creates handler functions
 * that delegate to tools/call.
 *
 * @module mcp-host-bridge
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServer } from "../../config/index.js";
import { createLogger } from "../../utils/logger.js";
import type { InjectedMcpServerDef, InjectedMcpToolDef, McpToolCallResult } from "../types.js";

const logger = createLogger("McpHostBridge");

// =============================================================================
// Types
// =============================================================================

export interface McpHostBridgeHandle {
  /** The InjectedMcpServerDef with tool handlers that delegate to the host process */
  serverDef: InjectedMcpServerDef;
  /** Close the MCP client and kill the subprocess */
  close: () => Promise<void>;
}

// =============================================================================
// Host Bridge
// =============================================================================

/**
 * Spawn a host-side MCP server process and wrap it as an InjectedMcpServerDef.
 *
 * The spawned process communicates via stdio using the MCP protocol.
 * Tools are discovered via tools/list and each tool's handler delegates
 * to tools/call on the subprocess.
 *
 * @param name - Server name (used for logging and as the InjectedMcpServerDef name)
 * @param config - MCP server config with command, args, env
 * @returns Handle with the server definition and a close function
 */
export async function createMcpHostBridge(
  name: string,
  config: McpServer,
): Promise<McpHostBridgeHandle> {
  if (!config.command) {
    throw new Error(`MCP server '${name}' has host: true but no command specified`);
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
  });

  const client = new Client(
    { name: `herdctl-host-${name}`, version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // Discover tools from the MCP server
  const toolsResult = await client.listTools();
  const tools: InjectedMcpToolDef[] = (toolsResult.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
    handler: async (args: Record<string, unknown>): Promise<McpToolCallResult> => {
      const result = await client.callTool({ name: tool.name, arguments: args });
      const content = Array.isArray(result.content)
        ? (result.content as Array<{ type: string; text: string }>)
        : [{ type: "text", text: JSON.stringify(result) }];
      return {
        content,
        isError: result.isError === true,
      };
    },
  }));

  logger.info(`Host MCP bridge '${name}' connected with ${tools.length} tool(s)`);

  return {
    serverDef: {
      name,
      version: "1.0.0",
      tools,
    },
    close: async () => {
      try {
        await client.close();
      } catch (err) {
        logger.error(`Failed to close MCP host bridge '${name}': ${err}`);
      }
    },
  };
}

// =============================================================================
// Partition Utility
// =============================================================================

/**
 * Partition MCP servers into host-side and container-side groups.
 *
 * Servers with `host: true` are separated out so they can be spawned on
 * the host and bridged into the container. Only meaningful when Docker
 * is enabled — when Docker is off, all servers run in-process regardless.
 *
 * @param mcpServers - All configured MCP servers for the agent
 * @returns Tuple of [hostServers, containerServers]
 */
export function partitionMcpServers(
  mcpServers: Record<string, McpServer> | undefined,
): [Record<string, McpServer>, Record<string, McpServer>] {
  const hostServers: Record<string, McpServer> = {};
  const containerServers: Record<string, McpServer> = {};

  if (!mcpServers) return [hostServers, containerServers];

  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.host) {
      hostServers[name] = server;
    } else {
      containerServers[name] = server;
    }
  }

  return [hostServers, containerServers];
}
