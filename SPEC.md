# Herdctl

> Autonomous Agent Fleet Management for Claude Code

**Website**: [herdctl.dev](https://herdctl.dev)
**Status**: Design Phase
**Last Updated**: 2025-01-19

## Domains

| Domain | Purpose |
|--------|---------|
| **herdctl.dev** | Primary - docs, landing page, marketing |
| herdctl.com | Redirect to .dev |
| herdctl.io | Redirect to .dev |

---

## Vision

An open-source platform for running fleets of autonomous AI agents. Each agent has its own identity, schedules, and work sources. Agents can be triggered by time (interval/cron), events (webhooks), or chat messages (Discord/Slack).

Think of it as "Kubernetes for AI agents" - declarative configuration, multiple runtimes, pluggable integrations.

---

## Core Concepts

### Nomenclature

```
┌─────────────────────────────────────────────────────────────────┐
│                           AGENT                                  │
│  A configured Claude instance with identity and permissions      │
│                                                                  │
│  • name: "bragdoc-marketer"                                     │
│  • identity: CLAUDE.md, knowledge/                              │
│  • workspace: ~/herdctl-workspace/bragdoc-ai                    │
│  • permissions: { allowedTools: [...], mode: "acceptEdits" }    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    SCHEDULES                             │    │
│  │  When and how to invoke this agent                       │    │
│  │                                                          │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │ Schedule: "issue-check"                          │   │    │
│  │  │ trigger: { type: interval, every: 5m }          │   │    │
│  │  │ prompt: "Check for ready issues..."             │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │                                                          │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │ Schedule: "daily-analytics"                      │   │    │
│  │  │ trigger: { type: cron, expression: "0 9 * * *" }│   │    │
│  │  │ prompt: "Analyze site traffic and report..."    │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Trigger fires
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                            JOB                                   │
│  A single execution of an agent                                  │
│                                                                  │
│  • id: "job-2024-01-19-abc123"                                  │
│  • agent: "bragdoc-marketer"                                    │
│  • schedule: "daily-analytics"                                  │
│  • status: running | completed | failed | cancelled             │
│  • session_id: "claude-session-xyz"                             │
│  • started_at, finished_at, output                              │
└─────────────────────────────────────────────────────────────────┘
```

| Term | Definition |
|------|------------|
| **Agent** | A configured Claude instance with identity, workspace, and permissions |
| **Schedule** | A trigger + prompt combination defining when and how to invoke an agent |
| **Trigger** | The condition that starts a job (interval, cron, webhook, chat message) |
| **Job** | A single execution of an agent (has ID, status, output, session) |
| **Workspace** | The directory (repo clone) where an agent operates |
| **Session** | Claude context (can persist across jobs or be fresh each time) |

### Agent
A configured Claude instance with:
- **Identity**: CLAUDE.md, knowledge files, personality
- **Workspace**: The working directory (repo clone) the agent operates in
- **Permissions**: Exactly which tools the agent can use
- **Schedules**: When and how to invoke (multiple allowed per agent)

### Schedule
Defines when and how to invoke an agent:
- **Trigger**: The condition (interval, cron, webhook, chat)
- **Prompt**: What to tell Claude when invoked

An agent can have multiple schedules (e.g., hourly Reddit scan + daily analytics + weekly report).

### Trigger
What causes a job to start:
- **Interval**: "Every 5 minutes after last completion"
- **Cron**: "At 9am every Monday"
- **Webhook**: HTTP POST to endpoint (future)
- **Chat**: Message in Discord/Slack channel (future)

### Job
A single execution of an agent:
- Has unique ID for tracking
- References the agent and schedule that created it
- Tracks status (running, completed, failed, cancelled)
- Stores session ID for resume/fork capability
- Contains full output log

### Work Source
Pluggable backend for task discovery:
- GitHub Issues (MVP)
- Jira (future)
- Linear (future)
- Chat messages (future)

### Chat Connector
Bridge between chat platforms and agents:
- Discord bot
- Slack app
- (WhatsApp, Telegram future)

### Workspace
The directory where an agent operates. Critical design decision:

**Problem**: Developers have their own working clones of repos. Agents shouldn't touch these.

**Solution**: Agents work on **separate clones** in a dedicated workspace directory.

```
~/herdctl-workspace/           # Agent workspace root
├── bragdoc-ai/                # Clone of edspencer/bragdoc-ai
├── theturtlemoves/            # Clone of edspencer/theturtlemoves
└── edspencer-net/             # Clone of edspencer/edspencer-net

~/Code/bragdoc-ai/             # Developer's working clone (untouched)
```

The agent's CWD is set to its workspace clone, giving it:
- Full access to the repo's CLAUDE.md, skills, conventions
- Ability to create branches, commit, push
- Isolation from developer's work-in-progress

**Note**: Multiple agents can share the same workspace (e.g., bragdoc-coder and bragdoc-marketer both work in bragdoc-ai)

---

## Architecture Principles

### Library-First Design

**CRITICAL ARCHITECTURAL DECISION**: herdctl is designed to be consumed as a library (`@herdctl/core`) in the same way as the Claude Agent SDK. All business logic lives in the core package. This enables:

1. **Programmatic integration**: Developers can embed herdctl in their own applications
2. **Multiple interaction modes**: Same functionality accessible via library, CLI, Web UI, or HTTP API
3. **Testability**: Core logic can be unit tested without CLI/UI complexity
4. **Extensibility**: New interfaces can be added without duplicating business logic

### Thin Clients Architecture

The CLI, Web UI, and HTTP API are **thin wrappers** that delegate to `@herdctl/core`. They contain only:
- Input parsing/validation
- Output formatting
- UI rendering
- Authentication (future)

They do **NOT** contain business logic, state management, or orchestration code.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Interaction Layers (THIN)                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │   CLI    │  │  Web UI  │  │ HTTP API │  │ Discord/Slack    ││
│  │ (herdctl)│  │(@herdctl │  │ (part of │  │  (future)        ││
│  │          │  │  /web)   │  │   web)   │  │                  ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘│
│       └─────────────┴─────────────┴──────────────────┘          │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    @herdctl/core                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │                  FleetManager                        │  │  │
│  │  │  (orchestration layer - wires everything together)   │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │     ┌─────────┬──────────┬───────────┬─────────┐         │  │
│  │     ▼         ▼          ▼           ▼         ▼         │  │
│  │  Config   Scheduler   Runner    WorkSources  State       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### FleetManager: The Orchestration Layer

FleetManager is the central class that wires together all core modules. It provides:

- **Lifecycle management**: `initialize()`, `start()`, `stop()`, `reload()`
- **Query methods**: `getStatus()`, `getAgents()`, `getJobs()`, etc.
- **Action methods**: `trigger()`, `cancelJob()`, `enableSchedule()`, etc.
- **Event emission**: Real-time updates via EventEmitter

All interaction layers (CLI, Web, API) use FleetManager rather than calling lower-level modules directly.

### Four Interaction Modes

| Mode | Package | Use Case |
|------|---------|----------|
| **Library** | `@herdctl/core` | Embed in your own application |
| **CLI** | `herdctl` | Command-line management |
| **Web UI** | `@herdctl/web` | Browser-based dashboard |
| **HTTP API** | Part of `@herdctl/web` | Programmatic remote access |

All four modes have identical capabilities - anything you can do in the CLI, you can do via the Web UI or API.

### Single Process Model

Running `herdctl start` launches a single process that includes:
- The scheduler (checking all agent schedules)
- Chat connectors (Discord/Slack bots, if configured)
- Optional HTTP API server (for remote access)
- Optional Web UI server (for browser dashboard)

This simplifies deployment and state management compared to running separate services.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HERDCTL                                  │
│                    Fleet Management Layer                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Projects                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │    │
│  │  │   Bragdoc   │  │   Turtle    │  │    Blog     │     │    │
│  │  │  ┌───────┐  │  │  ┌───────┐  │  │  ┌───────┐  │     │    │
│  │  │  │ coder │  │  │  │ coder │  │  │  │writer │  │     │    │
│  │  │  │marketer│ │  │  │content│  │  │  │  seo  │  │     │    │
│  │  │  │support│  │  │  │social │  │  │  └───────┘  │     │    │
│  │  │  └───────┘  │  │  └───────┘  │  │             │     │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Integration Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Work Sources │  │   Triggers   │  │    Chat      │          │
│  │              │  │              │  │  Connectors  │          │
│  │ • GitHub     │  │ • Interval   │  │              │          │
│  │ • (Jira)     │  │ • Cron       │  │ • Discord    │          │
│  │ • (Linear)   │  │ • Webhook    │  │ • (Slack)    │          │
│  │ • (Notion)   │  │ • Chat msg   │  │ • (WhatsApp) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Runtime Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Claude Agent SDK (primary)                               │   │
│  │  • @anthropic-ai/claude-agent-sdk (npm)                  │   │
│  │  • Programmatic session management                        │   │
│  │  • Fine-grained tool permissions                          │   │
│  │  • Streaming async iterator output                        │   │
│  │                                                           │   │
│  │  (Future: Aider, Gemini - pluggable interface)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Infrastructure                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │  Docker    │  │   State    │  │  Web UI    │                │
│  │ (optional) │  │   (files)  │  │ (monitor)  │                │
│  │            │  │            │  │            │                │
│  │ 1 per agent│  │ .herdctl/  │  │ dashboard  │                │
│  └────────────┘  └────────────┘  └────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### Fleet Configuration

```yaml
# herdctl.yaml
version: 1

defaults:
  docker:
    enabled: false  # Can override per-agent
  permissions:
    mode: acceptEdits
    allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
  work_source:
    type: github
    labels:
      ready: "ready"
      in_progress: "in-progress"
    cleanup_in_progress: true
  instances:
    max_concurrent: 1  # per agent

workspace:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1

# Agents can be inline or in separate files
agents:
  - path: ./agents/bragdoc-coder.yaml
  - path: ./agents/bragdoc-marketer.yaml
  - path: ./agents/turtle-content.yaml

# Chat connectors (optional)
chat:
  discord:
    enabled: true
    token_env: DISCORD_BOT_TOKEN
```

### Agent Configuration (Coder Example)

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
  journal: journal.md  # persistent memory

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

# Single schedule for coder
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
  mode: fresh_per_job  # new session per job
```

### Agent Configuration (Marketer Example - Multiple Schedules)

```yaml
# agents/bragdoc-marketer.yaml
name: bragdoc-marketer
description: "Promotes Bragdoc and engages with potential users"

# Same workspace as coder, different agent
workspace: bragdoc-ai
repo: edspencer/bragdoc-ai

identity:
  claude_md: .claude/marketer-CLAUDE.md  # Different identity
  knowledge_dir: .claude/knowledge/

# Multiple schedules for different tasks
schedules:
  - name: hourly-reddit-scan
    trigger:
      type: cron
      expression: "0 * * * *"  # Every hour on the hour
    prompt: |
      Scan Reddit for mentions of BragDoc, career documentation,
      or brag documents. Report any interesting threads to the
      team via a summary in marketing-report.md.

  - name: daily-analytics
    trigger:
      type: cron
      expression: "0 9 * * *"  # 9am daily
    prompt: |
      Analyze site traffic for the past 24 hours.
      Create a brief report covering:
      - Total visitors
      - Top pages
      - Conversion rate
      - Notable trends
      Post to #marketing channel on Discord.

  - name: weekly-report
    trigger:
      type: cron
      expression: "0 9 * * 1"  # Monday 9am
    prompt: |
      Generate comprehensive weekly marketing report.
      Include:
      - Traffic trends (week over week)
      - Conversion rates
      - Competitor analysis
      - Social media mentions
      - Recommendations for next week
      Email to team@egghead.com

session:
  mode: persistent  # Keep context across jobs
  session_name: bragdoc-marketer-main
```

### Chat-Enabled Agent

```yaml
# projects/bragdoc/agents/support.yaml
name: support
type: support
description: "Answers user questions in Discord"

identity:
  claude_md: ./support-CLAUDE.md

# Chat integration
chat:
  discord:
    guilds:
      - id: "123456789"  # Bragdoc Discord server
        channels:
          - id: "987654321"
            name: "#support"
            mode: mention  # requires @bot to respond
          - id: "111222333"
            name: "#general"
            mode: mention
        dm:
          enabled: true
          mode: auto  # responds to all DMs automatically

# Session per conversation
session:
  mode: per_channel  # separate session per Discord channel
  # This means #support has its own context, DMs have their own, etc.

# Can also have scheduled tasks
schedules:
  - name: daily-summary
    trigger:
      type: cron
      expression: "0 18 * * *"  # 6pm daily
    prompt: |
      Summarize today's support conversations.
      Post summary to #team-updates channel.
```

---

## Chat Integration

### Discord Bot Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Gateway                           │
│                   (discord.js bot)                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ Messages
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Router                             │
│                                                              │
│  • Check if bot mentioned (group) or DM                     │
│  • Route to appropriate agent based on channel config       │
│  • Maintain channel → session ID mapping                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │ Agent A │   │ Agent B │   │ Agent C │
   │Session 1│   │Session 2│   │Session 3│
   └─────────┘   └─────────┘   └─────────┘
```

### Chat Behavior

**Group Channels (mode: mention)**
- Bot ignores messages unless @mentioned
- When mentioned, reads recent context (last N messages)
- Responds in channel
- Maintains persistent session per channel

**Direct Messages (mode: auto)**
- Bot responds to all messages automatically
- Maintains persistent session per user
- Full conversational context

**Session Management**
- Each channel/DM gets its own Claude session ID
- Sessions persist across bot restarts (stored in state)
- Can be reset via command: `@bot /reset`

### Chat Commands

```
@bot /help          - Show available commands
@bot /reset         - Clear conversation context
@bot /status        - Show agent status
@bot /task <desc>   - Create a task for this agent
```

---

## Runtime: Claude Agent SDK

We use the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) rather than the CLI. This gives us:

