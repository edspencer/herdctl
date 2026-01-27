---
title: Triggers
description: Events that start agent execution
---

**Triggers** define the events that cause an agent to execute. herdctl supports multiple trigger types to fit different automation needs—from simple time-based intervals to event-driven webhooks.

## Overview

Every schedule needs a trigger to determine when it runs. The trigger type you choose depends on your use case:

| Trigger Type | Best For | Status |
|-------------|----------|--------|
| **Interval** | Regular recurring tasks (polling, health checks) | Available |
| **Cron** | Precise timing (daily reports, scheduled maintenance) | Available |
| **Webhook** | Event-driven automation (deployments, external events) | Future |
| **Chat** | Interactive responses (support, commands) | Available |

## Interval Triggers

Interval triggers execute at fixed time intervals after the last completion. This is ideal for tasks that need to run regularly without precise timing requirements.

### Syntax

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    prompt: "Check for new issues to process."
```

### Supported Units

| Unit | Description | Example |
|------|-------------|---------|
| `s` | Seconds | `30s` - every 30 seconds |
| `m` | Minutes | `5m` - every 5 minutes |
| `h` | Hours | `1h` - every hour |
| `d` | Days | `1d` - every 24 hours |

You can combine values: `1h30m` means every 1 hour and 30 minutes.

### How Interval Timing Works

Interval triggers measure time **from the completion of the last job**, not from start to start. This prevents job overlap when execution time varies:

```
Job 1 starts at 10:00, runs for 3 minutes, completes at 10:03
→ 5-minute interval starts counting
Job 2 starts at 10:08 (5 minutes after 10:03)
```

### Common Interval Patterns

```yaml
# Quick polling for new work
schedules:
  issue-check:
    type: interval
    interval: 5m
    prompt: "Check for issues labeled 'ready' and claim the oldest one."

# Health monitoring
schedules:
  health-check:
    type: interval
    interval: 30s
    prompt: "Run health checks on all services. Report any failures."

# Periodic sync
schedules:
  sync-data:
    type: interval
    interval: 1h
    prompt: "Sync data from external sources. Update local cache."

# Daily cleanup (alternative to cron)
schedules:
  cleanup:
    type: interval
    interval: 1d
    prompt: "Clean up temporary files and old logs."
```

### When to Use Interval Triggers

✅ **Good for:**
- Polling for new work (issues, messages, tasks)
- Health checks and monitoring
- Data synchronization
- Tasks where exact timing doesn't matter

❌ **Not ideal for:**
- Tasks that must run at specific times (use cron)
- Tasks tied to business hours (use cron)
- Event-driven tasks (use webhook when available)

## Cron Triggers

Cron triggers execute on a precise schedule using standard cron expressions. This is ideal for tasks that need to run at specific times—daily reports at 9am, weekly summaries on Monday, monthly audits on the first.

### Syntax

```yaml
schedules:
  daily-report:
    type: cron
    expression: "0 9 * * *"
    prompt: "Generate the daily status report."
```

### Cron Expression Format

Cron expressions use five fields:

```
┌───────────── minute (0-59)
│ ┌─────────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌─────── month (1-12)
│ │ │ │ ┌───── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

### Special Characters

| Character | Meaning | Example |
|-----------|---------|---------|
| `*` | Any value | `* * * * *` - every minute |
| `,` | List of values | `0,30 * * * *` - minute 0 and 30 |
| `-` | Range of values | `0 9-17 * * *` - 9am to 5pm |
| `/` | Step values | `*/15 * * * *` - every 15 minutes |

### Common Cron Patterns

```yaml
# Every day at 9am
schedules:
  morning-standup:
    type: cron
    expression: "0 9 * * *"
    prompt: "Review yesterday's progress and plan today's tasks."

# Weekdays at 9am (Monday-Friday)
schedules:
  weekday-check:
    type: cron
    expression: "0 9 * * 1-5"
    prompt: "Check for urgent issues before the team arrives."

# Every hour on the hour
schedules:
  hourly-scan:
    type: cron
    expression: "0 * * * *"
    prompt: "Scan for security vulnerabilities in dependencies."

# Every 15 minutes
schedules:
  frequent-check:
    type: cron
    expression: "*/15 * * * *"
    prompt: "Check for high-priority alerts."

# Weekly on Monday at 10am
schedules:
  weekly-summary:
    type: cron
    expression: "0 10 * * 1"
    prompt: "Generate the weekly team summary report."

# Monthly on the 1st at midnight
schedules:
  monthly-audit:
    type: cron
    expression: "0 0 1 * *"
    prompt: "Run the monthly security audit."

# Quarterly (1st of Jan, Apr, Jul, Oct)
schedules:
  quarterly-review:
    type: cron
    expression: "0 9 1 1,4,7,10 *"
    prompt: "Generate the quarterly performance review."
```

