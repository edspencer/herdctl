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
- **Live Monitoring**: Web dashboard with real-time streaming
- **Chat Integration**: Discord and Slack connectors (planned)
- **Optional Docker**: Run in containers or natively

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
  my-agent:
    path: ./agents/my-agent.yaml
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
```

## Documentation

Full documentation available at [herdctl.dev](https://herdctl.dev).

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

UNLICENSED - All rights reserved.

## Author

Ed Spencer - [edspencer.net](https://edspencer.net)
