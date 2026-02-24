---
"herdctl": minor
"@herdctl/core": minor
---

Add agent distribution system and `herdctl agent` command group

**@herdctl/core** — New `distribution/` module providing:
- Source specifier parsing (GitHub URLs, shorthand `owner/repo`, local paths)
- Repository fetching via `git clone` with ref/tag/branch support
- Repository validation (agent.yaml structure, security checks)
- File installation (copy to `./agents/<name>/`, write metadata.json, create workspace)
- Fleet config updating (add/remove agent references in herdctl.yaml, preserving comments)
- Agent discovery (scan herdctl.yaml to find installed vs manual agents)
- Agent info retrieval (detailed agent metadata including env var scanning)
- Agent removal (delete files + remove fleet config reference)
- Environment variable scanning (detect required env vars from agent files)
- Installation metadata tracking (source, version, install timestamp)

**herdctl CLI** — New commands:
- `herdctl agent add <source>` — Install an agent from GitHub or local path
- `herdctl agent list` — List all agents in the fleet (installed + manual)
- `herdctl agent info <name>` — Show detailed agent information
- `herdctl agent remove <name>` — Remove an installed agent
- `herdctl init fleet` — Create herdctl.yaml template (split from `herdctl init`)
- `herdctl init agent [name]` — Interactive agent configuration wizard

All agent commands support `--config` to specify a custom herdctl.yaml path. The `add` command supports `--force` for reinstallation and `--dry-run` for previewing changes.
