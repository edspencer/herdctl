---
title: Example Projects
description: Learn herdctl through working examples
---

The herdctl repository includes example projects demonstrating various features and patterns. Each example is self-contained and can be run immediately.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/herdctl/herdctl.git
cd herdctl

# Install and build
pnpm install
pnpm build

# Navigate to an example
cd examples/hello-world

# Run the agent
../../packages/cli/bin/herdctl.js trigger hello-world
```

## Available Examples

### hello-world

**Difficulty:** Beginner
**Features:** Basic configuration, default_prompt, max_turns

The simplest possible agent—just responds to greetings. Perfect for understanding the minimal configuration required.

```bash
cd examples/hello-world
../../packages/cli/bin/herdctl.js trigger hello-world
```

**What you'll learn:**
- Minimal agent YAML structure
- Using `default_prompt` for trigger without `--prompt`
- Limiting agent behavior with `max_turns`
- No tools required (pure conversation)

### hurricane-watcher

**Difficulty:** Intermediate
**Features:** Hooks, persistent memory, denied_tools, schedules

A monitoring agent that tracks weather activity and demonstrates several advanced features:

```bash
cd examples/hurricane-watcher
export ANTHROPIC_API_KEY="your-key"
../../packages/cli/bin/herdctl.js trigger hurricane-watcher
```

**What you'll learn:**
- **Persistent memory**: Agent maintains `context.md` file across runs
- **Shell hooks**: Run commands after job completion
- **Discord hooks**: Send notifications (requires bot setup)
- **Tool restrictions**: Using `denied_tools` to prevent certain actions
- **Schedules**: Configure interval-based execution

**Key configuration:**

```yaml
# Persistent memory pattern
system_prompt: |
  You maintain a context.md file to remember state between runs.
  At the START: Read context.md
  At the END: Update context.md with results

# Hooks for post-job processing
hooks:
  after_run:
    - type: shell
      command: "jq -r '.result.output'"
```

### price-checker

**Difficulty:** Advanced
**Features:** Metadata, conditional hooks, web scraping, notifications

A sophisticated agent that monitors product prices and sends conditional notifications:

```bash
cd examples/price-checker
export ANTHROPIC_API_KEY="your-key"
../../packages/cli/bin/herdctl.js trigger price-checker
```

**What you'll learn:**
- **Agent metadata**: Writing `metadata.json` for hook conditions
- **Conditional notifications**: `when: "metadata.shouldNotify"`
- **Web scraping**: Using WebFetch to get real product data
- **Discord notifications**: Formatted price alerts with product links

**Key configuration:**

```yaml
# Agent writes metadata to control hooks
metadata_file: metadata.json

hooks:
  after_run:
    # Only notify when price meets target
    - type: discord
      when: "metadata.shouldNotify"
      channel_id: "${DISCORD_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
```

**Example metadata the agent writes:**

```json
{
  "shouldNotify": true,
  "lowestPrice": 159.99,
  "retailer": "Staples",
  "product": "Hyken Mesh Chair",
  "url": "https://www.staples.com/...",
  "meetsTarget": true
}
```

### discord-chat-bot

**Difficulty:** Advanced
**Features:** Discord chat integration, scheduled checks, notifications, conversation memory

A price monitoring agent that combines scheduled automation with interactive Discord chat:

```bash
cd examples/discord-chat-bot
export DISCORD_BOT_TOKEN="your-token"
export DISCORD_GUILD_ID="your-guild-id"
export DISCORD_CHANNEL_ID="your-channel-id"
../../packages/cli/bin/herdctl.js start
```

**What you'll learn:**
- **Discord chat**: Two-way conversations via @mentions and DMs
- **Scheduled + interactive**: Same agent runs on schedule AND responds to chat
- **Session context**: Bot remembers conversation history (24h default)
- **Slash commands**: `/help`, `/reset`, `/status` built-in
- **Tool result embeds**: Tool usage, system status, and errors shown as Discord embeds

**Key configuration:**

```yaml
# Discord chat integration - users can @mention the bot
chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    session_expiry_hours: 24
    output:
      tool_results: true           # Show tool usage as embeds
      tool_result_max_length: 500  # Truncate long output
      system_status: true          # Show system messages
      result_summary: false        # Hide completion summary
      errors: true                 # Show errors
    guilds:
      - id: "${DISCORD_GUILD_ID}"
        channels:
          - id: "${DISCORD_CHANNEL_ID}"
            mode: mention  # Requires @mention
    dm:
      enabled: true
      mode: auto  # No @mention needed in DMs
