# @herdctl/core

## 5.2.0

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

## 5.1.0

### Minor Changes

- [#69](https://github.com/edspencer/herdctl/pull/69) [`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add Slack DM support with enabled/allowlist/blocklist (matching Discord).

  - Rename `DiscordDMSchema` to `ChatDMSchema` (shared between platforms)
  - Add `dm` field to `AgentChatSlackSchema` for DM configuration
  - Implement DM detection and filtering in `SlackConnector` (channel IDs starting with `D`)
  - Add `isDM` flag to `SlackMessageEvent` metadata
  - Add `dm_disabled` and `dm_filtered` message ignored reasons

## 5.0.0

### Major Changes

- [#67](https://github.com/edspencer/herdctl/pull/67) [`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7) Thanks [@edspencer](https://github.com/edspencer)! - Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

  - New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
  - `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
  - `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
  - `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
  - `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
  - FleetManager dynamically imports platform packages at runtime

## 4.2.0

### Minor Changes

- [#61](https://github.com/edspencer/herdctl/pull/61) [`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb) Thanks [@edspencer](https://github.com/edspencer)! - feat(slack): align SlackConnector to per-agent model matching Discord

  Restructured the Slack integration from a single shared connector with channel-agent routing to one connector per agent, matching Discord's per-agent architecture.

  - SlackConnector now takes per-agent options (agentName, channels, sessionManager)
  - SlackManager creates Map<string, ISlackConnector> instead of single connector
  - Event payloads (ready, disconnect, error) now include agentName
  - Added getConnectorNames() and getConnectedCount() to SlackManager
  - Removed getChannelAgentMap() from SlackManager

## 4.1.1

### Patch Changes

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Add verbose logging control and colorized output

  - Add `--verbose` / `-v` flag to `herdctl start` to enable debug logging
  - Add `HERDCTL_LOG_LEVEL` environment variable support (debug/info/warn/error)
  - Add colorized log output in `herdctl start` matching the style of `herdctl logs`
  - Refactor CLIRuntime and CLISessionWatcher to use centralized logger
  - Convert Discord and Slack connector loggers to use centralized `createLogger` from core
  - Internal debug logs are now hidden by default, reducing noise significantly
  - Extract shared color utilities for consistent formatting across CLI commands

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Downgrade verbose startup log messages from info to debug level in FleetManager, DiscordManager, and SlackManager. Only important milestones ("Fleet manager initialized successfully", "Fleet manager started", "Fleet manager stopped") remain at info level. Detailed step-by-step initialization messages are now debug-level, visible only with --verbose or HERDCTL_LOG_LEVEL=debug.

## 4.1.0

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

## 4.0.0

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
  - @herdctl/discord@0.2.0

## 3.0.2

### Patch Changes

- [#44](https://github.com/edspencer/herdctl/pull/44) [`3ff726f`](https://github.com/edspencer/herdctl/commit/3ff726fbe192109d89847b4c0c47b255d1ac82cd) Thanks [@edspencer](https://github.com/edspencer)! - Fix cron schedules never firing after first trigger

  The scheduler's cron check logic incorrectly skipped to the next future occurrence
  when the scheduled time arrived, instead of recognizing it as due. This caused cron
  schedules to never trigger after the initial run because `calculateNextCronTrigger(expression, now)`
  always returns a time in the future.

  The fix simplifies the logic to use `calculateNextCronTrigger(expression, lastRunAt)` directly,
  letting `isScheduleDue()` determine if it's time to trigger. After triggering, `last_run_at`
  updates to the current time, naturally advancing the schedule to the next occurrence.

- Updated dependencies []:
  - @herdctl/discord@0.1.10

## 3.0.1

### Patch Changes

- [#40](https://github.com/edspencer/herdctl/pull/40) [`5cdfe8e`](https://github.com/edspencer/herdctl/commit/5cdfe8ec44dec4d27c78dd0107f14bb1d8b62f29) Thanks [@edspencer](https://github.com/edspencer)! - Add path traversal protection for agent names and state file paths

  Security improvements:

  - Add `buildSafeFilePath` utility that validates identifiers before constructing file paths
  - Add `PathTraversalError` class for clear error reporting when traversal is detected
  - Update session.ts and job-metadata.ts to use safe path construction
  - Add `AGENT_NAME_PATTERN` regex validation in schema.ts to reject invalid agent names at config parsing time
  - Defense-in-depth: validation at both schema level and file path construction

  This prevents attackers from using agent names like `../../../etc/passwd` to read or write files outside the intended state directories.

- Updated dependencies []:
  - @herdctl/discord@0.1.9

## 3.0.0

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

- Updated dependencies []:
  - @herdctl/discord@0.1.8

## 2.1.0

### Minor Changes

- [#36](https://github.com/edspencer/herdctl/pull/36) [`39b1937`](https://github.com/edspencer/herdctl/commit/39b193776e67d5a5d412174d24a560df16c0d46c) Thanks [@edspencer](https://github.com/edspencer)! - Expand Docker configuration with tiered security model and new options.

  ## Security: Tiered Docker Configuration

  Docker options are now split into two schemas based on security risk:

  **Agent-level config** (`herdctl-agent.yml`) - Safe options only:

  - `enabled`, `ephemeral`, `memory`, `cpu_shares`, `cpu_period`, `cpu_quota`
  - `max_containers`, `workspace_mode`, `tmpfs`, `pids_limit`, `labels`

  **Fleet-level config** (`herdctl.yml`) - All options including dangerous ones:

  - All agent-level options, plus:
  - `image`, `network`, `volumes`, `user`, `ports`, `env`
  - `host_config` - Raw dockerode HostConfig passthrough for advanced options

  This prevents agents from granting themselves dangerous capabilities (like `network: "host"` or mounting sensitive volumes) since agent config files live in the agent's working directory.

  ## New Options

  - `ports` - Port bindings in format "hostPort:containerPort" or "containerPort"
  - `tmpfs` - Tmpfs mounts for fast in-memory temp storage
  - `pids_limit` - Maximum number of processes (prevents fork bombs)
  - `labels` - Container labels for organization and filtering
  - `cpu_period` / `cpu_quota` - Hard CPU limits (more precise than cpu_shares)

  ## Fleet-level `host_config` Passthrough

  For advanced users who need dockerode options not in our schema:

  ```yaml
  defaults:
    docker:
      enabled: true
      memory: "2g"
      host_config: # Raw dockerode HostConfig
        ShmSize: 67108864
        Privileged: true # Use with caution!
  ```

  Values in `host_config` override any translated options.

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.7

## 2.0.1

### Patch Changes

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - fix(core): Docker CLI runtime session persistence

  Fixed session resumption for CLI runtime agents running in Docker containers.

  **The bug:** When resuming a session with Docker enabled, the CLI runtime was watching the wrong session file path (`~/.claude/projects/...`) instead of the Docker-mounted session directory (`.herdctl/docker-sessions/`). This caused the session watcher to yield 0 messages, resulting in fallback responses despite Claude correctly remembering conversation context.

  **The fix:**

  1. Updated `validateSessionWithFileCheck` to check Docker session files at `.herdctl/docker-sessions/` when `session.docker_enabled` is true
  2. Updated `CLIRuntime` to use `sessionDirOverride` when resuming sessions, not just when starting new ones

  This ensures both session validation and session file watching use the correct paths for Docker-based CLI runtime execution.

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - Fix job streaming events during schedule execution.

  Added `onJobCreated` callback to `RunnerOptionsWithCallbacks` so the job ID is available before execution starts. Previously, the job ID was only set after `executor.execute()` returned, which meant `job:output` streaming events couldn't be emitted during execution.

  Now the schedule executor receives the job ID via callback as soon as the job is created, enabling real-time streaming of job output events throughout execution.

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - Fix job summary extraction and improve Discord notification formatting.

  **Summary extraction fix:**
  Previously, the `extractSummary` function captured summaries from short assistant messages (≤500 characters), which meant if an agent sent a short preliminary message ("I'll fetch the weather...") followed by a long final response, the preliminary message would be used as the summary.

  Now the logic tracks the last non-partial assistant message content separately and uses it as the summary, ensuring Discord hooks receive the actual final response.

  **Truncation changes:**

  - Removed truncation from core summary extraction (job-executor, message-processor) - full content is now stored
  - Truncation is now handled solely by downstream consumers at their specific limits

  **Discord notification improvements:**

  - Moved output from embed field (1024 char limit) to embed description (4096 char limit)
  - This allows much longer agent responses to be displayed in Discord notifications
  - Metadata and error fields remain in their own fields with appropriate limits

  This ensures Discord hooks and other consumers receive the full final response from the agent, with each consumer handling truncation at their own appropriate limits.

- Updated dependencies []:
  - @herdctl/discord@0.1.6

## 2.0.0

### Major Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - **BREAKING CHANGE**: Rename `workspace` config field to `working_directory`

  The configuration field `workspace` has been renamed to `working_directory` throughout the codebase for better clarity. This affects:

  - Fleet config: `defaults.workspace` → `defaults.working_directory`
  - Agent config: `workspace` → `working_directory`
  - Fleet config: top-level `workspace` → `working_directory`

  **Backward compatibility**: The old `workspace` field is still supported with automatic migration and deprecation warnings. Configs using `workspace` will continue to work but will emit a warning encouraging migration to `working_directory`.

  **Migration**: Replace all occurrences of `workspace:` with `working_directory:` in your YAML config files.

### Minor Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add Docker container runtime support for agent execution

  Agents can now be executed inside Docker containers instead of directly on the host machine. This provides better isolation, environment control, and resource management.

  **New Configuration**:

  ```yaml
  docker:
    enabled: true
    image: "anthropics/claude-code:latest"
    workspaceMode: "rw" # or "ro" for read-only
    cpus: 2.0
    memory: "2g"
    network: "bridge"
    mounts:
      - hostPath: "/host/path"
        containerPath: "/container/path"
        mode: "rw"
    environment:
      KEY: "value"
  ```

  **Features**:

  - Container-based agent execution with full isolation
  - Ephemeral containers by default (clean state each execution)
  - Configurable resource limits (CPU, memory)
  - Volume mounting for workspace and custom paths
  - Environment variable injection (custom vars + CLAUDE_CODE_OAUTH_TOKEN)
  - Automatic git authentication when GITHUB_TOKEN is provided
  - Network configuration (bridge, host, none)
  - Automatic image pulling and container lifecycle management
  - Proper cleanup on both success and failure
  - Works with both SDK and CLI runtimes

  **Use Cases**:

  - Run agents in isolated environments
  - Control resource usage per agent
  - Ensure consistent execution environments
  - Enhanced security through containerization

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add runtime selection between SDK and CLI for agent execution

  Agents can now choose between two execution runtimes:

  - **SDK Runtime** (default): Uses Claude Agent SDK with standard Claude Code features
  - **CLI Runtime**: Uses `claude-p` CLI invocation to preserve Claude Max tokens

  **New Configuration**:

  ```yaml
  # Agent-level runtime selection
  runtime: sdk  # or "cli"

  # Or with CLI-specific options
  runtime:
    type: cli
    command: claude-p  # Custom CLI command (optional)
  ```

  **SDK Runtime** (Default):

  - Full Claude Agent SDK integration
  - All standard Claude Code features
  - Standard token consumption

  **CLI Runtime**:

  - Invokes `claude -p` directly (or custom Claude CLI fork)
  - Preserves Claude Max tokens instead of consuming API credits
  - Session file watching for message streaming
  - Works with both host and Docker execution

  **Full Configuration Pass-Through**:
  Both runtimes support the complete agent configuration:

  - `model` - Model selection (e.g., claude-sonnet-4-20250514)
  - `system_prompt` - Custom system prompts
  - `permission_mode` - Permission handling (acceptEdits, plan, etc.)
  - `permissions.allowed_tools` / `permissions.denied_tools` - Tool access control
  - `permissions.bash.allowed_commands` / `permissions.bash.denied_patterns` - Bash restrictions
  - `mcp_servers` - MCP server configuration
  - `setting_sources` - Setting source configuration

  **Use Cases**:

  - Preserve Claude Max tokens for long-running agents
  - Use custom Claude CLI forks with modified behavior
  - Switch between SDK and CLI without code changes
  - Test different runtime behaviors

  The runtime architecture is pluggable, making it easy to add additional runtime types in the future.

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add runtime context tracking to sessions

  Sessions now track the runtime configuration (SDK vs CLI, Docker vs native) they were created with. This prevents session resume errors when switching between runtime modes.

  **Session Schema Updates**:

  - Added `runtime_type` field (defaults to "sdk" for legacy sessions)
  - Added `docker_enabled` field (defaults to false for legacy sessions)

  **Validation**:

  - Sessions are automatically invalidated when runtime context changes
  - Prevents "conversation not found" errors when switching Docker mode
  - Clear error messages explain why sessions were cleared

  **Migration**:

  - Legacy sessions automatically get default values via Zod schema
  - No manual migration needed - sessions self-heal on first use
  - Context mismatches trigger automatic session cleanup

  This ensures sessions remain valid only for the runtime configuration they were created with, preventing confusion when enabling/disabling Docker or switching between SDK and CLI runtimes.

### Patch Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Fix Discord typing indicator to stop immediately when messages are sent

  The typing indicator now stops as soon as the first message is sent, rather than continuing to show "typing..." while messages are being delivered. This provides a more natural chat experience.

  **Improvements**:

  - Stop typing immediately after SDK execution completes
  - Stop typing when the first streamed message is sent
  - Prevent multiple stopTyping calls with state tracking
  - Proper cleanup in finally block for error cases
  - Removed verbose debug logging for cleaner output

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Detect and clear stale sessions when working_directory changes

  Adds automatic detection of working directory changes between sessions. When the `working_directory` changes, Claude Code looks for the session file in a different project directory and fails with ENOENT errors.

  **Behavior**:

  - Session metadata now stores the `working_directory` path
  - On session resume, validates that `working_directory` hasn't changed
  - If changed, logs a warning with old → new paths
  - Automatically clears the stale session
  - Starts fresh session instead of attempting failed resume

  **Example Warning**:

  ```
  Working directory changed from /old/path to /new/path - clearing stale session abc123
  ```

  This prevents confusing "session file not found" errors when users change their agent's `working_directory` configuration.

- Updated dependencies []:
  - @herdctl/discord@0.1.5

## 1.3.1

### Patch Changes

- [#20](https://github.com/edspencer/herdctl/pull/20) [`3816d08`](https://github.com/edspencer/herdctl/commit/3816d08b5a9f2b2c6bccbd55332c8cec0da0c7a6) Thanks [@edspencer](https://github.com/edspencer)! - Fix system prompt not being passed to Claude SDK correctly. Custom system prompts were being ignored because we passed `{ type: 'custom', content: '...' }` but the SDK expects a plain string for custom prompts.

- Updated dependencies []:
  - @herdctl/discord@0.1.4

## 1.3.0

### Minor Changes

- [#17](https://github.com/edspencer/herdctl/pull/17) [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add .env file support for environment variable loading

  The config loader now automatically loads `.env` files from the config directory before interpolating environment variables. This makes it easier to manage environment-specific configuration without setting up shell environment variables.

  Features:

  - Automatically loads `.env` from the same directory as `herdctl.yaml`
  - System environment variables take precedence over `.env` values
  - New `envFile` option in `loadConfig()` to customize behavior:
    - `true` (default): Auto-load `.env` from config directory
    - `false`: Disable `.env` loading
    - `string`: Specify a custom path to the `.env` file

  Example `.env.example` file added to the discord-chat-bot example.

- [#17](https://github.com/edspencer/herdctl/pull/17) [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add per-agent config overrides when referencing agents in fleet config

  You can now override any agent configuration field when referencing an agent in your fleet's `herdctl.yaml`:

  ```yaml
  agents:
    - path: ./agents/my-agent.yaml
      overrides:
        schedules:
          check:
            interval: 2h # Override the default interval
        hooks:
          after_run: [] # Disable all hooks for this fleet
  ```

  Overrides are deep-merged after fleet defaults are applied, so you only need to specify the fields you want to change. Arrays are replaced entirely (not merged).

  This enables:

  - Reusing agent configs across fleets with different settings
  - Customizing schedules, hooks, permissions per-fleet
  - Disabling features (like Discord notifications) for specific fleets

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.3

## 1.2.0

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

- Updated dependencies []:
  - @herdctl/discord@0.1.2

## 1.1.0

### Minor Changes

- [#14](https://github.com/edspencer/herdctl/pull/14) [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b) Thanks [@edspencer](https://github.com/edspencer)! - Stream Discord messages incrementally instead of batching

  Previously, Discord chat would show "typing" for the entire duration of agent execution, then send all messages at once when complete. This could mean minutes of waiting with no feedback.

  Now messages are streamed incrementally to Discord as the agent generates them:

  - Messages sent at natural paragraph breaks (double newlines)
  - Rate limiting respected (1 second minimum between sends)
  - Large content automatically split at Discord's 2000 character limit
  - Typing indicator continues between message sends

  This provides a much more responsive chat experience, similar to how the CLI streams output.

### Patch Changes

- [#12](https://github.com/edspencer/herdctl/pull/12) [`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for npm package pages

  Each package now has a README that appears on npmjs.com with:

  - Package overview and purpose
  - Installation instructions
  - Quick start examples
  - Links to full documentation at herdctl.dev
  - Related packages

- [#14](https://github.com/edspencer/herdctl/pull/14) [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b) Thanks [@edspencer](https://github.com/edspencer)! - Fix project-embedded agents to fully inherit workspace configuration

  Three related changes for agents that point at existing Claude Code projects (the "Software Developer Agent" pattern):

  1. **Working directory**: The `workspace` configuration is now correctly passed to the Claude SDK as the `cwd` option, so agents run in their configured workspace directory instead of wherever herdctl was launched.

  2. **Settings discovery**: When `workspace` is configured, `settingSources` is now set to `["project"]` by default, enabling the agent to discover and use CLAUDE.md, skills, commands, and other Claude Code configuration from the workspace.

  3. **Explicit configuration**: Added `setting_sources` option to agent YAML for explicit control over settings discovery:
     ```yaml
     setting_sources:
       - project # Load from .claude/ in workspace
       - local # Load from user's local Claude config
     ```

  This enables herdctl agents to operate inside existing codebases with full access to project-specific Claude Code configuration - they behave as if you ran `claude` directly in that directory.

- Updated dependencies [[`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b)]:
  - @herdctl/discord@0.1.1

## 1.0.0

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
  - @herdctl/discord@0.1.0

## 0.3.0

### Minor Changes

- [#8](https://github.com/edspencer/herdctl/pull/8) [`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41) Thanks [@edspencer](https://github.com/edspencer)! - Add Discord chat integration via DiscordManager module

  - DiscordManager manages lifecycle of Discord connectors per agent
  - Messages routed to FleetManager.trigger() for Claude execution
  - Responses delivered back to Discord channels with automatic splitting
  - Session persistence across restarts via SessionManager
  - New events: discord:message:handled, discord:message:error, discord:error
  - New status queries: getDiscordStatus(), getDiscordConnectorStatus()

### Patch Changes

- Updated dependencies [[`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41)]:
  - @herdctl/discord@0.0.4

## 0.2.0

### Minor Changes

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add default_prompt agent config and getJobFinalOutput API

  - Add `default_prompt` field to agent config schema for sensible defaults when triggering without --prompt
  - Add `getJobFinalOutput(jobId)` method to FleetManager for retrieving agent's final response from JSONL
  - Pass `maxTurns` option through to Claude SDK to limit agent turns
  - Change SDK `settingSources` to empty by default - autonomous agents should not load Claude Code project settings (CLAUDE.md)
  - Log hook output to console for visibility when shell hooks produce output

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add DiscordHookRunner for Discord channel notifications

  - Implement DiscordHookRunner that posts job notifications to Discord channels
  - Uses Discord embeds with appropriate colors (green for success, red for failure, amber for timeout, gray for cancelled)
  - Bot token read from environment variable (configurable via bot_token_env)
  - Output truncated to max 1000 chars in embed
  - Supports filtering notifications by event type via on_events
  - Human-readable duration formatting (ms, seconds, minutes, hours)
  - Includes agent name, job ID, schedule, duration, and error details in embed

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add hooks metadata feature and fix SDK message streaming

  **Hooks Metadata:**

  - Add `when` field for conditional hook execution using dot-notation paths
  - Add `name` field for human-readable hook names in logs
  - Add `metadata_file` agent config for reading agent-provided metadata
  - Include agent metadata in HookContext for conditional execution
  - Display metadata in Discord embed notifications

  **SDK Message Streaming:**

  - Fix content extraction from nested SDK message structure
  - Add support for `stream_event`, `tool_progress`, `auth_status` message types
  - Add `onMessage` callback to `TriggerOptions` for real-time message streaming

  **Output Extraction:**

  - Fix `extractJobOutput` to prefer assistant text over raw tool results
  - Discord notifications now show agent's text summary instead of JSON

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add shell script hook execution after job completion

  - Implement ShellHookRunner that executes shell commands with HookContext JSON on stdin
  - Add HookExecutor to orchestrate hook execution with event filtering and error handling
  - Support `continue_on_error` option (default: true) to control whether hook failures affect job status
  - Support `on_events` filter to run hooks only for specific events (completed, failed, timeout, cancelled)
  - Default timeout of 30 seconds for shell commands
  - Integrate hooks into ScheduleExecutor to run after job completion
  - Add hook configuration schemas to agent config (`hooks.after_run`, `hooks.on_error`)
  - Full test coverage for ShellHookRunner and HookExecutor

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add WebhookHookRunner for POST/PUT webhook integrations

  - Implement WebhookHookRunner that POSTs HookContext JSON to configured URLs
  - Support custom headers with ${ENV_VAR} substitution for auth tokens
  - Support POST and PUT HTTP methods
  - Default timeout of 10000ms (configurable)
  - HTTP 2xx responses are treated as success, all others as failure
  - HTTP errors are logged but don't fail the job by default (continue_on_error: true)

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

- [#4](https://github.com/edspencer/herdctl/pull/4) [`6eca6b3`](https://github.com/edspencer/herdctl/commit/6eca6b33458f99b2edc43e42a78d88984964b5d8) Thanks [@edspencer](https://github.com/edspencer)! - Add strict schema validation to catch misconfigured agent YAML files

  Agent and fleet configs now reject unknown/misplaced fields instead of silently ignoring them. For example, putting `allowed_tools` at the root level (instead of under `permissions`) now produces a clear error:

  ```
  Agent configuration validation failed in 'agent.yaml':
    - (root): Unrecognized key(s) in object: 'allowed_tools'
  ```

## 0.0.2

### Patch Changes

- [`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844) Thanks [@edspencer](https://github.com/edspencer)! - Initial changesets setup for automated npm publishing
