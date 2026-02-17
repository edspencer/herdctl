---
title: Slack Chat Quick Start
description: Get Slack chat integration running in 5 minutes
---

Get your herdctl agent chatting on Slack in under 5 minutes. This guide covers the minimal setup — see the [full Slack reference](/integrations/slack/) for advanced configuration.

## 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** > **From scratch**
3. Name it (e.g., "HerdBot") and select your workspace

## 2. Enable Socket Mode

1. Go to **Settings** > **Socket Mode** > toggle it **on**
2. Create an App-Level Token with `connections:write` scope
3. Copy the token (starts with `xapp-`) — save it now, you can't see it again

## 3. Add Bot Scopes

Go to **OAuth & Permissions** > **Bot Token Scopes** and add:

- `app_mentions:read`
- `chat:write`
- `channels:history`
- `files:write`

## 4. Subscribe to Events

Go to **Event Subscriptions** > toggle **Enable Events** on > **Subscribe to bot events**:

- `app_mention`
- `message.channels`

Click **Save Changes**.

## 5. Install to Workspace

1. Go to **Install App** > **Install to Workspace** > **Authorize**
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## 6. Add Bot to a Channel

In Slack, go to the channel you want and type `@YourBotName` — click **Invite to Channel** when prompted.

Then get the channel ID: right-click the channel name > **View channel details** > copy the ID at the bottom.

## 7. Set Environment Variables

```bash
export SLACK_BOT_TOKEN="xoxb-your-bot-token-here"
export SLACK_APP_TOKEN="xapp-your-app-token-here"
export SLACK_CHANNEL_ID="C0123456789"
```

Or add them to a `.env` file next to your `herdctl.yaml`.

## 8. Add Chat Config to Agent

Add the `chat.slack` section to your agent YAML:

```yaml
name: my-agent
description: "Agent with Slack chat"

system_prompt: |
  You are a helpful assistant. Answer questions clearly and concisely.

chat:
  slack:
    bot_token_env: SLACK_BOT_TOKEN
    app_token_env: SLACK_APP_TOKEN
    channels:
      - id: "${SLACK_CHANNEL_ID}"
        mode: mention  # Respond when @mentioned
```

## 9. Start and Test

```bash
herdctl start
```

You should see:
```
[slack] Connecting to Slack via Socket Mode...
[slack] Connected to Slack: HerdBot
```

Now try it — in the channel, type: `@HerdBot Hello!`

## Commands

Your bot automatically supports prefix commands:

| Command | Description |
|---------|-------------|
| `!help` | Show available commands |
| `!reset` | Clear conversation context |
| `!status` | Show bot connection info |

:::note
Slack uses prefix commands (`!help`) rather than slash commands (`/help`). Just type the command as a regular message.
:::

## Next Steps

- See the [Slack Chat Bot example](/guides/examples/#slack-chat-bot) for a complete working example
- Read the [full Slack reference](/integrations/slack/) for advanced configuration
- Learn about [session management](/integrations/slack/#session-management) for conversation context
- Compare with the [Discord integration](/integrations/discord/) if you need both platforms
