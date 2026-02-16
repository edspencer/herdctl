# Handoff: WEA-17 File Sending from Agents via SDK Tool Injection

## Summary

Implementing file sending from herdctl agents to Slack threads. The core feature (SDK tool injection pipeline + file upload) is code-complete and builds successfully, but a mid-session refactor to support Docker execution is partially done. The branch has unstaged changes ready for the next session to complete the Docker MCP bridge and clean up the deprecated code path.

## What Was Done

### Core Pipeline (Complete)
- **`packages/core/src/runner/types.ts`** — Added `InjectedMcpServerDef`, `InjectedMcpToolDef`, `McpToolCallResult` types; added `injectedMcpServers` to `RunnerOptions`
- **`packages/core/src/fleet-manager/types.ts`** — Added `injectedMcpServers` to `TriggerOptions` using the new typed `InjectedMcpServerDef`
- **`packages/core/src/runner/runtime/interface.ts`** — Added `injectedMcpServers` to `RuntimeExecuteOptions`
- **`packages/core/src/runner/job-executor.ts`** — Passes `injectedMcpServers` through to runtime
- **`packages/core/src/fleet-manager/job-control.ts`** — Passes `injectedMcpServers` through to executor

### SDK Runtime Integration (Complete)
- **`packages/core/src/runner/runtime/sdk-runtime.ts`** — Merges injected MCP servers with config-declared servers; sets `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=120000` when file sender is present

### File Sender MCP (Partially Refactored)
- **`packages/core/src/runner/file-sender-mcp.ts`** — NEW file. Contains:
  - `createFileSenderDef()` — transport-agnostic definition with JSON schema + handler (the NEW API)
  - `createFileSenderMcpServer()` — deprecated async wrapper using SDK `tool()` + `createSdkMcpServer()` (the OLD API, still referenced by slack-manager.ts)
  - `FileSenderContext`, `FileUploadParams`, `FileUploadResult` interfaces
  - `herdctl_send_file` tool with path traversal prevention
- **`packages/core/src/runner/index.ts`** — Exports `createFileSenderMcpServer`, `FileSenderContext`, `FileUploadParams`, `FileUploadResult` (needs updating to export `createFileSenderDef` instead)

### Slack Integration (Complete but uses old API)
- **`packages/core/src/fleet-manager/slack-manager.ts`** — Creates `FileSenderContext` per message, injects MCP server via `createFileSenderMcpServer()` (needs switching to `createFileSenderDef()`)
- **`packages/slack/src/slack-connector.ts`** — Added `uploadFile()` method using Slack's `files.uploadV2` API
- **`packages/slack/src/types.ts`** — Added `SlackFileUploadParams` interface, updated `ISlackConnector`

### Tests (Written but failing)
- **`packages/core/src/runner/__tests__/file-sender-mcp.test.ts`** — 11 tests, ALL FAILING because `getToolHandler()` helper tries to access `.tools[0].handler` which doesn't exist on the old SDK MCP server object. Tests need rewriting to use `createFileSenderDef()` API instead.

### Changeset
- **`.changeset/file-sending-mcp.md`** — Minor bumps for `@herdctl/core` and `@herdctl/slack`

## What Worked

- The injection pipeline design is clean — `injectedMcpServers` flows through TriggerOptions → RunnerOptions → RuntimeExecuteOptions → SDKRuntime without any coupling to specific tools
- The `InjectedMcpServerDef` abstraction separates tool definitions from transport, enabling both in-process MCP (SDK runtime) and HTTP bridge (Docker runtime)
- Slack `files.uploadV2` integration was straightforward
- Path traversal prevention via `resolve()` + `relative()` is simple and effective

## What Didn't Work / Issues Found

### Docker MCP Server Serialization (Critical Discovery)
`ContainerRunner.executeSDKRuntime()` serializes `sdkOptions` to JSON for the Docker container. In-process MCP servers (function closures) **cannot be serialized**. This means the current `createFileSenderMcpServer()` approach silently fails in Docker — and production uses Docker.

The fix requires an HTTP MCP bridge: herdctl starts a minimal HTTP server on the Docker network, and the agent container connects to it as `http://herdctl:<port>`. This is why the refactor to `InjectedMcpServerDef` was started but not completed.

### Tests Broke During Refactor
The test file was written for the original `createFileSenderMcpServer()` API. The refactor to `createFileSenderDef()` changed the return type, but tests weren't updated. They all fail with `TypeError: Cannot read properties of undefined (reading '0')`.

## Key Learnings

- **Docker network**: `herdctl` container and agent containers share `herdctl-net`. Agents can reach `herdctl:<port>` via Docker DNS. No port mapping needed.
- **SDK MCP types**: `McpHttpServerConfig = { type: 'http'; url: string; headers?: Record<string, string> }` and `McpSdkServerConfigWithInstance = McpSdkServerConfig & { instance: McpServer }` — the Container runner needs to inject HTTP type, SDK runtime needs SDK type
- **Path translation for Docker**: Agent sees `/workspace/report.pdf`, herdctl sees `<working_directory>/report.pdf`. The HTTP bridge must strip `/workspace/` prefix before calling the handler.
- **`CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`**: SDK recommends setting this for long-running MCP tool calls (file uploads can exceed default 60s)