### Cron Quick Reference

| Pattern | Expression | Description |
|---------|------------|-------------|
| Every minute | `* * * * *` | Runs every minute |
| Every hour | `0 * * * *` | Runs at minute 0 of every hour |
| Every day at 9am | `0 9 * * *` | Runs at 9:00 AM daily |
| Weekdays at 9am | `0 9 * * 1-5` | Runs at 9:00 AM Mon-Fri |
| Every 15 minutes | `*/15 * * * *` | Runs at :00, :15, :30, :45 |
| Twice daily | `0 9,17 * * *` | Runs at 9:00 AM and 5:00 PM |
| Weekly on Sunday | `0 0 * * 0` | Runs at midnight Sunday |
| Monthly on 1st | `0 0 1 * *` | Runs at midnight on the 1st |

### When to Use Cron Triggers

✅ **Good for:**
- Reports that must be ready at a specific time
- Tasks aligned with business hours
- Scheduled maintenance windows
- Time-sensitive automation

❌ **Not ideal for:**
- Frequent polling (use interval)
- Event-driven tasks (use webhook when available)
- Tasks where timing doesn't matter (use interval)

## Webhook Triggers

:::note[Future Feature]
Webhook triggers are planned for a future release. This documentation describes the intended behavior.
:::

Webhook triggers execute when an HTTP POST request is received at a designated endpoint. This enables event-driven automation—trigger an agent when code is deployed, when a CI pipeline fails, or when an external service sends a notification.

### Syntax

```yaml
schedules:
  deploy-hook:
    type: webhook
    path: /hooks/deploy
    secret: ${WEBHOOK_SECRET}
    prompt: |
      A deployment has been triggered.
      Validate the deployment and run post-deploy checks.
```

### Webhook Configuration

| Property | Required | Description |
|----------|----------|-------------|
| `path` | Yes | URL path for the webhook endpoint |
| `secret` | No | Shared secret for request validation |
| `method` | No | HTTP method (default: POST) |
| `headers` | No | Required headers for validation |

### Webhook Payload

When a webhook fires, the request payload is available to the agent:

```yaml
schedules:
  github-push:
    type: webhook
    path: /hooks/github/push
    secret: ${GITHUB_WEBHOOK_SECRET}
    prompt: |
      A push event was received for branch {{payload.ref}}.
      Commits: {{payload.commits | length}}

      Run the test suite and report any failures.
```

### Common Webhook Patterns

```yaml
# Deployment notifications
schedules:
  post-deploy:
    type: webhook
    path: /hooks/deploy
    prompt: |
      Deployment completed. Run smoke tests and verify:
      - All services are healthy
      - No error spikes in logs
      - Performance metrics are normal

# CI/CD pipeline failures
schedules:
  ci-failure:
    type: webhook
    path: /hooks/ci/failure
    prompt: |
      CI pipeline failed for {{payload.branch}}.
      Analyze the failure and suggest fixes.

# External service notifications
schedules:
  alert-handler:
    type: webhook
    path: /hooks/alerts
    prompt: |
      Alert received: {{payload.alert_name}}
      Severity: {{payload.severity}}

      Investigate and take appropriate action.
```

### When to Use Webhook Triggers

✅ **Good for:**
- Deployment automation
- CI/CD pipeline integration
- External service notifications
- Event-driven workflows

❌ **Not ideal for:**
- Regular scheduled tasks (use cron or interval)
- Polling for changes (use interval)

## Chat Triggers

Chat triggers execute in response to messages in Discord. This enables interactive agents that respond to user questions, commands, or mentions. Unlike schedules that run automatically, chat triggers fire when a user messages or @mentions your bot.