### Why SDK Over CLI

| Aspect | CLI (`claude -p`) | SDK (programmatic) |
|--------|-------------------|-------------------|
| **Permissions** | `--dangerously-skip-permissions` (all or nothing) | Fine-grained `allowedTools` + permission modes |
| **Sessions** | `--resume <id>` flag | Programmatic resume, fork capability |
| **Output** | Terminal stream | Structured async iterator |
| **Integration** | Shell scripting | Native TypeScript/JavaScript |
| **Settings** | Auto-loads from filesystem | Explicit control |

### Streaming Output (No More File Watching!)

The SDK gives us **native streaming** via async iterator. No more watching session files:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Check GitHub issues and fix the oldest one",
  options: {
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["project", "local"],
  }
})) {
  // Messages arrive as they're generated - real streaming!
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        sessionId = message.session_id;  // Capture for resume/fork
        console.log(`Session started: ${sessionId}`);
      }
      break;

    case 'assistant':
      // Claude's thinking/response text
      console.log(`[Assistant] ${message.content}`);
      break;

    case 'tool_use':
      // Claude is about to use a tool
      console.log(`[Tool] Using ${message.name}: ${message.input}`);
      break;

    case 'tool_result':
      // Tool completed
      console.log(`[Tool Result] ${message.content}`);
      break;
  }

  // Fan out to multiple destinations simultaneously:
  websocket.send(JSON.stringify(message));  // Web UI
  appendToJobLog(jobId, message);           // Persistent log
  terminalOutput(message);                   // CLI output
}
```

This replaces our current hacky approach of watching Claude's session JSONL file.

### Session Management

```typescript
// Resume a session (maintains full context)
for await (const message of query({
  prompt: "Continue working on that issue",
  options: { resume: sessionId }
})) { ... }

