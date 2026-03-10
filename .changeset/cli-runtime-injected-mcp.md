---
"@herdctl/core": minor
---

Add injected MCP server support to CLI runtime via HTTP bridges

CLI runtime now supports `injectedMcpServers` (e.g., file sender for Discord/Slack uploads).
Previously only SDK and Docker runtimes handled injected MCP servers — CLI silently ignored them.

The fix reuses existing `mcp-http-bridge.ts` infrastructure: starts HTTP bridges on localhost
for each injected server and passes them via `--mcp-config` as HTTP-type MCP servers.
