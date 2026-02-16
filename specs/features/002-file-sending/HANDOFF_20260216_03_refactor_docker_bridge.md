# Handoff: WEA-17 File Sending — Refactor Complete + Docker Bridge

## Summary

Completed the mid-session refactor from Session 2: deleted the deprecated `createFileSenderMcpServer()` API, switched all consumers to `createFileSenderDef()`, built the MCP HTTP bridge for Docker containers, and fixed all tests. The feature is code-complete and builds/typechecks/tests cleanly. Remaining: deploy, add `files:write` Slack scope, test end-to-end.

## What Was Done

### Refactor: Remove Deprecated API
- **`packages/core/src/runner/file-sender-mcp.ts`** — Deleted `createFileSenderMcpServer()` (async SDK wrapper). Only `createFileSenderDef()` remains.
- **`packages/core/src/runner/index.ts`** — Updated exports: `createFileSenderDef` instead of `createFileSenderMcpServer`
- **`packages/core/src/fleet-manager/slack-manager.ts`** — Switched from `createFileSenderMcpServer()` to `createFileSenderDef()`, proper `InjectedMcpServerDef` typing throughout

### SDKRuntime: InjectedMcpServerDef → In-Process MCP Server
- **`packages/core/src/runner/runtime/sdk-runtime.ts`** — Added `defToSdkMcpServer()` that converts `InjectedMcpServerDef` to an SDK MCP server instance using `tool()` + `createSdkMcpServer()` from Claude Agent SDK. Includes `jsonPropertyToZod()` to convert JSON Schema properties to Zod schemas (handles string, number, boolean, optional).

### MCP HTTP Bridge for Docker (NEW)
- **`packages/core/src/runner/runtime/mcp-http-bridge.ts`** — NEW. Minimal HTTP server implementing MCP Streamable HTTP transport (JSON-RPC 2.0 over POST). Handles: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`. Binds to `0.0.0.0:0` (random port). Translates `/workspace/` paths to relative before calling handlers.

### ContainerRunner Docker Integration
- **`packages/core/src/runner/runtime/container-runner.ts`** — `executeSDKRuntime()` now detects `injectedMcpServers`, starts an HTTP bridge per server, injects `{ type: "http", url: "http://herdctl:<port>/mcp" }` into `sdkOptions.mcpServers`, cleans up bridges in `finally` block.
- **`packages/core/src/runner/runtime/index.ts`** — Exports `startMcpHttpBridge` and `McpHttpBridge` type

### Tests
- **`packages/core/src/runner/__tests__/file-sender-mcp.test.ts`** — Rewrote all 12 tests to use `createFileSenderDef()` API directly (no SDK mocks needed)
- **`packages/core/src/runner/runtime/__tests__/mcp-http-bridge.test.ts`** — NEW. 13 tests covering all MCP endpoints, Docker path translation, error handling, server lifecycle

## What Worked

- The `InjectedMcpServerDef` abstraction cleanly separates tool definitions from transport — SDKRuntime and ContainerRunner each do their own conversion without coupling
- JSON Schema → Zod conversion was simpler than expected since our tools only use string properties
- The HTTP bridge tests run fast (72ms for 13 tests) by using Node's native `fetch` against localhost
- No SDK mocks needed for file-sender tests since `createFileSenderDef()` returns plain objects with handler functions

## What Didn't Work / Issues Found

- `@modelcontextprotocol/sdk` is not directly available as a dependency (only transitively via Claude Agent SDK types). Had to use Claude Agent SDK's `tool()` + `createSdkMcpServer()` with Zod conversion instead of using MCP SDK's `McpServer` directly with JSON schemas.
- `sdkOptions.mcpServers` type is `Record<string, SDKMcpServerConfig>` but SDK actually accepts `McpSdkServerConfigWithInstance` (with live `McpServer` object). Required an `as any` cast in SDKRuntime since the types don't express this union.

## Key Learnings

- **Claude Agent SDK's `tool()` requires Zod schemas**, not JSON schemas. For tools defined with JSON schemas (like `InjectedMcpToolDef`), you need a converter. Simple flat-object schemas (string/number/boolean with optional) are trivial to convert.
- **Docker MCP bridge pattern**: Host starts HTTP server → agent container connects via Docker DNS (`http://herdctl:<port>/mcp`). No port mapping needed since both containers share `herdctl-net`. The bridge handles path translation (`/workspace/foo` → `foo`).
- **MCP Streamable HTTP transport**: JSON-RPC 2.0 over POST. Notifications (like `notifications/initialized`) return 204 No Content. All other methods return 200 with JSON body.