// Fork a session (branch without modifying original)
for await (const message of query({
  prompt: "Try a different approach",
  options: { resume: sessionId, forkSession: true }
})) { ... }
```

### Permission Model

**No more `--dangerously-skip-permissions`!** Instead, we have layered control:

```yaml
# Agent permission config
permissions:
  mode: acceptEdits  # or: default, bypassPermissions, plan

  # Explicitly allowed tools
  allowed_tools:
    - Read
    - Edit
    - Write
    - Bash
    - Glob
    - Grep
    - WebFetch  # if agent needs web access

  # Explicitly denied (safety)
  denied_tools:
    - WebSearch  # maybe not for coding agents

  # Bash command restrictions (future)
  bash:
    allowed_commands:
      - git
      - npm
      - pnpm
      - node
    denied_patterns:
      - "rm -rf /"
      - "sudo *"
```

**Permission Modes:**
- `default` - Requires approval for everything (via callback)
- `acceptEdits` - Auto-approve file operations (Edit, Write, mkdir, rm, mv, cp)
- `bypassPermissions` - Auto-approve everything (use sparingly)
- `plan` - No tool execution, planning only

### MCP Configuration

The Claude Agent SDK supports **programmatic MCP server configuration per agent**. Each agent can have completely different MCP servers without any filesystem config or Docker isolation.

```yaml
# agents/bragdoc-marketer.yaml
name: bragdoc-marketer
description: "Marketing and analytics for Bragdoc"

