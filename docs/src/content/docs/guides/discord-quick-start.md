---
title: Discord Chat Quick Start
description: Get Discord chat integration running in 5 minutes
---

Get your herdctl agent chatting on Discord in under 5 minutes. This guide covers the minimal setup—see the [full Discord reference](/integrations/discord/) for advanced configuration.

## 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and give it a name
3. Go to **Bot** → click **Reset Token** → copy the token

## 2. Enable Message Content Intent

Still in the Developer Portal:

1. Go to **Bot** → scroll to **Privileged Gateway Intents**
2. Enable **Message Content Intent**
3. Click **Save Changes**

:::caution
Without the Message Content Intent, your bot cannot read messages and won't respond.
:::

## 3. Invite the Bot

1. Go to **OAuth2** → **URL Generator**
2. Select scopes: `bot`, `applications.commands`
3. Select permissions: Send Messages, Read Message History, Use Slash Commands
4. Copy the URL and open it to invite the bot to your server

## 4. Get Your Discord IDs

Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode), then:

- **Guild ID**: Right-click server icon → Copy Server ID
- **Channel ID**: Right-click channel → Copy Channel ID

## 5. Set Environment Variables

```bash
export DISCORD_BOT_TOKEN="your-bot-token-here"
export DISCORD_GUILD_ID="123456789012345678"
export DISCORD_CHANNEL_ID="987654321098765432"
```

## 6. Add Chat Config to Agent

Add the `chat.discord` section to your agent YAML:

```yaml
name: my-agent
description: "Agent with Discord chat"

system_prompt: |
  You are a helpful assistant. Answer questions clearly and concisely.

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    guilds:
      - id: "${DISCORD_GUILD_ID}"
        channels:
          - id: "${DISCORD_CHANNEL_ID}"
            mode: mention  # Respond when @mentioned
    dm:
      enabled: true
      mode: auto  # Always respond to DMs
```

## 7. Start and Test

```bash
herdctl start
```

You should see:
```
[my-agent] Connecting to Discord...
[my-agent] Connected to Discord: MyBot#1234
```

Now try it:
- In the channel: `@MyBot Hello!`
- In a DM: Just say `Hello!`

## Slash Commands

Your bot automatically supports:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/reset` | Clear conversation context |
| `/status` | Show bot connection info |

## Next Steps

- See the [Discord Chat Bot example](/guides/examples/#discord-chat-bot) for a complete working example
- Read the [full Discord reference](/integrations/discord/) for advanced configuration
- Learn about [session management](/integrations/discord/#session-management) for conversation context
- Configure [output settings](/integrations/discord/#output-settings) to control which tool results, system messages, and errors appear in Discord
