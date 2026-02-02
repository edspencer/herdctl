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

## Docker Compatibility

Both runtimes work with Docker containerization:

```yaml
name: containerized-agent
runtime: cli  # CLI runtime in container
docker:
  enabled: true
  image: anthropic/claude-code:latest
  network: bridge
  memory: 2g
```

When Docker is enabled:
- Session files stored in `~/.claude/projects/` inside the container
- Sessions persist in Docker volumes between container restarts
- Auth files mounted read-only into container
- Sessions remain compatible across SDK and CLI runtimes

See [Docker Configuration](/configuration/docker/) for more details.

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
