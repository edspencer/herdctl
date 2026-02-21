# @herdctl/discord

## 1.0.9

### Patch Changes

- Updated dependencies [[`63dc4db`](https://github.com/edspencer/herdctl/commit/63dc4dbc87db064cac20abc1b6ea39b778b92847), [`979dbf6`](https://github.com/edspencer/herdctl/commit/979dbf68510c237f3ba8ceb24b30f9830f6c3e7b)]:
  - @herdctl/core@5.4.3
  - @herdctl/chat@0.3.3

## 1.0.8

### Patch Changes

- Updated dependencies [[`4d1e4d8`](https://github.com/edspencer/herdctl/commit/4d1e4d8925d04a75f92a64360408d9fead9d3730)]:
  - @herdctl/core@5.4.2
  - @herdctl/chat@0.3.2

## 1.0.7

### Patch Changes

- [#97](https://github.com/edspencer/herdctl/pull/97) [`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4) Thanks [@edspencer](https://github.com/edspencer)! - Add Biome for linting and formatting across all packages

- Updated dependencies [[`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4)]:
  - @herdctl/core@5.4.1
  - @herdctl/chat@0.3.1

## 1.0.6

### Patch Changes

- [#90](https://github.com/edspencer/herdctl/pull/90) [`12b26af`](https://github.com/edspencer/herdctl/commit/12b26af9dc0b7f39dd38c35cb230ca596725731e) Thanks [@edspencer](https://github.com/edspencer)! - Add tool call/result visibility to Web and Slack connectors

  - Extract shared tool parsing utilities (`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`, `TOOL_EMOJIS`) from Discord manager into `@herdctl/chat` for reuse across all connectors
  - Add shared `ChatOutputSchema` to `@herdctl/core` config with `tool_results`, `tool_result_max_length`, `system_status`, and `errors` fields; Discord's `DiscordOutputSchema` now extends it
  - Add `output` config field to `AgentChatSlackSchema` for Slack connector output settings
  - Add `tool_results` boolean to fleet-level `WebSchema` for dashboard-wide tool result visibility
  - Slack connector now displays tool call results (name, input summary, duration, output) when `output.tool_results` is enabled (default: true)
  - Web dashboard now streams tool call results via `chat:tool_call` WebSocket messages and renders them as collapsible inline blocks in chat conversations
  - Refactor Discord manager to import shared utilities from `@herdctl/chat` instead of using private methods

- Updated dependencies [[`12b26af`](https://github.com/edspencer/herdctl/commit/12b26af9dc0b7f39dd38c35cb230ca596725731e)]:
  - @herdctl/chat@0.3.0
  - @herdctl/core@5.4.0

## 1.0.5

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

## 1.0.4

### Patch Changes

- Updated dependencies [[`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa)]:
  - @herdctl/core@5.2.2
  - @herdctl/chat@0.2.4

## 1.0.3

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1
  - @herdctl/chat@0.2.3

## 1.0.2

### Patch Changes

- [#72](https://github.com/edspencer/herdctl/pull/72) [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea) Thanks [@edspencer](https://github.com/edspencer)! - Pass triggerType to job triggers so jobs are correctly tagged with their source (discord/slack)

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/core@5.2.0
  - @herdctl/chat@0.2.2

## 1.0.1

### Patch Changes

- [#69](https://github.com/edspencer/herdctl/pull/69) [`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add Slack DM support with enabled/allowlist/blocklist (matching Discord).

  - Rename `DiscordDMSchema` to `ChatDMSchema` (shared between platforms)
  - Add `dm` field to `AgentChatSlackSchema` for DM configuration
  - Implement DM detection and filtering in `SlackConnector` (channel IDs starting with `D`)
  - Add `isDM` flag to `SlackMessageEvent` metadata
  - Add `dm_disabled` and `dm_filtered` message ignored reasons

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

## 0.2.3

### Patch Changes

- Updated dependencies [[`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb)]:
  - @herdctl/core@4.2.0

## 0.2.2

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

## 0.2.1

### Patch Changes

- Updated dependencies [[`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1), [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9), [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1)]:
  - @herdctl/core@4.1.0

## 0.2.0

### Minor Changes

- [#48](https://github.com/edspencer/herdctl/pull/48) [`f4af511`](https://github.com/edspencer/herdctl/commit/f4af511158f02e5f07d6e1c346a6b31bcdcba9b0) Thanks [@edspencer](https://github.com/edspencer)! - Show tool results, system status, errors, and result summaries as Discord embeds

  Previously, when Claude used tools like Bash during a Discord conversation, only text responses were shown - tool outputs were silently dropped. Now tool results appear as compact Discord embeds with:

  - Tool name and emoji (Bash, Read, Write, Edit, Grep, Glob, WebSearch, etc.)
  - Input summary (the command, file path, or search pattern)
  - Duration of the tool call
  - Output length and truncated result in a code block
  - Color coding: blurple for success, red for errors

  Additional SDK message types are now surfaced in Discord:

  - System status messages (e.g., "Compacting context...") shown as gray embeds
  - SDK error messages shown as red error embeds
  - Optional result summary embed with duration, turns, cost, and token usage

  All output types are configurable via the new `output` block in agent Discord config:

  ```yaml
  chat:
    discord:
      output:
        tool_results: true # Show tool result embeds (default: true)
        tool_result_max_length: 900 # Max chars in output (default: 900, max: 1000)
        system_status: true # Show system status embeds (default: true)
        result_summary: false # Show completion summary (default: false)
        errors: true # Show error embeds (default: true)
  ```

  The reply function now accepts both plain text and embed payloads, allowing rich message formatting alongside streamed text responses.

### Patch Changes

- Updated dependencies [[`f4af511`](https://github.com/edspencer/herdctl/commit/f4af511158f02e5f07d6e1c346a6b31bcdcba9b0)]:
  - @herdctl/core@4.0.0

## 0.1.10

### Patch Changes

- Updated dependencies [[`3ff726f`](https://github.com/edspencer/herdctl/commit/3ff726fbe192109d89847b4c0c47b255d1ac82cd)]:
  - @herdctl/core@3.0.2

## 0.1.9

### Patch Changes

- Updated dependencies [[`5cdfe8e`](https://github.com/edspencer/herdctl/commit/5cdfe8ec44dec4d27c78dd0107f14bb1d8b62f29)]:
  - @herdctl/core@3.0.1

## 0.1.8

### Patch Changes

- Updated dependencies [[`1f0dc9e`](https://github.com/edspencer/herdctl/commit/1f0dc9e655e69bd46d0f7b2e2dece70ce8451459)]:
  - @herdctl/core@3.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`39b1937`](https://github.com/edspencer/herdctl/commit/39b193776e67d5a5d412174d24a560df16c0d46c)]:
  - @herdctl/core@2.1.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356), [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356), [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356)]:
  - @herdctl/core@2.0.1

## 0.1.5

### Patch Changes

- Updated dependencies [[`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d)]:
  - @herdctl/core@2.0.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`3816d08`](https://github.com/edspencer/herdctl/commit/3816d08b5a9f2b2c6bccbd55332c8cec0da0c7a6)]:
  - @herdctl/core@1.3.1

## 0.1.3

### Patch Changes

- Updated dependencies [[`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb), [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb)]:
  - @herdctl/core@1.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`5d6d948`](https://github.com/edspencer/herdctl/commit/5d6d9487c67c4178b5806c1f234bfebfa28a7ac3)]:
  - @herdctl/core@1.2.0

## 0.1.1

### Patch Changes

- [#12](https://github.com/edspencer/herdctl/pull/12) [`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for npm package pages

  Each package now has a README that appears on npmjs.com with:

  - Package overview and purpose
  - Installation instructions
  - Quick start examples
  - Links to full documentation at herdctl.dev
  - Related packages

- Updated dependencies [[`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b), [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b), [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b)]:
  - @herdctl/core@1.1.0

## 0.1.0

### Minor Changes

- [#10](https://github.com/edspencer/herdctl/pull/10) [`e33ddee`](https://github.com/edspencer/herdctl/commit/e33ddee788daaefa35c242ce1c7673d7883a2be5) Thanks [@edspencer](https://github.com/edspencer)! - Add Claude Agent SDK session resumption for Discord conversation continuity

  - Add `resume` option to `TriggerOptions` to pass session ID for conversation continuity
  - Add `sessionId` and `success` to `TriggerResult` to return job result and SDK session ID
  - Update `JobControl.trigger()` to pass `resume` through and return `success` status
  - Add `setSession()` method to Discord SessionManager for storing SDK session IDs
  - Update `DiscordManager.handleMessage()` to:
    - Get existing session ID before triggering (via `getSession()`)
    - Pass session ID as `resume` option to `trigger()`
    - Only store SDK session ID after **successful** job completion (prevents invalid session accumulation)

  This enables conversation continuity in Discord DMs and channels - Claude will remember
  the context from previous messages in the conversation. Session IDs from failed jobs
  are not stored, preventing the accumulation of invalid session references.

### Patch Changes

- Updated dependencies [[`e33ddee`](https://github.com/edspencer/herdctl/commit/e33ddee788daaefa35c242ce1c7673d7883a2be5)]:
  - @herdctl/core@1.0.0

## 0.0.4

### Patch Changes

- [#8](https://github.com/edspencer/herdctl/pull/8) [`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41) Thanks [@edspencer](https://github.com/edspencer)! - Fix session lifecycle issues discovered during FleetManager integration

  - Clean up expired sessions automatically on bot startup
  - Session cleanup failures logged but don't prevent connection
  - Improved session persistence reliability across restarts

- Updated dependencies [[`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41)]:
  - @herdctl/core@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49)]:
  - @herdctl/core@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [[`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe), [`6eca6b3`](https://github.com/edspencer/herdctl/commit/6eca6b33458f99b2edc43e42a78d88984964b5d8)]:
  - @herdctl/core@0.1.0
