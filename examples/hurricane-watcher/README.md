# Hurricane Watcher Example

This example demonstrates a scheduled agent that monitors hurricane activity and sends notifications via hooks.

## Features

- Scheduled checks every 6 hours
- Uses WebSearch and WebFetch to get real-time hurricane data
- Configurable notification hooks (shell, Discord, webhook)

## Quick Start

### 1. Clone and Build

```bash
# Clone the repo
git clone https://github.com/edspencer/herdctl.git
cd herdctl

# Install dependencies
pnpm install

# Build
pnpm build
```

### 2. Set Your API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### 3. Run the Example

```bash
cd examples/hurricane-watcher

# Trigger the agent (using local build)
../../packages/cli/bin/herdctl.js trigger hurricane-watcher \
  --prompt "Check for hurricane activity affecting Miami, FL"
```

### 4. Check the Shell Hook Output

The shell hook logs the job result to a file:

```bash
cat /tmp/hurricane-notifications.log
```

You should see JSON output like:
```json
{"event":"completed","job":{"id":"job-xxx","agentId":"hurricane-watcher",...},"result":{"success":true},...}
```

## How It Works

1. **Agent runs** - Claude checks for hurricane activity using WebSearch/WebFetch
2. **Job completes** - herdctl captures the result
3. **Hooks execute** - The shell hook receives the job context as JSON on stdin
4. **Output logged** - `tee` writes the JSON to `/tmp/hurricane-notifications.log`

## Notification Hooks

The agent is configured with hooks that run after each job. Edit `agents/hurricane-watcher.yaml` to configure:

### Shell Hook (enabled by default)

Logs notifications to `/tmp/hurricane-notifications.log`:

```yaml
hooks:
  after_run:
    - type: shell
      command: "tee -a /tmp/hurricane-notifications.log"
```

You can replace this with any shell command. The HookContext JSON is piped to stdin:

```yaml
hooks:
  after_run:
    # Send to a custom script
    - type: shell
      command: "./my-notification-script.sh"

    # Or use jq to extract fields
    - type: shell
      command: "jq -r '.result.output' >> /tmp/hurricane-output.txt"
```

### Discord Hook

To enable Discord notifications:

1. Create a Discord bot at https://discord.com/developers/applications
2. Add the bot to your server with "Send Messages" permission
3. Get the channel ID (right-click channel → Copy ID, with Developer Mode enabled)
4. Set environment variables:
   ```bash
   export DISCORD_BOT_TOKEN="your-bot-token"
   export DISCORD_CHANNEL_ID="your-channel-id"
   ```
5. Update `agents/hurricane-watcher.yaml`:
   ```yaml
   hooks:
     after_run:
       - type: discord
         channel_id: "${DISCORD_CHANNEL_ID}"
         bot_token_env: DISCORD_BOT_TOKEN
   ```

### Webhook Hook

To POST notifications to a URL:

```yaml
hooks:
  after_run:
    - type: webhook
      url: "https://your-webhook-endpoint.com/hurricane-alert"
      headers:
        Authorization: "Bearer ${WEBHOOK_TOKEN}"
```

## Running on a Schedule

To run the agent every 6 hours automatically:

```bash
# Start the fleet (runs in foreground)
../../packages/cli/bin/herdctl.js start
```

The schedule is defined in `agents/hurricane-watcher.yaml`:

```yaml
schedules:
  check:
    type: interval
    interval: 6h
    prompt: "Check for hurricane activity affecting Miami, FL"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | For Discord | Discord channel ID |
| `WEBHOOK_TOKEN` | For webhook | Auth token for webhook endpoint |