# MCP servers for this agent
mcp_servers:
  # HTTP-based MCP server
  posthog:
    type: http
    url: https://your-posthog-mcp-endpoint.com

  # Local process MCP server
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]

  # Server with environment variables
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

permissions:
  allowed_tools:
    - Read
    - Edit
    - Bash
    # Allow all tools from specific MCP servers
    - mcp__posthog__*
    - mcp__github__*
    # Or allow specific MCP tools
    - mcp__filesystem__read_file
    - mcp__filesystem__list_directory
```

**How it works in the SDK:**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: agentPrompt,
  options: {
    mcpServers: {
      "posthog": {
        type: "http",
        url: "https://your-posthog-mcp.com"
      },
      "filesystem": {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
      }
    },
    allowedTools: ["Read", "Edit", "mcp__posthog__*", "mcp__filesystem__*"]
  }
})) {
  // Each agent gets its own MCP servers
}
```

**Key points:**
- No filesystem config files needed (fully programmatic)
- Each agent can have different MCP servers
- MCP tools use the `mcp__<server>__<tool>` naming convention
- Wildcard support: `mcp__posthog__*` allows all tools from that server
- Environment variables can be passed per-server

---

## Docker (Optional)

Docker is **optional but recommended** for production use.

### When to Use Docker

| Scenario | Docker? | Why |
|----------|---------|-----|
| Local development | Optional | Easier debugging without container |
| Production/CI | Yes | Isolation, reproducibility |
| Multiple agents | Yes | Clean separation |
| Untrusted code | Yes | Sandboxing |

### Configuration

```yaml
# herdctl.yaml
docker:
  enabled: true  # or false for native execution
  base_image: herdctl-base:latest

# Per-agent override
agents:
  bragdoc-coder:
    docker:
      enabled: true
      # custom_image: my-custom-image:latest
```

### Without Docker

When `docker.enabled: false`, herdctl runs agents as native processes:
- CWD set to workspace directory
- Environment variables passed directly
- Output streamed to terminal/logs

### With Docker

When `docker.enabled: true`:
- One container per agent
- Workspace mounted as volume
- Claude auth mounted from host
- Isolated network (optional)

```dockerfile
# Dockerfile.base
FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-agent-sdk
RUN useradd -m agent
USER agent
WORKDIR /home/agent
```

---

## Workspace Management

### The Problem

Developers have working clones they actively use. Agents shouldn't:
- Touch developer's work-in-progress
- Create merge conflicts
- Interfere with local branches

### The Solution

**Dedicated workspace directory** with separate clones:

```
~/herdctl-workspace/              # Configurable root
├── bragdoc-ai/                   # Agent's clone
│   ├── .git/
│   ├── CLAUDE.md                 # Project's Claude config
│   ├── src/
│   └── ...
├── theturtlemoves/
└── edspencer-net/

~/Code/bragdoc-ai/                # Developer's clone (untouched)
```

### Configuration

```yaml
# herdctl.yaml
workspace:
  root: ~/herdctl-workspace  # Where agent repos live

  # Auto-clone strategy
  auto_clone: true           # Clone repos if not present
  clone_depth: 1             # Shallow clone (faster)
  default_branch: main       # Branch to track

projects:
  - name: bragdoc
    repo: edspencer/bragdoc-ai
    workspace_path: bragdoc-ai  # Relative to root
```

### Agent CWD

Each agent runs with CWD set to its project's workspace:

```typescript
// Runtime sets this before invoking SDK
process.chdir('/Users/ed/herdctl-workspace/bragdoc-ai');

// Agent now has access to:
// - CLAUDE.md, .claude/ directory
// - All project skills, conventions
// - Can git commit, push, etc.
```

### Workspace Initialization

```bash
# Initialize workspace for a project
herdctl workspace init bragdoc

# This does:
# 1. Creates ~/herdctl-workspace/bragdoc-ai/
# 2. git clone edspencer/bragdoc-ai
# 3. Sets up any required config
```

---

## State Management

All state is file-based in `.herdctl/` directory (no database required):

```
.herdctl/
├── state.yaml                    # Fleet state
├── jobs/
│   ├── job-2024-01-19-abc123.yaml   # Job metadata
│   ├── job-2024-01-19-abc123.jsonl  # Job output (streaming log)
│   ├── job-2024-01-19-def456.yaml
│   └── job-2024-01-19-def456.jsonl
├── sessions/
│   ├── bragdoc-coder.json        # Session info per agent
│   └── bragdoc-support.json
├── chat/
│   ├── discord-channels.json     # Channel → session mapping
│   └── discord-dms.json          # User → session mapping
└── logs/
    ├── bragdoc-coder.log         # Agent-level logs
    └── bragdoc-support.log
```

