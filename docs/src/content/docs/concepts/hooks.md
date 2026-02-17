---
title: Hooks
description: Execute actions after agent jobs complete
---

**Hooks** are actions that run automatically after an agent job completes. Use hooks to send notifications, trigger downstream systems, log results, or perform any post-job processing.

## Overview

Hooks enable powerful automation workflows:

| Use Case | Hook Type | Example |
|----------|-----------|---------|
| Send alerts | Discord / Slack | Notify a channel when a price drops |
| Trigger pipelines | Webhook | POST to CI/CD when code is ready |
| Log results | Shell | Pipe output to a logging system |
| Conditional actions | Any | Only notify when `metadata.shouldNotify` is true |

## Quick Example

```yaml
name: price-checker
description: Monitors product prices

# Agent can write metadata for conditional hooks
metadata_file: metadata.json

hooks:
  after_run:
    # Always log output to console
    - type: shell
      name: "Log output"
      command: "jq -r '.result.output'"

    # Only notify Discord when price drops below target
    - type: discord
      name: "Price alert"
      channel_id: "${DISCORD_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
      when: "metadata.shouldNotify"
```

## Hook Events

Hooks can be triggered at different points in the job lifecycle:

### after_run

Runs after **every** job completion, regardless of success or failure. This is the most common hook event.

```yaml
hooks:
  after_run:
    - type: shell
      command: "echo 'Job completed'"
```

### on_error

Runs **only** when a job fails. Use this for error-specific notifications or recovery actions.

```yaml
hooks:
  on_error:
    - type: discord
      channel_id: "${ALERT_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
```

### Event Filtering

You can further filter which specific events trigger a hook using `on_events`:

```yaml
hooks:
  after_run:
    - type: discord
      on_events: [completed]  # Only successful completions
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN

    - type: webhook
      on_events: [failed, timeout]  # Only failures
      url: "https://alerts.example.com/errors"
```

**Available events:**

| Event | Description |
|-------|-------------|
| `completed` | Job finished successfully |
| `failed` | Job terminated due to an error |
| `timeout` | Job exceeded its configured time limit |
| `cancelled` | Job was manually stopped |

## Hook Types

### Shell Hooks

