/**
 * Regression: edspencer/herdctl#444 + #445 — herdctl must not narrow the shape
 * the Agent SDK supports underneath it.
 *
 * #445: `McpServerSchema` was `{command, args, env, url}`, a plain `z.object`,
 * so `headers` and `type` were stripped at `addAgent` — and `transformMcpServer`
 * rewrote every `url` to `type: "http"`. That loses bearer auth, misconfigures
 * SSE, *and* changes the key Claude Code files a remote server's OAuth token
 * under (`${name}|sha256({type,url,headers})`), so a previously-authorised
 * server is no longer recognised as the same server.
 *
 * #444: there was no channel at all for an embedder to name Claude Code plugins.
 *
 * The stripping happened at the config boundary rather than inside the adapter,
 * so these drive the whole trip — `FleetManager.addAgent()` (which runs the real
 * `AgentConfigSchema.parse`) → `getAgents()` → `toSDKOptions()` → the options
 * object handed to the SDK's `query()` — instead of unit-testing the adapter in
 * isolation, which is where the earlier tests all passed while the field was
 * being dropped one layer up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the options every SDK query() receives, so the assertions can be made
// against the real call boundary rather than an intermediate value.
const queryCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((args: { options?: Record<string, unknown> }) => {
    queryCalls.push(args.options ?? {});
    return (async function* () {})();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedAgent } from "../../config/index.js";
import { FleetManager } from "../../fleet-manager/fleet-manager.js";
import { SDKRuntime } from "../runtime/sdk-runtime.js";
import { toSDKOptions } from "../sdk-adapter.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("MCP server + plugin passthrough (#444, #445)", () => {
  let tempDir: string;
  let configPath: string;
  let manager: FleetManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp-plugin-passthrough-"));
    const configDir = join(tempDir, "config");
    await mkdir(configDir, { recursive: true });
    configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify({ version: 1, agents: [] }));

    manager = new FleetManager({
      configPath,
      stateDir: join(tempDir, ".herdctl"),
      checkInterval: 10_000,
      logger: silentLogger(),
    });
    await manager.initialize();
  });

  afterEach(async () => {
    queryCalls.length = 0;
    vi.clearAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /** Register an agent and hand back the resolved config the runtime would use. */
  async function addAndResolve(config: Record<string, unknown>): Promise<ResolvedAgent> {
    await manager.addAgent(config as { name: string });
    const agent = manager.getAgents().find((a) => a.name === config.name);
    if (!agent) throw new Error(`agent ${String(config.name)} was not registered`);
    return agent;
  }

  // ===========================================================================
  // #445 — headers / type survive the round trip
  // ===========================================================================

  describe("#445: authenticated and SSE servers survive addAgent -> toSDKOptions", () => {
    it("preserves headers and an explicit type: sse end to end", async () => {
      const agent = await addAndResolve({
        name: "remote-mcp",
        mcp_servers: {
          linear: {
            type: "sse",
            url: "https://mcp.linear.app/sse",
            headers: { Authorization: "Bearer sk-test-123" },
          },
        },
      });

      // The config boundary is where the stripping used to happen — assert the
      // fields are still on the *resolved agent*, not just on the SDK options.
      expect(agent.mcp_servers?.linear).toEqual({
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: "Bearer sk-test-123" },
      });

      const sdkOptions = toSDKOptions(agent);
      expect(sdkOptions.mcpServers?.linear).toEqual({
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: "Bearer sk-test-123" },
      });
    });

    it("keeps headers on an http server (the OAuth token key depends on them)", async () => {
      const agent = await addAndResolve({
        name: "http-mcp",
        mcp_servers: {
          notion: {
            type: "http",
            url: "https://mcp.notion.com/mcp",
            headers: { "X-Api-Key": "secret" },
          },
        },
      });

      expect(toSDKOptions(agent).mcpServers?.notion).toEqual({
        type: "http",
        url: "https://mcp.notion.com/mcp",
        headers: { "X-Api-Key": "secret" },
      });
    });

    it("still infers type: http from a bare url, so existing configs are unchanged", async () => {
      const agent = await addAndResolve({
        name: "legacy-mcp",
        mcp_servers: { legacy: { url: "https://example.com/mcp" } },
      });

      expect(toSDKOptions(agent).mcpServers?.legacy).toEqual({
        type: "http",
        url: "https://example.com/mcp",
      });
    });

    it("passes timeout and alwaysLoad through, and leaves stdio type implicit", async () => {
      const agent = await addAndResolve({
        name: "stdio-mcp",
        mcp_servers: {
          fs: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem"],
            timeout: 30_000,
            alwaysLoad: true,
          },
        },
      });

      expect(toSDKOptions(agent).mcpServers?.fs).toEqual({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        timeout: 30_000,
        alwaysLoad: true,
      });
    });

    it("reaches the SDK query() options intact", async () => {
      const agent = await addAndResolve({
        name: "queried-mcp",
        mcp_servers: {
          linear: {
            type: "sse",
            url: "https://mcp.linear.app/sse",
            headers: { Authorization: "Bearer sk-test-123" },
          },
        },
      });

      const runtime = new SDKRuntime();
      for await (const _ of runtime.execute({ prompt: "hi", agent })) {
        // mocked query() yields nothing
      }

      expect(queryCalls).toHaveLength(1);
      expect((queryCalls[0].mcpServers as Record<string, unknown>).linear).toEqual({
        type: "sse",
        url: "https://mcp.linear.app/sse",
        headers: { Authorization: "Bearer sk-test-123" },
      });
    });
  });

  // ===========================================================================
  // #444 — plugins passthrough
  // ===========================================================================

  describe("#444: plugins reach SDKQueryOptions", () => {
    it("passes an object-form plugin through addAgent -> toSDKOptions", async () => {
      const agent = await addAndResolve({
        name: "plugged",
        plugins: [{ type: "local", path: "/opt/plugins/slack" }],
      });

      expect(toSDKOptions(agent).plugins).toEqual([{ type: "local", path: "/opt/plugins/slack" }]);
    });

    it("normalises the bare-path shorthand to the SDK's object form", async () => {
      const agent = await addAndResolve({
        name: "shorthand",
        plugins: ["/opt/plugins/slack", { path: "/opt/plugins/jira" }],
      });

      expect(agent.plugins).toEqual([
        { type: "local", path: "/opt/plugins/slack" },
        { type: "local", path: "/opt/plugins/jira" },
      ]);
      expect(toSDKOptions(agent).plugins).toEqual([
        { type: "local", path: "/opt/plugins/slack" },
        { type: "local", path: "/opt/plugins/jira" },
      ]);
    });

    it("carries skipMcpDiscovery", async () => {
      const agent = await addAndResolve({
        name: "no-mcp-plugin",
        plugins: [{ type: "local", path: "/opt/plugins/slack", skipMcpDiscovery: true }],
      });

      expect(toSDKOptions(agent).plugins).toEqual([
        { type: "local", path: "/opt/plugins/slack", skipMcpDiscovery: true },
      ]);
    });

    it("omits the key entirely when the agent lists no plugins", async () => {
      const agent = await addAndResolve({ name: "unplugged" });

      expect(toSDKOptions(agent).plugins).toBeUndefined();
      expect(toSDKOptions(agent)).not.toHaveProperty("plugins");
    });

    it("does not alias the agent's array, so a runtime cannot mutate config", async () => {
      const agent = await addAndResolve({
        name: "isolated",
        plugins: [{ type: "local", path: "/opt/plugins/slack" }],
      });

      const sdkOptions = toSDKOptions(agent);
      sdkOptions.plugins?.push({ type: "local", path: "/injected" });
      sdkOptions.plugins![0].path = "/mutated";

      expect(agent.plugins).toEqual([{ type: "local", path: "/opt/plugins/slack" }]);
    });

    it("reaches the SDK query() options", async () => {
      const agent = await addAndResolve({
        name: "queried-plugin",
        plugins: ["/opt/plugins/slack"],
      });

      const runtime = new SDKRuntime();
      for await (const _ of runtime.execute({ prompt: "hi", agent })) {
        // mocked query() yields nothing
      }

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].plugins).toEqual([{ type: "local", path: "/opt/plugins/slack" }]);
    });
  });

  // ===========================================================================
  // #444 second blocker — the settingSources lever that already exists
  // ===========================================================================

  describe("#444: setting_sources can opt an agent into user-source plugin enablement", () => {
    it("threads an explicit user source through to the SDK, overriding the project default", async () => {
      const agent = await addAndResolve({
        name: "user-settings",
        working_directory: tempDir,
        setting_sources: ["user", "project"],
      });

      // Without the explicit list this would be ["project"], which is what makes
      // the SDK's `enabledPlugins` auto-discovery inert (#444's second blocker).
      expect(toSDKOptions(agent).settingSources).toEqual(["user", "project"]);
    });
  });
});
