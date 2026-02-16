---
"@herdctl/core": minor
"@herdctl/slack": minor
---

feat: add file sending from agents via SDK tool injection (WEA-17)

Agents can now upload files to the originating Slack thread using the `herdctl_send_file` MCP tool, injected at runtime via the Claude Agent SDK's in-process MCP server support.

- Core: `createFileSenderMcpServer()` factory creates an in-process MCP server with `herdctl_send_file` tool
- Core: `injectedMcpServers` field threaded through TriggerOptions → RunnerOptions → RuntimeExecuteOptions → SDKRuntime
- Core: SDKRuntime merges injected MCP servers with config-declared servers at execution time
- Slack: `uploadFile()` method on SlackConnector using Slack's `files.uploadV2` API
- Slack: SlackManager automatically injects file sender MCP server for all agent jobs
- Path security: tool handler validates file paths stay within the agent's working directory
