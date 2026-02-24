# Example Agent Repository

This document shows a complete, concrete example of what an agent GitHub repository looks like.

## Repository: website-monitor-agent

A simple agent that monitors website uptime and posts alerts to Discord when sites go down.

**GitHub URL:** `github:herdctl-examples/website-monitor-agent`

---

## Complete File Structure

```
website-monitor-agent/
├── agent.yaml
├── CLAUDE.md
├── README.md
├── LICENSE
├── herdctl.json
└── knowledge/
    ├── monitoring-guide.md
    └── alert-templates.md
```

---

## File Contents

### `agent.yaml`

```yaml
# Website Monitor Agent
# Checks if websites are responding and alerts on downtime

name: website-monitor
description: "Website uptime monitor"

runtime: cli
working_directory: ./workspace

# Tell Claude Code to discover CLAUDE.md and .claude/ from the workspace
setting_sources:
  - project

schedules:
  check-websites:
    type: cron
    cron: "${CRON_SCHEDULE:-*/5 * * * *}"  # Default: every 5 minutes
    prompt: |
      Check the following websites for uptime: ${WEBSITES}

      For each website:
      1. Fetch the URL using WebFetch
      2. Check HTTP status code
      3. Measure response time
      4. Compare to previous status (read from workspace/status.json)

      If any site is down or slow (>5s response):
      - Post alert to Discord webhook: ${DISCORD_WEBHOOK_URL}
      - Update workspace/status.json with current status
      - Include: site URL, status code, response time, downtime duration

      If all sites are up and previously were down:
      - Post recovery notification to Discord

      Keep workspace/status.json updated with:
      - Last check time
      - Current status of each site
      - Last downtime event for each site

permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - WebFetch
  - Bash

docker:
  enabled: ${DOCKER_ENABLED:-false}
  network: bridge  # Agents need network access for Anthropic API
```

---

### `CLAUDE.md`

```markdown
# Website Monitor Agent

You are a website uptime monitoring assistant. Your job is to check if websites are responding correctly and alert users when sites go down or recover.

## Your Responsibilities

1. **Regular Checks**: Test each configured website periodically
2. **Status Tracking**: Maintain accurate state in `workspace/status.json`
3. **Alert on Changes**: Only notify when status changes (up→down or down→up)
4. **Clear Communication**: Alerts should be concise and actionable

## Monitoring Process

### Check Websites

For each website in the WEBSITES environment variable:

1. Use WebFetch to request the URL
2. Record the HTTP status code
3. Measure response time
4. Determine if site is "up" (2xx/3xx status, <5s response) or "down"

### Track State

Maintain `workspace/status.json` with this structure:

```json
{
  "last_check": "2026-02-23T10:30:00Z",
  "sites": {
    "https://example.com": {
      "status": "up",
      "last_status_code": 200,
      "last_response_time_ms": 234,
      "last_check": "2026-02-23T10:30:00Z",
      "last_downtime": null,
      "consecutive_failures": 0
    }
  }
}
```

### Send Alerts

**When a site goes down:**

```
🚨 **Website Down**

**Site:** https://example.com
**Status:** HTTP 500 (previously 200)
**Response Time:** 8.2s
**First Detected:** 2026-02-23 10:30 UTC
**Consecutive Failures:** 3

The site has been unreachable for 15 minutes.
```

**When a site recovers:**

```
✅ **Website Recovered**

**Site:** https://example.com
**Status:** HTTP 200
**Response Time:** 0.3s
**Downtime Duration:** 47 minutes
**Recovered At:** 2026-02-23 11:17 UTC

The site is back online.
```

## Important Rules

- **Only alert on status changes** - Don't spam with "still up" or "still down" messages
- **Wait for confirmation** - A site must fail 2-3 consecutive checks before alerting (reduces false positives)
- **Be precise** - Include timestamps, status codes, and response times
- **Update state file** - Always keep `status.json` current after each check

See `knowledge/monitoring-guide.md` for detailed monitoring procedures.
```

