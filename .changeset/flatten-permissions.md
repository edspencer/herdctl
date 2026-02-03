---
"@herdctl/core": major
"herdctl": major
---

BREAKING: Flatten permissions config to match Claude Agents SDK

This is a breaking change that removes the nested `permissions` object in agent and fleet configuration. The old structure:

```yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
  denied_tools:
    - WebSearch
  bash:
    allowed_commands:
      - git
      - npm
    denied_patterns:
      - "rm -rf *"
```

Is now the flat SDK-compatible structure:

```yaml
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - "Bash(git *)"
  - "Bash(npm *)"
denied_tools:
  - WebSearch
  - "Bash(rm -rf *)"
```

**Key changes:**

- `permissions.mode` → `permission_mode` (top-level)
- `permissions.allowed_tools` → `allowed_tools` (top-level)
- `permissions.denied_tools` → `denied_tools` (top-level)
- `permissions.bash.allowed_commands` → Use `Bash(cmd *)` patterns in `allowed_tools`
- `permissions.bash.denied_patterns` → Use `Bash(pattern)` patterns in `denied_tools`

**Why this change:**

1. Direct 1:1 mapping to Claude Agents SDK options
2. Familiar to anyone who knows Claude Code CLI or SDK
3. No magic transformation or hidden behavior
4. Simpler config parsing and validation

**Migration:**

Replace nested `permissions` object with flat fields. Transform bash convenience syntax into standard `Bash()` patterns.
