---
"@herdctl/chat": minor
"@herdctl/core": minor
"@herdctl/discord": patch
"@herdctl/slack": minor
"@herdctl/web": minor
---

Add tool call/result visibility to Web and Slack connectors

- Extract shared tool parsing utilities (`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`, `TOOL_EMOJIS`) from Discord manager into `@herdctl/chat` for reuse across all connectors
- Add shared `ChatOutputSchema` to `@herdctl/core` config with `tool_results`, `tool_result_max_length`, `system_status`, and `errors` fields; Discord's `DiscordOutputSchema` now extends it
- Add `output` config field to `AgentChatSlackSchema` for Slack connector output settings
- Add `tool_results` boolean to fleet-level `WebSchema` for dashboard-wide tool result visibility
- Slack connector now displays tool call results (name, input summary, duration, output) when `output.tool_results` is enabled (default: true)
- Web dashboard now streams tool call results via `chat:tool_call` WebSocket messages and renders them as collapsible inline blocks in chat conversations
- Refactor Discord manager to import shared utilities from `@herdctl/chat` instead of using private methods
