# Discord Chat Bot Example

This example demonstrates herdctl's Discord chat integration. The bot monitors office chair prices on a schedule AND responds to Discord messages, allowing you to ask questions like "What's the best price right now?"

## Features

- **Scheduled Price Checks**: Automatically checks prices every 4 hours
- **Discord Chat**: @mention the bot to ask questions about prices
- **Price Alerts**: Sends Discord notifications when prices drop below target
- **Conversation Memory**: Bot remembers context within a session

## Prerequisites

1. A Discord bot token (see [Discord Integration Guide](https://herdctl.dev/integrations/discord/))
2. A Discord server where you have permission to add bots
3. herdctl installed (`npm install -g herdctl`)

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Enable "Message Content Intent" under Privileged Gateway Intents
5. Copy the bot token

### 2. Invite the Bot to Your Server

Generate an OAuth2 URL with these permissions:
- Send Messages
- Read Message History
- Use Slash Commands

Permissions integer: `2147551232`

### 3. Get Your IDs

Enable Developer Mode in Discord (User Settings > App Settings > Advanced > Developer Mode), then right-click to copy:
- **Guild ID**: Right-click your server name
- **Channel ID**: Right-click the channel for alerts/chat

### 4. Set Environment Variables

```bash
export DISCORD_BOT_TOKEN="your-bot-token-here"
export DISCORD_GUILD_ID="123456789012345678"
export DISCORD_CHANNEL_ID="987654321098765432"
```

Or create a `.env` file (not committed to git):

```
DISCORD_BOT_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=123456789012345678
DISCORD_CHANNEL_ID=987654321098765432
```

### 5. Run the Fleet

```bash
cd examples/discord-chat-bot
herdctl start
```

## Usage

### Chat with the Bot

In your configured Discord channel, @mention the bot:

```
@price-bot What's the current best price?
@price-bot When did you last check?
@price-bot Should I buy now or wait?
@price-bot Check prices now
```

### DM the Bot

You can also DM the bot directly (auto mode - no @mention needed).

### Slash Commands

- `/help` - Show available commands
- `/reset` - Clear conversation history
- `/status` - Show bot status

### Trigger Manual Check

```bash
herdctl trigger price-bot
```

## Configuration

The agent configuration in `agents/price-bot.yaml` includes:

```yaml
# Discord chat integration
chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    session_expiry_hours: 24
    guilds:
      - id: "${DISCORD_GUILD_ID}"
        channels:
          - id: "${DISCORD_CHANNEL_ID}"
            mode: mention  # Requires @mention
    dm:
      enabled: true
      mode: auto  # No @mention needed in DMs
```

### Chat Modes

- **mention**: Bot only responds when @mentioned (good for busy channels)
- **auto**: Bot responds to all messages (good for DMs or dedicated channels)

## How It Works

1. **On Schedule**: Every 4 hours, the bot checks Staples and IKEA for chair prices
2. **On Chat**: When you message the bot, it reads `context.md` to answer your questions
3. **On Price Drop**: If prices meet the target, a Discord notification is sent

The bot maintains conversation context within a session (24 hours by default), so you can have multi-turn conversations about price history and recommendations.

## Files

| File | Purpose |
|------|---------|
| `herdctl.yaml` | Fleet configuration |
| `agents/price-bot.yaml` | Agent with schedule + Discord chat |
| `context.md` | Price history and current state |
| `.herdctl/` | State directory (created on first run) |
