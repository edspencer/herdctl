---
"herdctl": minor
---

Add `herdctl init fleet` and `herdctl init agent` subcommands

Restructures `herdctl init` into a command group:
- `herdctl init` (bare) prompts to choose between fleet and agent initialization
- `herdctl init fleet` creates a well-commented herdctl.yaml template (non-interactive)
- `herdctl init agent [name]` walks through interactive agent configuration (name, description, permission mode, Docker, runtime, Discord/Slack)

The agent init command supports full non-interactive use via flags (`--yes`, `--docker`, `--discord`, `--slack`, `--permission-mode`, `--runtime`) for scripted and agentic workflows.
