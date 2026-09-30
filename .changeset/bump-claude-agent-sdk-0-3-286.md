---
"@herdctl/core": patch
---

Raise the `@anthropic-ai/claude-agent-sdk` floor to `^0.3.286` (current npm `latest`).

Picks up upstream fixes to foreground subagents missing task-tracking tools, SDK MCP tool schema conversion, `toggleMcpServer()` connections, `forkSession()` history reading, and `getSessionMessages()` message inclusion.

0.3.286 is breaking upstream in one respect — the TypeScript Agent SDK no longer sends a default `permissionMode`, letting Claude Code apply the settings' `permissions.defaultMode` instead — but herdctl is unaffected: `toSDKOptions` always sets `permissionMode` explicitly (`agent.permission_mode ?? "acceptEdits"`), and the CLI runtime always passes `--permission-mode`. No exported SDK types changed, so no code adaptation was needed.
