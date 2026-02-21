# @herdctl/slack

## 1.2.2

### Patch Changes

- Updated dependencies [[`4d1e4d8`](https://github.com/edspencer/herdctl/commit/4d1e4d8925d04a75f92a64360408d9fead9d3730)]:
  - @herdctl/core@5.4.2
  - @herdctl/chat@0.3.2

## 1.2.1

### Patch Changes

- [#97](https://github.com/edspencer/herdctl/pull/97) [`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4) Thanks [@edspencer](https://github.com/edspencer)! - Add Biome for linting and formatting across all packages

- Updated dependencies [[`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4)]:
  - @herdctl/core@5.4.1
  - @herdctl/chat@0.3.1

## 1.2.0

### Minor Changes

- [#90](https://github.com/edspencer/herdctl/pull/90) [`12b26af`](https://github.com/edspencer/herdctl/commit/12b26af9dc0b7f39dd38c35cb230ca596725731e) Thanks [@edspencer](https://github.com/edspencer)! - Add tool call/result visibility to Web and Slack connectors

  - Extract shared tool parsing utilities (`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`, `TOOL_EMOJIS`) from Discord manager into `@herdctl/chat` for reuse across all connectors
  - Add shared `ChatOutputSchema` to `@herdctl/core` config with `tool_results`, `tool_result_max_length`, `system_status`, and `errors` fields; Discord's `DiscordOutputSchema` now extends it
  - Add `output` config field to `AgentChatSlackSchema` for Slack connector output settings
  - Add `tool_results` boolean to fleet-level `WebSchema` for dashboard-wide tool result visibility
  - Slack connector now displays tool call results (name, input summary, duration, output) when `output.tool_results` is enabled (default: true)
  - Web dashboard now streams tool call results via `chat:tool_call` WebSocket messages and renders them as collapsible inline blocks in chat conversations
  - Refactor Discord manager to import shared utilities from `@herdctl/chat` instead of using private methods

### Patch Changes

- Updated dependencies [[`12b26af`](https://github.com/edspencer/herdctl/commit/12b26af9dc0b7f39dd38c35cb230ca596725731e)]:
  - @herdctl/chat@0.3.0
  - @herdctl/core@5.4.0

## 1.1.4

### Patch Changes

- [#86](https://github.com/edspencer/herdctl/pull/86) [`0f74b63`](https://github.com/edspencer/herdctl/commit/0f74b63d3943ef8f3428e3ec222b2dac461e50eb) Thanks [@edspencer](https://github.com/edspencer)! - Add fleet composition support. Fleets can now reference sub-fleets via the `fleets` YAML field, enabling "super-fleets" that combine multiple project fleets into a unified system.

  Key features:

  - Recursive fleet loading with cycle detection
  - Agents receive qualified names (e.g., `herdctl.security-auditor`) based on fleet hierarchy
  - Defaults merge across fleet levels with clear priority order
  - Web dashboard groups agents by fleet in the sidebar
  - CLI commands accept qualified names for sub-fleet agents
  - Sub-fleet web configurations are automatically suppressed (single dashboard at root)
  - Chat connectors (Discord, Slack) work with qualified agent names

- Updated dependencies [[`0f74b63`](https://github.com/edspencer/herdctl/commit/0f74b63d3943ef8f3428e3ec222b2dac461e50eb)]:
  - @herdctl/core@5.3.0
  - @herdctl/chat@0.2.5

## 1.1.3

### Patch Changes

- Updated dependencies [[`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa)]:
  - @herdctl/core@5.2.2
  - @herdctl/chat@0.2.4

## 1.1.2

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1
  - @herdctl/chat@0.2.3

## 1.1.1

### Patch Changes

- [#72](https://github.com/edspencer/herdctl/pull/72) [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea) Thanks [@edspencer](https://github.com/edspencer)! - Pass triggerType to job triggers so jobs are correctly tagged with their source (discord/slack)

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/core@5.2.0
  - @herdctl/chat@0.2.2

## 1.1.0

### Minor Changes

- [#69](https://github.com/edspencer/herdctl/pull/69) [`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add Slack DM support with enabled/allowlist/blocklist (matching Discord).

  - Rename `DiscordDMSchema` to `ChatDMSchema` (shared between platforms)
  - Add `dm` field to `AgentChatSlackSchema` for DM configuration
  - Implement DM detection and filtering in `SlackConnector` (channel IDs starting with `D`)
  - Add `isDM` flag to `SlackMessageEvent` metadata
  - Add `dm_disabled` and `dm_filtered` message ignored reasons

### Patch Changes

- Updated dependencies [[`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb)]:
  - @herdctl/core@5.1.0
  - @herdctl/chat@0.2.1

## 1.0.0

### Major Changes

- [#67](https://github.com/edspencer/herdctl/pull/67) [`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7) Thanks [@edspencer](https://github.com/edspencer)! - Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

  - New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
  - `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
  - `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
  - `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
  - `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
  - FleetManager dynamically imports platform packages at runtime

### Patch Changes

- Updated dependencies [[`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7)]:
  - @herdctl/chat@0.2.0
  - @herdctl/core@5.0.0

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
