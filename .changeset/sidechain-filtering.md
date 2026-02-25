---
"@herdctl/core": minor
---

Filter sidechain (sub-agent) sessions from UI session discovery and default `resume_session` to `false`. Sidechain sessions created by Claude Code's Task tool or `--resume` flag are now excluded from the dashboard to reduce noise.
