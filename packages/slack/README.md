# @herdctl/slack

> Slack connector for herdctl fleet management

[![npm version](https://img.shields.io/npm/v/@herdctl/slack.svg)](https://www.npmjs.com/package/@herdctl/slack)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

`@herdctl/slack` enables your [herdctl](https://herdctl.dev) agents to interact via Slack. Users can chat with agents in channels or DMs, and agents stream responses in real time. The connector handles session management automatically, maintaining conversation context across messages.

Herdctl is an open-source system for running fleets of autonomous AI agents powered by Claude Code. This package is part of the herdctl monorepo.

## Installation

```bash
npm install @herdctl/slack
```

> **Note**: This package is typically used automatically by `@herdctl/core` when Slack is configured in your agent YAML. Direct installation is only needed for advanced use cases.

## Configuration

Add Slack chat configuration to your agent YAML:

### Channel Bot

```yaml
name: support-bot
model: claude-sonnet-4-20250514

chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    channels:
      - id: "C0123456789"
        name: "#support"
        mode: mention     # Only respond when @mentioned
      - id: "C9876543210"
        name: "#general"
        mode: auto        # Respond to all messages
```

### DM-Only Bot

```yaml
name: my-assistant
model: claude-sonnet-4-20250514

chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    channels: []
    dm:
      enabled: true
      mode: auto
```

### Full Configuration Reference

```yaml
chat:
  slack:
    # Required: Environment variables containing tokens
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN

    # Optional: Session expiry in hours (default: 24)
    session_expiry_hours: 24

    # Channel configurations
    channels:
      - id: "C0123456789"
        name: "#support"        # Optional, for logging
        mode: mention            # mention | auto

    # Optional: DM configuration
    dm:
      enabled: true
      mode: auto                 # mention | auto
      allowlist: ["U001", "U002"]  # Only these users can DM
      blocklist: ["U999"]          # These users cannot DM
```

### Chat Modes

- **`auto`** - Respond to all messages in allowed channels/DMs
- **`mention`** - Only respond when the bot is @mentioned

## Features

- **Conversation Continuity** - Sessions persist across messages using Claude SDK session resumption
- **DM Support** - Users can chat privately with agents, with allowlist/blocklist controls
- **Channel Support** - Agents can participate in multiple Slack channels
- **Streaming Responses** - Responses are delivered incrementally as the agent generates them
- **Typing Indicators** - Hourglass emoji reaction while the agent is processing
- **Message Splitting** - Long responses are automatically split to fit Slack's 4,000-character limit
- **Markdown Conversion** - Agent Markdown output is converted to Slack's mrkdwn format
- **Socket Mode** - No public URL required; uses Slack Socket Mode for event delivery

## Commands

Type these in any channel where the bot is active:

| Command | Description |
|---------|-------------|
| `!help` | Show available commands and usage |
| `!status` | Show agent status and current session info |
| `!reset` | Clear conversation context and start fresh |

## Slack App Setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an App-Level Token (`xapp-...`)
3. Add the following **Bot Token Scopes** under OAuth & Permissions:
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `reactions:write`
4. Enable **Event Subscriptions** and subscribe to:
   - `message.channels`
   - `message.groups`
   - `message.im`
5. Install the app to your workspace and copy the Bot User OAuth Token (`xoxb-...`)
6. Set your tokens as environment variables:
   ```bash
   export SLACK_BOT_TOKEN="xoxb-..."
   export SLACK_APP_TOKEN="xapp-..."
   ```

For a full walkthrough, see the [Slack Quick Start](https://herdctl.dev/guides/slack-quick-start/) guide.

## Documentation

For complete setup instructions, visit [herdctl.dev](https://herdctl.dev):

- [Slack Quick Start](https://herdctl.dev/guides/slack-quick-start/)
- [Chat Configuration](https://herdctl.dev/configuration/agent-config/#chat)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic use
- [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) - Shared chat infrastructure (used internally)
- [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) - Discord connector
- [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) - Web dashboard

## License

MIT
