<p align="center">
  <img src="docs/public/herdctl-logo.svg" alt="herdctl" width="120" />
</p>

<h1 align="center">herdctl</h1>

<p align="center">
  <strong>Let Claude Code invoke itself.</strong><br/>
  Run agents on schedules, chat with them on Discord, and resume any session in your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/herdctl"><img src="https://img.shields.io/npm/v/herdctl.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/edspencer/herdctl/actions"><img src="https://github.com/edspencer/herdctl/workflows/CI/badge.svg" alt="CI Status"></a>
</p>

<p align="center">
  <a href="https://herdctl.dev">Documentation</a> •
  <a href="https://herdctl.dev/getting-started/">Getting Started</a> •
  <a href="https://discord.gg/d2eXZKtNrh">Discord</a> •
  <a href="https://github.com/edspencer/herdctl/issues">Issues</a>
</p>

---

## The Vision

Claude Code has changed the world, but most of the work it does is supervised by a human. What if Claude Code could invoke itself?

**herdctl** is an orchestration layer for Claude Code. Under the hood, it uses the Claude Agents SDK to trigger Claude Code sessions on schedules, via webhooks, or via chat messages.

It uses simple .yml files that are a thin wrapper around Claude Agents SDK configs, plus a couple of extra features provided by herdctl - `schedules`, `chat` and `hooks`. Each Agent defined this way can have any number of **schedules** that trigger the agent to do something automatically.

herdctl can run **fleets of agents**, each with their own source-controllable configurations. Agent fleets can be run anywhere via a simple `herdctl start` command.

herdctl allows you to interact with all of your existing Claude Code projects via **chat apps like Discord and Slack** (Telegram support coming soon).

## Key Features

- **Self-Invoking Agents** — Define agents that wake themselves up on schedules or triggers. Coordinate an entire fleet from a single `herdctl start` command.

- **Fleet Composition** — Build "super-fleets" from multiple project fleets. Each project keeps its own agent configurations, but they all run together with a unified web dashboard and CLI.

- **Full Claude Code Power** — If Claude Code can do it, your herdctl agent can do it. Same tools, same MCP servers, same capabilities. herdctl is a thin orchestration layer, not a sandbox.

- **Two Runtimes** — CLI runtime uses your Claude Max subscription (much cheaper per token). SDK runtime uses API pricing. Both support Docker isolation with resource limits and network controls.

- **Chat From Anywhere** — Connect agents to Discord or Slack. Message your agents from your phone, get responses, and they continue working based on your conversation. Your PR reviewer bot becomes a team member you can @ mention.

- **Session Continuity** — Every job creates a real Claude SDK session. When an agent finishes, you can `claude --resume` that exact session in your terminal. Pick up where the agent left off with full context intact.

- **Bidirectional Communication** — Agents write structured data back to herdctl via metadata files. Hooks act on that data. Coming soon: agents that request schedule changes, store persistent context, and evolve their own behavior over time.

## Intro Video

In which we try to cover all of the main parts of herdctl in 20 minutes:

<div align="center">
  <a href="https://www.youtube.com/watch?v=b3MRrpHLu8M">
    <img src="https://img.youtube.com/vi/b3MRrpHLu8M/maxresdefault.jpg" alt="herdctl demo" width="600">
  </a>
  <p><em>Watch the demo</em></p>
</div>

## Quick Start

```bash
# Install herdctl globally
npm install -g herdctl

# Initialize a new project with example agents
herdctl init

# Start your agent fleet
herdctl start
```

Your agents are now running. Check their status:

```bash
herdctl status
```

## Runtime & Isolation

**CLI Runtime (default)**: Uses Claude CLI. Can authenticate with Claude Max subscription tokens (much cheaper) or API key.

**SDK Runtime**: Uses Claude Agent SDK. API key only (more expensive per token).

```yaml
# Use SDK runtime
runtime: sdk
```

**Docker Isolation (opt-in)**: Run agents in containers with resource limits and network controls.