### Fleet State File

```yaml
# .herdctl/state.yaml
fleet:
  started_at: 2025-01-19T10:00:00Z

agents:
  bragdoc-coder:
    status: idle  # idle | running | error
    current_job: null
    last_job: job-2024-01-19-abc123
    next_schedule: issue-check
    next_trigger_at: 2025-01-19T10:10:00Z
    container_id: "abc123"  # if using Docker

  bragdoc-marketer:
    status: running
    current_job: job-2024-01-19-def456
    last_job: job-2024-01-19-xyz789
    next_schedule: null  # running now
    next_trigger_at: null
    container_id: "def456"
```

### Job Data Structure

```yaml
# .herdctl/jobs/job-2024-01-19-abc123.yaml
id: job-2024-01-19-abc123
agent: bragdoc-marketer
schedule: daily-analytics
trigger_type: cron

status: completed  # running | completed | failed | cancelled
exit_reason: success  # success | error | timeout | manual_cancel

session_id: claude-session-xyz789
forked_from: null  # if this was a forked session

started_at: 2024-01-19T09:00:00Z
finished_at: 2024-01-19T09:05:23Z
duration_seconds: 323

# Prompt that was used
prompt: |
  Analyze site traffic for the past 24 hours.
  Create a brief report and post to #marketing channel.

# Summary (extracted from final assistant message)
summary: "Generated daily analytics report. Traffic up 12% from yesterday."

# Output stored separately for size
output_file: job-2024-01-19-abc123.jsonl
```

### Job Output Log (JSONL)

```jsonl
# .herdctl/jobs/job-2024-01-19-abc123.jsonl
{"type":"system","subtype":"init","session_id":"xyz789","timestamp":"2024-01-19T09:00:00Z"}
{"type":"assistant","content":"I'll analyze the traffic data...","timestamp":"2024-01-19T09:00:01Z"}
{"type":"tool_use","name":"Bash","input":"node scripts/get-analytics.js","timestamp":"2024-01-19T09:00:02Z"}
{"type":"tool_result","content":"...analytics output...","timestamp":"2024-01-19T09:00:05Z"}
{"type":"assistant","content":"Traffic is up 12% from yesterday...","timestamp":"2024-01-19T09:00:10Z"}
```

This JSONL format allows:
- Streaming writes during job execution
- Easy parsing for web UI
- Resume/replay of job output

---

## Streaming & Monitoring

### Real-Time Output

Each job streams its output to multiple destinations:
1. Job log file (`.herdctl/jobs/<job-id>.jsonl`)
2. Web UI (via WebSocket)
3. CLI terminal (sectioned by agent)
4. Optional: Discord/Slack channel

### CLI Output

When running multiple agents, output is sectioned by agent:

```
[bragdoc-coder] 10:05:00 Waking up...
[bragdoc-coder] 10:05:01 Found issue #42: Fix login bug
[turtle-content] 10:05:02 Waking up...
[bragdoc-coder] 10:05:03 Reading issue body...
[turtle-content] 10:05:03 No ready issues found
[turtle-content] 10:05:04 Going back to sleep (next: 10:10:04)
[bragdoc-coder] 10:05:10 Implementing fix...
```

