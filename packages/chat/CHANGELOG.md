# @herdctl/chat

## 0.4.0

### Minor Changes

- [#256](https://github.com/edspencer/herdctl/pull/256) [`7956804`](https://github.com/edspencer/herdctl/commit/795680412b48dadd4ba25ed0355f33fa12d37e9f) Thanks [@edspencer](https://github.com/edspencer)! - Add programmatic agent management, convenience session access, and a reusable SDK message translator.

  Motivated by apps built on top of herdctl (e.g. paddock) that manage agents in
  memory rather than on disk.

  **`@herdctl/core` — `FleetManager`:**

  - `addAgent(agent, options?)` / `removeAgent(name)` register and unregister an
    agent at runtime without hand-writing YAML and calling `reload()`. The agent
    config is validated, merged with fleet `defaults`, normalized (relative
    `working_directory` resolved to an absolute path), wired into the scheduler,
    and surfaced in fleet status — so it is immediately triggerable. A
    `config:reloaded` event is emitted describing the change. `addAgent` supports
    `{ baseDir, mergeDefaults, replace }`.
  - `getAgentSessions(name, options?)` and `getAgentSessionMessages(name,
sessionId)` derive the agent's working directory and Docker mode from the
    loaded config and wrap `SessionDiscoveryService`, so consumers no longer map
    agent slug → working directory by hand.
  - `deleteSession(name, sessionId)` resolves the agent's working dir + Docker
    mode from config, computes the CLI (or Docker) transcript file with the same
    encoder Claude Code uses, deletes it, invalidates the session-discovery cache,
    and returns whether a file was removed. The `sessionId` is validated (only
    `[A-Za-z0-9-]`) to reject path traversal before any filesystem access. Throws
    `InvalidStateError` before init and `AgentNotFoundError` for unknown agents,
    matching the other session helpers.
  - `setSessionName(name, sessionId, customName)` sets (or, when passed `null` or
    an empty/whitespace string, clears) a session's custom display name via the
    fleet's shared `SessionMetadataStore` — the same store session discovery reads
    — so a subsequent `getAgentSessions` reflects the new `customName` immediately.
    Same init / agent-not-found error behavior as the other session helpers.

  **`@herdctl/core` — new public exports:**

  - `getCliSessionFile`, `getCliSessionDir`, `encodePathForCli` (and the Docker
    equivalents `getDockerSessionFile` / `getDockerSessionDir`) are now exported
    from the package root, so consumers can compute a session's transcript path
    without deep-importing `dist/runner/runtime/cli-session-path.js`.
  - `SessionMetadataStore` is exported from the package root (it was already
    re-exported from the state module; this keeps the surface explicit for
    callers managing custom session names directly).
  - `SessionDiscoveryService` accepts an optional shared `sessionMetadataStore`
    (and exposes `getSessionMetadataStore()`) so writers and the discovery reader
    can share one in-memory cache. Omitting it preserves the previous behavior.

  **`@herdctl/core` — fixes:**

  - **Throw the documented `InvalidStateError` (not `AgentNotFoundError`) when
    `getAgentSessions` / `getAgentSessionMessages` are called before
    `initialize()`.** The session helpers previously fell through to an agent
    lookup against a null config, masking the real cause. They now guard on
    initialization state first, matching their JSDoc.
  - **Use a typed error for an invalid per-trigger `workingDirectory` override.**
    The override validation now throws `InvalidWorkingDirectoryOverrideError`
    (extending `FleetManagerError`, code `INVALID_WORKING_DIRECTORY_OVERRIDE`)
    instead of a raw `Error`, per the repo's typed-error guideline. The actionable
    message is unchanged.

  - **Fix CLI session discovery for working directories with dots (and other
    non-alphanumerics).** `encodePathForCli` now matches Claude Code's actual
    cwd → transcript-directory encoding: it replaces every non-`[A-Za-z0-9]`
    character (path separators, `.`, `_`, `@`, etc.) with a hyphen, and applies
    Claude Code's 200-char truncate-and-hash fallback. Previously only path
    separators were replaced, so an agent whose `working_directory` contained a
    `.` resolved to the wrong `~/.claude/projects/<encoded>` directory and
    session discovery silently returned nothing.
  - **Add a per-trigger working-directory override.** `TriggerOptions` gains an
    optional `workingDirectory` so a single agent can be triggered against
    different directories per call (e.g. one "sweeper" agent run across many
    project directories) instead of registering one agent per directory. When
    omitted, behavior is unchanged. The override flows into the process cwd / SDK
    `cwd` / Docker workspace mount, and session/transcript resolution for the job
    uses the effective (overridden) working directory. Absolute paths are used
    as-is; relative paths resolve against `process.cwd()`. Sessions remain keyed
    by cwd, so agent-level `getAgentSessions` (which uses the _configured_
    `working_directory`) won't surface sessions created under a different
    override directory — callers list those by scanning the override directory.

  **`@herdctl/chat` — SDK message translation:**

  - `SDKMessageTranslator` and the `createSDKMessageHandler` factory provide a
    transport-agnostic translation of the `SDKMessage` stream from
    `trigger({ onMessage })` into chat-UI events: assistant text deltas,
    boundaries between assistant turns, and paired tool calls (a `tool_use`
    matched to its `tool_result`, enriched with an input summary and wall-clock
    duration). This extracts logic previously reimplemented per connector.

  All additions are backward compatible; no existing behavior changes.

### Patch Changes

- Updated dependencies [[`7956804`](https://github.com/edspencer/herdctl/commit/795680412b48dadd4ba25ed0355f33fa12d37e9f)]:
  - @herdctl/core@5.11.0

## 0.3.14

### Patch Changes

- Updated dependencies [[`31c675c`](https://github.com/edspencer/herdctl/commit/31c675cbd3cc73c039abe083aa8314dee266acf9)]:
  - @herdctl/core@5.10.1

## 0.3.13

### Patch Changes

- Updated dependencies [[`3f947a0`](https://github.com/edspencer/herdctl/commit/3f947a01ed797170c88064cc7e60ec0d9741f74a), [`3f947a0`](https://github.com/edspencer/herdctl/commit/3f947a01ed797170c88064cc7e60ec0d9741f74a)]:
  - @herdctl/core@5.10.0

## 0.3.12

### Patch Changes

- Updated dependencies [[`62a938d`](https://github.com/edspencer/herdctl/commit/62a938d2177433d8a2b2b6b404a62f1775171c20), [`7a75d61`](https://github.com/edspencer/herdctl/commit/7a75d617c7dfd515409e3cf41cf3da92176c7f45), [`6e8d143`](https://github.com/edspencer/herdctl/commit/6e8d1438569fff390d44a1dbf79d178d6dca8266)]:
  - @herdctl/core@5.9.0

## 0.3.11

### Patch Changes

- Updated dependencies [[`ccdda22`](https://github.com/edspencer/herdctl/commit/ccdda2234e22c0275c8d3b27b991eb9a68ee53c8)]:
  - @herdctl/core@5.8.3

## 0.3.10

### Patch Changes

- Updated dependencies [[`fea713e`](https://github.com/edspencer/herdctl/commit/fea713e8cfaa86ccf6c849a66928dcf2063f6da2)]:
  - @herdctl/core@5.8.2

## 0.3.9

### Patch Changes

- Updated dependencies [[`8f06594`](https://github.com/edspencer/herdctl/commit/8f0659459a58d22ef221638589fb7d23c6579a71)]:
  - @herdctl/core@5.8.1

## 0.3.8

### Patch Changes

- Updated dependencies [[`487893e`](https://github.com/edspencer/herdctl/commit/487893e512acc56e7de2caf9b44eab5f20f5df64)]:
  - @herdctl/core@5.8.0

## 0.3.7

### Patch Changes

- Updated dependencies [[`e7933a5`](https://github.com/edspencer/herdctl/commit/e7933a5a8b63df1805b6d965edbb6b0526a57801)]:
  - @herdctl/core@5.7.1

## 0.3.6

### Patch Changes

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Move tool-parsing utilities from @herdctl/chat to @herdctl/core for reuse by new session discovery modules. @herdctl/chat re-exports all symbols for backwards compatibility.

- Updated dependencies [[`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9), [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9)]:
  - @herdctl/core@5.7.0

## 0.3.5

### Patch Changes

- Updated dependencies [[`bd59195`](https://github.com/edspencer/herdctl/commit/bd591953046462c8055a72b3df21f1e880a62607)]:
  - @herdctl/core@5.6.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`a0e7ad8`](https://github.com/edspencer/herdctl/commit/a0e7ad8cc8c4aa9a8da46bd0b5ff933e56c5158c), [`d52fa37`](https://github.com/edspencer/herdctl/commit/d52fa37f98df825c75f3d0ba29abbe5b838d2c6e)]:
  - @herdctl/core@5.5.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`63dc4db`](https://github.com/edspencer/herdctl/commit/63dc4dbc87db064cac20abc1b6ea39b778b92847), [`979dbf6`](https://github.com/edspencer/herdctl/commit/979dbf68510c237f3ba8ceb24b30f9830f6c3e7b)]:
  - @herdctl/core@5.4.3

## 0.3.2

### Patch Changes

- Updated dependencies [[`4d1e4d8`](https://github.com/edspencer/herdctl/commit/4d1e4d8925d04a75f92a64360408d9fead9d3730)]:
  - @herdctl/core@5.4.2

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
