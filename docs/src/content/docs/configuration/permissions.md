---
title: Permissions
description: Control what tools and commands agents can use
---

Permissions control what an agent can do within its session. Herdctl provides fine-grained control over tool access and permission approval modes using a flat configuration structure that maps directly to the Claude Agents SDK. This allows you to create agents with appropriate access levels—from read-only support bots to full-access development agents.

## Quick Start

```yaml
# agents/my-agent.yaml
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - Edit
  - "Bash(git *)"
  - "Bash(npm *)"
  - "Bash(pnpm *)"
denied_tools:
  - WebSearch
  - "Bash(rm -rf *)"
  - "Bash(sudo *)"
```

---

## Permission Modes

The `permission_mode` field controls how Claude Code handles permission requests. This maps directly to the Claude Agents SDK's permission modes.

```yaml
permission_mode: acceptEdits  # default
```

### Available Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `default` | Requires approval for everything | Maximum control, manual oversight |
| `acceptEdits` | Auto-approve file operations | **Recommended for most agents** |
| `bypassPermissions` | Auto-approve everything | Trusted, isolated environments |
| `plan` | Planning only, no execution | Research agents, dry runs |

### Mode Details

#### `default`

The most restrictive mode. Every tool use requires explicit approval through herdctl's permission callback system.

```yaml
permission_mode: default
```

**When to use:**
- Testing new agents
- Running untrusted prompts
- Environments requiring audit trails

#### `acceptEdits`

Auto-approves file operations (Read, Write, Edit, mkdir, rm, mv, cp) while still requiring approval for other tools like Bash execution. This is the **default mode** if not specified.

```yaml
permission_mode: acceptEdits
```

**When to use:**
- Standard development agents
- Content creation agents
- Most production use cases

#### `bypassPermissions`

Auto-approves all tool requests without prompting. Use with caution.

```yaml
permission_mode: bypassPermissions
```

**When to use:**
- Fully trusted agents in isolated environments
- Docker-isolated agents with resource limits
- Automated pipelines with pre-validated prompts

:::caution
Only use `bypassPermissions` in isolated environments. This mode allows the agent to execute any tool without restriction.
:::

#### `plan`

Enables planning mode where Claude analyzes and plans but doesn't execute tools. Useful for understanding what an agent would do.

```yaml
permission_mode: plan
```

**When to use:**
- Previewing agent behavior before execution
- Research and analysis agents
- Generating plans for human review

---

## Tool Permissions

Control which Claude Code tools an agent can use with `allowed_tools` and `denied_tools` arrays. These are top-level configuration fields.

### Allowed Tools

Explicitly list tools the agent can use:

```yaml
allowed_tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - WebFetch
  - "Bash(git *)"
  - "Bash(npm *)"
```

### Denied Tools

Explicitly block specific tools:

```yaml
denied_tools:
  - WebSearch
  - WebFetch
  - "Bash(sudo *)"
  - "Bash(rm -rf /)"
```

### Available Claude Code Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `Read` | Read files from filesystem | Low |
| `Write` | Create new files | Medium |
| `Edit` | Modify existing files | Medium |
| `Glob` | Find files by pattern | Low |
| `Grep` | Search file contents | Low |
| `Bash` | Execute shell commands (use patterns) | High |
| `Task` | Launch subagents | Medium |
| `WebFetch` | Fetch web content | Medium |
| `WebSearch` | Search the web | Medium |
| `TodoWrite` | Manage task lists | Low |
| `AskUserQuestion` | Request user input | Low |
| `NotebookEdit` | Edit Jupyter notebooks | Medium |

### Bash Command Permissions

Bash commands are controlled using `Bash()` patterns in the `allowed_tools` and `denied_tools` arrays. The pattern inside the parentheses is matched against the command being executed.

**Allow specific commands:**

```yaml
allowed_tools:
  - "Bash(git *)"           # All git commands
  - "Bash(npm run *)"       # npm run scripts
  - "Bash(pnpm *)"          # All pnpm commands
  - "Bash(node scripts/*)"  # Node scripts in scripts/
  - "Bash(make build)"      # Specific make target
```