:::tip
See the [Discord Quick Start](/guides/discord-quick-start/) for a 5-minute setup guide, or the [full Discord reference](/integrations/discord/) for advanced configuration.
:::

### Configuration

Chat triggers are configured in the `chat` section of your agent config, not in `schedules`:

```yaml
name: support-agent

chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    guilds:
      - id: "123456789012345678"
        channels:
          - id: "987654321098765432"
            mode: mention    # Only respond to @mentions
    dm:
      enabled: true
      mode: auto           # Always respond to DMs
```

### Response Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `mention` | Responds only when @mentioned | Shared channels with multiple bots |
| `auto` | Responds to all messages | Dedicated support channels, DMs |

### How Chat Triggers Work

1. User sends a message (or @mentions the bot)
2. herdctl receives the message via Discord gateway
3. The agent's session is loaded (or created)
4. The message becomes the prompt for a Claude session
5. The response is sent back to Discord
6. Session context is preserved for follow-up messages

### Session Management

Discord chat maintains conversation context per channel:

- **Session Expiry**: Default 24 hours (configurable via `session_expiry_hours`)
- **Scope**: Sessions are per-channel, not per-user
- **Reset**: Users can clear context with the `/reset` slash command
- **Memory**: Agents "remember" recent messages within a session

### Built-in Slash Commands

Every Discord-enabled agent automatically supports:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and bot info |
| `/reset` | Clear conversation context |
| `/status` | Show connection status and stats |

### Combining Chat with Schedules

A single agent can have both scheduled runs AND respond to chat:

```yaml
name: price-bot

# Scheduled price checks
schedules:
  check:
    type: interval
    interval: 4h

# Interactive Discord chat
chat:
  discord:
    bot_token_env: DISCORD_BOT_TOKEN
    guilds:
      - id: "${DISCORD_GUILD_ID}"
        channels:
          - id: "${DISCORD_CHANNEL_ID}"
            mode: mention
```

Users can ask the bot questions like "What's the current price?" between scheduled runs.

### When to Use Chat Triggers

✅ **Good for:**
- Interactive support bots
- On-demand queries ("What's the status?")
- Q&A over project documentation
- User-initiated actions

❌ **Not ideal for:**
- Background automation (use cron or interval)
- Event-driven workflows (use webhook when available)

## Choosing the Right Trigger

### Decision Guide

```
Do you need to run at a specific time?
├─ Yes → Use CRON
│        "Daily at 9am", "Every Monday", "First of month"
│
└─ No → Is it event-driven?
        ├─ Yes → Use WEBHOOK (when available)
        │        "After deploy", "On CI failure"
        │
        └─ No → Is it interactive?
                ├─ Yes → Use CHAT (when available)
                │        "When mentioned", "On command"
                │
                └─ No → Use INTERVAL
                        "Every 5 minutes", "Check regularly"
```

### Comparison Table

| Aspect | Interval | Cron | Webhook | Chat |
|--------|----------|------|---------|------|
| Timing | Relative | Absolute | On-demand | On-demand |
| Precision | Low | High | Immediate | Immediate |
| Use case | Polling | Scheduled | Events | Interactive |
| Status | Available | Available | Future | Available |

## Trigger Options

All trigger types support common options for controlling execution:

### Concurrency

Limit how many instances can run simultaneously:

```yaml
schedules:
  check-issues:
    type: interval
    interval: 5m
    concurrency: 1  # Only one instance at a time
    prompt: "Process the next ready issue."
```

### Timeout

Set maximum execution time:

```yaml
schedules:
  quick-check:
    type: interval
    interval: 1m
    timeout: 30s  # Must complete within 30 seconds
    prompt: "Quick health check."
```

### Enabled/Disabled

Temporarily disable a trigger without removing it:

```yaml
schedules:
  maintenance:
    type: cron
    expression: "0 2 * * *"
    enabled: false  # Disabled during development
    prompt: "Run maintenance tasks."
```

## Related Concepts

- [Schedules](/concepts/schedules/) - Combine triggers with prompts
- [Jobs](/concepts/jobs/) - Trigger execution results
- [Agents](/concepts/agents/) - What triggers invoke
