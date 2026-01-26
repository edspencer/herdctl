# Hurricane Watcher Example

This example demonstrates a **stateful agent** that monitors hurricane activity, maintains context across runs, and sends notifications via hooks.

## Features

- **Persistent memory** via `context.md` - agent remembers location and history
- Scheduled checks every 6 hours
- Uses WebSearch and WebFetch to get real-time hurricane data
- Configurable notification hooks (shell, Discord, webhook)

## Quick Start

### 1. Clone and Build

```bash
git clone https://github.com/edspencer/herdctl.git
cd herdctl
pnpm install
pnpm build
```

### 2. Set Your API Key

```bash
export ANTHROPIC_API_KEY="sk-ant-your-key-here"
```

### 3. Run the Example

```bash
cd examples/hurricane-watcher

# First run - set your location
../../packages/cli/bin/herdctl.js trigger hurricane-watcher \
  --prompt "Monitor Tampa, FL for hurricane activity"

# Subsequent runs - agent remembers the location
../../packages/cli/bin/herdctl.js trigger hurricane-watcher
```

### 4. Check the Context File

After running, the agent creates `context.md` with its memory:

```bash
cat context.md
```

You'll see the agent's configuration, current status, and history of checks.

## Agent Memory (context.md)

This example demonstrates how agents can maintain state across multiple runs. The hurricane-watcher:

1. **Reads** `context.md` at the start of each run
2. **Remembers** its configured location and check history
3. **Updates** the context file with new data after each check
4. **Manages history** by keeping only the last 10 entries

Example context file:
```markdown
# Hurricane Watcher Context

## Configuration
- **Monitoring Location**: Tampa, FL
- **Check Frequency**: Every 6 hours (scheduled)
- **Alert Threshold**: MODERATE or higher

## Current Status
- **Last Check**: 2026-01-26
- **Current Threat Level**: NONE
- **Active Storms**: 0

## Recent History
| Date | Threat Level | Notable Events |
|------|--------------|----------------|
| 2026-01-26 | NONE | Follow-up check. Off-season. |
| 2026-01-26 | NONE | Initial setup for Tampa, FL. |
```

### Changing Locations

To change the monitored location, just mention it in your prompt:

```bash
../../packages/cli/bin/herdctl.js trigger hurricane-watcher \
  --prompt "Switch to monitoring Key West, FL"
```

The agent will update its context file with the new location.

## Notification Hooks

The agent is configured with hooks that run after each job. Edit `agents/hurricane-watcher.yaml` to configure:

### Shell Hook (enabled by default)

Prints the agent's output:

```yaml
hooks:
  after_run:
    - type: shell
      command: "jq -r '.result.output'"
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
5. Uncomment the Discord hook in `agents/hurricane-watcher.yaml`

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
../../packages/cli/bin/herdctl.js start
```

The schedule is defined in `agents/hurricane-watcher.yaml`:

```yaml
schedules:
  check:
    type: interval
    interval: 6h
    prompt: "Check for hurricane activity and update context."
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `DISCORD_BOT_TOKEN` | For Discord | Discord bot token |
| `DISCORD_CHANNEL_ID` | For Discord | Discord channel ID |
| `WEBHOOK_TOKEN` | For webhook | Auth token for webhook endpoint |