### Web UI Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  HERDCTL DASHBOARD                              [Settings] [?]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ bragdoc-coder   │  │ bragdoc-marketer│  │ turtle-content  │ │
│  │ ● RUNNING       │  │ ○ IDLE          │  │ ○ IDLE          │ │
│  │                 │  │                 │  │                 │ │
│  │ Job: abc123     │  │ Last: 2h ago    │  │ Last: 30m ago   │ │
│  │ Issue #42       │  │ Next: in 58m    │  │ Next: in 4m     │ │
│  │                 │  │                 │  │                 │ │
│  │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │ │
│  │ │ Reading     │ │  │ │ Completed   │ │  │ │ No issues   │ │ │
│  │ │ src/auth.ts │ │  │ │ analytics   │ │  │ │ found       │ │ │
│  │ │ ...         │ │  │ │ report      │ │  │ │             │ │ │
│  │ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │ │
│  │                 │  │                 │  │                 │ │
│  │ [Resume] [Fork] │  │ [Resume] [Fork] │  │ [Resume] [Fork] │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                  │
│  Recent Jobs                                            [See All]│
│  ├─ ✓ bragdoc-coder    issue-check    5m ago    (23s)          │
│  ├─ ✓ turtle-content   issue-check    30m ago   (12s)          │
│  ├─ ✓ bragdoc-marketer daily-analytics 2h ago   (5m 23s)       │
│  └─ ✗ bragdoc-coder    issue-check    3h ago    (error)        │
└─────────────────────────────────────────────────────────────────┘
```

### Web UI Agent Detail (Live Streaming)

```
┌─────────────────────────────────────────────────────────────────┐
│  bragdoc-coder                    ● RUNNING    [Stop] [Fork]    │
├─────────────────────────────────────────────────────────────────┤
│  Job: job-2024-01-19-abc123                                      │
│  Schedule: issue-check (every 5m)                                │
│  Started: 2 minutes ago                                          │
│  Session: claude-session-xyz789                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [Assistant] I'll check for ready issues in the repository.     │
│                                                                  │
│  [Tool] Bash: gh issue list --label ready --json number,title   │
│                                                                  │
│  [Result] [{"number":42,"title":"Fix auth timeout"}]            │
│                                                                  │
│  [Assistant] Found issue #42: "Fix auth timeout". Let me read   │
│  the full issue body and start working on it.                   │
│                                                                  │
│  [Tool] Bash: gh issue view 42                                  │
│                                                                  │
│  [Result] # Fix auth timeout                                    │
│           When users are inactive for >30 minutes...            │
│                                                                  │
│  [Assistant] I understand the issue. The auth token expires     │
│  but the frontend doesn't handle the refresh properly...        │
│                                                                  │
│  [Tool] Read: src/lib/auth.ts                                   │  ← Live
│  ▌                                                               │    cursor
├─────────────────────────────────────────────────────────────────┤
│  CLI Commands:                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ claude --resume xyz789        # Resume this session       │  │
│  │ claude --resume xyz789 --fork # Fork this session         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                    [Copy Resume] │
│                                                    [Copy Fork]   │
└─────────────────────────────────────────────────────────────────┘
```

### Resume/Fork Buttons

The web UI provides buttons to interact with running or completed sessions:

1. **Copy Resume Command**: Copies `claude --resume <session-id>` to clipboard
2. **Copy Fork Command**: Copies `claude --resume <session-id> --fork` to clipboard

This lets you jump into any agent session from your terminal to continue interacting manually.

### Web UI Features Summary

- **Dashboard**: Overview of all agents, status, recent activity
- **Agent Detail**: Live streaming output, session history
- **Job History**: Searchable list of all jobs with filtering
- **Logs**: Aggregated log viewer
- **Config Editor**: Edit herdctl.yaml and agent configs (optional)
- **Admin**: Start/stop agents, trigger manually

**Important**: The web UI is optional. All functionality works via CLI.

---

## Package Structure (Turborepo + pnpm)

```
herdctl/
├── packages/
│   ├── core/                 # @herdctl/core - Core library (TypeScript)
│   │   ├── src/
│   │   │   ├── config/       # Config parsing
│   │   │   ├── scheduler/    # Interval, cron scheduling
│   │   │   ├── runners/      # Agent runners
│   │   │   ├── work-sources/ # GitHub, (Jira, Linear)
│   │   │   └── state/        # State management
│   │   └── package.json
│   │
│   ├── cli/                  # herdctl - Main CLI package (what users install)
│   │   ├── src/
│   │   │   ├── commands/     # start, stop, status, trigger
│   │   │   └── index.ts
│   │   ├── bin/
│   │   │   └── herdctl       # CLI entry point
│   │   └── package.json
│   │
│   ├── web/                  # @herdctl/web - Local dashboard (Next.js)
│   │   ├── app/              # Runs locally for monitoring
│   │   │   ├── dashboard/
│   │   │   ├── agents/
│   │   │   └── logs/
│   │   └── package.json
│   │
│   ├── discord/              # @herdctl/discord - Discord connector
│   │   ├── src/
│   │   │   ├── bot.ts
│   │   │   └── router.ts
│   │   └── package.json
│   │
│   └── docker/               # Docker images
│       ├── Dockerfile.base
│       └── scripts/
│
├── docs/                     # Marketing + Documentation site (Astro/Starlight)
│   ├── astro.config.mjs
│   ├── package.json
│   ├── src/
│   │   ├── pages/
│   │   │   └── index.astro   # Landing page
│   │   ├── content/
│   │   │   ├── docs/         # Documentation markdown
│   │   │   │   ├── getting-started.md
│   │   │   │   ├── configuration.md
│   │   │   │   ├── agents.md
│   │   │   │   ├── schedules.md
│   │   │   │   ├── work-sources.md
│   │   │   │   ├── cli-reference.md
│   │   │   │   └── ...
│   │   │   └── config.ts
│   │   └── layouts/
│   └── public/
│
├── examples/                 # Example configurations
│   ├── simple/               # Single agent example
│   └── multi-project/        # Multiple projects example
│
├── turbo.json
├── package.json
└── LICENSE                   # License TBD
```

### Web Properties

| Property | Package | Tech | Purpose | Deployment |
|----------|---------|------|---------|------------|
| **Local Dashboard** | `packages/web/` | Next.js | Monitor agents, live streaming, config | Runs locally via `herdctl web` |
| **Marketing/Docs** | `docs/` | Astro + Starlight | Landing page, documentation | Cloudflare Pages → herdctl.dev |

The `docs/` directory is a full Astro site using Starlight (Astro's docs theme). Documentation is written in markdown in `docs/src/content/docs/` and rendered by Astro. No content duplication - markdown is the source of truth.

### Release & npm Publishing

**Versioning**: Managed via [changesets](https://github.com/changesets/changesets) for semantic versioning across the monorepo.

**Publishing Strategy**: Uses **OIDC trusted publishing** (as of December 2025, npm classic tokens are revoked):
- No long-lived npm tokens stored in CI
- Short-lived, workflow-specific credentials via GitHub Actions OIDC
- Automatic provenance attestations for supply chain security
- Requires npm >= 11.5.1 or Node.js >= 24

**Workflow**:
1. Contributors run `pnpm changeset` to describe changes
2. On merge to main, GitHub Action creates "Version Packages" PR
3. When Version Packages PR is merged, packages are published to npm via OIDC

**Package Access**:
| Package | npm Name | Access |
|---------|----------|--------|
| CLI | `herdctl` | public |
| Core | `@herdctl/core` | public |
| Web | `@herdctl/web` | public |
| Discord | `@herdctl/discord` | public |

---

## CLI Commands

```bash
# Fleet management
herdctl start                    # Start all agents
herdctl start bragdoc-coder      # Start specific agent
herdctl stop                     # Stop all agents
herdctl stop bragdoc-coder       # Stop specific agent
herdctl restart                  # Restart all agents

