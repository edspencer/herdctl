# Slack Integration Testing Guide

## Overview

This guide walks through manually testing the herdctl Slack integration end-to-end
using Docker. The test agent will work on an existing repo, with Perplexity and Slack
MCP servers available for search and Slack access.

**Architecture**:
```
┌──────────────────────────────────────────────────────────────┐
│  Docker Compose (shared network: herdctl-net)                │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ perplexity   │  │ slack-mcp    │  │ (other MCP   │       │
│  │ MCP server   │  │ MCP server   │  │  servers)    │       │
│  │ :8080/mcp    │  │ :8081/mcp    │  │              │       │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘       │
│         │                 │                                  │
│  ┌──────┴─────────────────┴──────────────────────────────┐   │
│  │  herdctl container                                    │   │
│  │  - FleetManager process                               │   │
│  │  - SlackManager (Socket Mode ↔ Slack API)             │   │
│  │  - Docker socket mounted (to spawn agents)            │   │
│  │                                                       │   │
│  │  spawns ──►  ┌───────────────────────────────┐        │   │
│  │              │ Agent container               │        │   │
│  │              │ - Claude Code (OAuth)          │        │   │
│  │              │ - MCP: perplexity, slack-mcp   │        │   │
│  │              │ - /workspace = mounted repo    │        │   │
│  │              └───────────────────────────────┘        │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

herdctl runs in one container, orchestrates agent containers via Docker socket.
Agents are sibling containers on the same Docker network — they reach MCP servers
by service name (e.g., `http://perplexity:8080/mcp`).

---

## Prerequisites

- Docker and Docker Compose installed
- A Slack workspace where you can install apps
- Claude Max/Pro subscription (OAuth authentication)
- An existing repo you want the agent to work on

---

## Step 1: Create the Slack App

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**
2. Name it (e.g., `herdctl-test`), select your workspace

### Enable Socket Mode

3. **Settings → Socket Mode** → Toggle **ON**
4. Generate an **App-Level Token**:
   - Name: `herdctl-socket`
   - Scope: `connections:write`
   - Copy the token (starts with `xapp-`)

### Add Bot Scopes

5. **OAuth & Permissions → Bot Token Scopes** → Add:
   - `app_mentions:read`
   - `chat:write`
   - `channels:history`
   - `reactions:write`
   - `files:write`

### Subscribe to Events

6. **Event Subscriptions → Subscribe to bot events** → Add:
   - `app_mention`
   - `message.channels`

### Install to Workspace

7. **Install App → Install to Workspace** → Authorize
8. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Add Bot to a Channel

9. In Slack, go to your test channel
10. Type `/invite @herdctl-test` (or whatever you named the bot)
11. Get the channel ID: right-click channel name → **View channel details** → copy the ID (starts with `C`)

---

## Step 2: Get OAuth Tokens for Claude

Since you're on a Claude subscription (not an API key), agents authenticate via
OAuth tokens. Run this on your local machine:

```bash
claude setup-token
```

This opens a browser OAuth flow. After authenticating, it outputs three values:

| Variable | Purpose |
|----------|---------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Access token for Claude API |
| `CLAUDE_REFRESH_TOKEN` | Refreshes the access token when it expires |
| `CLAUDE_EXPIRES_AT` | Expiration timestamp |

Copy all three into your `.env` file (Step 3). The refresh token is important —
without it, the access token will expire and agents will stop working.

**To refresh later**: Run `claude setup-token` again and update `.env`.

---

## Step 3: Set Up the Test Environment

Create a working directory for the test:

```bash
mkdir -p ~/herdctl-slack-test/agents
cd ~/herdctl-slack-test
```

### `.env`

```bash
# --- Slack credentials (from Step 1) ---
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# --- Claude auth (from Step 2) ---
# OAuth tokens from `claude setup-token`
CLAUDE_CODE_OAUTH_TOKEN=...
CLAUDE_REFRESH_TOKEN=...
CLAUDE_EXPIRES_AT=...

# --- MCP server credentials ---
# Perplexity MCP server needs this
PERPLEXITY_API_KEY=pplx-...

# Slack MCP server needs this (same bot token, or a separate one)
SLACK_MCP_BOT_TOKEN=xoxb-...

# --- Optional ---
# GITHUB_TOKEN=ghp_...    # for agents that need GitHub access
```

