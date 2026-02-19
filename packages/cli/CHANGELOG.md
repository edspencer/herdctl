# herdctl

## 1.2.1

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

- Updated dependencies [[`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5)]:
  - @herdctl/core@5.2.1
  - @herdctl/discord@1.0.3
  - @herdctl/slack@1.1.2
  - @herdctl/web@0.1.1

## 1.2.0

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

- Updated dependencies [[`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea), [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea)]:
  - @herdctl/discord@1.0.2
  - @herdctl/slack@1.1.1
  - @herdctl/web@0.1.0
  - @herdctl/core@5.2.0

## 1.1.3

### Patch Changes

- Updated dependencies [[`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb)]:
  - @herdctl/core@5.1.0
  - @herdctl/slack@1.1.0
  - @herdctl/discord@1.0.1

## 1.1.2

### Patch Changes

- [#67](https://github.com/edspencer/herdctl/pull/67) [`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7) Thanks [@edspencer](https://github.com/edspencer)! - Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

  - New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
  - `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
  - `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
  - `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
  - `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
  - FleetManager dynamically imports platform packages at runtime

- Updated dependencies [[`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7)]:
  - @herdctl/core@5.0.0
  - @herdctl/discord@1.0.0
  - @herdctl/slack@1.0.0

## 1.1.1

### Patch Changes

- Updated dependencies [[`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb)]:
  - @herdctl/slack@0.3.0
  - @herdctl/core@4.2.0
  - @herdctl/discord@0.2.3

## 1.1.0

### Minor Changes

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Add verbose logging control and colorized output

  - Add `--verbose` / `-v` flag to `herdctl start` to enable debug logging
  - Add `HERDCTL_LOG_LEVEL` environment variable support (debug/info/warn/error)
  - Add colorized log output in `herdctl start` matching the style of `herdctl logs`
  - Refactor CLIRuntime and CLISessionWatcher to use centralized logger
  - Convert Discord and Slack connector loggers to use centralized `createLogger` from core
  - Internal debug logs are now hidden by default, reducing noise significantly
  - Extract shared color utilities for consistent formatting across CLI commands

### Patch Changes

- Updated dependencies [[`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d), [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d)]:
  - @herdctl/core@4.1.1
  - @herdctl/discord@0.2.2
  - @herdctl/slack@0.2.1

## 1.0.4

### Patch Changes

- [#51](https://github.com/edspencer/herdctl/pull/51) [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9) Thanks [@edspencer](https://github.com/edspencer)! - Fix symlink bypass in file-sender-mcp path validation, narrow Slack error classification, add missing event types, and correct help text

  - **Security**: Use `realpath()` before path containment check in file-sender-mcp to prevent symlink bypass
  - **Bug fix**: Narrow `classifyError()` token matching from broad `"token"` substring to specific Slack API error codes (`token_revoked`, `token_expired`, `not_authed`)
  - **Types**: Add typed `FleetManagerEventMap` entries for four Slack manager events (`slack:message:handled`, `slack:message:error`, `slack:error`, `slack:session:lifecycle`)
  - **Docs**: Fix help text to reflect channel-based sessions instead of thread-based
  - **Deps**: Add `@herdctl/slack` to CLI dependencies so `npx herdctl start` includes Slack support
  - **Build**: Configure changesets `onlyUpdatePeerDependentsWhenOutOfRange` to prevent unnecessary major version bumps on core when connector packages are updated

- Updated dependencies [[`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1), [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9), [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1), [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1)]:
  - @herdctl/core@4.1.0
  - @herdctl/slack@0.2.0
  - @herdctl/discord@0.2.1

## 1.0.3

### Patch Changes

- Updated dependencies [[`f4af511`](https://github.com/edspencer/herdctl/commit/f4af511158f02e5f07d6e1c346a6b31bcdcba9b0)]:
  - @herdctl/core@4.0.0
  - @herdctl/discord@0.2.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`3ff726f`](https://github.com/edspencer/herdctl/commit/3ff726fbe192109d89847b4c0c47b255d1ac82cd)]:
  - @herdctl/core@3.0.2
  - @herdctl/discord@0.1.10

## 1.0.1

### Patch Changes

- Updated dependencies [[`5cdfe8e`](https://github.com/edspencer/herdctl/commit/5cdfe8ec44dec4d27c78dd0107f14bb1d8b62f29)]:
  - @herdctl/core@3.0.1
  - @herdctl/discord@0.1.9

## 1.0.0

### Major Changes

- [#38](https://github.com/edspencer/herdctl/pull/38) [`1f0dc9e`](https://github.com/edspencer/herdctl/commit/1f0dc9e655e69bd46d0f7b2e2dece70ce8451459) Thanks [@edspencer](https://github.com/edspencer)! - BREAKING: Flatten permissions config to match Claude Agents SDK

  This is a breaking change that removes the nested `permissions` object in agent and fleet configuration. The old structure:

  ```yaml
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
    denied_tools:
      - WebSearch
    bash:
      allowed_commands:
        - git
        - npm
      denied_patterns:
        - "rm -rf *"
  ```

  Is now the flat SDK-compatible structure:

  ```yaml
  permission_mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - "Bash(git *)"
    - "Bash(npm *)"
  denied_tools:
    - WebSearch
    - "Bash(rm -rf *)"
  ```

  **Key changes:**

  - `permissions.mode` → `permission_mode` (top-level)
  - `permissions.allowed_tools` → `allowed_tools` (top-level)
  - `permissions.denied_tools` → `denied_tools` (top-level)
  - `permissions.bash.allowed_commands` → Use `Bash(cmd *)` patterns in `allowed_tools`
  - `permissions.bash.denied_patterns` → Use `Bash(pattern)` patterns in `denied_tools`

  **Why this change:**

  1. Direct 1:1 mapping to Claude Agents SDK options
  2. Familiar to anyone who knows Claude Code CLI or SDK
  3. No magic transformation or hidden behavior
  4. Simpler config parsing and validation

  **Migration:**

  Replace nested `permissions` object with flat fields. Transform bash convenience syntax into standard `Bash()` patterns.

### Patch Changes

- Updated dependencies [[`1f0dc9e`](https://github.com/edspencer/herdctl/commit/1f0dc9e655e69bd46d0f7b2e2dece70ce8451459)]:
  - @herdctl/core@3.0.0
  - @herdctl/discord@0.1.8

## 0.4.6

### Patch Changes

- Updated dependencies [[`39b1937`](https://github.com/edspencer/herdctl/commit/39b193776e67d5a5d412174d24a560df16c0d46c)]:
  - @herdctl/core@2.1.0
  - @herdctl/discord@0.1.7

## 0.4.5

### Patch Changes

- Updated dependencies [[`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356), [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356), [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356)]:
  - @herdctl/core@2.0.1
  - @herdctl/discord@0.1.6

## 0.4.4

### Patch Changes

- Updated dependencies [[`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d), [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d)]:
  - @herdctl/core@2.0.0
  - @herdctl/discord@0.1.5

## 0.4.3

### Patch Changes

- [#28](https://github.com/edspencer/herdctl/pull/28) [`93e209a`](https://github.com/edspencer/herdctl/commit/93e209a74aa248e54830e1aef7a4965b03f50216) Thanks [@edspencer](https://github.com/edspencer)! - Fix init templates using incorrect `workspace.path` key instead of `workspace: path` string format

- [#30](https://github.com/edspencer/herdctl/pull/30) [`6ae6ad2`](https://github.com/edspencer/herdctl/commit/6ae6ad24cddba84105e25eaeebeb7d0138c3dd5c) Thanks [@edspencer](https://github.com/edspencer)! - Remove default model from init templates - SDK uses its own sensible default

## 0.4.2

### Patch Changes

- [#20](https://github.com/edspencer/herdctl/pull/20) [`3816d08`](https://github.com/edspencer/herdctl/commit/3816d08b5a9f2b2c6bccbd55332c8cec0da0c7a6) Thanks [@edspencer](https://github.com/edspencer)! - Fix system prompt not being passed to Claude SDK correctly. Custom system prompts were being ignored because we passed `{ type: 'custom', content: '...' }` but the SDK expects a plain string for custom prompts.

- Updated dependencies [[`3816d08`](https://github.com/edspencer/herdctl/commit/3816d08b5a9f2b2c6bccbd55332c8cec0da0c7a6)]:
  - @herdctl/core@1.3.1
  - @herdctl/discord@0.1.4

## 0.4.1

### Patch Changes

- Updated dependencies [[`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb), [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb)]:
  - @herdctl/core@1.3.0
  - @herdctl/discord@0.1.3

## 0.4.0

### Minor Changes

- [#15](https://github.com/edspencer/herdctl/pull/15) [`5d6d948`](https://github.com/edspencer/herdctl/commit/5d6d9487c67c4178b5806c1f234bfebfa28a7ac3) Thanks [@edspencer](https://github.com/edspencer)! - Add `herdctl sessions` command to discover and resume Claude Code sessions

  When agents run with session persistence enabled, herdctl tracks Claude Code session IDs. This new command makes those sessions discoverable and resumable:

  ```bash
  # List all sessions
  herdctl sessions

  # Output:
  # Sessions (2)
  # ══════════════════════════════════════════════════════════════════════════════════════
  # AGENT               SESSION ID                               LAST ACTIVE   JOBS
  # ─────────────────────────────────────────────────────────────────────────────────────
  # bragdoc-developer   a166a1e4-c89e-41f8-80c8-d73f6cd0d39c     5m ago        19
  # price-checker       b234e5f6-a78b-49c0-d12e-3456789abcde     2h ago        3

  # Resume the most recent session
  herdctl sessions resume

  # Resume a specific session (supports partial ID match)
  herdctl sessions resume a166a1e4
  herdctl sessions resume bragdoc-developer  # or by agent name

  # Show full resume commands
  herdctl sessions --verbose

  # Filter by agent
  herdctl sessions --agent bragdoc-developer

  # JSON output for scripting
  herdctl sessions --json
  ```

  The `resume` command launches Claude Code with `--resume <session-id>` in the agent's configured workspace directory, making it easy to pick up where a Discord bot or scheduled agent left off.

  Also adds `listSessions()` function to `@herdctl/core` for programmatic access.

### Patch Changes

- Updated dependencies [[`5d6d948`](https://github.com/edspencer/herdctl/commit/5d6d9487c67c4178b5806c1f234bfebfa28a7ac3)]:
  - @herdctl/core@1.2.0
  - @herdctl/discord@0.1.2

## 0.3.2

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
  - @herdctl/discord@0.1.1

## 0.3.1

### Patch Changes

- Updated dependencies [[`e33ddee`](https://github.com/edspencer/herdctl/commit/e33ddee788daaefa35c242ce1c7673d7883a2be5)]:
  - @herdctl/core@1.0.0
  - @herdctl/discord@0.1.0

## 0.3.0

### Minor Changes

- [#8](https://github.com/edspencer/herdctl/pull/8) [`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41) Thanks [@edspencer](https://github.com/edspencer)! - Bundle @herdctl/discord with CLI for out-of-box Discord chat support

  - Installing `herdctl` now automatically includes Discord chat integration
  - No separate `npm install @herdctl/discord` needed for CLI users
  - Programmatic users of `@herdctl/core` can still optionally add Discord

### Patch Changes

- Updated dependencies [[`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41), [`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41)]:
  - @herdctl/core@0.3.0
  - @herdctl/discord@0.0.4

## 0.2.0

### Minor Changes

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add live streaming output to trigger command

  - Stream assistant messages in real-time during job execution
  - Display output as it's generated instead of waiting for completion
  - Add `--quiet` flag support for suppressing streaming output
  - Extract content from nested SDK message structure

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Display agent output by default after trigger

  - Trigger command now displays the agent's final output by default (no hook required)
  - Output truncated at 20,000 characters with count of remaining characters shown
  - Add `--quiet` / `-q` flag to suppress output display (just show job info)

### Patch Changes

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Fix: Read-only CLI commands (logs, jobs, job) no longer require full config validation

  Previously, running `herdctl logs --job <id>`, `herdctl jobs`, or `herdctl job <id>` would fail if the configuration had unset environment variables (e.g., `DISCORD_CHANNEL_ID`). This was unnecessary since these commands only read from the state directory and don't need the full agent configuration.

  Now these commands use `JobManager` directly, bypassing `FleetManager.initialize()` and its config validation. This means you can inspect job history and logs even when environment variables for hooks aren't set.

- Updated dependencies [[`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49), [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49)]:
  - @herdctl/core@0.2.0

## 0.1.0

### Minor Changes

- [`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe) Thanks [@edspencer](https://github.com/edspencer)! - Fix trigger command to actually execute jobs

  Previously, `herdctl trigger <agent>` would create a job metadata file but never
  actually run the agent. The job would stay in "pending" status forever.

  Now trigger() uses JobExecutor to:

  - Create the job record
  - Execute the agent via Claude SDK
  - Stream output to job log
  - Update job status on completion

  This is a minor version bump as it adds new behavior (job execution) rather than
  breaking existing APIs. The trigger() method signature is unchanged.

### Patch Changes

- Updated dependencies [[`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe), [`6eca6b3`](https://github.com/edspencer/herdctl/commit/6eca6b33458f99b2edc43e42a78d88984964b5d8)]:
  - @herdctl/core@0.1.0

## 0.0.2

### Patch Changes

- [`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844) Thanks [@edspencer](https://github.com/edspencer)! - Initial changesets setup for automated npm publishing

- Updated dependencies [[`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844)]:
  - @herdctl/core@0.0.2
