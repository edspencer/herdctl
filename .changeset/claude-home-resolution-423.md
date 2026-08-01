---
"@herdctl/core": minor
---

fix(core): resolve the Claude home consistently, and tell Claude Code about it (#423)

The Claude home -- the `.claude` directory holding
`projects/<encoded-cwd>/<session-id>.jsonl` transcripts -- was resolved in two
different ways by two halves of the same code path, and in a third way by Claude
Code itself. All three now agree.

**1. The listing path and the read path disagreed.** `SessionDiscoveryService`
already accepted an injectable `claudeHomePath` and scanned
`<claudeHome>/projects/` for transcripts, but `getCliSessionDir()` and
`getCliSessionFile()` hardcoded `path.join(os.homedir(), ".claude")`. So under a
non-default home, discovery *listed* sessions out of the configured home and then
*read* each one out of `~/.claude` -- where nothing was. Sessions listed but
opened empty. The bug is invisible whenever the configured home happens to equal
`~/.claude`, which is why it lurked.

Both helpers now take an optional trailing `claudeHomePath`, falling back to the
new exported `defaultClaudeHome()` (a function, not a constant, so `os.homedir()`
is read at call time). The home is threaded from `FleetManager` through session
discovery, `RuntimeFactory`, `SDKRuntime`, `CLIRuntime`, `JobControl`,
`ScheduleExecutor`, `runSchedule()`, `deleteSession()` and
`cliSessionFileExists()`.

**2. Claude Code resolves its own home from `CLAUDE_CONFIG_DIR`, and nothing set
it.** Threading `claudeHomePath` only fixes herdctl's own path arithmetic. The
process that actually writes transcripts is Claude Code -- the Agent SDK for the
`sdk` runtime, the spawned `claude` binary for the `cli` runtime -- and neither
has a "Claude home" option to pass; both read the `CLAUDE_CONFIG_DIR`
environment variable. Left unset, herdctl and Claude Code operated on different
trees: a new chat's transcript landed in `~/.claude` while herdctl watched the
configured home and saw nothing appear, and resuming a session whose transcript
lived in the configured home failed outright with `error_during_execution`,
because Claude Code was asked for a session id whose file it could not find.

The new `claude-config-dir` module exports `CLAUDE_CONFIG_DIR_VAR`,
`resolveClaudeConfigDir()` and `withClaudeConfigDir()`. `SDKRuntime` applies the
variable to the per-query `env` (never to `process.env` -- a host runs many
concurrent agents, and a global mutation would leak one agent's home into all of
them; note the SDK's `env` *replaces* the subprocess environment rather than
merging, so the inherited environment is spread in). `CLIRuntime` adds it to its
default `execa` spawn, which merges over the inherited environment. An operator
who already set `CLAUDE_CONFIG_DIR` wins -- herdctl never overwrites it -- and
the default home injects nothing at all, so behaviour is unchanged for everyone
not using a custom home. `ContainerRunner` deliberately injects nothing: the
container has its own filesystem and its own fixed home
(`/home/claude/.claude/projects/-workspace`, bind-mounted back to the host
`<stateDir>/docker-sessions`), and a host path there would move the agent's
transcripts off the mount and out of herdctl's view.

**New API** (all additive):

- `FleetManagerOptions.claudeHomePath` and `FleetManager.getClaudeHomePath()`
- `SessionDiscoveryService.getClaudeHomePath()`
- `SDKRuntimeOptions` (with `claudeHomePath`), `SDKRuntime.getClaudeHomePath()`,
  `CLIRuntime.getClaudeHomePath()`
- `RuntimeFactory.create()` accepts `claudeHomePath`
- `RunScheduleOptions.claudeHomePath`, `SessionFileCheckOptions.claudeHomePath`,
  and a third `claudeHomePath` parameter on `cliSessionFileExists()`
- `defaultClaudeHome()`, `CLAUDE_CONFIG_DIR_VAR`, `resolveClaudeConfigDir()`,
  `withClaudeConfigDir()`
- `SDKQueryOptions.env`, mirroring the SDK's own `Options["env"]`
- `FleetManagerContext.getClaudeHomePath?()` (optional, so existing mock
  contexts in module unit tests keep compiling)

Every new parameter is optional and defaults to the previous behaviour.
