---
title: Agent Configuration
description: Complete reference for agent YAML configuration
---

Each agent is defined by a YAML file that specifies its identity, behavior, schedule, permissions, and integrations. This page documents the complete agent configuration schema.

## Quick Example

```yaml
name: my-coder
description: "Implements features from GitHub issues"

workspace: my-project
repo: myorg/my-project

identity:
  name: "Code Bot"
  role: "Software Engineer"
  personality: "Methodical and thorough"

system_prompt: |
  You are a senior software engineer. Write clean, tested code.

work_source:
  type: github
  labels:
    ready: "ready"
    in_progress: "in-progress"

schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for ready issues and work on the oldest one."

session:
  max_turns: 50
  timeout: 2h
  model: claude-sonnet-4-20250514

permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

model: claude-sonnet-4-20250514
max_turns: 100
permission_mode: acceptEdits
```

## Complete Schema Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Unique identifier for the agent |
| `description` | string | No | Human-readable description |
| `workspace` | string \| object | No | Directory name or workspace config |
| `repo` | string | No | GitHub repository (e.g., `owner/repo`) |
| `identity` | object | No | Agent identity configuration |
| `system_prompt` | string | No | Custom system instructions for Claude |
| `default_prompt` | string | No | Default prompt when triggered without `--prompt` |
| `work_source` | object | No | Where the agent gets tasks |
| `schedules` | object | No | Map of named schedule configurations |
| `hooks` | object | No | Post-job actions (notifications, webhooks) |
| `instances` | object | No | Concurrency and instance settings |
| `session` | object | No | Session runtime settings |
| `permissions` | object | No | Permission controls |
| `mcp_servers` | object | No | MCP server configurations |
| `chat` | object | No | Chat integration settings |
| `docker` | object | No | Docker execution settings |
| `runtime` | string | No | Runtime type: `"sdk"` (default) or `"cli"` |
| `model` | string | No | Claude model to use |
| `max_turns` | integer | No | Maximum conversation turns |
| `permission_mode` | string | No | Quick permission mode setting |
| `metadata_file` | string | No | Path to agent metadata file for hooks |

---

## Field Details

### name (required)

The unique identifier for this agent. Used in CLI commands and logging.

```yaml
name: bragdoc-coder
```

### description

Human-readable description of what this agent does.

```yaml
description: "Implements features and fixes bugs for the bragdoc project"
```

### workspace

Where the agent operates. Can be a simple string (directory name) or a full configuration object.

**Simple form:**

```yaml
workspace: my-project
```

**Full form:**

```yaml
workspace:
  root: /path/to/workspace
  auto_clone: true
  clone_depth: 1
  default_branch: main
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `root` | string | — | Absolute path to workspace root |
| `auto_clone` | boolean | `true` | Auto-clone repo if missing |
| `clone_depth` | integer | `1` | Git clone depth |
| `default_branch` | string | `"main"` | Default branch to use |

### repo

GitHub repository in `owner/repo` format. Used for cloning and work source integration.

```yaml
repo: edspencer/bragdoc-ai
```

### identity

Defines the agent's persona for Claude interactions.

```yaml
identity:
  name: "Senior Developer"
  role: "Backend Engineer"
  personality: "Detail-oriented, writes comprehensive tests"
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the agent |
| `role` | string | Job title or function |
| `personality` | string | Personality traits and working style |

### system_prompt

Custom instructions prepended to Claude's system prompt.

```yaml
system_prompt: |
  You are a senior software engineer specializing in TypeScript.
  Always write tests for new code.
  Follow the existing code style.
```

### default_prompt

Default prompt used when the agent is triggered without an explicit `--prompt` argument.

```yaml
default_prompt: "Check for new issues and process the oldest one."
```

This enables simple triggering:

```bash
# Without default_prompt, you must specify --prompt
herdctl trigger my-agent --prompt "Do something"

# With default_prompt configured, just run
herdctl trigger my-agent
```

### work_source

Defines where the agent gets tasks to work on.

