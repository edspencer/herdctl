---
"@herdctl/core": minor
"@herdctl/web": minor
"herdctl": minor
"@herdctl/discord": patch
"@herdctl/slack": patch
"@herdctl/chat": patch
---

Add fleet composition support. Fleets can now reference sub-fleets via the `fleets` YAML field, enabling "super-fleets" that combine multiple project fleets into a unified system.

Key features:
- Recursive fleet loading with cycle detection
- Agents receive qualified names (e.g., `herdctl.security-auditor`) based on fleet hierarchy
- Defaults merge across fleet levels with clear priority order
- Web dashboard groups agents by fleet in the sidebar
- CLI commands accept qualified names for sub-fleet agents
- Sub-fleet web configurations are automatically suppressed (single dashboard at root)
- Chat connectors (Discord, Slack) work with qualified agent names