**Deny dangerous patterns:**

```yaml
denied_tools:
  - "Bash(rm -rf /)"
  - "Bash(rm -rf /*)"
  - "Bash(sudo *)"
  - "Bash(chmod 777 *)"
  - "Bash(curl * | bash)"
  - "Bash(curl * | sh)"
  - "Bash(wget * | bash)"
  - "Bash(wget * | sh)"
  - "Bash(dd if=*)"
  - "Bash(mkfs *)"
  - "Bash(> /dev/*)"
```

### MCP Tool Permissions

MCP (Model Context Protocol) server tools use the `mcp__<server>__<tool>` naming convention:

```yaml
allowed_tools:
  - Read
  - Edit
  - mcp__github__*         # All GitHub MCP tools
  - mcp__posthog__*        # All PostHog MCP tools
  - mcp__filesystem__read_file  # Specific tool only
```

**Wildcard support:**
- `mcp__github__*` — Allow all tools from the GitHub MCP server
- `mcp__*` — Allow all MCP tools (not recommended)

---

## Common Permission Patterns

### Development Agent (Standard)

Full development capabilities with sensible restrictions:

```yaml
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Task
  - TodoWrite
  - "Bash(git *)"
  - "Bash(npm *)"
  - "Bash(pnpm *)"
  - "Bash(node *)"
  - "Bash(npx *)"
  - "Bash(tsc *)"
  - "Bash(eslint *)"
  - "Bash(prettier *)"
  - "Bash(vitest *)"
  - "Bash(jest *)"
denied_tools:
  - "Bash(rm -rf /)"
  - "Bash(rm -rf /*)"
  - "Bash(sudo *)"
  - "Bash(chmod 777 *)"
```

### Read-Only Support Agent

Can read and search but cannot modify:

```yaml
permission_mode: default
allowed_tools:
  - Read
  - Glob
  - Grep
  - WebFetch
denied_tools:
  - Write
  - Edit
  - Bash
```

### Content Writer

Can read/write files, no shell access:

```yaml
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebFetch
  - WebSearch
denied_tools:
  - Bash
  - Task
```

### Isolated Full-Access Agent

Maximum permissions in a Docker container:

```yaml
permission_mode: bypassPermissions
allowed_tools: []  # Empty = all tools allowed

docker:
  enabled: true
  base_image: node:20-slim
```

### Research/Planning Agent

Plan and research without execution:

```yaml
permission_mode: plan
allowed_tools:
  - Read
  - Glob
  - Grep
  - WebFetch
  - WebSearch
```

### Git-Only Agent

Can only perform git operations:

```yaml
permission_mode: acceptEdits
allowed_tools:
  - Read
  - Glob
  - Grep
  - "Bash(git status)"
  - "Bash(git diff *)"
  - "Bash(git log *)"
  - "Bash(git add *)"
  - "Bash(git commit *)"
  - "Bash(git push *)"
  - "Bash(git pull *)"
  - "Bash(git checkout *)"
  - "Bash(git branch *)"
  - "Bash(git merge *)"
  - "Bash(gh pr *)"
  - "Bash(gh issue *)"
denied_tools:
  - "Bash(git push --force *)"
  - "Bash(git push -f *)"
  - "Bash(git reset --hard *)"
```

---

## Security Recommendations

### 1. Start Restrictive

Begin with minimal permissions and expand as needed:

```yaml
# Start here
permission_mode: default
allowed_tools:
  - Read
  - Glob
  - Grep

# Add more as you verify behavior
```

### 2. Use Mode Appropriately

| Environment | Recommended Mode |
|-------------|-----------------|
| Development/Testing | `default` |
| Production (standard) | `acceptEdits` |
| Production (Docker isolated) | `bypassPermissions` |
| Research/Preview | `plan` |

### 3. Block Dangerous Bash Patterns