# Status & monitoring
herdctl status                   # Show fleet status
herdctl status bragdoc-coder     # Show agent status
herdctl logs                     # Tail all logs
herdctl logs bragdoc-coder       # Tail specific agent
herdctl logs -f                  # Follow mode

# Manual triggers
herdctl trigger bragdoc-coder                    # Trigger wake
herdctl trigger bragdoc-coder --prompt "..."     # With custom prompt
herdctl trigger bragdoc-coder --payload '{...}'  # With payload (webhook sim)

# Configuration
herdctl config validate          # Validate config files
herdctl config show              # Show merged config

# Chat connectors
herdctl discord start            # Start Discord bot
herdctl discord status           # Show bot status

# Web UI
herdctl web                      # Start web UI (default: localhost:3000)
herdctl web --port 8080          # Custom port

# Initialization
herdctl init                     # Initialize new herdctl project
herdctl init --example simple    # From example template
```

---

## Docker Strategy

### One Container Per Agent

Each agent runs in its own Docker container:
- Isolation between agents
- Independent resource limits
- Clean restart capability
- Parallel execution

### Base Image

```dockerfile
# Dockerfile.base
FROM node:20-slim

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Install GitHub CLI
RUN apt-get update && apt-get install -y gh

# Create agent user
RUN useradd -m -s /bin/bash agent
USER agent

# Working directory
WORKDIR /home/agent

# Entry point (overridden per agent)
CMD ["claude", "--help"]
```

### Agent Container

```dockerfile
# Generated or user-provided per agent
FROM herdctl-base:latest

# Copy agent identity
COPY CLAUDE.md /home/agent/CLAUDE.md
COPY knowledge/ /home/agent/knowledge/

# Set working directory to repo
WORKDIR /home/agent/repo

# Entry point
CMD ["herdctl-runner"]
```

---

## Webhooks

### Incoming Webhooks

Herdctl can expose HTTP endpoints for external triggers:

```yaml
# herdctl.yaml
webhooks:
  enabled: true
  port: 8081
  secret_env: WEBHOOK_SECRET  # for signature verification
```

```bash
# External service calls:
curl -X POST http://localhost:8081/trigger/bragdoc-coder \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"event": "issue.labeled", "issue": {"number": 42}}'
```

### GitHub Webhooks

Direct integration with GitHub webhooks for real-time triggers:
- Issue labeled → trigger coder agent
- PR opened → trigger reviewer agent
- Comment created → trigger support agent

---

## Security Considerations

### Credentials

- All tokens via environment variables
- Never stored in config files
- Docker secrets for production

### Agent Isolation

- Each agent in separate container
- No cross-agent file access
- Network isolation optional

### GitHub Tokens

- Fine-grained PATs recommended
- No delete permissions
- Scoped to specific repos

---

## MVP Scope

### Phase 1: Core
- [ ] Config parser (YAML)
- [ ] Interval-based scheduler
- [ ] GitHub Issues work source
- [ ] Single-agent runner
- [ ] CLI: start, stop, status
- [ ] File-based state
- [ ] Streaming output

### Phase 2: Multi-Agent
- [ ] Fleet runner (multiple agents)
- [ ] Log sectioning
- [ ] Agent isolation (containers)
- [ ] Manual trigger command

### Phase 3: Web UI
- [ ] Dashboard
- [ ] Agent detail view
- [ ] Log viewer
- [ ] Basic admin controls

### Phase 4: Chat
- [ ] Discord bot connector
- [ ] Channel → agent routing
- [ ] Per-channel sessions
- [ ] DM support

### Future
- [ ] Cron scheduling
- [ ] Webhook triggers
- [ ] Slack connector
- [ ] Jira work source
- [ ] Multi-instance agents
- [ ] Agent type templates

---

## CLAUDE.md Recommendations for Target Projects

For best results, target projects should add agent-awareness to their CLAUDE.md. This is **optional** but improves agent behavior.

### Recommended Addition

```markdown
## Automated Agent Operations

This project may be operated by automated agents (via herdctl).