```yaml
docker:
  enabled: true
  memory: 2g
  env:
    GITHUB_TOKEN: "${GITHUB_TOKEN}"  # Auto-configures git auth
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Fleet** | A collection of agents running together, defined in `herdctl.yaml` |
| **Agent** | An autonomous Claude Code instance with its own identity, schedule, and permissions |
| **Schedule** | When an agent wakes up: interval (`5m`), cron (`0 9 * * *`), or on-demand |
| **Trigger** | What starts a job: schedule tick, webhook, chat message, or manual `herdctl trigger` |
| **Job** | A single execution of an agent, with start time, duration, output, and status |
| **Session** | The Claude SDK conversation context, resumable by humans or continued in chat |

## Example Agents

There's an essentially infinite number of Claude Code agents that would benefit from being invoked by means other than a human typing at a keyboard. Any task that's repetitive, time-sensitive, or benefits from continuous monitoring is a candidate. Here are a few examples to spark ideas:

### Competitive Analysis Agent
Track your competitors automatically. Configure a daily scan to check competitor websites, pricing pages, and feature announcements. When something changes—a new feature launches, pricing shifts, or a major announcement drops—get notified immediately. Add a second schedule for weekly summary reports that get emailed to your team. One agent, multiple schedules, continuous market intelligence.

### Hurricane Tracker
Monitor NOAA for tropical storm activity. The example agent checks every few hours and sends a Discord notification if conditions warrant attention. *(Coming soon: agents will be able to dynamically adjust their own schedules—this agent could check weekly off-season, daily during hurricane season, and hourly when a storm is approaching your area.)*

**[See the example →](examples/hurricane-watcher/)**

### Price Checker
Monitor prices across retailers for a specific product. When the target price is hit, notify yourself on Discord. In theory, the agent could go further—drafting purchase emails, negotiating warranty terms, completing the transaction. All while you sleep.

**[See the example →](examples/price-checker/)**

### PR Review Bot
Every morning at 9am, review all open PRs. Leave thoughtful comments, suggest improvements, flag security issues. The same agent can be triggered via Discord: "Hey, can you take another look at PR #47?"

### Support Assistant
Answer questions in your Discord server. When a question gets complex, tell users "Let me look into that"—then you resume the exact same session in your terminal to investigate with full context.

### Documentation Agent
Scan your codebase weekly for undocumented functions. Generate JSDoc comments, update README files, create examples. Review its own output before committing.

### Software Developer Agent

This one deserves special attention. Point a herdctl agent at your existing codebase and it operates exactly as if you ran `claude` in that directory yourself. Your `CLAUDE.md` instructions are honored. Your custom slash commands work. Your MCP servers are available. The agent *is* a Claude Code session for that project.

Now connect that to Discord. Your software developer agent becomes a team member you can message:

```
You: "Hey, what's the current state of the authentication system?"
Agent: "Looking at the codebase... Authentication uses JWT tokens stored in
       HttpOnly cookies. The main logic is in src/auth/. Want me to explain
       any specific part?"

