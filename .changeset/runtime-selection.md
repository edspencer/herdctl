---
"@herdctl/core": minor
---

Add runtime selection between SDK and CLI for agent execution

Agents can now choose between two execution runtimes:
- **SDK Runtime** (default): Uses Claude Agent SDK with standard Claude Code features
- **CLI Runtime**: Uses `claude-p` CLI invocation to preserve Claude Max tokens

**New Configuration**:
```yaml
# Agent-level runtime selection
runtime: sdk  # or "cli"

# Or with CLI-specific options
runtime:
  type: cli
  command: claude-p  # Custom CLI command (optional)
```

**SDK Runtime** (Default):
- Full Claude Agent SDK integration
- All standard Claude Code features
- Standard token consumption

**CLI Runtime**:
- Invokes `claude -p` directly (or custom Claude CLI fork)
- Preserves Claude Max tokens instead of consuming API credits
- Session file watching for message streaming
- Works with both host and Docker execution

**Full Configuration Pass-Through**:
Both runtimes support the complete agent configuration:
- `model` - Model selection (e.g., claude-sonnet-4-20250514)
- `system_prompt` - Custom system prompts
- `permission_mode` - Permission handling (acceptEdits, plan, etc.)
- `permissions.allowed_tools` / `permissions.denied_tools` - Tool access control
- `permissions.bash.allowed_commands` / `permissions.bash.denied_patterns` - Bash restrictions
- `mcp_servers` - MCP server configuration
- `setting_sources` - Setting source configuration

**Use Cases**:
- Preserve Claude Max tokens for long-running agents
- Use custom Claude CLI forks with modified behavior
- Switch between SDK and CLI without code changes
- Test different runtime behaviors

The runtime architecture is pluggable, making it easy to add additional runtime types in the future.