---

### `README.md`

```markdown
# Website Monitor Agent

A herdctl agent that monitors website uptime and sends Discord alerts when sites go down or recover.

## Features

- ⏰ Configurable check intervals (default: every 5 minutes)
- 🎯 Multi-site monitoring
- 📊 Response time tracking
- 🔔 Discord notifications on status changes
- 💾 Persistent state tracking
- 🚫 False positive reduction (waits for consecutive failures)

## Installation

```bash
herdctl agent add github:herdctl-examples/website-monitor-agent
```

After installation, add the required environment variables to your `.env` file.

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Required
WEBSITES=https://example.com,https://api.example.com,https://status.example.com
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_HERE

# Optional
CHECK_INTERVAL="*/5 * * * *"  # Every 5 minutes (default)
```

### Schedule Options

Common check intervals:

- Every 5 minutes: `*/5 * * * *` (default)
- Every 15 minutes: `*/15 * * * *`
- Every hour: `0 * * * *`
- Every 30 seconds: `*/30 * * * * *` (requires seconds support)

## Usage

### Start Monitoring

```bash
herdctl start
```

The agent will check your websites on the configured schedule and send Discord alerts when status changes.

### Manual Check

Trigger a check immediately:

```bash
herdctl trigger website-monitor
```

### View Status

Check current status of all monitored sites:

```bash
cat agents/website-monitor/workspace/status.json
```

## Discord Webhook Setup

1. Go to your Discord server settings
2. Navigate to Integrations → Webhooks
3. Click "New Webhook"
4. Choose the channel for alerts
5. Copy the webhook URL
6. Add to your `.env` file

## Monitoring Multiple Sets of Websites

Install the agent multiple times to different paths:

```bash
# Production sites
herdctl agent add github:herdctl-examples/website-monitor-agent --path ./agents/production-monitor

# Staging sites
herdctl agent add github:herdctl-examples/website-monitor-agent --path ./agents/staging-monitor
```

Edit each instance's `agent.yaml` to give it a unique name, and use different
environment variable names for each set of websites.

## How It Works

1. **Scheduled Check**: Agent runs on configured cron schedule
2. **Fetch Sites**: Uses WebFetch to request each configured URL
3. **Compare Status**: Reads previous status from `workspace/status.json`
4. **Detect Changes**: Identifies sites that changed from up→down or down→up
5. **Send Alerts**: Posts Discord notification only when status changes
6. **Update State**: Writes new status to `workspace/status.json`

## Workspace Files

The agent creates and maintains these files in its workspace:

- `status.json` - Current status of all monitored sites
- `history.json` - Historical downtime events (optional, see knowledge/monitoring-guide.md)

## Customization

### Add Custom Checks

Edit `knowledge/monitoring-guide.md` to add:

- SSL certificate expiration warnings
- Custom response time thresholds per site
- Content validation (check for specific text in response)
- Header validation

### Custom Alert Format

Modify the alert templates in `knowledge/alert-templates.md`.

## Troubleshooting

**Agent not sending alerts:**
- Verify Discord webhook URL is correct
- Check `agents/website-monitor/workspace/status.json` exists
- Run `herdctl trigger website-monitor` manually to test

**False positives:**
- Increase check interval to reduce network blips
- Modify consecutive failure threshold in `knowledge/monitoring-guide.md`

**Permission errors:**
- Ensure the agent has `acceptEdits` permission mode to write status files

## License

MIT

## Support

- GitHub Issues: https://github.com/herdctl-examples/website-monitor-agent/issues
- herdctl Docs: https://herdctl.dev/docs
```

---

### `LICENSE`

```
MIT License

