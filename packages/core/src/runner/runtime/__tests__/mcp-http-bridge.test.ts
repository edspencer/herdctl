import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
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
  bridge: McpHttpBridge,
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
  const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bridge.headers },
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

    const response = await jsonRpcPost(bridge, "initialize", {
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
      headers: { "Content-Type": "application/json", ...bridge.headers },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    expect(res.status).toBe(204);
  });

  it("handles tools/list", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge, "tools/list");

    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe("test_tool");
    expect(response.result.tools[0].description).toBe("A test tool");
    expect(response.result.tools[0].inputSchema.properties.message.type).toBe("string");
  });

  it("handles tools/call successfully", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge, "tools/call", {
      name: "test_tool",
      arguments: { message: "hello" },
    });

    expect(response.result.content[0].text).toContain("hello");
    expect(response.result.isError).toBeUndefined();
  });

  it("returns error for unknown tool", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge, "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(response.error).toBeDefined();
    expect(response.error.message).toContain("Unknown tool");
  });

  it("handles ping", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge, "ping");
    expect(response.result).toEqual({});
  });

  it("returns method not found for unknown methods", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const response = await jsonRpcPost(bridge, "nonexistent/method");
    expect(response.error.code).toBe(-32601);
  });

  it("returns 404 for non-MCP paths", async () => {
    const def = createTestDef();
    bridge = await startMcpHttpBridge(def);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/not-mcp`, {
      method: "POST",
      headers: bridge.headers,
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

    await jsonRpcPost(bridge, "tools/call", {
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

    const response = await jsonRpcPost(bridge, "tools/call", {
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
      headers: { "Content-Type": "application/json", ...bridge.headers },
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

// =============================================================================
// Authentication and binding
// =============================================================================

/** A non-loopback IPv4 address of this machine, if it has one. */
function externalIPv4(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

async function rawToolsCall(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; wwwAuthenticate: string | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test_tool", arguments: { message: "unauthorized" } },
    }),
  });
  await res.text();
  return { status: res.status, wwwAuthenticate: res.headers.get("www-authenticate") };
}

describe("MCP HTTP Bridge authentication and binding", () => {
  const bridges: McpHttpBridge[] = [];

  afterEach(async () => {
    for (const b of bridges.splice(0)) {
      await b.close();
    }
  });

  async function start(
    def: InjectedMcpServerDef,
    options?: Parameters<typeof startMcpHttpBridge>[1],
  ): Promise<McpHttpBridge> {
    const b = await startMcpHttpBridge(def, options);
    bridges.push(b);
    return b;
  }

  it("binds loopback by default", async () => {
    const bridge = await start(createTestDef());
    const addr = bridge.server.address() as AddressInfo;

    expect(addr.address).toBe("127.0.0.1");
    expect(bridge.host).toBe("127.0.0.1");
  });

  it.skipIf(!externalIPv4())(
    "is not reachable on a non-loopback interface by default",
    async () => {
      const bridge = await start(createTestDef());

      await expect(
        fetch(`http://${externalIPv4()}:${bridge.port}/mcp`, {
          method: "POST",
          headers: bridge.headers,
          body: "{}",
        }),
      ).rejects.toThrow();
    },
  );

  it("rejects a request with no Authorization header and never calls the tool", async () => {
    let called = false;
    const bridge = await start(
      createTestDef(async () => {
        called = true;
        return { content: [{ type: "text" as const, text: "ok" }] };
      }),
    );

    const res = await rawToolsCall(`http://127.0.0.1:${bridge.port}/mcp`, {});

    expect(res.status).toBe(401);
    expect(res.wwwAuthenticate).toBe("Bearer");
    expect(called).toBe(false);
  });

  it.each([
    ["a wrong token", (t: string) => `Bearer ${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`],
    ["a token of a different length", (t: string) => `Bearer ${t}x`],
    ["an empty bearer token", () => "Bearer "],
    ["the right token without the Bearer scheme", (t: string) => t],
    ["the right token under another scheme", (t: string) => `Basic ${t}`],
  ])("rejects %s", async (_label, makeHeader) => {
    const bridge = await start(createTestDef());

    const res = await rawToolsCall(`http://127.0.0.1:${bridge.port}/mcp`, {
      Authorization: makeHeader(bridge.token),
    });

    expect(res.status).toBe(401);
  });

  it("authenticates before routing, so unauthenticated callers can't probe paths or methods", async () => {
    const bridge = await start(createTestDef());

    const wrongPath = await fetch(`http://127.0.0.1:${bridge.port}/not-mcp`, { method: "POST" });
    const wrongMethod = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, { method: "GET" });

    expect(wrongPath.status).toBe(401);
    expect(wrongMethod.status).toBe(401);
  });

  it("rejects a browser-style simple request (text/plain, no credentials)", async () => {
    const bridge = await start(createTestDef());

    const res = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(401);
  });

  it("generates a distinct 256-bit token per bridge, and one bridge's token doesn't open another", async () => {
    const a = await start(createTestDef());
    const b = await start(createTestDef());

    expect(Buffer.from(a.token, "base64url")).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.headers).toEqual({ Authorization: `Bearer ${a.token}` });

    const crossed = await rawToolsCall(`http://127.0.0.1:${b.port}/mcp`, a.headers);
    expect(crossed.status).toBe(401);
  });

  it("uses a caller-supplied token", async () => {
    const bridge = await start(createTestDef(), { token: "fixed-test-token" });

    expect(bridge.token).toBe("fixed-test-token");
    const response = await jsonRpcPost(bridge, "tools/list");
    expect(response.result.tools).toHaveLength(1);
  });

  it("refuses an empty caller-supplied token", async () => {
    await expect(startMcpHttpBridge(createTestDef(), { token: "" })).rejects.toThrow(/empty/);
  });

  it.skipIf(!externalIPv4())(
    "still requires the token when bound to all interfaces (the Docker path)",
    async () => {
      const bridge = await start(createTestDef(), { host: "0.0.0.0" });
      const url = `http://${externalIPv4()}:${bridge.port}/mcp`;

      expect((await rawToolsCall(url, {})).status).toBe(401);
      expect((await rawToolsCall(url, bridge.headers)).status).toBe(200);
    },
  );
});