When running as an automated agent:
- Check journal.md for recent context and current state
- Update journal.md before completing each task
- Use conventional commit messages
- Create PRs for significant changes (don't push directly to main)
- If stuck, document the issue and move on

### Agent-Specific Files

- `journal.md` - Persistent memory across sessions
- `.claude/knowledge/` - Domain-specific context
- `.claude/skills/agent/` - Agent-specific skills (optional)
  - `/continue` - Resume work, check for tasks
  - `/report` - Generate status report
```

### Why This Helps

1. **Journal pattern**: Agents can maintain context across sessions via journal.md
2. **Safe git practices**: Agents know to create PRs, not push to main
3. **Graceful failure**: Agents know to document blockers and continue
4. **Skill discovery**: Agents know what skills are available

### Without This

Agents will still work, but:
- May push directly to main (if permissions allow)
- Won't use journal.md for context persistence
- May get stuck without documenting why

---

## Future Considerations

### Cross-Channel Memory

**Problem**: When an agent is available across multiple channels (Discord channels, Slack workspaces, DMs), each channel has an isolated session. If a user tells the agent something in Channel A, the agent won't remember it when talking in Channel B - unlike a human colleague who maintains context across conversations.

**Solution**: Give agents a tool to explicitly search their conversation history across channels.

```typescript
// Tool available to agent
interface SearchConversationsInput {
  query: string;
  channels?: string[];  // Limit scope (privacy control)
  timeRange?: { from: Date; to: Date };
}

// Agent uses it when context seems missing
"Let me check if we discussed this in another channel..."
[calls search_conversations({ query: "OAuth PKCE flow" })]
"Ah yes, in #api-design you mentioned you're using OAuth2 with PKCE..."
```

**Architecture**:
```
┌─────────────────────────────────────────────────────┐
│                 Conversation Memory                  │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Channel A  │  │  Channel B  │  │  Channel C  │ │
│  │  History    │  │  History    │  │  History    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Index / Embeddings                 ││
│  │         (searchable across channels)            ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                      Agent                           │
│                                                      │
│  Tools:                                              │
│  - search_conversations(query, scope?)              │
│  - get_channel_summary(channelId)                   │
│  - list_active_conversations()                      │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Why tool-based (not automatic injection)**:
- **Explicit**: Agent decides when to look things up
- **Auditable**: You can see when cross-channel context was used
- **Privacy-controllable**: Configure which channels can see which
- **Mirrors human behavior**: "Let me check what we discussed elsewhere"

**Implementation approaches** (future):
1. **Simple**: LLM-as-retrieval (ask Claude to search recent messages)
2. **Sophisticated**: Vector embeddings for large history (OpenAI embeddings, local model)

**Privacy model**:
```yaml
# Agent config
memory:
  cross_channel_search: true
  access_rules:
    - channels: ["support-*"]      # Support channels can see each other
      can_search: ["support-*"]
    - channels: ["sales-*"]        # Sales channels isolated
      can_search: ["sales-*"]
    - channels: ["exec-*"]         # Exec channels see everything
      can_search: ["*"]
```

Or per-user scope (user's conversations across channels are searchable, but not other users').

**When to build**:
1. Ship Discord/Slack MVP with isolated sessions (current plan)
2. Add simple LLM-as-retrieval version post-MVP
3. Vector embeddings if history grows large

---

### Multiple Runtime Backends

While we're starting with Claude Code only, the architecture doesn't preclude other backends:

```typescript
// Future: Pluggable runtime interface
interface AgentRuntime {
  query(prompt: string, options: RuntimeOptions): AsyncIterable<Message>;
  resumeSession(sessionId: string): AsyncIterable<Message>;
  getCapabilities(): RuntimeCapabilities;
}

// Implementations
class ClaudeAgentRuntime implements AgentRuntime { ... }
class AiderRuntime implements AgentRuntime { ... }  // Future
class GeminiRuntime implements AgentRuntime { ... } // Future
```

**Not building this now** - but keeping the door open by:
- Not hardcoding Claude-specific logic throughout
- Keeping runtime invocation in one place
- Using generic message types where possible

### Multi-Instance Agents

Currently: One instance per agent (enforced via lock file).

Future possibility:
- Multiple instances of same agent for parallelism
- Each instance gets unique session ID
- Coordination via work queue (prevent duplicate work)

---

## Open Questions

### Resolved

- **MCP per agent**: ✓ Solved - SDK supports programmatic MCP configuration per agent
- **Workspace git strategy**: Out of scope - left to individual agent CLAUDE.md configuration
- **Package manager**: pnpm (mature ecosystem, good monorepo support)

### Post-v1 Features

These are important but not blocking v1 release:

1. **Agent templates/types**: Reusable base configurations that agents can extend. Would reduce duplication for similar agents (e.g., all "coder" agents share common config).

2. **Multi-instance agents**: Running multiple instances of the same agent in parallel for higher throughput. Requires work queue coordination to prevent duplicate work.

3. **Cost tracking**: Track Claude API costs per agent. Useful for budgeting and identifying expensive agents. May require API-level integration.

4. **Approval workflows**: Human-in-the-loop for certain actions (e.g., require approval before pushing to main, deploying, or spending over threshold).

### Still Open

1. **Session lifetime**: When should sessions be cleared vs. persisted indefinitely? Options:
   - Clear after N days of inactivity
   - Clear when context gets too large
   - Never clear (let Claude manage)

---

## Comparison to Ralph Wiggum

| Aspect | Ralph Wiggum | Herdctl |
|--------|--------------|---------|
| Focus | Single task → completion | Continuous fleet operation |
| Agents | Specialized "hats" within workflow | Independent agents with identities |
| Scheduling | Run until done | Interval, cron, webhook, chat |
| Work Source | User-provided PRD | Pluggable (GitHub, Jira, chat) |
| Scope | One session, one goal | Many agents, ongoing operation |
| Chat | None | Discord, Slack integration |

**Ralph is episodic. Herdctl is continuous.**

Ralph: "Build me this feature overnight."
Herdctl: "Run my business operations indefinitely."

---

## References

- [Ralph Wiggum Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum)
- [Ralph Orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)
- [Claude Code Headless Docs](https://docs.anthropic.com/en/docs/claude-code/headless)
- [MCP Protocol](https://modelcontextprotocol.io/)
