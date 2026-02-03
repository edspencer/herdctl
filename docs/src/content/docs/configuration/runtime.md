---
title: Runtime Configuration
description: Choose between SDK and CLI runtimes for agent execution
---

Herdctl supports two runtime backends for executing Claude Code agents: **SDK runtime** and **CLI runtime**. This page explains when to use each and how to configure them.

## Runtime Types Overview

### SDK Runtime (Default)

The SDK runtime uses the Claude Agent SDK directly to execute agents. This is the default runtime and works out of the box with just an API key.

**Key characteristics:**
- Standard Claude API pricing
- Requires only `ANTHROPIC_API_KEY` environment variable
- Fully programmatic execution
- All SDK features available
- Sessions stored in `~/.claude/projects/`

### CLI Runtime

The CLI runtime spawns the `claude` CLI command to execute agents. This runtime is designed for users with Claude Max plans who want to leverage their subscription benefits.

**Key characteristics:**
- Max plan pricing (if subscribed)
- Requires Claude CLI installed and logged in
- Full Claude Code capabilities
- Sessions stored in `~/.claude/projects/` (same as SDK)
- Fully compatible with SDK runtime sessions

## Decision Matrix

Choose the appropriate runtime based on your requirements:

| Factor | SDK Runtime | CLI Runtime |
|--------|-------------|-------------|
| **Pricing** | Standard API rates | Max plan rates (if subscribed) |
| **Setup** | Just API key | Claude CLI installed + logged in |
| **Features** | Full SDK support | Full Claude Code capabilities |
| **Best for** | API-only deployments, CI/CD | Max plan users wanting cost savings |
| **Session storage** | `~/.claude/projects/` | `~/.claude/projects/` (same location) |
| **Session compatibility** | ✅ Compatible with CLI | ✅ Compatible with SDK |
| **Authentication** | `ANTHROPIC_API_KEY` | `claude login` |
| **Dependencies** | None | Claude CLI must be installed |

**When to use SDK runtime:**
- You're using standard Claude API access
- Running in CI/CD or automated environments
- Don't have Claude CLI installed
- Want simplest setup (default)

**When to use CLI runtime:**
- You have a Claude Max subscription
- Want to use Max plan pricing benefits
- Already use Claude CLI for other work
- Need full Claude Code feature parity

## Configuration

### SDK Runtime (Default)

The SDK runtime is used automatically when no runtime is specified:

```yaml
# agent.yaml
name: my-agent
# runtime: sdk  # Optional - sdk is the default

workspace: my-project
schedules:
  check:
    type: interval
    interval: 5m
    prompt: "Check for work."
```

**Requirements:**
- `ANTHROPIC_API_KEY` environment variable must be set

**No additional setup needed** - this is the default and works immediately.

### CLI Runtime

To use the CLI runtime, set `runtime: cli` in your agent configuration:

```yaml
# agent.yaml
name: cli-agent
runtime: cli

workspace: my-project
schedules:
  check:
    type: interval
    interval: 5m
    prompt: "Check for work."
```

**Requirements:**
1. Claude CLI must be installed:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. User must be logged in:
   ```bash
   claude login
   ```

3. Claude CLI manages authentication in `~/.claude/`

## Session Management

Both SDK and CLI runtimes use the same Claude Code session storage, enabling seamless runtime switching without losing conversation context.

### Unified Session Storage

- **Location:** `~/.claude/projects/{workspace-path-hash}/`
- **Format:** JSONL session files (UUID-based filenames)
- **Compatibility:** Sessions work across both runtimes
- **Resumption:** Full conversation history preserved when switching

**Example session file:**
```
~/.claude/projects/-Users-ed-projects-myapp/052cf4a1-92f9-4c33-a527-9cdc107f0d1d.jsonl
```

### Cross-Runtime Session Compatibility

Because both runtimes use the same underlying Claude Code session system:

- **SDK → CLI**: Sessions created by SDK runtime can be resumed by CLI runtime
- **CLI → SDK**: Sessions created by CLI runtime can be resumed by SDK runtime
- **Conversation continuity**: Full message history is preserved across the switch
- **Zero migration needed**: Just change the `runtime` field and restart

**Example workflow:**
```yaml
# Start with CLI runtime (Max plan pricing)
name: my-agent
runtime: cli

# Later switch to SDK runtime (standard pricing)
name: my-agent
runtime: sdk  # Or remove runtime field for default

# Sessions automatically continue - no data loss!
```

:::tip[Runtime Flexibility]
You can switch runtimes at any time without losing conversation context. This makes it easy to experiment with different pricing models or deployment environments while maintaining session continuity.
:::

## Runtime Switching

You can switch an agent's runtime at any time by changing the `runtime` field. Sessions are fully compatible across runtimes, so conversation context is preserved.

```yaml
# Before (SDK runtime - default)
name: my-agent
# No runtime field specified

# After (CLI runtime)
name: my-agent
runtime: cli
```

**Session Continuity:** When you switch runtimes, existing sessions are automatically resumed by the new runtime. The conversation history is preserved, and the agent continues from where it left off.

