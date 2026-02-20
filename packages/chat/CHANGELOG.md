# @herdctl/chat

## 0.3.1

### Patch Changes

- [#97](https://github.com/edspencer/herdctl/pull/97) [`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4) Thanks [@edspencer](https://github.com/edspencer)! - Add Biome for linting and formatting across all packages

- Updated dependencies [[`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4)]:
  - @herdctl/core@5.4.1

## 0.3.0

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
  - @herdctl/core@5.4.0

## 0.2.5

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

## 0.2.4

### Patch Changes

- Updated dependencies [[`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa)]:
  - @herdctl/core@5.2.2

## 0.2.3

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/core@5.2.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb)]:
  - @herdctl/core@5.1.0

## 0.2.0

### Minor Changes

- [#67](https://github.com/edspencer/herdctl/pull/67) [`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7) Thanks [@edspencer](https://github.com/edspencer)! - Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

  - New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
  - `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
  - `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
  - `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
  - `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
  - FleetManager dynamically imports platform packages at runtime

### Patch Changes

- Updated dependencies [[`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7)]:
  - @herdctl/core@5.0.0