You: "Can you add rate limiting to the login endpoint?"
Agent: "On it. I'll add rate limiting using the existing Redis connection..."
```

The agent has full context of your codebase, can answer questions, and can make changes—all from a Discord conversation on your phone. When you get back to your desk, `claude --resume` the session to review what it did.

### Engineering Manager Agent

Not every issue should go straight to a developer. An Engineering Manager agent can be the first line of defense when issues get filed—triaging, asking clarifying questions, estimating complexity, and tagging appropriately. Only when an issue has been approved and marked "ready for development" does the Software Developer agent get triggered.

Chain your agents: the manager triages, the developer implements, the reviewer checks the PR. Each agent has its own identity and responsibilities, working together like a team.

### Community & Product Intelligence Agent

Monitor the places your customers talk: Reddit, Hacker News, Twitter, Discord servers, Stack Overflow. Configure scheduled scans to find mentions of your product, questions from confused users, feature requests, complaints, and competitive chatter.

The agent can do pure intelligence gathering—summarizing what it found and surfacing important items. Or it can run the whole operation: drafting responses, flagging urgent issues to your team, and engaging with the community on your behalf.

Triggers don't have to be schedules. Webhooks can fire when someone mentions your product, kicking off an immediate response workflow. The agent becomes your always-on community presence.

### CTO / Overseer Agent

Here's where it gets meta. If you're running multiple projects with multiple agents each, you might want an agent dedicated to *managing your other agents*.

A CTO agent could:
- Review agent performance and suggest configuration improvements
- Create new agents when patterns emerge ("we need a dedicated security scanner")
- Edit existing agent prompts based on what's working
- Disable agents that aren't providing value

This is future capability—agents that create, modify, and delete other agents will need proper access control and permissioning. But the architecture supports it. An agent is just a YAML file and a prompt. Another agent can write YAML files.

### Two Categories of Agents

Every herdctl agent has a workspace directory. This creates two natural categories:

**Standalone agents** have their own dedicated workspace for storing data. The price checker keeps price history in its folder. The hurricane tracker stores weather data. These agents don't need an existing codebase—they create their own working environment.

**Project-embedded agents** run inside an existing Claude Code project—one that already has a `CLAUDE.md`, local skills, sub-agents, and project-specific configuration. When you point a herdctl agent at an existing project, it operates exactly as if you ran `claude` in that directory. Your instructions are honored. Your slash commands work. Your MCP servers are available.

This means you can add autonomous capabilities to any existing Claude Code project. Your current codebase, with all its context, becomes accessible to scheduled jobs, chat interfaces, and webhook triggers.

## Scheduled Agents

Agents can run on fixed intervals or cron schedules:

```yaml
# agents/daily-reviewer.yaml
name: daily-reviewer
model: claude-sonnet-4-20250514

schedules:
  morning-review:
    type: cron
    cron: "0 9 * * *"  # Every day at 9am
    prompt: "Review all open PRs and provide feedback"

  quick-check:
    type: interval
    interval: 30m
    prompt: "Check for any new critical issues"
```

Each schedule can have its own prompt, permissions, and work source. An agent might do a deep review once daily but quick checks every 30 minutes.

## Chat Integration

### Discord (Available Now)

Your agents can live in Discord. Users DM them questions. Channels become collaborative workspaces. Setup takes about a minute:

```yaml
# agents/support-bot.yaml
name: support-bot
model: claude-sonnet-4-20250514

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    mode: auto  # Respond to all DMs
    allowed_channels:
      - "1234567890"  # Support channel
    allowed_roles:
      - "9876543210"  # Team member role
```

**Features:**
- **DMs and Channels**: Users can chat privately or in shared spaces
- **Session Persistence**: The bot remembers conversation context across messages
- **Slash Commands**: Built-in `/status`, `/reset`, `/help`
- **Role-Based Access**: Control who can interact with each agent
- **Typing Indicators**: Visual feedback while the agent thinks

### Slack (Available Now)

Your agents can respond in Slack channels and DMs. Uses Socket Mode — no public URL needed:

```yaml
# agents/support-bot.yaml
chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    channels:
      - id: "C1234567890"
        mode: auto
    dm:
      enabled: true
```

**Features:**
- **Channels and DMs**: Route agents to specific channels or enable direct messages
- **Socket Mode**: No public URL or webhook endpoint needed
- **Session Persistence**: Conversation context maintained across messages
- **Message Threading**: Responses in threads keep channels organized
- **Markdown Conversion**: Agent output automatically converted to Slack's mrkdwn format

### Web Dashboard (Available Now)

Monitor your fleet and chat with agents from your browser. Enable the web dashboard with a single flag:

```bash
herdctl start --web
```

Or in your fleet config:

```yaml
web:
  enabled: true
  port: 3232
