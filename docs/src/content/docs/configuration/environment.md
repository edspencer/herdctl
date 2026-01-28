---
title: Environment Variables
description: Reference guide for environment variable interpolation in herdctl configuration
---

herdctl supports environment variable interpolation in configuration files, allowing you to inject secrets and environment-specific values without hardcoding them.

## Interpolation Syntax

Environment variables can be referenced in any string value within your configuration using the `${VAR_NAME}` syntax.

### Required Variables

Use `${VAR_NAME}` to reference a required environment variable:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

If the variable is not defined, herdctl will throw an error at configuration load time:

```
UndefinedVariableError: Undefined environment variable 'GITHUB_TOKEN' at 'mcp_servers.github.env.GITHUB_TOKEN' (no default provided)
```

### Variables with Default Values

Use `${VAR_NAME:-default}` to provide a fallback value:

```yaml
workspace:
  root: ${HERDCTL_WORKSPACE_ROOT:-~/herdctl-workspace}

defaults:
  model: ${CLAUDE_MODEL:-claude-sonnet-4-20250514}
```

If `HERDCTL_WORKSPACE_ROOT` is not set, the value `~/herdctl-workspace` will be used instead.

---

## Where Interpolation Works

Environment variable interpolation works on **any string value** in your configuration, at any nesting depth:

```yaml
# Top-level strings
version: 1

fleet:
  name: ${FLEET_NAME:-production}
  description: Fleet for ${ENVIRONMENT:-development} environment

# Nested in objects
workspace:
  root: ${WORKSPACE_ROOT:-~/herdctl}

# Inside arrays
agents:
  - path: ./agents/${AGENT_PROFILE:-default}.yaml
  - path: ${CUSTOM_AGENT_PATH}

# Deeply nested
defaults:
  permissions:
    bash:
      allowed_commands:
        - ${PACKAGE_MANAGER:-npm}

# MCP server configuration
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      API_URL: ${GITHUB_API_URL:-https://api.github.com}
```

### Non-String Values

Interpolation **only applies to strings**. Non-string values (numbers, booleans, null) are preserved as-is:

```yaml
defaults:
  max_turns: 50           # Number - no interpolation
  docker:
    enabled: true         # Boolean - no interpolation

workspace:
  clone_depth: 1          # Number - no interpolation
  auto_clone: true        # Boolean - no interpolation
```

### Multiple Variables in One String

You can use multiple variables in a single string value:

```yaml
fleet:
  description: "${TEAM_NAME} fleet in ${ENVIRONMENT}"

workspace:
  root: ${HOME}/${PROJECT_NAME:-herdctl}/workspace
```

---

## Error Behavior

### Undefined Required Variables

When a required variable (without a default) is undefined, configuration loading fails immediately with a descriptive error:

```
UndefinedVariableError: Undefined environment variable 'API_KEY' at 'mcp.servers[0].env.API_KEY' (no default provided)
```

The error message includes:
- The variable name that's missing
- The full path in the configuration where it was referenced
- A reminder that no default was provided

### Validation Timing

Environment variables are resolved when the configuration is loaded, not when it's parsed. This means:

1. YAML syntax is validated first
2. Schema validation runs second
3. Environment variable interpolation happens third

If interpolation fails, you'll see the `UndefinedVariableError` after YAML and schema validation pass.

---

## Security Recommendations

### Never Commit Secrets

Keep sensitive values out of version control:

```bash
# .gitignore
.env
.env.local
.env.*.local
```

### Use Environment Variables for All Secrets

Always use interpolation for sensitive values:

```yaml
# Good: Secrets come from environment
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
  custom-api:
    command: node
    args: ["./mcp-servers/custom.js"]
    env:
      API_KEY: ${API_KEY}

webhooks:
  secret_env: WEBHOOK_SECRET  # Reference by name, not value
```

```yaml
# Bad: Secrets hardcoded in config
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ghp_xxxxxxxxxxxx  # Never do this!
```

### Set Variables in Your Environment

Export variables in your shell or use a secrets manager:

```bash
# In your shell profile (~/.bashrc, ~/.zshrc)
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."

# Or set them when running herdctl
ANTHROPIC_API_KEY="sk-ant-..." herdctl run coder
```

### Production Environments

For production deployments, use your platform's secrets management:

- **CI/CD**: Use GitHub Actions secrets, GitLab CI variables, etc.
- **Kubernetes**: Use Kubernetes Secrets or external secrets operators
- **Cloud**: Use AWS Secrets Manager, GCP Secret Manager, Azure Key Vault
- **Docker**: Use Docker secrets or environment files

---

## Common Patterns

### API Tokens and Keys

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

