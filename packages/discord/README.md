# @herdctl/discord

> Discord connector for herdctl fleet management

[![npm version](https://img.shields.io/npm/v/@herdctl/discord.svg)](https://www.npmjs.com/package/@herdctl/discord)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

`@herdctl/discord` enables your herdctl agents to interact via Discord. Users can chat with agents in DMs or channels, and agents can send notifications when jobs complete. The connector handles session management automatically, maintaining conversation context across messages.

## Installation

```bash
npm install @herdctl/discord
```

> **Note**: This package is typically used automatically by `@herdctl/core` when Discord is configured in your agent YAML. Direct installation is only needed for advanced use cases.

## Configuration

Add Discord chat configuration to your agent YAML:

### DM-Only Bot (Simplest Setup)

```yaml
name: my-assistant
model: claude-sonnet-4-20250514

chat:
  discord:
    bot_token_env: MY_ASSISTANT_DISCORD_TOKEN
    guilds: []  # Empty array = no channel restrictions
    dm:
      enabled: true
      mode: auto  # Respond to all DMs automatically
```

### Channel-Based Bot

```yaml
name: support-bot
model: claude-sonnet-4-20250514

chat:
  discord:
    bot_token_env: SUPPORT_BOT_DISCORD_TOKEN
    guilds:
      - id: "123456789012345678"  # Your server ID
        channels:
          - id: "987654321098765432"
            name: "#support"  # Optional, for logging
            mode: mention     # Only respond when @mentioned
          - id: "111222333444555666"
            name: "#general"
            mode: auto        # Respond to all messages
    dm:
      enabled: true
      mode: auto
```

### Full Configuration Reference

```yaml
chat:
  discord:
    # Required: Environment variable containing bot token
    bot_token_env: DISCORD_BOT_TOKEN

    # Optional: Session expiry in hours (default: 24)
    session_expiry_hours: 24

    # Optional: Log verbosity (default: standard)
    log_level: standard  # minimal | standard | verbose

    # Optional: Bot presence/activity
    presence:
      activity_type: watching  # playing | watching | listening | competing
      activity_message: "for support requests"

    # Required: Guild (server) configurations (can be empty array for DM-only)
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            name: "#support"
            mode: mention  # mention | auto
            context_messages: 10  # Messages to include for context
        # Per-guild DM settings (optional, overrides global)
        dm:
          enabled: true
          mode: auto

    # Optional: Global DM configuration
    dm:
      enabled: true
      mode: auto  # mention | auto
      allowlist: ["user-id-1", "user-id-2"]  # Only these users can DM
      blocklist: ["blocked-user-id"]  # These users cannot DM
```

### Chat Modes

- **`auto`** - Respond to all messages in allowed channels/DMs
- **`mention`** - Only respond when the bot is @mentioned

## Multiple Bots / Multiple Agents

Each agent can have its own Discord bot with a unique token. Simply use different environment variable names:

```yaml
# Agent 1: Support Bot
name: support-bot
chat:
  discord:
    bot_token_env: SUPPORT_BOT_TOKEN
    # ...

# Agent 2: Developer Assistant
name: dev-assistant
chat:
  discord:
    bot_token_env: DEV_ASSISTANT_TOKEN
    # ...
```

Then set both environment variables:
```bash
export SUPPORT_BOT_TOKEN="your-support-bot-token"
export DEV_ASSISTANT_TOKEN="your-dev-assistant-token"
```

This allows you to run multiple agents with different Discord identities, each with their own bot user, avatar, and permissions.

## Features

- **Conversation Continuity** - Sessions persist across messages using Claude SDK session resumption
- **DM Support** - Users can chat privately with agents
- **Channel Support** - Agents can participate in server channels
- **Per-Agent Bots** - Each agent can have its own Discord bot identity
- **Slash Commands** - Built-in `/status`, `/reset`, and `/help` commands
- **Typing Indicators** - Visual feedback while agent is processing
- **Message Splitting** - Long responses are automatically split to fit Discord's limits

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and usage |
| `/status` | Show agent status and current session info |
| `/reset` | Clear conversation context (start fresh) |

## Bot Setup

1. Create a Discord application at [discord.com/developers](https://discord.com/developers/applications)
2. Add a bot to your application
3. Enable the "Message Content Intent" in bot settings
4. Generate an invite URL with these permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands
5. Invite the bot to your server
6. Set your bot token as an environment variable (use a unique name per bot)

## Documentation

For complete setup instructions, visit [herdctl.dev](https://herdctl.dev):

- [Discord Integration Guide](https://herdctl.dev/integrations/discord/)
- [Chat Configuration](https://herdctl.dev/configuration/agent/#chat)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic use
- [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) - Shared chat infrastructure (used internally)
- [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) - Slack connector
- [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) - Web dashboard

## License

MIT