```yaml
work_source:
  type: github
  labels:
    ready: "ready-for-dev"
    in_progress: "in-progress"
  cleanup_in_progress: true
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Work source type. Currently: `"github"` |
| `labels` | object | Label configuration for GitHub issues |
| `labels.ready` | string | Label indicating an issue is ready for work |
| `labels.in_progress` | string | Label to apply when work begins |
| `cleanup_in_progress` | boolean | Remove in_progress label when complete |

### schedules

A map of named schedules that trigger agent execution. Each schedule has a unique key.

```yaml
schedules:
  morning-standup:
    type: cron
    expression: "0 9 * * 1-5"
    prompt: "Review open PRs and summarize status."

  issue-check:
    type: interval
    interval: 10m
    prompt: "Check for ready issues and work on the oldest one."
    work_source:
      type: github
      labels:
        ready: "ready"

  on-demand:
    type: webhook
    prompt: "Process the incoming webhook payload."

  support-chat:
    type: chat
    prompt: "You are a helpful support agent."
```

#### Schedule Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `interval` | Run at fixed intervals | `interval` (e.g., "5m", "1h") |
| `cron` | Run on cron schedule | `expression` (cron syntax) |
| `webhook` | Triggered by HTTP webhook | — |
| `chat` | Triggered by chat messages | — |

:::note[Webhook and Chat Schedules]
`webhook` and `chat` schedule types are for documentation and configuration purposes. They are **not automatically triggered** by the scheduler. Webhook triggers require an external HTTP request, and chat triggers are handled by the Discord connector when messages are received.
:::

#### Cron Schedules

Use cron expressions for precise time-based scheduling. Cron format: `minute hour day month weekday`

**Common cron expressions:**

| Expression | Description |
|------------|-------------|
| `0 9 * * *` | Daily at 9:00 AM |
| `30 9 * * 1-5` | Weekdays at 9:30 AM |
| `0 */2 * * *` | Every 2 hours |
| `0 0 1 * *` | First day of each month at midnight |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 0 * * 0` | Weekly on Sunday at midnight |

**Supported shorthands:**

| Shorthand | Equivalent | Description |
|-----------|------------|-------------|
| `@hourly` | `0 * * * *` | Every hour at minute 0 |
| `@daily` | `0 0 * * *` | Every day at midnight |
| `@weekly` | `0 0 * * 0` | Every Sunday at midnight |
| `@monthly` | `0 0 1 * *` | First of each month at midnight |
| `@yearly` | `0 0 1 1 *` | January 1st at midnight |

**Example using shorthands:**

```yaml
schedules:
  daily-report:
    type: cron
    expression: "@daily"
    prompt: "Generate daily status report."

  weekly-review:
    type: cron
    expression: "@weekly"
    prompt: "Conduct weekly code review summary."
```

#### When to Use Cron vs Interval

- **Use cron** when specific times matter:
  - Daily reports at 9 AM (`0 9 * * *`)
  - Business hours processing (`0 9-17 * * 1-5`)
  - End-of-week summaries (`0 17 * * 5`)
  - Monthly maintenance (`0 2 1 * *`)

- **Use interval** when regular frequency matters:
  - Health checks every 5 minutes (`5m`)
  - Polling for new work (`10m`)
  - Continuous monitoring (`1m`)
  - Cache refresh (`1h`)

```yaml
# Cron: Reports need to arrive at specific times
schedules:
  morning-report:
    type: cron
    expression: "0 9 * * 1-5"
    prompt: "Generate morning status report for the team."

# Interval: Just need regular checks, timing doesn't matter
schedules:
  issue-check:
    type: interval
    interval: 5m
    prompt: "Check for new issues to process."
```

#### Schedule Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | **Required.** One of: `interval`, `cron`, `webhook`, `chat` |
| `interval` | string | Interval duration (e.g., "5m", "1h", "30s") |
| `expression` | string | Cron expression (e.g., "0 9 * * 1-5") |
| `prompt` | string | Task prompt for this schedule |
| `work_source` | object | Override work source for this schedule |

For more details on scheduling, see [Schedules](/concepts/schedules/) and [Triggers](/concepts/triggers/).

### hooks

Configure actions that run after job completion. Use hooks for notifications, logging, triggering downstream systems, or any post-job processing.

```yaml
hooks:
  after_run:
    - type: shell
      name: "Log output"
      command: "jq -r '.result.output'"

    - type: discord
      name: "Notify team"
      channel_id: "${DISCORD_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
      when: "metadata.shouldNotify"

  on_error:
    - type: webhook
      url: "https://alerts.example.com/errors"
```

#### Hook Events

| Event | Description |
|-------|-------------|
| `after_run` | Runs after every job (success or failure) |
| `on_error` | Runs only when a job fails |