Always deny dangerous patterns in `denied_tools`:

```yaml
denied_tools:
  # Destructive commands
  - "Bash(rm -rf /)"
  - "Bash(rm -rf /*)"
  - "Bash(rm -rf ~)"
  - "Bash(rm -rf ~/*)"
  - "Bash(rm -rf .)"
  - "Bash(rm -rf ./*)"

  # Privilege escalation
  - "Bash(sudo *)"
  - "Bash(su *)"
  - "Bash(doas *)"

  # Remote code execution
  - "Bash(curl * | bash)"
  - "Bash(curl * | sh)"
  - "Bash(wget * | bash)"
  - "Bash(wget * | sh)"
  - "Bash(eval *)"

  # System damage
  - "Bash(dd if=*)"
  - "Bash(mkfs *)"
  - "Bash(fdisk *)"
  - "Bash(> /dev/*)"
  - "Bash(chmod -R 777 *)"

  # Fork bomb
  - "Bash(:(){ :|:& };:)"
```

### 4. Scope MCP Permissions

Only allow necessary MCP tools:

```yaml
allowed_tools:
  # Specific MCP tools, not wildcards
  - mcp__github__create_issue
  - mcp__github__list_issues
  - mcp__github__create_pull_request
  # NOT: mcp__github__*
```

### 5. Use Docker for Untrusted Workloads

Combine Docker isolation with permissions:

```yaml
permission_mode: bypassPermissions

docker:
  enabled: true
  base_image: node:20-slim
```

### 6. Limit Blast Radius

Restrict workspace access when possible:

```yaml
workspace:
  root: ~/herdctl-workspace/project-a
  # Agent can only access this directory
```

### 7. Audit Regularly

Review agent permissions periodically:

```bash
# Show effective permissions for an agent
herdctl config show --agent my-agent --section permissions
```

---

## Permission Inheritance

Agent permissions inherit from fleet defaults and can be overridden:

```yaml
# herdctl.yaml (fleet defaults)
defaults:
  permission_mode: acceptEdits
  denied_tools:
    - WebSearch
    - "Bash(sudo *)"
```

```yaml
# agents/trusted-agent.yaml
# Override mode
permission_mode: bypassPermissions

# Add to allowed tools
allowed_tools:
  - WebSearch  # Override fleet denial

# Inherits denied_tools from fleet
```

**Inheritance rules:**
1. Agent settings override fleet defaults
2. `denied_tools` takes precedence over `allowed_tools`
3. Denied bash patterns always apply (never removed by inheritance)

---

## Validation

Validate your permission configuration:

```bash
# Validate specific agent
herdctl validate agents/my-agent.yaml

# Validate entire fleet
herdctl validate

# Show merged permissions
herdctl config show --agent my-agent --section permissions
```

---

## Schema Reference

### Permission Fields

```typescript
// Top-level permission fields (not nested)
permission_mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"
allowed_tools?: string[]
denied_tools?: string[]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `permission_mode` | string | `"acceptEdits"` | Permission approval mode |
| `allowed_tools` | string[] | — | Tools the agent can use (including `Bash()` patterns) |
| `denied_tools` | string[] | — | Tools explicitly blocked (including `Bash()` patterns) |

### Bash Pattern Syntax

Bash commands are specified using `Bash(<pattern>)` syntax:

| Pattern | Description |
|---------|-------------|
| `Bash(git *)` | Allow any git command |
| `Bash(npm run build)` | Allow specific npm script |
| `Bash(node scripts/*)` | Allow node scripts in specific directory |
| `Bash(sudo *)` | (Deny) Block all sudo commands |
| `Bash(rm -rf /)` | (Deny) Block dangerous rm command |

---

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Full agent config reference
- [Fleet Configuration](/configuration/fleet-config/) — Fleet-level defaults
- [MCP Servers](/configuration/mcp-servers/) — Configure MCP tools
- [Agents Concept](/concepts/agents/) — Understanding agents