### `herdctl.yaml`

```yaml
version: 1

fleet:
  name: slack-test
  description: Slack integration manual testing

defaults:
  docker:
    enabled: true
    image: herdctl/runtime:latest
    memory: "2g"
    ephemeral: false          # reuse containers for faster responses
    network: herdctl-net      # same network as MCP servers

agents:
  - path: agents/assistant.yaml
```

### `agents/assistant.yaml`

This agent responds to Slack mentions. It has access to Perplexity (web search)
and Slack MCP (reading Slack data). Mount your target repo as the workspace.

```yaml
name: assistant
description: Test assistant for Slack integration

max_turns: 15
default_prompt: "Check for new messages and respond."

system_prompt: |
  You are a helpful assistant available through Slack.
  Keep responses concise. Use Slack formatting (*bold*, `code`).
  You have access to Perplexity for web search and can read Slack data.

working_directory: /workspace

allowed_tools:
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__perplexity__*
  - mcp__slack-mcp__*

denied_tools:
  - Bash
  - TodoWrite
  - Task

# MCP servers — reached via Docker service names
mcp_servers:
  perplexity:
    url: http://perplexity:8080/mcp
  slack-mcp:
    url: http://slack-mcp:8081/mcp

# Slack chat integration
chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    session_expiry_hours: 24
    log_level: verbose
    channels:
      - id: "C0123456789"        # paste your channel ID here
```

### `docker-compose.yaml`

```yaml
services:
  # --- MCP Servers ---
  # Replace these with your actual MCP server images/commands.
  # These are placeholders — update to match how you run them locally.

  perplexity:
    image: your-perplexity-mcp-image    # TODO: replace with actual image
    # OR build from source:
    # build: /path/to/perplexity-mcp-server
    environment:
      - PERPLEXITY_API_KEY=${PERPLEXITY_API_KEY}
    networks:
      - herdctl-net
    restart: unless-stopped

  slack-mcp:
    image: your-slack-mcp-image         # TODO: replace with actual image
    environment:
      - SLACK_BOT_TOKEN=${SLACK_MCP_BOT_TOKEN}
    networks:
      - herdctl-net
    restart: unless-stopped

  # --- herdctl orchestrator ---
  herdctl:
    build:
      context: .
      dockerfile: Dockerfile.herdctl
    volumes:
      # Docker socket — lets herdctl spawn agent containers
      - /var/run/docker.sock:/var/run/docker.sock
      # Fleet config
      - ./herdctl.yaml:/app/herdctl.yaml:ro
      - ./agents:/app/agents:ro
      # Target repo the agent will work on
      - /path/to/your/repo:/workspace:rw
      # Persistent state (sessions, logs)
      - herdctl-state:/app/.herdctl
    env_file: .env
    networks:
      - herdctl-net
    working_dir: /app
    restart: unless-stopped
    depends_on:
      - perplexity
      - slack-mcp

networks:
  herdctl-net:
    driver: bridge

volumes:
  herdctl-state:
```

### `Dockerfile.herdctl`

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install herdctl CLI (pulls in @herdctl/core) and Slack package
RUN npm install -g herdctl @herdctl/slack

WORKDIR /app

CMD ["herdctl", "start"]
```

---

## Step 4: Build and Run

```bash
cd ~/herdctl-slack-test

# 1. Build the agent runtime image (from the herdctl repo)
docker build -t herdctl/runtime:latest \
  -f /path/to/herdctl/Dockerfile \
  /path/to/herdctl/

