# @herdctl/slack

## 0.3.0

### Minor Changes

- [#61](https://github.com/edspencer/herdctl/pull/61) [`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb) Thanks [@edspencer](https://github.com/edspencer)! - feat(slack): align SlackConnector to per-agent model matching Discord

  Restructured the Slack integration from a single shared connector with channel-agent routing to one connector per agent, matching Discord's per-agent architecture.

  - SlackConnector now takes per-agent options (agentName, channels, sessionManager)
  - SlackManager creates Map<string, ISlackConnector> instead of single connector
  - Event payloads (ready, disconnect, error) now include agentName
  - Added getConnectorNames() and getConnectedCount() to SlackManager
  - Removed getChannelAgentMap() from SlackManager

### Patch Changes

- Updated dependencies [[`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb)]:
  - @herdctl/core@4.2.0

## 0.2.1

### Patch Changes

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Add verbose logging control and colorized output

  - Add `--verbose` / `-v` flag to `herdctl start` to enable debug logging
  - Add `HERDCTL_LOG_LEVEL` environment variable support (debug/info/warn/error)
  - Add colorized log output in `herdctl start` matching the style of `herdctl logs`
  - Refactor CLIRuntime and CLISessionWatcher to use centralized logger
  - Convert Discord and Slack connector loggers to use centralized `createLogger` from core
  - Internal debug logs are now hidden by default, reducing noise significantly
  - Extract shared color utilities for consistent formatting across CLI commands

- Updated dependencies [[`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d), [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d)]:
  - @herdctl/core@4.1.1

## 0.2.0

### Minor Changes

- [#47](https://github.com/edspencer/herdctl/pull/47) [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1) Thanks [@ikido](https://github.com/ikido)! - feat: add file sending from agents via SDK tool injection (WEA-17)

  Agents can now upload files to the originating Slack thread using the `herdctl_send_file` MCP tool, injected at runtime via the Claude Agent SDK's in-process MCP server support.

  - Core: `createFileSenderMcpServer()` factory creates an in-process MCP server with `herdctl_send_file` tool
  - Core: `injectedMcpServers` field threaded through TriggerOptions → RunnerOptions → RuntimeExecuteOptions → SDKRuntime
  - Core: SDKRuntime merges injected MCP servers with config-declared servers at execution time
  - Slack: `uploadFile()` method on SlackConnector using Slack's `files.uploadV2` API
  - Slack: SlackManager automatically injects file sender MCP server for all agent jobs
  - Path security: tool handler validates file paths stay within the agent's working directory

- [#47](https://github.com/edspencer/herdctl/pull/47) [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1) Thanks [@ikido](https://github.com/ikido)! - feat: add Slack integration for agent chat

  Adds `@herdctl/slack` package and integrates it into `@herdctl/core`:

  - New `@herdctl/slack` package with SlackConnector (Bolt/Socket Mode), SessionManager, CommandHandler, error handling, and mrkdwn formatting
  - Config schema: `AgentChatSlackSchema` and `SlackHookConfigSchema` for agent chat and hook configuration
  - Core: `SlackManager` for single-connector-per-workspace lifecycle management with channel-to-agent routing
  - Core: `SlackHookRunner` for posting schedule results to Slack channels
  - Core: FleetManager wiring (initialize/start/stop), status queries, and event types for Slack connector
  - Example: `examples/slack-chat-bot/` with setup instructions

### Patch Changes

- [#51](https://github.com/edspencer/herdctl/pull/51) [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9) Thanks [@edspencer](https://github.com/edspencer)! - Fix symlink bypass in file-sender-mcp path validation, narrow Slack error classification, add missing event types, and correct help text

  - **Security**: Use `realpath()` before path containment check in file-sender-mcp to prevent symlink bypass
  - **Bug fix**: Narrow `classifyError()` token matching from broad `"token"` substring to specific Slack API error codes (`token_revoked`, `token_expired`, `not_authed`)
  - **Types**: Add typed `FleetManagerEventMap` entries for four Slack manager events (`slack:message:handled`, `slack:message:error`, `slack:error`, `slack:session:lifecycle`)
  - **Docs**: Fix help text to reflect channel-based sessions instead of thread-based
  - **Deps**: Add `@herdctl/slack` to CLI dependencies so `npx herdctl start` includes Slack support
  - **Build**: Configure changesets `onlyUpdatePeerDependentsWhenOutOfRange` to prevent unnecessary major version bumps on core when connector packages are updated

- [#47](https://github.com/edspencer/herdctl/pull/47) [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1) Thanks [@ikido](https://github.com/ikido)! - feat: convert agent markdown output to Slack mrkdwn format

  Wire `markdownToMrkdwn()` into the reply path so agent output renders correctly in Slack. Add conversions for headers, strikethrough, images, and horizontal rules.

- Updated dependencies [[`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1), [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9), [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1)]:
  - @herdctl/core@4.1.0
