# @herdctl/core

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
