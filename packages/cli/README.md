# herdctl

> Autonomous Agent Fleet Management for Claude Code

[![npm version](https://img.shields.io/npm/v/herdctl.svg)](https://www.npmjs.com/package/herdctl)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

Herdctl is an open-source CLI for running fleets of autonomous AI agents powered by Claude Code. Define your agents in YAML, configure schedules and triggers, and let them work autonomously on your codebase.

Think of it as "Kubernetes for AI agents" - declarative configuration, pluggable integrations, and continuous operation.

## Installation

```bash
npm install -g herdctl
```

## Quick Start

```bash
# Initialize a new project
herdctl init

# Start your agent fleet
herdctl start

# Check fleet status
herdctl status

# Manually trigger an agent
herdctl trigger my-agent
```

## Configuration

Create a `herdctl.yaml` in your project root:

```yaml
fleet:
  name: my-fleet

agents:
  - path: ./agents/my-agent.yaml
```

Then define your agent in `agents/my-agent.yaml`:

```yaml
name: my-agent
model: claude-sonnet-4-20250514

schedules:
  daily-review:
    type: cron
    cron: "0 9 * * *"
    prompt: "Review open PRs and provide feedback"

permissions:
  mode: bypassPermissions
  allowed_tools:
    - Read
    - Glob
    - Grep
```

## Features

- **Fleet Management** - Run multiple Claude Code agents with a single command
- **Declarative Config** - Define agents, schedules, and permissions in YAML
- **Multiple Triggers** - Interval, cron, webhooks, chat messages
- **Work Sources** - GitHub Issues integration (Jira/Linear planned)
- **Execution Hooks** - Shell commands, webhooks, Discord notifications
- **Chat Integration** - Discord connector for conversational agents

## Documentation

For complete documentation, visit [herdctl.dev](https://herdctl.dev):

- [Getting Started](https://herdctl.dev/getting-started/installation/)
- [Configuration Reference](https://herdctl.dev/configuration/fleet/)
- [CLI Reference](https://herdctl.dev/cli-reference/commands/)
- [Guides](https://herdctl.dev/guides/github-issues/)

## Related Packages

- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic fleet management
- [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) - Discord connector for chat-based agents

## License

MIT