**Use cases for runtime switching:**
- Switch to CLI runtime to leverage Max plan pricing
- Switch to SDK runtime for CI/CD or container deployments
- Experiment with different runtime backends without losing context
- Optimize costs by switching based on usage patterns

## Execution Modes

Herdctl supports four execution modes based on runtime type and execution environment:

| Mode | Runtime | Environment | Description |
|------|---------|-------------|-------------|
| **SDK Local** | `runtime: sdk` | Local (no Docker) | Default mode, standard API pricing, runs on host |
| **CLI Local** | `runtime: cli` | Local (no Docker) | Max plan pricing, runs on host |
| **SDK Docker** | `runtime: sdk` | `docker.enabled: true` | Isolated SDK execution in container |
| **CLI Docker** | `runtime: cli` | `docker.enabled: true` | Isolated CLI execution in container |

### Session Compatibility Across Modes

Understanding session persistence is crucial when switching between modes:

#### ✅ Compatible: Within Same Environment

Sessions **are compatible** when switching runtimes within the same environment:

- **Local SDK ↔ Local CLI**: Sessions resume seamlessly
  - Both use `~/.claude/projects/` on your host machine
  - Full conversation history preserved
  - No configuration changes needed

- **Docker SDK ↔ Docker CLI**: Sessions resume seamlessly
  - Both use `.herdctl/docker-sessions/` (mounted to containers)
  - Full conversation history preserved
  - No configuration changes needed

#### ❌ Not Compatible: Across Environments

Sessions **are not compatible** when switching between Docker and local environments:

- **Local → Docker** or **Docker → Local**: Fresh session starts
  - Docker sessions: `.herdctl/docker-sessions/`
  - Local sessions: `.herdctl/sessions/` (SDK) or `~/.claude/projects/` (CLI)
  - Different filesystems prevent session sharing
  - This is by design for container isolation

**Example session behavior:**

```yaml
# Job 1: SDK runtime, local execution
runtime: sdk
# Session: abc-123 stored in ~/.claude/projects/

# Job 2: CLI runtime, local execution
runtime: cli
# ✅ Session abc-123 resumes - same environment

# Job 3: CLI runtime, Docker enabled
runtime: cli
docker:
  enabled: true
# ❌ New session xyz-789 - different environment
# Cannot access session abc-123 from Jobs 1-2

# Job 4: SDK runtime, Docker still enabled
runtime: sdk
docker:
  enabled: true
# ✅ Session xyz-789 resumes - same Docker environment
```

:::caution[Session Isolation]
Enabling or disabling Docker will start a fresh session. Docker sessions are isolated from local sessions to prevent path conflicts and maintain container security. Plan your runtime and environment choices accordingly.
:::

### Choosing Your Execution Mode

**Use SDK Local (default) when:**
- Standard API pricing works for your use case
- Running on your local machine or VM
- Want simplest setup with minimal dependencies

**Use CLI Local when:**
- You have a Claude Max subscription
- Want to use Max plan pricing benefits
- Running on your local machine or VM

**Use SDK Docker when:**
- Need container isolation for security
- Running untrusted code or workspace
- Want resource limits and sandboxing
- Standard API pricing is acceptable

**Use CLI Docker when:**
- Need container isolation AND Max plan pricing
- Running untrusted code or workspace
- Want resource limits and sandboxing
- Have Claude Max subscription

## Docker Configuration

Both runtimes work with Docker containerization. Enable Docker in your agent config:

```yaml
name: containerized-agent
runtime: cli  # or sdk (default)
docker:
  enabled: true
  network: bridge
  memory: 2g
```

**Key Docker behaviors:**
- Agents run isolated in containers
- Sessions stored separately (`.herdctl/docker-sessions/`)
- Runtime switching within Docker preserves sessions
- Switching between Docker and local starts fresh sessions

See [Docker Configuration](/configuration/docker/) for complete Docker options, security model, and best practices.

## Troubleshooting

### SDK Runtime Issues

**Error:** `Missing ANTHROPIC_API_KEY`
- **Solution:** Set the `ANTHROPIC_API_KEY` environment variable with your API key

**Error:** `Invalid API key`
- **Solution:** Verify your API key is correct and active

### CLI Runtime Issues

**Error:** `claude command not found`
- **Solution:** Install Claude CLI: `npm install -g @anthropic-ai/claude-code`

**Error:** `Not authenticated`
- **Solution:** Log in to Claude CLI: `claude login`

**Error:** `CLI runtime requires claude CLI`
- **Solution:** Ensure Claude CLI is installed and in your PATH

### Session Issues

**Problem:** Sessions not resuming after runtime switch
- **Check:** Verify session files exist: `~/.claude/projects/{workspace}/`
- **Check:** Ensure working directory hasn't changed (sessions are tied to workspace path)
- **Solution:** Sessions are compatible across runtimes - if sessions aren't resuming, check the working directory configuration

**Problem:** "Session expired" after runtime switch
- **Explanation:** Sessions have a default 24h timeout based on last activity
- **Solution:** This is normal behavior - not related to runtime switching
- **Fix:** Increase `session.timeout` in agent config if needed

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Complete agent config reference
- [Docker Configuration](/configuration/docker/) — Container security and isolation
- [Fleet Configuration](/configuration/fleet-config/) — Global fleet settings
