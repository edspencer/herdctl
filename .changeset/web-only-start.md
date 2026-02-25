---
"@herdctl/core": minor
"herdctl": minor
---

Start web UI without fleet config for zero-config session browsing. When no herdctl.yaml is found, `herdctl start` now boots the web dashboard in web-only mode instead of exiting with an error, letting users browse Claude Code sessions from ~/.claude/ without any fleet configuration.
