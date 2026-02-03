# @herdctl/core

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