Execute a shell command with the full [HookContext](#hook-context) passed as JSON on stdin.

```yaml
hooks:
  after_run:
    - type: shell
      name: "Process output"
      command: "jq -r '.result.output' | tee -a /var/log/agent.log"
      timeout: 5000  # 5 seconds (default: 30000)
```

**Configuration:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"shell"` | — | **Required.** Hook type |
| `command` | string | — | **Required.** Shell command to execute |
| `timeout` | number | `30000` | Timeout in milliseconds |
| `name` | string | — | Human-readable name for logs |
| `continue_on_error` | boolean | `true` | Continue if hook fails |
| `on_events` | array | all | Filter to specific events |
| `when` | string | — | Conditional execution path |

**Using HookContext in shell:**

The hook receives complete job information on stdin:

```bash
# Extract just the output
jq -r '.result.output'

# Check if job succeeded
jq -e '.result.success'

# Get agent metadata
jq '.metadata'

# Conditional processing
jq -e '.metadata.shouldNotify' && send-notification
```

### Webhook Hooks

POST or PUT the [HookContext](#hook-context) as JSON to a URL.

```yaml
hooks:
  after_run:
    - type: webhook
      name: "Notify CI"
      url: "https://ci.example.com/webhooks/agent-complete"
      method: POST  # or PUT
      headers:
        Authorization: "Bearer ${CI_TOKEN}"
        X-Agent-Name: "${AGENT_NAME}"
```

**Configuration:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"webhook"` | — | **Required.** Hook type |
| `url` | string | — | **Required.** URL to send request to |
| `method` | `"POST"` \| `"PUT"` | `"POST"` | HTTP method |
| `headers` | object | — | Custom headers (supports `${ENV_VAR}` substitution) |
| `name` | string | — | Human-readable name for logs |
| `continue_on_error` | boolean | `true` | Continue if hook fails |
| `on_events` | array | all | Filter to specific events |
| `when` | string | — | Conditional execution path |

### Discord Hooks

Send a formatted notification embed to a Discord channel. This is different from the [Discord chat integration](/integrations/discord/)—hooks send one-way notifications rather than enabling interactive chat.

```yaml
hooks:
  after_run:
    - type: discord
      name: "Job notification"
      channel_id: "123456789012345678"
      bot_token_env: DISCORD_BOT_TOKEN
```

**Configuration:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"discord"` | — | **Required.** Hook type |
| `channel_id` | string | — | **Required.** Discord channel ID |
| `bot_token_env` | string | — | **Required.** Environment variable containing bot token |
| `name` | string | — | Human-readable name for logs |
| `continue_on_error` | boolean | `true` | Continue if hook fails |
| `on_events` | array | all | Filter to specific events |
| `when` | string | — | Conditional execution path |

**Discord embed format:**

The notification includes:
- **Title**: Agent name and job ID
- **Color**: Green (success), Red (failure), Yellow (timeout/cancelled)
- **Fields**: Duration, event type
- **Metadata**: Displayed if provided by agent
- **Output**: Agent's text output (truncated if long)

:::note[Bot Setup Required]
Discord hooks require a Discord bot with permission to send messages in the target channel. See [Discord Integration](/integrations/discord/#creating-a-discord-application) for setup instructions.
:::

### Slack Hooks

Send a formatted notification to a Slack channel. This is different from the [Slack chat integration](/integrations/slack/)—hooks send one-way notifications rather than enabling interactive chat.

```yaml
hooks:
  after_run:
    - type: slack
      name: "Job notification"
      channel_id: "C0123456789"
      bot_token_env: SLACK_BOT_TOKEN
```

**Configuration:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"slack"` | — | **Required.** Hook type |
| `channel_id` | string | — | **Required.** Slack channel ID |
| `bot_token_env` | string | — | **Required.** Environment variable containing bot token (`xoxb-`) |
| `name` | string | — | Human-readable name for logs |
| `continue_on_error` | boolean | `true` | Continue if hook fails |
| `on_events` | array | all | Filter to specific events |
| `when` | string | — | Conditional execution path |

**Slack notification format:**

The notification includes:
- **Title**: Agent name and job ID
- **Color**: Green (success), Red (failure), Yellow (timeout/cancelled)
- **Fields**: Duration, event type
- **Metadata**: Displayed if provided by agent
- **Output**: Agent's text output (truncated if long)

:::note[Bot Setup Required]
Slack hooks require a Slack bot with the `chat:write` scope and membership in the target channel. See [Slack Integration](/integrations/slack/#creating-a-slack-app) for setup instructions. Note: hooks only need the Bot User OAuth Token (`xoxb-`), not the App-Level Token.
:::

## Conditional Execution

Use the `when` field to run hooks only when specific conditions are met. The value is a dot-notation path to a boolean field in the [HookContext](#hook-context).

### Common Patterns

```yaml
hooks:
  after_run:
    # Only when agent sets shouldNotify: true in metadata (Discord)
    - type: discord
      when: "metadata.shouldNotify"
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN

    # Same pattern works with Slack
    - type: slack
      when: "metadata.shouldNotify"
      channel_id: "C0123456789"
      bot_token_env: SLACK_BOT_TOKEN

    # Only when job succeeded
    - type: webhook
      when: "result.success"
      url: "https://..."

    # Only when job failed
    - type: shell
      when: "result.error"
      command: "send-alert"
```

### Agent Metadata

Agents can write a metadata file during execution to control hook behavior:

**Agent config:**

```yaml
name: price-checker
metadata_file: metadata.json  # Path relative to workspace

hooks:
  after_run:
    - type: discord
      when: "metadata.shouldNotify"
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN
```

**Agent writes during execution:**

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

**Benefits of metadata:**
- Agent controls when notifications fire
- Include dynamic data in notifications (price, URL, etc.)
- Metadata displayed in Discord embeds
- Enables sophisticated conditional logic

## Hook Context

All hooks receive a `HookContext` object containing complete information about the job:

```json
{
  "event": "completed",
  "job": {
    "id": "job-2024-01-15-abc123",
    "agentId": "price-checker",
    "scheduleName": "check",
    "startedAt": "2024-01-15T09:00:00.000Z",
    "completedAt": "2024-01-15T09:05:30.000Z",
    "durationMs": 330000
  },
  "result": {
    "success": true,
    "output": "Price check complete: Staples Hyken at $159.99..."
  },
  "agent": {
    "id": "price-checker",
    "name": "Price Checker"
  },
  "metadata": {
    "shouldNotify": true,
    "lowestPrice": 159.99,
    "retailer": "Staples"
  }
}
```

### Context Fields

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event that triggered the hook |
| `job.id` | string | Unique job identifier |
| `job.agentId` | string | Agent name |
| `job.scheduleName` | string | Schedule name (if triggered by schedule) |
| `job.startedAt` | string | ISO timestamp when job started |
| `job.completedAt` | string | ISO timestamp when job completed |
| `job.durationMs` | number | Duration in milliseconds |
| `result.success` | boolean | Whether job succeeded |
| `result.output` | string | Agent's text output |
| `result.error` | string | Error message (if failed) |
| `agent.id` | string | Agent identifier |
| `agent.name` | string | Human-readable agent name |
| `metadata` | object | Agent-provided metadata (if any) |

## Error Handling

By default, hooks continue executing even if one fails. Control this with `continue_on_error`:

```yaml
hooks:
  after_run:
    # Critical notification - stop if this fails
    - type: discord
      continue_on_error: false
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN

    # Nice-to-have logging - continue if this fails
    - type: shell
      continue_on_error: true  # default
      command: "log-to-external-system"
```

Hook execution order:
1. Hooks run in the order they're defined
2. If a hook fails with `continue_on_error: false`, subsequent hooks are skipped
3. Hook failures are logged but don't affect job status

## Complete Examples

### Price Alert System

Monitor prices and notify when targets are met:

```yaml
name: price-checker
description: Monitors product prices

max_turns: 15
default_prompt: "Check current prices and update context."
metadata_file: metadata.json

system_prompt: |
  You monitor product prices. After checking prices:
  1. Update context.md with findings
  2. Write metadata.json with:
     - shouldNotify: true if price meets target
     - lowestPrice, retailer, product, url

allowed_tools:
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Edit
denied_tools:
  - Bash
  - Task

schedules:
  check:
    type: interval
    interval: 4h

hooks:
  after_run:
    # Console output for debugging
    - type: shell
      name: "Show result"
      command: |
        if jq -e '.metadata.shouldNotify == true' > /dev/null 2>&1; then
          echo "Deal found - meets target price"
        else
          echo "No deal - above target price"
        fi

    # Discord alert only when deal found
    - type: discord
      name: "Price alert"
      when: "metadata.shouldNotify"
      channel_id: "${DISCORD_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
```

### CI/CD Integration

Notify external systems when agent completes work:

```yaml
name: code-implementer
description: Implements features from GitHub issues

hooks:
  after_run:
    # Trigger CI pipeline on success
    - type: webhook
      name: "Trigger CI"
      on_events: [completed]
      url: "https://ci.example.com/api/trigger"
      method: POST
      headers:
        Authorization: "Bearer ${CI_TOKEN}"

    # Alert on failure
    - type: discord
      name: "Failure alert"
      on_events: [failed, timeout]
      channel_id: "${ALERTS_CHANNEL}"
      bot_token_env: DISCORD_BOT_TOKEN

  on_error:
    # Page on-call for critical failures
    - type: webhook
      name: "PagerDuty"
      url: "https://events.pagerduty.com/v2/enqueue"
      headers:
        Content-Type: "application/json"
```

### Multi-Channel Notifications

Send different information to different places:

```yaml
name: daily-reporter
description: Generates daily reports

hooks:
  after_run:
    # Full report to dedicated channel
    - type: discord
      name: "Full report"
      on_events: [completed]
      channel_id: "${REPORTS_CHANNEL}"
      bot_token_env: DISCORD_BOT_TOKEN

    # Summary to general channel
    - type: shell
      name: "Post summary"
      on_events: [completed]
      command: |
        jq -r '.result.output' | head -20 | \
        curl -X POST -H "Content-Type: application/json" \
          -d "{\"content\": \"$(cat)\"}" \
          "https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}"

    # Archive to S3
    - type: shell
      name: "Archive report"
      command: |
        DATE=$(jq -r '.job.completedAt' | cut -d'T' -f1)
        jq '.' > /tmp/report-$DATE.json
        aws s3 cp /tmp/report-$DATE.json s3://reports-bucket/
```

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Where hooks are configured
- [Discord Integration](/integrations/discord/) — Interactive Discord chat (different from notification hooks)
- [Slack Integration](/integrations/slack/) — Interactive Slack chat (different from notification hooks)
- [Jobs](/concepts/jobs/) — Job lifecycle that triggers hooks
- [Triggers](/concepts/triggers/) — What starts jobs
