/**
 * MCP HTTP Bridge
 *
 * Minimal HTTP server implementing MCP Streamable HTTP transport (JSON-RPC 2.0 over POST).
 * Used by ContainerRunner to expose injected MCP servers to Docker containers.
 *
 * The agent container connects to `http://herdctl:<port>/mcp` and the bridge
 * translates tool calls to the in-process handler functions from InjectedMcpServerDef.
 *
 * Supports:
 * - initialize
 * - notifications/initialized
 * - tools/list
 * - tools/call
 * - ping
 *
 * @module mcp-http-bridge
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { InjectedMcpServerDef, InjectedMcpToolDef, McpToolCallResult } from "../types.js";

// =============================================================================
// Types
// =============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpHttpBridge {
  /** The HTTP server */
  server: Server;
  /** Port the server is listening on */
  port: number;
  /** Stop the bridge server */
  close: () => Promise<void>;
}

// =============================================================================
// Path Translation
// =============================================================================

/**
 * Translate Docker container paths to host-relative paths.
 *
 * Inside Docker, the agent sees `/workspace/report.pdf`.
 * The handler on the host expects paths relative to the working directory.
 * We strip the `/workspace/` prefix so the handler resolves correctly.
 */
function translateDockerPath(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.file_path === "string") {
    const filePath = args.file_path;
    // Strip /workspace/ prefix for Docker path translation
    if (filePath.startsWith("/workspace/")) {
      return { ...args, file_path: filePath.slice("/workspace/".length) };
    }
    // Also handle exact /workspace (unlikely but safe)
    if (filePath === "/workspace") {
      return { ...args, file_path: "." };
    }
  }
  return args;
}

// =============================================================================
// JSON-RPC Helpers
// =============================================================================

function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// =============================================================================
// Request Handlers
// =============================================================================

function handleInitialize(req: JsonRpcRequest, def: InjectedMcpServerDef): JsonRpcResponse {
  return jsonRpcResult(req.id ?? null, {
    protocolVersion: "2024-11-05",
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: def.name,
      version: def.version ?? "0.1.0",
    },
  });
}

function handleToolsList(req: JsonRpcRequest, def: InjectedMcpServerDef): JsonRpcResponse {
  const tools = def.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return jsonRpcResult(req.id ?? null, { tools });
}

async function handleToolsCall(
  req: JsonRpcRequest,
  def: InjectedMcpServerDef,
): Promise<JsonRpcResponse> {
  const params = req.params ?? {};
  const toolName = params.name as string;
  const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

  const toolDef = def.tools.find((t) => t.name === toolName);
  if (!toolDef) {
    return jsonRpcError(req.id ?? null, -32602, `Unknown tool: ${toolName}`);
  }

  // Translate Docker paths before calling handler
  const translatedArgs = translateDockerPath(toolArgs);

  const result: McpToolCallResult = await toolDef.handler(translatedArgs);
  return jsonRpcResult(req.id ?? null, result);
}

function handlePing(req: JsonRpcRequest): JsonRpcResponse {
  return jsonRpcResult(req.id ?? null, {});
}

// =============================================================================
// HTTP Server
// =============================================================================

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  def: InjectedMcpServerDef,
): Promise<void> {
  // Only accept POST to /mcp
  if (req.method !== "POST" || (req.url !== "/mcp" && req.url !== "/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body: string;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read body" }));
    return;
  }

  let rpcReq: JsonRpcRequest;
  try {
    rpcReq = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonRpcError(null, -32700, "Parse error")));
    return;
  }

  let response: JsonRpcResponse;

  switch (rpcReq.method) {
    case "initialize":
      response = handleInitialize(rpcReq, def);
      break;

    case "notifications/initialized":
      // Notification — no response needed per JSON-RPC spec
      res.writeHead(204);
      res.end();
      return;

    case "tools/list":
      response = handleToolsList(rpcReq, def);
      break;

    case "tools/call":
      try {
        response = await handleToolsCall(rpcReq, def);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response = jsonRpcError(rpcReq.id ?? null, -32000, `Tool call failed: ${message}`);
      }
      break;

    case "ping":
      response = handlePing(rpcReq);
      break;

    default:
      response = jsonRpcError(rpcReq.id ?? null, -32601, `Method not found: ${rpcReq.method}`);
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start an MCP HTTP bridge for an InjectedMcpServerDef.
 *
 * Binds to 0.0.0.0 on a random available port. The agent container
 * connects via `http://herdctl:<port>/mcp`.
 *
 * @param def - The injected MCP server definition to expose
 * @returns Promise resolving to the bridge with server, port, and close method
 */
export async function startMcpHttpBridge(def: InjectedMcpServerDef): Promise<McpHttpBridge> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res, def).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
      });
    });

    server.on("error", reject);

    // Bind to 0.0.0.0:0 for random available port
    server.listen(0, "0.0.0.0", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }

      resolve({
        server,
        port: addr.port,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          }),
      });
    });
  });
}