```

The dashboard provides real-time fleet status, agent detail views, schedule management, job history, and interactive chat — all updated live over WebSocket.

### Coming Soon

- **WhatsApp**: Personal assistant on your phone
- **iMessage**: Native Apple Messages integration
- **Telegram**: Bot API integration

## Web Dashboard

<div align="center">
  <img src="docs/src/assets/screenshots/fleet-overview.png" alt="herdctl web dashboard" width="800">
  <p><em>Fleet overview showing agents, status, and recent jobs</em></p>
</div>

The web dashboard gives you a browser-based control panel for your fleet. Enable it with `herdctl start --web` or `web.enabled: true` in your config.

**What you get:**
- **Fleet overview** — real-time status of all agents and recent jobs
- **Agent detail** — live output streaming, schedule controls, job history
- **Interactive chat** — message any agent directly from the browser
- **Schedule management** — trigger, enable, and disable schedules
- **Job management** — cancel, fork, and inspect jobs
- **Dark mode** — light, dark, and system theme support

See the [web dashboard documentation](https://herdctl.dev/integrations/web-dashboard/) for full details.

## Session Continuity

This is herdctl's superpower. Every agent job creates a real Claude SDK session with a persistent ID.

### Resume in Terminal

Your price checker just completed job #200. You want to ask it about a decision it made:

```bash
# Find the session ID
herdctl job job-2024-01-15-abc123

# Resume in Claude Code
claude --resume clsn_abc123xyz
```

You're now in the exact same conversation. Full context. All the agent's reasoning is there. Ask follow-up questions, give new instructions, or just review what happened.

### Continue in Chat

When a Discord user chats with an agent, they get their own persistent session:

```
User: Hey, can you check the status of my order?
Bot: I can see order #12345 shipped yesterday. Want tracking details?
User: Yes please

[... hours later ...]

User: Did that order arrive yet?
Bot: Checking... Yes! It was delivered at 2:47pm to your front door.
```

The bot remembers the entire conversation. No "Sorry, I don't have context about previous messages."

### Cross-Interface Continuity

The same session can move between interfaces:

1. Agent runs on schedule, analyzes data, creates session
2. You `claude --resume` to review its work in terminal
3. A colleague asks about it on Discord—same session continues
4. You finish up back in terminal

One continuous conversation across time and interfaces.

## Agent Communication

Agents can do more than output text. They communicate structured data back to herdctl.

### Metadata Files

Agents can write a `metadata.json` file during execution:

```json
{
  "shouldNotify": true,
  "lowestPrice": 159,
  "retailer": "Staples",
  "meetsTarget": true,
  "nextCheckIn": "2024-01-16T09:00:00Z"
}
```

This data is included in hook context, enabling conditional automation.

### Execution Hooks

Hooks run after jobs complete. They receive full job context including agent metadata:

**Shell Hooks**: Run any command with job data piped to stdin

```yaml
hooks:
  after_run:
    - type: shell
      command: ./scripts/process-result.sh
      when: "metadata.meetsTarget"  # Only run when target met
```

**Webhook Hooks**: POST to external APIs

```yaml
hooks:
  after_run:
    - type: webhook
      url: https://api.example.com/job-complete
      headers:
        Authorization: "Bearer ${API_TOKEN}"
```

**Discord Hooks**: Send rich notifications

```yaml
hooks:
  after_run:
    - type: discord
      channel_id: "${DISCORD_ALERTS_CHANNEL}"
      bot_token_env: DISCORD_BOT_TOKEN
      when: "metadata.shouldNotify"
```

### Hook Events

Hooks can trigger on specific job outcomes:

```yaml
hooks:
  after_run:
    - type: shell
      command: ./celebrate.sh
      on_events: [completed]  # Only on success

    - type: discord
      channel_id: "${ALERTS_CHANNEL}"
      on_events: [failed, timeout]  # Only on problems
```

Events: `completed`, `failed`, `timeout`, `cancelled`

### Hook Context

Every hook receives comprehensive job data:

```json
{
  "event": "completed",
  "job": {
    "id": "job-2024-01-15-abc123",
    "agentId": "price-checker",
    "scheduleName": "hourly-check",
    "startedAt": "2024-01-15T09:00:00.000Z",
    "completedAt": "2024-01-15T09:03:30.000Z",
    "durationMs": 210000,
    "sessionId": "clsn_abc123xyz"
  },
  "result": {
    "success": true,
    "output": "Found lowest price at Staples: $159"
  },
  "metadata": {
    "shouldNotify": true,
    "lowestPrice": 159
  }
}
```

## Self-Evolving Agents (Coming Soon)

The next frontier: agents that modify their own behavior.

### Dynamic Schedules

Imagine an agent that says: "This situation needs closer monitoring. Wake me in 37 minutes instead of the usual 4 hours."

```json
// metadata.json
{
  "requestedNextRun": "2024-01-15T10:37:00Z",
  "reason": "Storm trajectory update expected"
}
```

herdctl will read this and adjust the next trigger accordingly.

### Persistent Context

Agents can maintain a `context.md` file in their workspace—a persistent memory that survives across jobs:

```markdown
# Agent Context