#### Hook Types

| Type | Description |
|------|-------------|
| `shell` | Execute a shell command with HookContext on stdin |
| `webhook` | POST/PUT HookContext JSON to a URL |
| `discord` | Send formatted notification to Discord channel |

#### Common Hook Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | — | **Required.** `shell`, `webhook`, or `discord` |
| `name` | string | — | Human-readable name for logs |
| `continue_on_error` | boolean | `true` | Continue if hook fails |
| `on_events` | array | all | Filter to specific events: `completed`, `failed`, `timeout`, `cancelled` |
| `when` | string | — | Conditional execution (dot-notation path, e.g., `metadata.shouldNotify`) |

For complete hook documentation, see [Hooks](/concepts/hooks/).

### metadata_file

Path to a JSON file that the agent writes during execution. This metadata is included in hook context and can be used for conditional hook execution.

```yaml
metadata_file: metadata.json  # Path relative to workspace
```

**Example workflow:**

1. Configure `metadata_file` in agent config
2. Agent writes metadata during execution:
   ```json
   {
     "shouldNotify": true,
     "lowestPrice": 159.99,
     "retailer": "Staples"
   }
   ```
3. Hooks use `when` to conditionally execute:
   ```yaml
   hooks:
     after_run:
       - type: discord
         when: "metadata.shouldNotify"
         channel_id: "..."
         bot_token_env: DISCORD_BOT_TOKEN
   ```

The metadata is also displayed in Discord notification embeds and included in webhook payloads.

### instances

Configure concurrent execution limits for the agent.

```yaml
instances:
  max_concurrent: 1
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_concurrent` | integer | `1` | Maximum simultaneous jobs for this agent |

The `max_concurrent` setting controls how many schedule-triggered jobs can run simultaneously. When an agent reaches its limit, additional schedule triggers are skipped until a slot becomes available.

**Example: Allow parallel processing**

```yaml
name: data-processor
description: "Processes work items from a queue"

instances:
  max_concurrent: 3  # Process up to 3 items at once

schedules:
  process-queue:
    type: interval
    interval: 1m
    prompt: "Process the next available item."
    work_source:
      type: github
      labels:
        ready: "ready"
        in_progress: "processing"
```

**When to increase `max_concurrent`**:
- Processing independent work items (e.g., separate GitHub issues)
- Running short, non-conflicting tasks
- When throughput is more important than ordering

**When to keep `max_concurrent: 1`** (default):
- Work items may conflict or depend on each other
- Agent modifies shared resources
- Order of execution matters

For more details on concurrency, see [Schedules - Concurrency Control](/concepts/schedules/#concurrency-control-with-max_concurrent).

### session

Runtime settings for agent sessions.

```yaml
session:
  max_turns: 50
  timeout: 2h
  model: claude-sonnet-4-20250514
```

| Field | Type | Description |
|-------|------|-------------|
| `max_turns` | integer | Maximum conversation turns per session |
| `timeout` | string | Session timeout (e.g., "30m", "2h") |
| `model` | string | Claude model for this session |

### permissions

Control what the agent can do. See [Permissions](/configuration/permissions/) for full details.

```yaml
permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
  denied_tools:
    - WebFetch
  bash:
    allowed_commands:
      - "git *"
      - "npm *"
      - "pnpm *"
    denied_patterns:
      - "rm -rf *"
      - "sudo *"
```

| Field | Type | Description |
|-------|------|-------------|
| `mode` | string | Permission mode (see below) |
| `allowed_tools` | string[] | Tools the agent can use |
| `denied_tools` | string[] | Tools explicitly denied |
| `bash` | object | Bash command restrictions |
| `bash.allowed_commands` | string[] | Allowed bash patterns |
| `bash.denied_patterns` | string[] | Denied bash patterns |

#### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Default Claude Code behavior |
| `acceptEdits` | Auto-accept file edits (default) |
| `bypassPermissions` | Skip permission prompts |
| `plan` | Plan-only mode, no execution |

### mcp_servers

Configure MCP (Model Context Protocol) servers. See [MCP Servers](/configuration/mcp-servers/) for full details.

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]

  custom:
    url: http://localhost:8080/mcp
