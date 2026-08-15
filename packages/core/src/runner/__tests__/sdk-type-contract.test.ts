/**
 * Compile-time contract between herdctl's hand-written SDK option mirrors and
 * the Agent SDK's own types (edspencer/herdctl#444, #445).
 *
 * `SDKQueryOptions` / `SDKMcpServerConfig` / `SDKPluginConfig` are maintained by
 * hand, and `sdk-runtime.ts` widens them with `as Record<string, unknown>`
 * before calling `query()` — so nothing at runtime, and nothing anywhere else in
 * the build, checks that they still line up with the SDK. That is how #445's
 * `type?: "http"` stayed wrong: the SDK grew `sse` and herdctl never noticed.
 *
 * These assertions are erased at runtime; `pnpm typecheck` is what enforces
 * them, and a `tsc` error here means the SDK moved and the mirrors need
 * updating. The `it()` blocks exist so the intent is visible in test output.
 */

import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
  Options as SdkOptions,
  SdkPluginConfig,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { SDKMcpServerConfig, SDKPluginConfig, SDKQueryOptions } from "../types.js";

/** Fails to compile unless `T` is assignable to `U`. */
type Extends<T extends U, U> = T;

// --- #444: plugins ----------------------------------------------------------

// Our plugin config must be something the SDK's `plugins` option accepts...
type _PluginIsAcceptedBySdk = Extends<SDKPluginConfig, SdkPluginConfig>;
// ...and must not be missing a required field the SDK demands.
type _PluginCoversSdkRequired = Extends<SdkPluginConfig, SDKPluginConfig>;
// The option itself must still be called `plugins` and still take an array.
type _PluginsOptionExists = Extends<SDKPluginConfig[], NonNullable<SdkOptions["plugins"]>>;
type _OurPluginsMatchTheOption = Extends<
  NonNullable<SDKQueryOptions["plugins"]>,
  NonNullable<SdkOptions["plugins"]>
>;

// --- #445: MCP server transports -------------------------------------------

// Every transport the SDK's serializable configs declare must be expressible in
// our `type` union. `sse` is the one that was missing.
type _CoversSse = Extends<McpSSEServerConfig["type"], NonNullable<SDKMcpServerConfig["type"]>>;
type _CoversHttp = Extends<McpHttpServerConfig["type"], NonNullable<SDKMcpServerConfig["type"]>>;
type _CoversStdio = Extends<
  NonNullable<McpStdioServerConfig["type"]>,
  NonNullable<SDKMcpServerConfig["type"]>
>;

// Header and timeout shapes must match the SDK's, not merely exist.
type _HeadersMatchSse = Extends<
  NonNullable<SDKMcpServerConfig["headers"]>,
  NonNullable<McpSSEServerConfig["headers"]>
>;
type _HeadersMatchHttp = Extends<
  NonNullable<SDKMcpServerConfig["headers"]>,
  NonNullable<McpHttpServerConfig["headers"]>
>;
type _TimeoutMatches = Extends<
  NonNullable<SDKMcpServerConfig["timeout"]>,
  NonNullable<McpHttpServerConfig["timeout"]>
>;
type _AlwaysLoadMatches = Extends<
  NonNullable<SDKMcpServerConfig["alwaysLoad"]>,
  NonNullable<McpHttpServerConfig["alwaysLoad"]>
>;

// A fully-populated SSE server built the way `transformMcpServer` builds one
// must satisfy the SDK's own config type.
const sseExample = {
  type: "sse",
  url: "https://mcp.example.com/sse",
  headers: { Authorization: "Bearer token" },
} satisfies McpSSEServerConfig;

describe("SDK type contract (#444, #445)", () => {
  it("keeps SDKPluginConfig assignable to the SDK's SdkPluginConfig", () => {
    // Enforced by `pnpm typecheck` via the aliases above.
    const plugin: SDKPluginConfig = { type: "local", path: "/opt/plugins/slack" };
    const asSdk: SdkPluginConfig = plugin;
    expect(asSdk.path).toBe("/opt/plugins/slack");
  });

  it("keeps SDKMcpServerConfig able to express every SDK transport", () => {
    const transports: Array<NonNullable<SDKMcpServerConfig["type"]>> = ["stdio", "sse", "http"];
    expect(transports).toContain("sse");
    expect(sseExample.headers.Authorization).toBe("Bearer token");
  });
});
