---
"@herdctl/core": patch
---

Downgrade verbose startup log messages from info to debug level in FleetManager, DiscordManager, and SlackManager. Only important milestones ("Fleet manager initialized successfully", "Fleet manager started", "Fleet manager stopped") remain at info level. Detailed step-by-step initialization messages are now debug-level, visible only with --verbose or HERDCTL_LOG_LEVEL=debug.
