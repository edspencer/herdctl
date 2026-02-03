---
title: Agents
description: Understanding autonomous agents in herdctl
---

An **Agent** is a configured Claude Code instance with its own identity, workspace, permissions, and schedules. Think of it as a specialized team member that operates autonomously on your codebase.

## What is an Agent?

```
┌─────────────────────────────────────────────────────────────────┐
│                           AGENT                                 │
│  A configured Claude instance with identity and permissions     │
│                                                                 │
│  • name: "bragdoc-marketer"                                     │
│  • identity: CLAUDE.md, knowledge/                              │
│  • workspace: ~/herdctl-workspace/bragdoc-ai                    │
│  • permission_mode: "acceptEdits", allowed_tools: [...]         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    SCHEDULES                             │   │
│  │  When and how to invoke this agent                       │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ Schedule: "issue-check"                          │   │   │
│  │  │ trigger: { type: interval, every: 5m }           │   │   │
│  │  │ prompt: "Check for ready issues..."              │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ Schedule: "daily-analytics"                      │   │   │
│  │  │ trigger: { type: cron, expression: "0 9 * * *" } │   │   │
│  │  │ prompt: "Analyze site traffic and report..."     │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Each agent operates independently with:

- **Identity**: CLAUDE.md instructions, knowledge files, personality
- **Workspace**: The working directory (repo clone) the agent operates in
- **Permissions**: Exactly which tools the agent can use
- **Schedules**: When and how to invoke (multiple allowed per agent)

## Key Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Unique identifier for the agent within your fleet |
| `description` | No | Human-readable explanation of the agent's purpose |
| `workspace` | Yes | Directory name for the agent's working copy |
| `repo` | Yes | Git repository to clone (e.g., `owner/repo`) |
| `identity` | No | Agent-specific CLAUDE.md and knowledge files |
| `schedules` | Yes | One or more triggers defining when the agent runs |
| `work_source` | No | Where the agent gets tasks from (e.g., GitHub Issues) |
| `permissions` | No | Tool access and file restrictions |
| `session` | No | Session persistence and timeout settings |

## Example Agent Configuration

Here's a complete example of an agent that implements features and fixes bugs:

```yaml
# agents/bragdoc-coder.yaml
name: bragdoc-coder
description: "Implements features and fixes bugs in Bragdoc"

# Workspace (the repo this agent works in)
workspace: bragdoc-ai
repo: edspencer/bragdoc-ai

# Agent identity
identity:
  claude_md: inherit  # Use repo's CLAUDE.md
  knowledge_dir: .claude/knowledge/
  journal: journal.md  # Persistent memory

# Work source configuration
work_source:
  type: github
  filter:
    labels:
      any: ["ready", "bug", "feature"]
    exclude_labels: ["blocked", "needs-design"]
  claim:
    add_label: "in-progress"
    remove_label: "ready"
  complete:
    remove_label: "in-progress"
    close_issue: true
    comment: "Completed: {{summary}}"

# Schedule for checking issues
schedules:
  - name: issue-check
    trigger:
      type: interval
      every: 5m
    prompt: |
      Check for ready issues in the repository.
      Pick the oldest one and implement it.
      Update journal.md with your progress.

# Session management
session:
  mode: fresh_per_job  # New session per job
```

## Agent Identity

Every agent has a unique identity defined by:

### Name

A unique identifier for the agent within your fleet. Use descriptive names that indicate the agent's purpose:

- `bragdoc-coder` - Implements features
- `bragdoc-marketer` - Handles marketing tasks
- `project-support` - Answers user questions

### Description

A human-readable description of what the agent does. This appears in the dashboard and helps team members understand each agent's role.

### CLAUDE.md

Agent-specific instructions that define behavior, conventions, and context. You can:

- **Inherit** the repo's existing CLAUDE.md
- **Specify** a custom file (e.g., `.claude/marketer-CLAUDE.md`)
- **Extend** with additional knowledge files

```yaml
identity:
  claude_md: .claude/marketer-CLAUDE.md  # Custom identity
  knowledge_dir: .claude/knowledge/       # Additional context
```

## Multiple Agents, Same Workspace

Multiple agents can share the same workspace (repo clone). For example:

- `bragdoc-coder` - Implements features in bragdoc-ai
- `bragdoc-marketer` - Handles marketing in bragdoc-ai
- `bragdoc-support` - Answers questions about bragdoc-ai

Each has different schedules, prompts, and potentially different identity files, but they all work on the same codebase.

## Agent Lifecycle

1. **Created**: Agent configuration loaded from YAML
2. **Initialized**: Workspace cloned and prepared
3. **Idle**: Waiting for next trigger
4. **Running**: Executing a scheduled task (creates a [Job](/concepts/jobs/))
5. **Completed**: Task finished, returns to idle
6. **Stopped**: Agent manually stopped

## Common Patterns

### The Coder Agent

Implements features and fixes bugs from issue trackers:

```yaml
name: project-coder
description: "Implements features from GitHub Issues"
workspace: my-project
repo: owner/my-project

work_source:
  type: github
  filter:
    labels:
      any: ["ready"]

schedules:
  - name: issue-check
    trigger:
      type: interval
      every: 5m
    prompt: "Check for ready issues and implement the oldest one."
```

### The Marketing Agent

Monitors channels and generates reports:

```yaml
name: project-marketer
description: "Monitors social media and generates analytics"
workspace: my-project
repo: owner/my-project

schedules:
  - name: hourly-scan
    trigger:
      type: cron
      expression: "0 * * * *"
    prompt: "Scan social media for product mentions."

  - name: daily-report
    trigger:
      type: cron
      expression: "0 9 * * *"
    prompt: "Generate daily analytics report."
```

### The Support Agent

Responds to chat messages. Each chat-enabled agent has its own Discord bot, appearing as a distinct "colleague" in chat:

```yaml
name: project-support
description: "Answers user questions in Discord"
workspace: my-project
repo: owner/my-project

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN  # This agent's own bot
    guilds:
      - id: "guild-id-here"
        channels:
          - id: "123456789"
            mode: mention  # Responds when @mentioned
        dm:
          enabled: true
          mode: auto

session:
  mode: per_channel  # Separate context per channel
```

## Related Concepts

- [Schedules](/concepts/schedules/) - Define when agents run
- [Triggers](/concepts/triggers/) - What starts agent execution
- [Workspaces](/concepts/workspaces/) - Where agents operate
- [Jobs](/concepts/jobs/) - Individual agent executions
- [Sessions](/concepts/sessions/) - Agent context management

## Configuration Reference

For the complete schema and all available options, see:

- [Agent Configuration](/configuration/agent-config/) - Full YAML reference
- [Permissions](/configuration/permissions/) - Tool and file access control
- [Fleet Configuration](/configuration/fleet-config/) - Fleet-wide defaults
