---
"@herdctl/core": patch
---

Re-establish injected MCP servers on session wake-fired turns (#390).

Under session drive-mode, in-process `injectedMcpServers` were dropped on every
wake-driven turn (`ScheduleWakeup` / `/loop` / `CronCreate` re-fires): the reaper
closes the idle session and the wake registry re-opens it without the in-process
servers, so the resumed subprocess still lists the injected `mcp__…__*` patterns
in `--allowedTools` but has no server behind them — the tools vanish from the
model's catalog for the whole autonomous stretch (durably so across restarts).

- **@herdctl/core:** add an optional `resolveInjectedMcpServers(entry)` factory to
  `SessionLifecycleManagerOptions` (and a `setResolveInjectedMcpServers` setter on
  both `SessionLifecycleManager` and `FleetManager`). When registered, the wake
  `fire()` path consults it and threads the resolved servers into the resumed
  session via a new optional `injectedMcpServers` field on
  `SessionWakeChatOptions`. Injection *policy* stays in the consumer; herdctl owns
  the *wiring*. Fully backward-compatible — with no resolver registered, wakes fire
  with no injection exactly as before, and a throwing resolver is logged and
  degrades to no-injection rather than wedging the wake.

- **@herdctl/core (secondary):** stop `allowedTools` from accumulating duplicate
  `mcp__…__*` wildcards across turns. `toSDKOptions` now copies the agent's
  `allowed_tools` array instead of aliasing it, and the SDK runtime de-dupes
  injected tool patterns before appending them.
