---
"@herdctl/core": major
---

**BREAKING CHANGE**: Rename `workspace` config field to `working_directory`

The configuration field `workspace` has been renamed to `working_directory` throughout the codebase for better clarity. This affects:

- Fleet config: `defaults.workspace` → `defaults.working_directory`
- Agent config: `workspace` → `working_directory`
- Fleet config: top-level `workspace` → `working_directory`

**Backward compatibility**: The old `workspace` field is still supported with automatic migration and deprecation warnings. Configs using `workspace` will continue to work but will emit a warning encouraging migration to `working_directory`.

**Migration**: Replace all occurrences of `workspace:` with `working_directory:` in your YAML config files.
