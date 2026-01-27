# herdctl

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
