---
"@herdctl/core": minor
---

Add an agent-level `settings` field: Claude Code settings passed through at the flag tier, as the Agent SDK's `settings` option or `--settings <json>` on the CLI runtime. It lets an embedder set a key per agent that a project's checked-in `.claude/settings.json` is not trusted to set, such as `autoMemoryDirectory` (edspencer/paddock#955).