## Learned Preferences
- User prefers concise summaries
- Always include links to source data
- Escalate price drops > 20%

## Current State
- Monitoring: Sony WH-1000XM5
- Target price: $279
- Best seen: $299 at Amazon (2024-01-14)
```

Each job reads this context, acts on it, and can update it for future runs.

### Self-Modification

Advanced agents could:
- Update their own `CLAUDE.md` instructions
- Write new slash command skills
- Modify their YAML configuration
- Commit and push changes to GitHub

An agent that improves itself over time, learning from each interaction.

## Tools & MCP Configuration

Each agent can have its own tool permissions and MCP server configuration:

```yaml
# agents/code-reviewer.yaml
name: code-reviewer
model: claude-sonnet-4-20250514

permission_mode: bypassPermissions
allowed_tools:
  - Read
  - Glob
  - Grep
  - Bash  # Careful with this one

mcp_servers:
  - name: github
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

The Claude SDK's full capabilities flow through to your agents. Any MCP server, any tool configuration.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Application                         │
├─────────────────────────────────────────────────────────────────┤
│  herdctl CLI   │  @herdctl/core  │  @herdctl/web               │
│  (Commands)    │  (Library)      │  (Dashboard)                 │
├────────────────┴─────────────────┴──────────────────────────────┤
│                        FleetManager                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Scheduler │  │ JobRunner │  │  State   │  │ HookExecutor  │  │
│  │ (cron,   │  │ (spawns   │  │ Manager  │  │ (shell,       │  │
│  │ interval)│  │ agents)   │  │ (.herd/) │  │ webhook)      │  │
│  └──────────┘  └───────────┘  └──────────┘  └───────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      @herdctl/chat                               │
│              (Session management, streaming)                     │
├─────────────────────────────────────────────────────────────────┤
│  @herdctl/discord  │  @herdctl/slack  │  @herdctl/web (chat)   │
│  (Discord Bot)     │  (Slack Bot)     │  (Browser chat)        │
├─────────────────────────────────────────────────────────────────┤
│                        Claude SDK                                │
│              (Sessions, Tools, MCP Servers)                      │
└─────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Library-first**: All logic lives in `@herdctl/core`. CLI and connectors are thin wrappers.
- **Single process**: The fleet runs in one Node.js process. Agents spawn as child processes.
- **Persistent state**: Jobs, sessions, and fleet status are stored in `.herdctl/` for crash recovery.

## Packages