```

Each MCP server is a named entry with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Executable command |
| `args` | string[] | Command arguments |
| `env` | object | Environment variables |
| `url` | string | URL for HTTP-based MCP servers |

### chat

Configure chat integrations for the agent. Each chat-enabled agent has its own bot - appearing as a distinct "person" in Discord/Slack with its own name, avatar, and presence.

```yaml
chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention
        dm:
          enabled: true
          mode: auto

```

#### Discord Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bot_token_env` | string | — | **Required.** Environment variable name containing this agent's Discord bot token |
| `guilds` | array | — | Discord servers (guilds) this bot participates in |
| `guilds[].id` | string | — | Discord guild ID |
| `guilds[].channels` | array | — | Channels to monitor in this guild |
| `guilds[].channels[].id` | string | — | Discord channel ID |
| `guilds[].channels[].name` | string | — | Human-readable name (for documentation) |
| `guilds[].channels[].mode` | string | `mention` | `mention` (respond when @mentioned) or `auto` (respond to all) |
| `guilds[].dm.enabled` | boolean | `true` | Allow direct messages |
| `guilds[].dm.mode` | string | `auto` | DM response mode |

:::note[Bot Setup Required]
Each chat-enabled agent needs its own Discord Application (created in [Discord Developer Portal](https://discord.com/developers/applications)). See the [Discord integration guide](/integrations/discord/) for setup instructions.
:::

### docker

Run the agent in a Docker container for security isolation.

```yaml
docker:
  enabled: true
  image: "anthropic/claude-code:latest"
  network: bridge
  memory: "2g"
  user: "1000:1000"
  workspace_mode: rw
  volumes:
    - "/data/models:/models:ro"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Docker execution |
| `image` | string | `anthropic/claude-code:latest` | Docker image |
| `network` | string | `bridge` | Network mode: `none`, `bridge`, `host` |
| `memory` | string | `2g` | Memory limit |
| `cpu_shares` | integer | — | CPU relative weight |
| `user` | string | Host UID:GID | Container user |
| `workspace_mode` | string | `rw` | Workspace mount: `rw` or `ro` |
| `volumes` | array | `[]` | Additional volume mounts |
| `ephemeral` | boolean | `false` | Fresh container per job |
| `max_containers` | integer | `5` | Container pool limit |

See [Docker Configuration](/configuration/docker/) for security model and detailed options.

### runtime

Select the runtime backend for this agent.

```yaml
runtime: cli  # Use CLI runtime (Max plan pricing)
```

| Value | Description |
|-------|-------------|
| `sdk` | Claude Agent SDK (default, standard pricing) |
| `cli` | Claude CLI (Max plan pricing, requires CLI installed) |

See [Runtime Configuration](/configuration/runtime/) for detailed guidance on choosing a runtime.

### model

Override the Claude model for this agent.

```yaml
model: claude-sonnet-4-20250514
```

Common models:
- `claude-sonnet-4-20250514` — Fast, capable (recommended)
- `claude-opus-4-20250514` — Most capable

### max_turns

Maximum number of conversation turns per session.

```yaml
max_turns: 100
```

### permission_mode

Shorthand for `permissions.mode`. Sets the permission mode directly.

```yaml
permission_mode: acceptEdits
```

---

## Complete Examples

### Coder Agent

A development agent that processes GitHub issues:

```yaml
name: project-coder
description: "Senior developer that implements features and fixes bugs"

workspace: my-project
repo: myorg/my-project

identity:
  name: "Dev Bot"
  role: "Senior Software Engineer"
  personality: "Methodical, writes clean code with tests"

system_prompt: |
  You are a senior software engineer working on this project.

  Guidelines:
  - Write TypeScript with strict types
  - Include unit tests for new code
  - Follow existing code patterns
  - Create atomic commits with clear messages

work_source:
  type: github
  labels:
    ready: "ready-for-dev"
    in_progress: "in-progress"
  cleanup_in_progress: true

schedules:
  continuous:
    type: interval
    interval: 5m
    prompt: |
      Check for GitHub issues labeled "ready-for-dev".
      If found, implement the oldest issue:
      1. Create a feature branch
      2. Implement the solution
      3. Write tests
      4. Create a PR

session:
  max_turns: 100
  timeout: 4h
  model: claude-sonnet-4-20250514

permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Bash
    - Glob
    - Grep
    - Task
  bash:
    allowed_commands:
      - "git *"
      - "npm *"
      - "pnpm *"
      - "node *"
      - "npx *"
    denied_patterns:
      - "rm -rf /"
      - "sudo *"

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

docker:
  enabled: false
```

### Marketer Agent

A content creation agent for marketing tasks:

```yaml
name: content-marketer
description: "Creates blog posts, social content, and marketing copy"

identity:
  name: "Marketing Assistant"
  role: "Content Strategist"
  personality: "Creative, engaging, brand-aware"

system_prompt: |
  You are a content marketing specialist.

  Your responsibilities:
  - Write engaging blog posts
  - Create social media content
  - Maintain consistent brand voice
  - Optimize content for SEO

work_source:
  type: github
  labels:
    ready: "content-ready"
    in_progress: "writing"

schedules:
  content-check:
    type: cron
    expression: "0 8 * * 1-5"
    prompt: |
      Check for content requests labeled "content-ready".
      For each request:
      1. Research the topic
      2. Create an outline
      3. Write the content
      4. Submit for review

  social-daily:
    type: cron
    expression: "0 10 * * *"
    prompt: |
      Review recent blog posts and create social media
      snippets for Twitter and LinkedIn.

session:
  max_turns: 50
  timeout: 2h

permissions:
  mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Glob
    - Grep
    - WebFetch
    - WebSearch

chat:
  discord:
    bot_token_env: MARKETER_DISCORD_TOKEN
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "marketing-channel-id"
            name: "#marketing"
            mode: mention
```

### Support Agent

A customer support agent that handles inquiries:

```yaml
name: support-agent
description: "Handles customer support inquiries via chat"

identity:
  name: "Support Bot"
  role: "Customer Support Specialist"
  personality: "Friendly, patient, solution-oriented"

system_prompt: |
  You are a customer support specialist.

  Guidelines:
  - Be helpful and empathetic
  - Provide accurate information from the knowledge base
  - Escalate complex issues to humans
  - Never make up information

schedules:
  support-chat:
    type: chat
    prompt: |
      You are monitoring support channels.
      Help users with their questions about our product.
      If you cannot help, escalate to a human.

  ticket-review:
    type: cron
    expression: "0 9 * * 1-5"
    prompt: |
      Review open support tickets from yesterday.
      Summarize common issues and trends.

session:
  max_turns: 200
  timeout: 8h
  model: claude-sonnet-4-20250514

permissions:
  mode: default
  allowed_tools:
    - Read
    - Glob
    - Grep
    - WebFetch
  denied_tools:
    - Write
    - Edit
    - Bash

mcp_servers:
  knowledge-base:
    command: node
    args: ["./mcp-servers/knowledge-base.js"]
    env:
      KB_API_KEY: ${KB_API_KEY}

chat:
  discord:
    bot_token_env: SUPPORT_DISCORD_TOKEN
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "support-general-id"
            name: "#support-general"
            mode: mention
          - id: "support-billing-id"
            name: "#support-billing"
            mode: mention
        dm:
          enabled: true
          mode: auto
```

---

## Inheritance

Agents inherit default settings from the fleet configuration (`herdctl.yaml`). Agent-specific settings override fleet defaults.

```yaml
# herdctl.yaml
defaults:
  model: claude-sonnet-4-20250514
  permission_mode: acceptEdits
  session:
    timeout: 2h
```

```yaml
# agents/special-agent.yaml
name: special-agent
model: claude-opus-4-20250514  # Override default model
session:
  timeout: 4h  # Override default timeout
```

## Validation

Validate agent configuration before running:

```bash
herdctl validate agents/my-agent.yaml
```

## Related Pages

- [Fleet Configuration](/configuration/fleet-config/) — Global fleet settings
- [Runtime Configuration](/configuration/runtime/) — SDK vs CLI runtime selection
- [Docker Configuration](/configuration/docker/) — Container security and isolation
- [Permissions](/configuration/permissions/) — Detailed permission controls
- [MCP Servers](/configuration/mcp-servers/) — MCP server setup
- [Hooks](/concepts/hooks/) — Post-job actions and notifications
- [Schedules](/concepts/schedules/) — Schedule concepts and interval timing
- [Triggers](/concepts/triggers/) — Trigger types and configuration
- [Work Sources](/concepts/work-sources/) — Task source integration
- [Agents](/concepts/agents/) — Agent concepts
- [Scheduling Troubleshooting](/guides/scheduling-troubleshooting/) — Debug scheduling issues