Copyright (c) 2026 herdctl Examples

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### `herdctl.json`

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "website-monitor",
  "version": "1.0.0",
  "description": "Monitor website uptime and send Discord alerts when sites go down or recover",
  "author": "herdctl-examples",
  "repository": "github:herdctl-examples/website-monitor-agent",
  "homepage": "https://github.com/herdctl-examples/website-monitor-agent",
  "license": "MIT",
  "keywords": ["monitoring", "uptime", "alerts", "discord", "devops"],

  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": [
      "WEBSITES",
      "DISCORD_WEBHOOK_URL"
    ],
    "workspace": true,
    "docker": false
  },

  "category": "operations",
  "tags": ["monitoring", "automation", "alerts"],

  "screenshots": [
    "https://github.com/herdctl-examples/website-monitor-agent/blob/main/screenshots/discord-alert.png"
  ],

  "examples": {
    "basic": "Monitor 2-3 production websites with 5-minute checks",
    "advanced": "Monitor multiple environments with different check intervals and alert thresholds"
  }
}
```

---

### `knowledge/monitoring-guide.md`

```markdown
# Website Monitoring Guide

This guide explains how to perform uptime monitoring for websites.

## Monitoring Checklist

For each website in the WEBSITES environment variable:

### 1. Fetch the URL

Use the WebFetch tool to request the URL:

```typescript
const response = await webFetch(url);
```

### 2. Evaluate Response

A site is considered **UP** if:
- HTTP status code is 2xx (success) or 3xx (redirect)
- Response time is < 5 seconds
- No network errors occurred

A site is considered **DOWN** if:
- HTTP status code is 4xx or 5xx
- Response time is >= 5 seconds
- Network error occurred (timeout, DNS failure, connection refused)

### 3. Compare to Previous Status

Read `workspace/status.json` to get the previous status for this site.

### 4. Consecutive Failures

To reduce false positives:
- A site must fail **3 consecutive checks** before marking as DOWN
- Increment `consecutive_failures` counter on each failure
- Reset counter to 0 on successful check

### 5. Status Changes

**Site went DOWN** (was UP, now DOWN with ≥3 failures):
- Post "Website Down" alert to Discord
- Record `last_downtime` timestamp
- Update status to "down"

**Site came UP** (was DOWN, now UP):
- Post "Website Recovered" alert to Discord
- Calculate downtime duration
- Update status to "up"
- Reset `consecutive_failures` to 0

### 6. Update State File

Always update `workspace/status.json` after each check:

```json
{
  "last_check": "2026-02-23T10:30:00Z",
  "sites": {
    "https://example.com": {
      "status": "up",
      "last_status_code": 200,
      "last_response_time_ms": 234,
      "last_check": "2026-02-23T10:30:00Z",
      "last_downtime": "2026-02-23T09:15:00Z",
      "consecutive_failures": 0
    }
  }
}
```

## Response Time Tracking

Track response times to identify performance degradation:

- **Fast**: < 1 second (green)
- **Moderate**: 1-3 seconds (yellow)
- **Slow**: 3-5 seconds (orange, but still "up")
- **Timeout**: >= 5 seconds (red, considered "down")

Include response time in alerts to help diagnose issues.

## Error Handling

If WebFetch throws an error:
- Treat as site DOWN
- Include error message in alert
- Common errors:
  - `ENOTFOUND`: DNS lookup failed
  - `ECONNREFUSED`: Server refused connection
  - `ETIMEDOUT`: Request timed out
  - `CERT_HAS_EXPIRED`: SSL certificate expired

## Alert Throttling

Only send Discord alerts when status **changes**:

- ✅ Up → Down (after 3 failures)
- ✅ Down → Up
- ❌ Up → Up (no alert)
- ❌ Down → Down (no alert)

This prevents spam while ensuring critical events are communicated.

## Multiple URLs

When monitoring multiple websites:
1. Check them sequentially (not in parallel) to avoid rate limiting
2. If one fails, continue checking the others
3. Send separate alerts for each status change
4. Include site URL in all alerts

## State File Initialization