## Current State

### Build Status
- `pnpm build`: **PASSES** (all 5 packages)
- `pnpm typecheck`: **PASSES** (all 6 targets)
- `pnpm test`: **2373 tests pass**, coverage thresholds met

### Branch: `features/wea-17-file-sending`
Commit `9bc1af3` — all changes committed, nothing unstaged.

### Linear Status

| Issue | Title | Status |
|-------|-------|--------|
| WEA-17 | File sending from agents | In Progress |
| WEA-35 | Thread injectedMcpServers through pipeline | Done |
| WEA-36 | Create FileSenderContext and factory | Done |
| WEA-37 | Wire up Slack file upload in SlackManager | Done |
| WEA-38 | Expose uploadFile on SlackConnector | Done |
| WEA-39 | Set CLAUDE_CODE_STREAM_CLOSE_TIMEOUT | Done |
| WEA-40 | Tests for file-sender MCP | Done |
| WEA-41 | Changeset | Done |

## Next Steps

### Deploy & Test
1. **Add `files:write` scope** to Slack app at api.slack.com → OAuth & Permissions → Bot Token Scopes → Reinstall to Workspace
2. **Deploy** via the standard tarball flow:
   ```bash
   pnpm build
   cd packages/core && pnpm pack
   cd ../cli && pnpm pack
   cd ../slack && pnpm pack
   cd ../discord && pnpm pack
   # Copy tarballs to /home/dev/hetzner-dev-box-config/herdctl/tarballs/
   cd /home/dev/hetzner-dev-box-config && docker compose build herdctl && docker compose up -d herdctl
   ```
3. **Test in Slack** (channel C0AFZKCDGRE):
   - Ask agent: "напиши короткий текстовый файл test.txt и отправь его мне"
   - Expected: agent creates file, calls `herdctl_send_file`, file appears in Slack thread
4. **Create PR** after successful test
5. **Close WEA-17** after merge

## Relevant Files

### Core — File Sender
- `packages/core/src/runner/file-sender-mcp.ts` — `createFileSenderDef()` + handler
- `packages/core/src/runner/__tests__/file-sender-mcp.test.ts` — 12 tests
- `packages/core/src/runner/types.ts` — `InjectedMcpServerDef`, `InjectedMcpToolDef`, `McpToolCallResult`

### Core — SDKRuntime Conversion
- `packages/core/src/runner/runtime/sdk-runtime.ts` — `defToSdkMcpServer()`, `jsonPropertyToZod()`

### Core — Docker MCP Bridge
- `packages/core/src/runner/runtime/mcp-http-bridge.ts` — HTTP server for Docker
- `packages/core/src/runner/runtime/__tests__/mcp-http-bridge.test.ts` — 13 tests
- `packages/core/src/runner/runtime/container-runner.ts` — Bridge lifecycle in `executeSDKRuntime()`

### Core — Pipeline
- `packages/core/src/fleet-manager/slack-manager.ts` — `createFileSenderDef()` per message
- `packages/core/src/fleet-manager/types.ts` — `TriggerOptions.injectedMcpServers`
- `packages/core/src/runner/runtime/interface.ts` — `RuntimeExecuteOptions.injectedMcpServers`
- `packages/core/src/runner/job-executor.ts` — passthrough
- `packages/core/src/fleet-manager/job-control.ts` — passthrough

### Slack
- `packages/slack/src/slack-connector.ts` — `uploadFile()` via `files.uploadV2`
- `packages/slack/src/types.ts` — `SlackFileUploadParams`, `ISlackConnector`