```

**Example interactions:**

```
You: @price-bot What's the best price right now?
Bot: Based on my last check, the Hyken chair is $189 at Staples...

You: @price-bot Check prices now
Bot: Checking Staples and IKEA... [performs live price check]
```

**Prerequisites:**
- Discord bot with Message Content Intent enabled
- See [Discord Quick Start](/guides/discord-quick-start/) for setup

### slack-chat-bot

**Difficulty:** Advanced
**Features:** Slack chat integration, Socket Mode, prefix commands, session context

An assistant agent that combines Slack chat with scheduled automation. Uses Slack's Socket Mode for real-time messaging without needing a public URL:

```bash
cd examples/slack-chat-bot
export SLACK_BOT_TOKEN="xoxb-your-bot-token"
export SLACK_APP_TOKEN="xapp-your-app-token"
export SLACK_CHANNEL_ID="C0123456789"
../../packages/cli/bin/herdctl.js start
```

**What you'll learn:**
- **Slack chat**: Two-way conversations via @mentions and threads
- **Socket Mode**: WebSocket-based connection — no public URL needed
- **Session context**: Bot remembers conversation history (24h default)
- **Prefix commands**: `!help`, `!reset`, `!status` built-in
- **Slack hooks**: Send notification messages after scheduled runs

**Key configuration:**

```yaml
# Slack chat integration - users @mention the bot to start a conversation
chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    session_expiry_hours: 24
    log_level: standard
    channels:
      - id: "${SLACK_CHANNEL_ID}"

# Post schedule results to Slack
hooks:
  after_run:
    - type: slack
      channel_id: "${SLACK_CHANNEL_ID}"
      bot_token_env: SLACK_BOT_TOKEN
```

**Prerequisites:**
- Slack App with Socket Mode enabled
- Bot Token Scopes: `app_mentions:read`, `chat:write`, `channels:history`, `files:write`
- Event Subscriptions: `app_mention`, `message.channels`
- See [Slack Quick Start](/guides/slack-quick-start/) for setup

## Pattern Reference

### Persistent Memory Pattern

Give your agent memory across runs using a context file:

```yaml
system_prompt: |
  ## Context Management

  You maintain a `context.md` file to remember state between runs.

  At the START of each run:
  1. Read context.md to understand your configuration and history
  2. If context.md doesn't exist, create it with sensible defaults

  At the END of each run:
  1. Update context.md with the results of this check
  2. Keep history to the last 10 entries

allowed_tools:
  - Read
  - Write
  - Edit
```

See [Persistent Memory Guide](/guides/persistent-memory/) for details.

### Conditional Notification Pattern

Send notifications only when specific conditions are met:

```yaml
metadata_file: metadata.json

system_prompt: |
  After completing your task, write metadata.json with:
  - shouldNotify: true if the user should be alerted
  - Other relevant data for the notification

hooks:
  after_run:
    - type: discord
      when: "metadata.shouldNotify"
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN
```

### Tool Restriction Pattern

Prevent agents from using certain tools:

```yaml
allowed_tools:
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Edit
denied_tools:
  - Bash        # No shell access
  - Task        # No spawning subagents
  - TodoWrite   # Don't waste turns on todos
```

## Running Examples

### Prerequisites

All examples require:
- Node.js 18+
- pnpm (for building from source)
- `ANTHROPIC_API_KEY` environment variable

Some examples require additional setup:
- **Discord hooks/chat**: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, and `DISCORD_CHANNEL_ID`
- **Slack chat**: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and `SLACK_CHANNEL_ID`
- **Webhook hooks**: External webhook endpoint

### From Source

```bash
# Build the CLI
pnpm install
pnpm build

# Run from examples directory
cd examples/hello-world
../../packages/cli/bin/herdctl.js trigger hello-world
```

### With Installed herdctl

```bash
# Install herdctl globally
npm install -g herdctl

# Copy an example
cp -r node_modules/herdctl/examples/hello-world ./my-agent
cd my-agent

# Run the agent
herdctl trigger hello-world
```

## Creating Your Own

Use an example as a starting point:

```bash
# Copy and customize
cp -r examples/price-checker ./my-agent
cd my-agent

# Edit the agent configuration
vim agents/price-checker.yaml

# Rename and update
mv agents/price-checker.yaml agents/my-agent.yaml
# Update the 'name' field in the YAML
```

## Related Pages

- [Getting Started](/getting-started/) — Initial setup guide
- [Agent Configuration](/configuration/agent-config/) — Full configuration reference
- [Hooks](/concepts/hooks/) — Post-job actions
- [Persistent Memory Guide](/guides/persistent-memory/) — Memory pattern details