| Package | Description |
|---------|-------------|
| [`herdctl`](https://www.npmjs.com/package/herdctl) | CLI for fleet management. Install globally, run `herdctl start`. |
| [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) | Core library. Embed fleet management in your own applications. |
| [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) | Web dashboard. Real-time fleet monitoring, agent chat, and job management in your browser. |
| [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) | Discord connector. Chat with your agents via Discord DMs and channels. |
| [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) | Slack connector. Chat with your agents via Slack channels and DMs. |
| [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) | Shared chat infrastructure. Session management, streaming, and message handling used by all connectors. |

### Using the Library

```typescript
import { FleetManager } from '@herdctl/core';

const fleet = new FleetManager();
await fleet.initialize();
await fleet.start();

// Subscribe to events
fleet.on('job:completed', (event) => {
  console.log(`Agent ${event.agentName} finished: ${event.result.output}`);
});

// Trigger an agent programmatically
await fleet.trigger('my-agent', undefined, {
  prompt: 'Check for new issues',
  onMessage: (msg) => process.stdout.write(msg.content)
});

// Query state
const jobs = await fleet.listJobs({ limit: 10 });
const status = await fleet.getStatus();
```

## Configuration Reference

### Fleet Configuration (`herdctl.yaml`)

```yaml
fleet:
  name: my-fleet
  log_level: info

agents:
  - path: ./agents/reviewer.yaml
  - path: ./agents/monitor.yaml
  - path: ./agents/support-bot.yaml

# Global hooks (run for all agents)
hooks:
  after_run:
    - type: webhook
      url: https://api.example.com/fleet-activity
```

### Fleet Composition

Compose multiple project fleets into a single "super-fleet":

```yaml
version: 1

fleet:
  name: engineering
  web:
    enabled: true
    port: 3232

fleets:
  - path: ~/projects/herdctl/herdctl.yaml
  - path: ~/projects/bragdoc/herdctl.yaml
  - path: ~/projects/webapp/herdctl.yaml

agents:
  - path: ./agents/overseer.yaml  # Fleet-wide agent
```

Agents get qualified names like `herdctl.security-auditor` or `bragdoc.developer`. Use these with CLI commands:

```bash
herdctl trigger herdctl.security-auditor
herdctl status bragdoc.developer
```

See [Fleet Composition](https://herdctl.dev/configuration/fleet-config/#fleets) for full documentation.

### Agent Configuration

```yaml
name: my-agent
description: What this agent does
model: claude-sonnet-4-20250514

# Working directory for the agent
workspace:
  path: ./workspace

# How the agent wakes up
schedules:
  daily:
    type: cron
    cron: "0 9 * * *"
    prompt: "Good morning! Here's your daily task..."

  frequent:
    type: interval
    interval: 15m
    work_source:
      type: github_issues
      repo: org/repo

# Chat interfaces
chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    mode: auto
    allowed_channels: ["123456789"]

# Tool access
permission_mode: bypassPermissions
allowed_tools: [Read, Glob, Grep, Bash]

# MCP servers
mcp_servers:
  - name: filesystem
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]

# Agent-specific hooks
hooks:
  after_run:
    - type: discord
      channel_id: "${ALERTS_CHANNEL}"
      when: "metadata.important"

# Metadata file location (default: metadata.json)
metadata_file: metadata.json
```

## CLI Commands

```bash
herdctl init              # Initialize new project
herdctl start [agent]     # Start fleet or specific agent
herdctl stop [agent]      # Stop fleet or specific agent
herdctl status [agent]    # Show fleet/agent status
herdctl trigger <agent>   # Manually trigger an agent
herdctl logs [agent]      # Tail agent logs
herdctl jobs              # List job history
herdctl job <id>          # Show job details
herdctl fork <job-id>     # Fork a job with new instructions
```

## Roadmap

We're building toward a future where AI agents are first-class participants in your development workflow:

- **More Chat Integrations**: WhatsApp, iMessage, Telegram
- **Dynamic Scheduling**: Agents request their own next run time
- **Persistent Agent Memory**: Context files that survive across jobs
- **Agent Self-Modification**: Update own configs, write skills
- **Agent-to-Agent Communication**: Agents that delegate to other agents
- **Marketplace**: Share and discover agent configurations

## Documentation

Full documentation at [herdctl.dev](https://herdctl.dev):

- [Getting Started](https://herdctl.dev/getting-started/)
- [Configuration Reference](https://herdctl.dev/configuration/fleet-config/)
- [CLI Reference](https://herdctl.dev/cli-reference/)
- [Library Reference](https://herdctl.dev/library-reference/fleet-manager/)
- [Guides & Recipes](https://herdctl.dev/guides/recipes/)

## Development

```bash
# Clone the repo
git clone https://github.com/edspencer/herdctl
cd herdctl

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Community

- [Discord](https://discord.gg/d2eXZKtNrh) - Chat with the community
- [GitHub Discussions](https://github.com/edspencer/herdctl/discussions) - Ask questions, share ideas
- [Twitter/X](https://twitter.com/edspencer) - Updates and announcements

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built by <a href="https://edspencer.net">Ed Spencer</a>
</p>
