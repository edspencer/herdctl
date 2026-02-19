import { afterEach, describe, expect, it } from "vitest";
import type { InjectedMcpServerDef } from "../../types.js";
import { type McpHttpBridge, startMcpHttpBridge } from "../mcp-http-bridge.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestDef(
  handler = async (args: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: `Received: ${JSON.stringify(args)}` }],
  }),
): InjectedMcpServerDef {
  return {
    name: "test-server",
    version: "1.0.0",
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "A message" },
            count: { type: "number", description: "A count" },
          },
          required: ["message"],
        },
        handler,
      },
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function jsonRpcPost(
  port: number,
  method: string,
  params?: Record<string, unknown>,
  id: number = 1,
): Promise<any> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (res.status === 204) return null; // notification
  return res.json();
}

// =============================================================================
// Tests
// =============================================================================

describe("MCP HTTP Bridge", () => {
  let bridge: McpHttpBridge | null = null;

  afterEach(async () => {
    if (bridge) {
      await bridge.close();
      bridge = null;
    }
  });

  it("starts and listens on a random port", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    expect(bridge.port).toBeGreaterThan(0);
    expect(bridge.server.listening).toBe(true);
  });

  it("handles initialize request", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    });

    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("test-server");
    expect(response.result.capabilities.tools).toBeDefined();
  });

  it("handles notifications/initialized with 204", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    expect(res.status).toBe(204);
  });

  it("handles tools/list", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "tools/list");

    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe("test_tool");
    expect(response.result.tools[0].description).toBe("A test tool");
    expect(response.result.tools[0].inputSchema.properties.message.type).toBe("string");
  });

  it("handles tools/call successfully", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "tools/call", {
      name: "test_tool",
      arguments: { message: "hello" },
    });

    expect(response.result.content[0].text).toContain("hello");
    expect(response.result.isError).toBeUndefined();
  });

  it("returns error for unknown tool", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("Unknown tool");
  });

  it("handles ping", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "ping");
    expect(response.result).toEqual({});
  });

  it("returns method not found for unknown methods", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "nonexistent/method");
    expect(response.error.code).toBe(-32601);
  });

  it("returns 404 for non-MCP paths", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/not-mcp`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("translates Docker /workspace/ paths in file_path", async () => {
    let receivedArgs: Record<string, unknown> = {};
    const def = createTestDef(async (args) => {
      receivedArgs = args;
      return { content: [{ type: "text", text: "ok" }] };
    });

    // Add a tool with file_path param
    def.tools[0].name = "send_file";

    bridge = await startMcpHttpBridge(def);

    await jsonRpcPost(bridge.port, "tools/call", {
      name: "send_file",
      arguments: { file_path: "/workspace/report.pdf", message: "test" },
    });

    expect(receivedArgs.file_path).toBe("report.pdf");
    expect(receivedArgs.message).toBe("test");
  });

  it("handles tool call errors gracefully", async () => {
    const def = createTestDef(async () => {
      throw new Error("Upload failed");
    });
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge.port, "tools/call", {
      name: "test_tool",
      arguments: { message: "test" },
    });

    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("Upload failed");
  });

  it("handles malformed JSON", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    expect(json.error.code).toBe(-32700);
  });

  it("closes cleanly", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);
    const port = bridge.port;

    await bridge.close();
    bridge = null;

    // Server should no longer accept connections
    try {
      await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
      // If we get here, the connection was unexpectedly accepted
      expect.unreachable("Server should be closed");
    } catch {
      // Expected - connection refused
    }
  });
});
