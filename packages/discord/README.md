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

```yaml
name: my-assistant
model: claude-sonnet-4-20250514

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    mode: auto  # Respond to all DMs automatically
    allowed_channels:
      - "123456789"  # Specific channel IDs
    allowed_roles:
      - "987654321"  # Role IDs that can interact
```

### Chat Modes

- **`auto`** - Respond to all messages in allowed channels/DMs
- **`mention`** - Only respond when the bot is @mentioned

## Features

- **Conversation Continuity** - Sessions persist across messages using Claude SDK session resumption
- **DM Support** - Users can chat privately with agents
- **Channel Support** - Agents can participate in server channels
- **Role-Based Access** - Restrict which users can interact
- **Slash Commands** - Built-in `/status`, `/reset`, and `/help` commands
- **Typing Indicators** - Visual feedback while agent is processing
- **Message Splitting** - Long responses are automatically split to fit Discord's limits

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and usage |
| `/status` | Show agent status and current session info |
| `/reset` | Clear conversation context (start fresh) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token (or use custom env var name in config) |

## Bot Setup

1. Create a Discord application at [discord.com/developers](https://discord.com/developers/applications)
2. Add a bot to your application
3. Enable the "Message Content Intent" in bot settings
4. Generate an invite URL with these permissions:
   - Send Messages
   - Read Message History
   - Use Slash Commands
5. Invite the bot to your server
6. Set `DISCORD_BOT_TOKEN` environment variable

## Documentation

For complete setup instructions, visit [herdctl.dev](https://herdctl.dev):

- [Discord Integration Guide](https://herdctl.dev/integrations/discord/)
- [Chat Configuration](https://herdctl.dev/configuration/agent/#chat)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic use

## License

MIT
