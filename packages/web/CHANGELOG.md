# @herdctl/web

## 0.3.1

### Patch Changes

- [#93](https://github.com/edspencer/herdctl/pull/93) [`e2dac90`](https://github.com/edspencer/herdctl/commit/e2dac903a90966011957adbda0ee029cbfc9d8ac) Thanks [@edspencer](https://github.com/edspencer)! - Improve sidebar fleet hierarchy visual clarity with divider lines between fleet groups, left border accent on expanded content, and removal of status indicator dots from fleet headers and agent rows

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
  - @herdctl/chat@0.3.0
  - @herdctl/core@5.4.0

## 0.2.0

### Minor Changes

- [#86](https://github.com/edspencer/herdctl/pull/86) [`0f74b63`](https://github.com/edspencer/herdctl/commit/0f74b63d3943ef8f3428e3ec222b2dac461e50eb) Thanks [@edspencer](https://github.com/edspencer)! - Add fleet composition support. Fleets can now reference sub-fleets via the `fleets` YAML field, enabling "super-fleets" that combine multiple project fleets into a unified system.

  Key features:

  - Recursive fleet loading with cycle detection
  - Agents receive qualified names (e.g., `herdctl.security-auditor`) based on fleet hierarchy
  - Defaults merge across fleet levels with clear priority order
  - Web dashboard groups agents by fleet in the sidebar
  - CLI commands accept qualified names for sub-fleet agents
  - Sub-fleet web configurations are automatically suppressed (single dashboard at root)
  - Chat connectors (Discord, Slack) work with qualified agent names

### Patch Changes

- Updated dependencies [[`0f74b63`](https://github.com/edspencer/herdctl/commit/0f74b63d3943ef8f3428e3ec222b2dac461e50eb)]:
  - @herdctl/core@5.3.0
  - @herdctl/chat@0.2.5

## 0.1.4

### Patch Changes

- [#83](https://github.com/edspencer/herdctl/pull/83) [`c433165`](https://github.com/edspencer/herdctl/commit/c4331652ab7e2ffbf00ec496ed9ac46308fbb7cd) Thanks [@edspencer](https://github.com/edspencer)! - Remove duplicate inner sidebar from chat page, move chat title and session ID to top-level header bar, and make the global sidebar new-chat button blue

- [#81](https://github.com/edspencer/herdctl/pull/81) [`7b78a4e`](https://github.com/edspencer/herdctl/commit/7b78a4e8008baf3536a0d13ac57342df3411bb45) Thanks [@edspencer](https://github.com/edspencer)! - Fix sidebar chat list not updating when creating or deleting chat sessions

- [#85](https://github.com/edspencer/herdctl/pull/85) [`9d3e2a1`](https://github.com/edspencer/herdctl/commit/9d3e2a1c2757a504c8dcd693aeba8e2a9650609d) Thanks [@edspencer](https://github.com/edspencer)! - Increase font size, padding, and spacing of chat session items in the global sidebar so they are easier to read and click

## 0.1.3

### Patch Changes

- [#79](https://github.com/edspencer/herdctl/pull/79) [`58edb6a`](https://github.com/edspencer/herdctl/commit/58edb6abf88231104757e83ebd6cdf250ba241bd) Thanks [@edspencer](https://github.com/edspencer)! - Colorize Discord, Slack, and web connector log messages with platform brand colors

## 0.1.2

### Patch Changes

- Updated dependencies [[`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa)]:
  - @herdctl/core@5.2.2
  - @herdctl/chat@0.2.4

## 0.1.1

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1
  - @herdctl/chat@0.2.3

## 0.1.0

### Minor Changes

- [#72](https://github.com/edspencer/herdctl/pull/72) [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea) Thanks [@edspencer](https://github.com/edspencer)! - feat(web): Add web dashboard with real-time fleet monitoring, agent chat, schedule management, and job control

  - Fleet dashboard with real-time status updates via WebSocket
  - Agent detail pages with live output streaming and DiceBear avatars
  - Interactive chat with agents using @herdctl/chat
  - Sidebar with agent sections and nested recent chat sessions
  - Schedule overview with trigger, enable, and disable actions
  - Job management with cancel, fork, and CLI command copying
  - Dark/light/system theme toggle in header
  - CLI integration: `--web` and `--web-port` flags on `herdctl start`
  - Error boundaries, loading states, toast notifications
  - Responsive layout with collapsible sidebar

### Patch Changes

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/core@5.2.0
  - @herdctl/chat@0.2.2
