---
"@herdctl/core": patch
"herdctl": minor
---

Add verbose logging control and colorized output

- Add `--verbose` / `-v` flag to `herdctl start` to enable debug logging
- Add `HERDCTL_LOG_LEVEL` environment variable support (debug/info/warn/error)
- Add colorized log output in `herdctl start` matching the style of `herdctl logs`
- Refactor CLIRuntime and CLISessionWatcher to use centralized logger
- Internal debug logs are now hidden by default, reducing noise significantly
- Extract shared color utilities for consistent formatting across CLI commands