# Chat integrations are per-agent (each agent has its own bot)
# See agent config for chat settings
```

### URLs and Endpoints

```yaml
mcp_servers:
  custom-api:
    command: node
    args: ["./mcp-servers/custom-api.js"]
    env:
      API_BASE_URL: ${API_BASE_URL:-https://api.example.com}
      API_VERSION: ${API_VERSION:-v1}
```

### Paths and Directories

```yaml
workspace:
  root: ${HERDCTL_WORKSPACE:-~/herdctl-workspace}

agents:
  - path: ${AGENTS_DIR:-./agents}/coder.yaml
  - path: ${AGENTS_DIR:-./agents}/reviewer.yaml
```

### Environment-Specific Configuration

```yaml
fleet:
  name: ${FLEET_NAME:-development}
  description: ${FLEET_DESCRIPTION:-Local development fleet}

defaults:
  model: ${CLAUDE_MODEL:-claude-sonnet-4-20250514}

  # Different settings per environment
  instances:
    max_concurrent: ${MAX_CONCURRENT_AGENTS:-2}
```

### Dynamic Agent Selection

```yaml
agents:
  - path: ./agents/${AGENT_PROFILE:-standard}.yaml
```

Set `AGENT_PROFILE=advanced` to load `./agents/advanced.yaml` instead of the default.

---

## Core Environment Variables

While herdctl doesn't require specific environment variables, these are commonly used:

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for agent sessions | `sk-ant-...` |
| `GITHUB_TOKEN` | GitHub API token for MCP server | `ghp_...` |
| `LINEAR_API_KEY` | Linear API key for issue tracking | `lin_api_...` |
| `<AGENT>_DISCORD_TOKEN` | Per-agent Discord bot token (e.g., `SUPPORT_DISCORD_TOKEN`) | — |
| `<AGENT>_SLACK_TOKEN` | Per-agent Slack bot token (e.g., `SUPPORT_SLACK_TOKEN`) | — |
| `<AGENT>_SLACK_APP_TOKEN` | Per-agent Slack app token for Socket Mode | — |

---

## Complete Example

Here's a full configuration demonstrating environment variable usage:

```yaml
version: 1

fleet:
  name: ${FLEET_NAME:-production}
  description: ${FLEET_DESCRIPTION:-Agent fleet for ${TEAM_NAME:-engineering}}

defaults:
  model: ${CLAUDE_MODEL:-claude-sonnet-4-20250514}
  max_turns: ${MAX_TURNS:-50}

  permissions:
    mode: acceptEdits
    bash:
      allowed_commands:
        - ${PACKAGE_MANAGER:-npm}
        - git
        - node

workspace:
  root: ${HERDCTL_WORKSPACE:-~/herdctl-workspace}
  auto_clone: true
  clone_depth: 1

agents:
  - path: ./agents/${AGENT_PROFILE:-default}/coder.yaml
  - path: ./agents/${AGENT_PROFILE:-default}/reviewer.yaml

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ALLOWED_PATHS:-/tmp}"]

# Note: Chat (Discord/Slack) is configured per-agent, not at fleet level.
# Each agent references its own token env var in its config.

webhooks:
  enabled: true
  port: ${WEBHOOK_PORT:-8081}
  secret_env: WEBHOOK_SECRET
```

---

## Troubleshooting

### "Undefined environment variable" Error

**Problem**: Configuration fails to load with `UndefinedVariableError`.

**Solution**: Either set the missing variable or provide a default:

```bash
# Option 1: Set the variable
export MISSING_VAR="value"

# Option 2: Add a default in config
# Change: ${MISSING_VAR}
# To:     ${MISSING_VAR:-default_value}
```

### Variable Not Being Replaced

**Problem**: The `${VAR}` syntax appears in the final config instead of the value.

**Possible causes**:
1. Variable name contains invalid characters (must match `[A-Za-z_][A-Za-z0-9_]*`)
2. Malformed syntax (missing `}`, extra spaces)
3. Value is not a string type in YAML

```yaml
# Invalid variable names
${123_VAR}        # Can't start with number
${VAR-NAME}       # Hyphens not allowed (use underscores)
${VAR NAME}       # Spaces not allowed

# Valid variable names
${VAR_NAME}
${_PRIVATE_VAR}
${myVar123}
```

### Testing Configuration

Validate your configuration before running:

```bash
# Check that all required variables are set
herdctl config validate

# See the resolved configuration
herdctl config show
```

---

## Related

- [Fleet Configuration](/configuration/fleet-config/) - Complete fleet configuration reference
- [Agent Configuration](/configuration/agent-config/) - Agent-specific settings
- [MCP Servers](/configuration/mcp-servers/) - MCP server configuration