# 2. Start everything
docker compose up --build
```

Watch the logs for:
```
Slack connector started
Connected to Slack workspace: <your-workspace>
Mapped channel C... → agent "assistant"
```

---

## Step 5: Test Checklist

### Basic Connectivity
- [ ] herdctl container starts without errors
- [ ] Logs show "Slack connector started" and "Connected"
- [ ] No authentication errors in logs

### Message Handling
- [ ] @mention the bot in the channel — it creates a new thread
- [ ] Hourglass emoji appears while processing
- [ ] Bot replies in the thread (not in the main channel)
- [ ] Hourglass emoji is removed after reply
- [ ] Reply in the same thread — bot continues the conversation (session persists)

### Commands
- [ ] `!help` — bot responds with available commands
- [ ] `!status` — bot shows session status
- [ ] `!reset` — bot resets the conversation session
- [ ] After `!reset`, next message starts a fresh conversation

### MCP Integration
- [ ] Ask the bot to search something — Perplexity MCP is used
- [ ] Ask the bot about a Slack channel — Slack MCP is used
- [ ] MCP tool calls appear in agent logs

### Message Formatting
- [ ] Bot uses Slack mrkdwn correctly (*bold*, `code`, code blocks)
- [ ] Long responses are split into multiple messages (not truncated)

### Error Recovery
- [ ] Bot handles invalid/empty mentions gracefully
- [ ] After an error, bot can still process new messages
- [ ] Session survives herdctl restart (sessions persisted to disk)

### Docker Agent Lifecycle
- [ ] Agent container is created on first message
- [ ] Container is reused for subsequent messages (ephemeral: false)
- [ ] `docker ps` shows herdctl + agent containers
- [ ] Agent container is on `herdctl-net` network

---

## How It All Connects

### Auth Flow
```
env vars → herdctl container → buildContainerEnv()
  → agent container env vars → Claude Agent SDK → Anthropic API
```

herdctl's `buildContainerEnv()` (in `container-manager.ts`) automatically passes
`CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_REFRESH_TOKEN`, and `CLAUDE_EXPIRES_AT` from
its own environment to agent containers. No extra config needed — just set them
in the herdctl container's environment and they propagate.

### MCP Server Flow
```
agent YAML (url: http://perplexity:8080/mcp) → Claude Agent SDK
  → HTTP request to perplexity service → response back to agent
```

Because all containers are on the `herdctl-net` Docker network, agents reach MCP
servers by Docker service name. No `host.docker.internal` or `network: host` needed.

### Slack Message Flow
```
User @mentions bot in Slack
  → Slack API (Socket Mode) → herdctl SlackManager
  → routes to agent by channel ID → triggers agent job
  → agent runs in Docker container → streaming response
  → SlackManager posts reply in thread
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Could not connect to Slack" | Bad app token | Verify `SLACK_APP_TOKEN` starts with `xapp-` and Socket Mode is ON |
| "not_authed" or "invalid_auth" | Bad bot token | Verify `SLACK_BOT_TOKEN` starts with `xoxb-` and app is installed |
| Bot doesn't respond to @mentions | Missing event subscription | Check Event Subscriptions has `app_mention` enabled |
| Bot doesn't respond in channels | Missing scope | Add `channels:history` scope, reinstall app |
| "Package @herdctl/slack not installed" | Missing package in herdctl container | Ensure Dockerfile installs `@herdctl/slack` |
| Agent container fails to start | Missing Docker socket | Verify `/var/run/docker.sock` is mounted |
| Agent can't reach Claude API | Missing/expired OAuth token | Run `claude setup-token` again, update `.env` |
| Agent can't reach MCP servers | Wrong network | Check agent containers join `herdctl-net` |
| Agent timeout / no response | Container resource limits | Increase `memory` in docker config |

### Viewing Logs

```bash
# herdctl logs (follow)
docker compose logs -f herdctl

# Agent container logs
docker logs herdctl-assistant-<timestamp>

# List all herdctl-related containers
docker ps --filter "name=herdctl-"

# Check network connectivity
docker exec <agent-container> curl -s http://perplexity:8080/mcp
```

### Token Expiry

OAuth tokens expire. If agents suddenly stop working:

```bash
# Re-generate tokens
claude setup-token

# Update .env with new values, then restart
docker compose restart herdctl
```