If `workspace/status.json` doesn't exist:
1. Create it with empty sites object
2. Perform first check for all sites
3. Write initial status
4. Do NOT send alerts on first run (assume all sites starting in unknown state)

## Customization Ideas

Advanced users can modify this guide to add:

- SSL certificate expiration warnings (check cert valid_to date)
- Custom response time thresholds per site
- Content validation (check for specific text in response)
- Geographic monitoring (check from multiple regions)
- Ping before HTTP check for faster detection
```

---

### `knowledge/alert-templates.md`

```markdown
# Discord Alert Templates

This guide defines the format for Discord webhook alerts.

## Alert Format

All alerts are sent as Discord messages using the webhook URL.

### Website Down Alert

```
🚨 **Website Down**

**Site:** {url}
**Status:** HTTP {status_code} (previously {previous_status_code})
**Response Time:** {response_time}s
**First Detected:** {timestamp}
**Consecutive Failures:** {failure_count}

{optional_error_message}

The site has been unreachable for {downtime_duration}.
```

**Example:**

```
🚨 **Website Down**

**Site:** https://api.example.com
**Status:** HTTP 500 (previously 200)
**Response Time:** 8.2s
**First Detected:** 2026-02-23 10:30 UTC
**Consecutive Failures:** 3

Error: Internal Server Error

The site has been unreachable for 15 minutes.
```

### Website Recovered Alert

```
✅ **Website Recovered**

**Site:** {url}
**Status:** HTTP {status_code}
**Response Time:** {response_time}s
**Downtime Duration:** {downtime_duration}
**Recovered At:** {timestamp}

The site is back online.
```

**Example:**

```
✅ **Website Recovered**

**Site:** https://api.example.com
**Status:** HTTP 200
**Response Time:** 0.3s
**Downtime Duration:** 47 minutes
**Recovered At:** 2026-02-23 11:17 UTC

The site is back online.
```

## Sending to Discord

Use the Discord webhook URL from the environment:

```bash
curl -X POST "${DISCORD_WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -d '{"content": "YOUR_ALERT_MESSAGE_HERE"}'
```

Or use Bash tool to execute the curl command.

## Alert Formatting

- Use **bold** for labels and important info
- Include emojis for quick visual identification:
  - 🚨 for down alerts
  - ✅ for recovery alerts
  - ⚠️ for warnings (slow but not down)
- Always include UTC timestamps
- Keep messages concise but actionable

## Optional Enhancements

For advanced users:

### Rich Embeds

Use Discord embeds for prettier formatting:

```json
{
  "embeds": [{
    "title": "🚨 Website Down",
    "color": 15158332,
    "fields": [
      {"name": "Site", "value": "https://example.com", "inline": false},
      {"name": "Status", "value": "HTTP 500", "inline": true},
      {"name": "Response Time", "value": "8.2s", "inline": true}
    ],
    "timestamp": "2026-02-23T10:30:00Z"
  }]
}
```

### Mentions

Tag specific users or roles on critical alerts:

```
<@USER_ID> 🚨 **Website Down**
```

### Severity Levels

Color-code alerts by severity:
- 🔴 Red (15158332): Site down
- 🟡 Yellow (16776960): Slow response (>3s)
- 🟢 Green (5763719): Site recovered
```

---

## After Installation

When a user runs `herdctl agent add github:herdctl-examples/website-monitor-agent`, the files are copied to their local agents directory:

```
my-project/
├── herdctl.yaml                      # Updated with agent reference
└── agents/
    └── website-monitor/              # Name from agent.yaml
        ├── agent.yaml                # Copied from repo as-is
        ├── CLAUDE.md
        ├── README.md
        ├── metadata.json             # Installation tracking (created by herdctl)
        ├── knowledge/
        │   ├── monitoring-guide.md
        │   └── alert-templates.md
        └── workspace/                # Created during installation
            └── status.json           # Created by agent on first run
```

The user's `herdctl.yaml` is updated to reference the agent. herdctl prints which environment variables the user needs to add to their `.env` file.