## Current State

### Build Status
- `pnpm build`: **PASSES** (all 5 packages)
- `pnpm typecheck`: Should pass (types are consistent)
- Tests: **11 failing** in `file-sender-mcp.test.ts` (old API, easy fix)

### Branch: `features/wea-17-file-sending`
All changes are **unstaged** (nothing committed to this branch yet). The staged-only file is the old handoff doc.

### Linear Status

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| WEA-17 | File sending from agents | In Progress | Parent issue, Docker bridge incomplete |
| WEA-35 | Thread injectedMcpServers through pipeline | Done | Code complete |
| WEA-36 | Create FileSenderContext and factory | Done | Needs cleanup (remove deprecated fn) |
| WEA-37 | Wire up Slack file upload in SlackManager | Done | Uses old API, needs switching to Def |
| WEA-38 | Expose uploadFile on SlackConnector | Done | Code complete |
| WEA-39 | Set CLAUDE_CODE_STREAM_CLOSE_TIMEOUT | Done | Code complete |
| WEA-40 | Tests for file-sender MCP | Done* | *Tests written but currently broken |
| WEA-41 | Changeset | Done | `.changeset/file-sending-mcp.md` exists |

## Next Steps

### Immediate (finish the refactor)
1. **Delete `createFileSenderMcpServer()`** from `file-sender-mcp.ts` — it's deprecated, async (breaks callers), and not needed. Per CLAUDE.md: no backwards compat.
2. **Update `slack-manager.ts`** to use `createFileSenderDef()` instead of `createFileSenderMcpServer()`
3. **Update `runner/index.ts` exports** to export `createFileSenderDef` instead of `createFileSenderMcpServer`
4. **Fix tests** in `file-sender-mcp.test.ts` — use `createFileSenderDef()` API, test handler via `def.tools[0].handler()` directly
5. **Update `SDKRuntime.execute()`** to convert `InjectedMcpServerDef` → in-process MCP server (currently passes raw objects, needs to use SDK's `tool()` + `createSdkMcpServer()` to build real MCP server from the def)

### Docker Bridge (new work)
6. **Create `packages/core/src/runner/runtime/mcp-http-bridge.ts`**:
   - Minimal HTTP server implementing MCP Streamable HTTP transport (JSON-RPC 2.0 over POST)
   - Handles: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`
   - Binds to `0.0.0.0:0` (random port), returns port
   - Translates `/workspace/...` paths to relative before calling handler
7. **Update `ContainerRunner.executeSDKRuntime()`** (`container-runner.ts:185-280`):
   - Detect `options.injectedMcpServers`
   - Start HTTP bridge per server
   - Inject `{ type: "http", url: "http://herdctl:<port>" }` into `sdkOptions.mcpServers`
   - Clean up bridges in `finally` block
8. **Deploy and test in Slack** (channel C0AFZKCDGRE)

### Deploy Process
```bash
pnpm build
cd packages/core && pnpm pack
cd ../cli && pnpm pack
cd ../slack && pnpm pack
cd ../discord && pnpm pack
# Copy tarballs to /home/dev/hetzner-dev-box-config/herdctl/tarballs/
cd /home/dev/hetzner-dev-box-config && docker compose build herdctl && docker compose up -d herdctl
```

## Relevant Files

### Core — Pipeline
- `packages/core/src/runner/types.ts` — `InjectedMcpServerDef`, `InjectedMcpToolDef`, `McpToolCallResult`
- `packages/core/src/fleet-manager/types.ts` — `TriggerOptions.injectedMcpServers`
- `packages/core/src/runner/runtime/interface.ts` — `RuntimeExecuteOptions.injectedMcpServers`
- `packages/core/src/runner/job-executor.ts` — passthrough
- `packages/core/src/fleet-manager/job-control.ts` — passthrough

### Core — File Sender
- `packages/core/src/runner/file-sender-mcp.ts` — Tool definition + handler
- `packages/core/src/runner/__tests__/file-sender-mcp.test.ts` — Tests (currently broken)
- `packages/core/src/runner/runtime/sdk-runtime.ts` — MCP server merge + timeout env var

### Core — Docker (TODO)
- `packages/core/src/runner/runtime/container-runner.ts` — Needs HTTP bridge integration (lines 185-280)
- `packages/core/src/runner/runtime/mcp-http-bridge.ts` — To be created

### Slack
- `packages/core/src/fleet-manager/slack-manager.ts` — FileSenderContext creation + injection
- `packages/slack/src/slack-connector.ts` — `uploadFile()` method
- `packages/slack/src/types.ts` — `SlackFileUploadParams`, `ISlackConnector`

### Config
- `.changeset/file-sending-mcp.md` — Changeset for release
- `/home/dev/hetzner-dev-box-config/docker-compose.yml` — Docker network setup reference
