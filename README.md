# Herdctl

> Autonomous Agent Fleet Management for Claude Code

**Website**: [herdctl.dev](https://herdctl.dev)
**npm**: [`herdctl`](https://www.npmjs.com/package/herdctl)

## Overview

Herdctl is an open-source platform for running fleets of autonomous AI agents. Each agent has its own identity, schedules, and work sources. Think of it as "Kubernetes for AI agents" - declarative configuration, pluggable integrations, and continuous operation.

## Features

- **Fleet Management**: Run multiple Claude Code agents with a single command
- **Declarative Config**: Define agents, schedules, and permissions in YAML
- **Multiple Triggers**: Interval, cron, webhooks, chat messages
- **Work Sources**: GitHub Issues (MVP), with Jira/Linear planned
- **Execution Hooks**: Run shell commands, webhooks, or Discord notifications after jobs
- **Agent Metadata**: Agents can write JSON metadata for conditional hook execution
- **Live Monitoring**: Web dashboard with real-time streaming (planned)
- **Chat Integration**: Discord and Slack connectors (planned)
- **Library-First**: Use `@herdctl/core` programmatically in your own applications

## Quick Start

```bash
# Install herdctl
npm install -g herdctl

# Initialize a new project
herdctl init

# Start your agent fleet
herdctl start
```

## Configuration

```yaml
# herdctl.yaml
fleet:
  name: my-fleet

agents:
  - path: ./agents/my-agent.yaml
```

```yaml
# agents/my-agent.yaml
name: my-agent
description: My first agent

workspace:
  path: ./workspace

schedules:
  heartbeat:
    type: interval
    interval: 5m
    work_source:
      type: github_issues
      repo: my-org/my-repo
      labels:
        include: ["ready"]
```

## Commands

```bash
herdctl start [agent]    # Start all agents or a specific agent
herdctl stop [agent]     # Stop all agents or a specific agent
herdctl status [agent]   # Show fleet or agent status
herdctl logs [agent]     # Tail agent logs
herdctl trigger <agent>  # Manually trigger an agent
herdctl jobs             # List job history
herdctl job <id>         # Show job details
```

## Execution Hooks

Herdctl supports execution hooks that run after agent jobs complete. Hooks can be used for notifications, logging, triggering downstream workflows, or any custom automation.

### Hook Types

**Shell Hooks**: Execute shell commands with the job context piped to stdin as JSON.

```yaml
hooks:
  after_run:
    - type: shell
      name: "Log completion"
      command: ./scripts/log-job.sh
      timeout: 30000  # ms, default: 30000
```

**Webhook Hooks**: POST job context as JSON to an HTTP endpoint.

```yaml
hooks:
  after_run:
    - type: webhook
      url: https://api.example.com/hooks/job-complete
      method: POST  # or PUT
      headers:
        Authorization: "Bearer ${API_TOKEN}"  # env var substitution
      timeout: 10000  # ms, default: 10000
```

**Discord Hooks**: Send formatted notifications to a Discord channel.

```yaml
hooks:
  after_run:
    - type: discord
      channel_id: "1234567890"
      bot_token_env: DISCORD_BOT_TOKEN
```

### Hook Configuration Options

All hook types support these common options:

```yaml
hooks:
  after_run:
    - type: shell
      command: ./notify.sh
      name: "My Hook"              # Human-readable name for logs
      continue_on_error: true      # Don't fail job if hook fails (default: true)
      on_events: [completed]       # Only run on specific events: completed, failed, timeout, cancelled
      when: "metadata.shouldNotify"  # Conditional execution via metadata
```

### Hook Events

Hooks can be configured to run on specific events:

- `completed` - Job finished successfully
- `failed` - Job encountered an error
- `timeout` - Job exceeded time limit
- `cancelled` - Job was manually cancelled

### Hook Context

All hooks receive a JSON context containing job information:

```json
{
  "event": "completed",
  "job": {
    "id": "job-2024-01-15-abc123",
    "agentId": "my-agent",
    "scheduleName": "heartbeat",
    "startedAt": "2024-01-15T09:00:00.000Z",
    "completedAt": "2024-01-15T09:05:30.000Z",
    "durationMs": 330000
  },
  "result": {
    "success": true,
    "output": "Job completed successfully...",
    "error": null
  },
  "agent": {
    "id": "my-agent",
    "name": "My Agent"
  },
  "metadata": {
    "shouldNotify": true,
    "customField": "value"
  }
}
```

## Agent Metadata

Agents can write a JSON file during execution that gets included in hook context. This enables conditional hook execution based on agent decisions.

### Configuration

```yaml
# agents/price-checker.yaml
name: price-checker
metadata_file: metadata.json  # default, can be customized

hooks:
  after_run:
    - type: discord
      channel_id: "${DISCORD_CHANNEL_ID}"
      bot_token_env: DISCORD_BOT_TOKEN
      when: "metadata.shouldNotify"  # Only notify when agent sets this flag
```

### Agent Usage

The agent writes `metadata.json` in its workspace during execution:

```json
{
  "shouldNotify": true,
  "lowestPrice": 159,
  "retailer": "Staples",
  "meetsTarget": true
}
```

The `when` condition uses dot-notation to access fields:
- `metadata.shouldNotify` - Check if shouldNotify is truthy
- `result.success` - Check if job succeeded
- `job.durationMs` - Access job duration (for numeric comparisons, use shell hooks)

## Library Usage

Herdctl is designed library-first. Use `@herdctl/core` to embed fleet management in your own applications:

```typescript
import { FleetManager } from '@herdctl/core';

// Initialize and start
const fleet = new FleetManager({ configPath: './herdctl.yaml' });
await fleet.initialize();
await fleet.start();

// Subscribe to events
fleet.on('job:completed', (event) => {
  console.log(`Job ${event.jobId} completed for ${event.agentName}`);
});

// Trigger agents programmatically
await fleet.trigger('my-agent', { prompt: 'Check for new issues' });

// Query state
const status = await fleet.getStatus();
const jobs = await fleet.listJobs({ agent: 'my-agent', limit: 10 });
```

See the [library documentation](https://herdctl.dev/library-reference/fleet-manager/) for complete API reference.

## Documentation

Full documentation available at [herdctl.dev](https://herdctl.dev):

- [Getting Started](https://herdctl.dev/getting-started/)
- [Configuration Reference](https://herdctl.dev/configuration/)
- [CLI Reference](https://herdctl.dev/cli-reference/)
- [Library Reference](https://herdctl.dev/library-reference/)
- [Recipes & Examples](https://herdctl.dev/guides/recipes/)

## Development

```bash
# Clone the repo
git clone https://github.com/edspencer/herdctl
cd herdctl

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

Ed Spencer - [edspencer.net](https://edspencer.net)
