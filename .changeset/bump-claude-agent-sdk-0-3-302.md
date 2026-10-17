---
"@herdctl/core": patch
---

Raise the `@anthropic-ai/claude-agent-sdk` floor to `^0.3.302` (current npm `latest`).

Picks up upstream fixes across 0.3.284–0.3.302, including: foreground subagents missing task-tracking tools, SDK MCP tool schema conversion, `toggleMcpServer()` leaving in-process tool calls hung, `forkSession()` history reading, `getSessionMessages()` message inclusion, `importSessionToStore` dropping transcript rows containing U+2028/U+2029, assistant text blocks losing `citations` in streamed responses, and `includePartialMessages` streams never emitting `message_stop` on a cut stream.

No code adaptation was needed. The API surface is additive over this range — the only new exports are `BUILTIN_TOOL_NAMES` and `LEGACY_TOOL_NAME_ALIASES`, and nothing was removed or renamed. Two upstream `permissionMode` default changes (0.3.286 and 0.3.302) do not reach herdctl, which always sets `permissionMode` explicitly (`agent.permission_mode ?? "acceptEdits"`) and always passes `--permission-mode` on the CLI runtime.

Note one runtime behaviour change inherited from 0.3.302: fork subagents (`subagent_type: "fork"`) are now on by default in SDK sessions, matching the terminal. Set `CLAUDE_CODE_FORK_SUBAGENT=0` to opt out.
