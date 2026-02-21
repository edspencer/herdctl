---
title: Workspaces
description: The working directory where agents operate
---

A **Workspace** is simply the directory where an agent operates—the working directory (`cwd`) set when Claude Code runs.

## What is a Workspace?

When you configure an agent with a `workspace`, herdctl sets that path as the current working directory before invoking Claude Code. This gives the agent access to:

- The project's `CLAUDE.md` and `.claude/` configuration
- All source files in that directory
- Git operations (if it's a git repository)
- Any skills or commands defined in the project

```yaml
# agents/my-agent.yaml
name: my-agent
workspace: /Users/me/projects/my-app  # Agent runs here
```

## Configuration

The workspace can be specified as a simple path:

```yaml
workspace: /path/to/project
```

Or as an object (for future extensibility):

```yaml
workspace:
  root: /path/to/project
```

If no workspace is specified, the agent runs in whatever directory herdctl was started from.

## You Manage the Repository

herdctl does **not** clone, pull, or manage git repositories for you. You are responsible for:

- Cloning the repository to the workspace path
- Keeping it up to date (if desired)
- Managing branches
- Deciding where repos live on your filesystem

herdctl simply runs Claude Code in the directory you specify.

## Isolation Pattern (Recommended)

A useful pattern is maintaining separate clones for human and agent work:

```
~/Code/my-project/           # Your working copy
~/agent-workspaces/my-project/  # Agent's copy
```

This prevents agents from interfering with your uncommitted work. But this is a pattern you implement yourself—herdctl doesn't enforce or automate it.

**To set this up:**

```bash
# Create agent workspace directory
mkdir -p ~/agent-workspaces

# Clone a copy for the agent
git clone https://github.com/you/my-project.git ~/agent-workspaces/my-project

# Configure agent to use it
# In agents/my-agent.yaml:
#   workspace: ~/agent-workspaces/my-project
```

## Multiple Agents, Same Workspace

Multiple agents can share the same workspace path. This is useful when different agents need access to the same codebase:

```yaml
# agents/coder.yaml
name: coder
workspace: ~/projects/my-app
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for ready issues and implement them."

# agents/reviewer.yaml
name: reviewer
workspace: ~/projects/my-app  # Same workspace
schedules:
  daily-review:
    type: cron
    cron: "0 9 * * *"
    prompt: "Review recent changes and suggest improvements."
```

**Considerations when sharing:**

- Agents might conflict if running simultaneously on the same files
- Consider scheduling to avoid overlap
- Each agent maintains its own session context

## How It Works at Runtime

When an agent job runs, herdctl:

1. Resolves the workspace path from agent config
2. Sets `cwd` to that path when invoking the Claude SDK
3. Claude Code runs with full access to files in that directory

```typescript
// Simplified - what happens internally
const sdkOptions = {
  cwd: agent.workspace,  // e.g., "/Users/me/projects/my-app"
  // ... other options
};
```

## Related Concepts

- [Agents](/concepts/agents/) - Configure workspace per agent
- [Jobs](/concepts/jobs/) - Execute within workspaces
- [Sessions](/concepts/sessions/) - Maintain context across jobs
