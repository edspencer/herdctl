import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "../../../config/index.js";

// Mock the MCP SDK before importing the module under test
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockListTools = vi.fn().mockResolvedValue({
  tools: [
    {
      name: "search_notes",
      description: "Search Bear notes",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "create_note",
      description: "Create a Bear note",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, text: { type: "string" } },
      },
    },
  ],
});
const mockCallTool = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Note found: Hello World" }],
  isError: false,
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class MockClient {
      connect = mockConnect;
      close = mockClose;
      listTools = mockListTools;
      callTool = mockCallTool;
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: class MockTransport {},
  };
});

import { createMcpHostBridge, partitionMcpServers } from "../mcp-host-bridge.js";

describe("partitionMcpServers", () => {
  it("separates host and container servers", () => {
    const servers: Record<string, McpServer> = {
      bear: { command: "node", args: ["bear.js"], host: true },
      gmail: { command: "npx", args: ["gmail-mcp"] },
      contacts: { command: "python3", args: ["-m", "contacts"], host: true },
    };

    const [host, container] = partitionMcpServers(servers);

    expect(Object.keys(host)).toEqual(["bear", "contacts"]);
    expect(Object.keys(container)).toEqual(["gmail"]);
    expect(host.bear.host).toBe(true);
    expect(container.gmail.host).toBeUndefined();
  });

  it("returns empty records for undefined input", () => {
    const [host, container] = partitionMcpServers(undefined);
    expect(Object.keys(host)).toHaveLength(0);
    expect(Object.keys(container)).toHaveLength(0);
  });

  it("puts all servers in container when none have host: true", () => {
    const servers: Record<string, McpServer> = {
      a: { command: "a" },
      b: { command: "b" },
    };
    const [host, container] = partitionMcpServers(servers);
    expect(Object.keys(host)).toHaveLength(0);
    expect(Object.keys(container)).toHaveLength(2);
  });

  it("puts all servers in host when all have host: true", () => {
    const servers: Record<string, McpServer> = {
      a: { command: "a", host: true },
      b: { command: "b", host: true },
    };
    const [host, container] = partitionMcpServers(servers);
    expect(Object.keys(host)).toHaveLength(2);
    expect(Object.keys(container)).toHaveLength(0);
  });
});

describe("createMcpHostBridge", () => {
  it("throws if no command is specified", async () => {
    await expect(createMcpHostBridge("test", { host: true })).rejects.toThrow(
      "no command specified",
    );
  });

  it("connects to the MCP server and discovers tools", async () => {
    const config: McpServer = {
      command: "node",
      args: ["/srv/mcp-servers/bear/index.js"],
      env: { BEAR_DB_PATH: "/data/bear.sqlite" },
      host: true,
    };

    const handle = await createMcpHostBridge("bear", config);

    expect(mockConnect).toHaveBeenCalled();
    expect(mockListTools).toHaveBeenCalled();
    expect(handle.serverDef.name).toBe("bear");
    expect(handle.serverDef.tools).toHaveLength(2);
    expect(handle.serverDef.tools[0].name).toBe("search_notes");
    expect(handle.serverDef.tools[1].name).toBe("create_note");
  });

  it("tool handler delegates to client.callTool", async () => {
    const handle = await createMcpHostBridge("bear", {
      command: "node",
      args: ["bear.js"],
      host: true,
    });

    const result = await handle.serverDef.tools[0].handler({ query: "hello" });

    expect(mockCallTool).toHaveBeenCalledWith({
      name: "search_notes",
      arguments: { query: "hello" },
    });
    expect(result.content[0].text).toBe("Note found: Hello World");
    expect(result.isError).toBe(false);
  });

  it("close() calls client.close()", async () => {
    const handle = await createMcpHostBridge("bear", {
      command: "node",
      args: ["bear.js"],
      host: true,
    });

    await handle.close();
    expect(mockClose).toHaveBeenCalled();
  });
});
