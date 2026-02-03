---
title: MCP Servers
description: Configure Model Context Protocol servers to extend agent capabilities
---

MCP (Model Context Protocol) servers extend your agents with custom tools and resources, enabling integration with external services like GitHub, PostHog, databases, and more.

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open protocol that allows AI assistants to interact with external tools and data sources. MCP servers provide:

- **Tools**: Custom functions the agent can call (e.g., create GitHub issues, query databases)
- **Resources**: Data sources the agent can read (e.g., documentation, knowledge bases)
- **Prompts**: Predefined prompt templates

When you configure an MCP server for an agent, all tools from that server become available to the agent during its sessions.

---

## Configuration

MCP servers are configured per-agent in the `mcp_servers` field. Each server has a unique name (key) and configuration.

### Process-Based Servers

Most MCP servers run as local processes, spawned when the agent starts:

```yaml
# agents/coder.yaml
name: coder
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable to run |
| `args` | string[] | Command-line arguments |
| `env` | object | Environment variables (supports `${VAR}` interpolation) |

### HTTP-Based Servers

Some MCP servers run as HTTP services:

```yaml
mcp_servers:
  custom-api:
    url: http://localhost:8080/mcp
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL endpoint for the MCP server |

---

## Tool Naming Convention

MCP tools are namespaced using the `mcp__<server>__<tool>` pattern:

```
mcp__<server-name>__<tool-name>
```

For example, if you configure a server named `github`:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

Its tools become available as:
- `mcp__github__create_issue`
- `mcp__github__list_issues`
- `mcp__github__create_pull_request`
- etc.

The server name in the tool identifier comes from the key you use in `mcp_servers`, not the package name.

---

## Combining with Permissions

Use `allowed_tools` and `denied_tools` to control which MCP tools an agent can use.

### Wildcard Support

Allow all tools from a specific server using wildcards:

```yaml
allowed_tools:
  - Read
  - Write
  - Edit
  - mcp__github__*      # All GitHub MCP tools
  - mcp__posthog__*     # All PostHog MCP tools
```

### Specific Tools Only

For tighter security, allow only specific tools:

```yaml
allowed_tools:
  - Read
  - Write
  - mcp__github__list_issues
  - mcp__github__create_pull_request
  # Other GitHub tools are blocked
```

### Denying Specific MCP Tools

Block specific tools while allowing others:

```yaml
allowed_tools:
  - mcp__github__*
denied_tools:
  - mcp__github__delete_repository  # Block dangerous operations
```

:::tip
`denied_tools` takes precedence over `allowed_tools`. A tool in both lists will be denied.
:::

---

## Common MCP Servers

### GitHub Server

Access GitHub APIs for issues, PRs, repositories:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

**Tools provided:**
- `mcp__github__list_issues`
- `mcp__github__create_issue`
- `mcp__github__create_pull_request`
- `mcp__github__search_repositories`
- And more...

**Required environment:**
```bash
export GITHUB_TOKEN=ghp_your_token_here
```

### PostHog Server

Analytics and feature flag management:

```yaml
mcp_servers:
  posthog:
    command: npx
    args: ["-y", "@anthropic/posthog-mcp-server"]
    env:
      POSTHOG_API_KEY: ${POSTHOG_API_KEY}
      POSTHOG_PROJECT_ID: ${POSTHOG_PROJECT_ID}
```

**Tools provided:**
- `mcp__posthog__query-run`
- `mcp__posthog__feature-flag-get-all`
- `mcp__posthog__create-feature-flag`
- `mcp__posthog__experiment-create`
- And more...

**Required environment:**
```bash
export POSTHOG_API_KEY=phx_your_api_key
export POSTHOG_PROJECT_ID=12345
```

### Filesystem Server

Controlled filesystem access:

```yaml
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
```

**Tools provided:**
- `mcp__filesystem__read_file`
- `mcp__filesystem__write_file`
- `mcp__filesystem__list_directory`
- `mcp__filesystem__create_directory`
- And more...

The filesystem server restricts access to the specified directory path.

### PostgreSQL Server

Database access:

```yaml
mcp_servers:
  postgres:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: ${DATABASE_URL}
```

**Tools provided:**
- `mcp__postgres__query`
- `mcp__postgres__list_tables`
- `mcp__postgres__describe_table`

### Memory Server

Persistent memory/knowledge base:

```yaml
mcp_servers:
  memory:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-memory"]
```

**Tools provided:**
- `mcp__memory__store`
- `mcp__memory__retrieve`
- `mcp__memory__search`

---

## Full Examples

### Development Agent with GitHub

A coder agent that can interact with GitHub issues and PRs:

