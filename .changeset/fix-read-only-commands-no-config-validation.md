---
"herdctl": patch
---

Fix: Read-only CLI commands (logs, jobs, job) no longer require full config validation

Previously, running `herdctl logs --job <id>`, `herdctl jobs`, or `herdctl job <id>` would fail if the configuration had unset environment variables (e.g., `DISCORD_CHANNEL_ID`). This was unnecessary since these commands only read from the state directory and don't need the full agent configuration.

Now these commands use `JobManager` directly, bypassing `FleetManager.initialize()` and its config validation. This means you can inspect job history and logs even when environment variables for hooks aren't set.