```yaml
name: dev-agent
description: "Implements features from GitHub issues"

repo: myorg/my-project
workspace: my-project

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

allowed_tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__github__*
  - "Bash(git *)"
  - "Bash(npm *)"
  - "Bash(pnpm *)"
```

### Analytics Agent with PostHog

An agent that can query analytics and manage experiments:

```yaml
name: analytics-agent
description: "Manages product analytics and experiments"

mcp_servers:
  posthog:
    command: npx
    args: ["-y", "@anthropic/posthog-mcp-server"]
    env:
      POSTHOG_API_KEY: ${POSTHOG_API_KEY}
      POSTHOG_PROJECT_ID: ${POSTHOG_PROJECT_ID}

allowed_tools:
  - Read
  - Glob
  - Grep
  - mcp__posthog__query-run
  - mcp__posthog__insights-get-all
  - mcp__posthog__feature-flag-get-all
  - mcp__posthog__experiment-get-all
denied_tools:
  - mcp__posthog__delete-feature-flag  # Block destructive operations
  - mcp__posthog__experiment-delete
```

### Multi-Server Agent

An agent with access to multiple MCP servers:

```yaml
name: full-stack-agent
description: "Full-stack development with multiple integrations"

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace/docs"]

  postgres:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-postgres"]
    env:
      DATABASE_URL: ${DATABASE_URL}

allowed_tools:
  - Read
  - Write
  - Edit
  - mcp__github__*
  - mcp__filesystem__*
  - mcp__postgres__query
  - mcp__postgres__list_tables
denied_tools:
  - mcp__postgres__*  # Then allow specific ones above
```

### Custom MCP Server

Run your own MCP server implementation:

```yaml
mcp_servers:
  internal-tools:
    command: node
    args: ["./mcp-servers/internal-tools.js"]
    env:
      API_KEY: ${INTERNAL_API_KEY}
      API_URL: https://api.internal.example.com
```

---

## Server Lifecycle

MCP servers follow the agent session lifecycle:

1. **Startup**: When an agent session begins, herdctl spawns all configured MCP servers
2. **Connection**: Servers connect via stdio (process-based) or HTTP
3. **Available**: Tools become available for the agent to use
4. **Shutdown**: When the session ends, process-based servers are terminated

---

## Environment Variables

MCP server configurations support environment variable interpolation using `${VAR}` syntax:

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}           # From shell environment
      GITHUB_ENTERPRISE_URL: ${GH_ENTERPRISE} # Custom variable
```

Set these in your shell or `.env` file before running herdctl.

---

## Security Considerations

### Principle of Least Privilege

Only grant access to tools an agent actually needs:

```yaml
# Good: Specific tools
allowed_tools:
  - mcp__github__list_issues
  - mcp__github__create_pull_request

# Risky: All tools
allowed_tools:
  - mcp__github__*
```

### Protect Sensitive Tokens

Never hardcode tokens in configuration:

```yaml
# Bad
env:
  GITHUB_TOKEN: ghp_actualtoken123

# Good
env:
  GITHUB_TOKEN: ${GITHUB_TOKEN}
```

### Limit Filesystem Access

When using the filesystem server, restrict to specific directories:

```yaml
mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace/safe-dir"]
    # Agent can only access /workspace/safe-dir and subdirectories
```

### Deny Destructive Operations

Block dangerous tools even when using wildcards:

```yaml
allowed_tools:
  - mcp__github__*
denied_tools:
  - mcp__github__delete_repository
  - mcp__github__delete_branch
```

---

## Debugging

### Check MCP Server Status

```bash
# View logs including MCP server output
herdctl logs --agent my-agent

# Check if MCP servers started correctly
herdctl status --agent my-agent
```

### Common Issues

**Server fails to start:**
- Check that the command is installed (`npx`, `node`, etc.)
- Verify environment variables are set
- Check for typos in package names

**Tools not available:**
- Verify the server name in `mcp_servers` matches the pattern in `allowed_tools`
- Check that the MCP server actually provides the expected tools
- Look for startup errors in agent logs

**Authentication errors:**
- Verify environment variables are correctly set
- Check token permissions match required scopes
- Ensure tokens haven't expired

---

## Schema Reference

```typescript
mcp_servers:
  [server-name]:
    command?: string      # Executable for process-based servers
    args?: string[]       # Command arguments
    env?: Record<string, string>  # Environment variables
    url?: string          # URL for HTTP-based servers
```

---

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Full agent config reference
- [Permissions](/configuration/permissions/) — Tool permission controls
- [Environment Variables](/configuration/environment/) — Environment configuration
