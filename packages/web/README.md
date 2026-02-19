# @herdctl/web

> Web dashboard for herdctl fleet management

[![npm version](https://img.shields.io/npm/v/@herdctl/web.svg)](https://www.npmjs.com/package/@herdctl/web)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

`@herdctl/web` provides a real-time web dashboard for monitoring and managing your [herdctl](https://herdctl.dev) agent fleet. View agent status, trigger and manage jobs, chat with agents, and control schedules - all from your browser with live updates via WebSocket.

Herdctl is an open-source system for running fleets of autonomous AI agents powered by Claude Code. This package is part of the herdctl monorepo.

## Installation

```bash
npm install @herdctl/web
```

> **Note**: The dashboard is typically started automatically via the `herdctl` CLI. Direct installation is only needed for programmatic use.

## Quick Start

### Via CLI (Recommended)

```bash
# Start your fleet with the web dashboard enabled
herdctl start --web

# Or specify a custom port
herdctl start --web --web-port 3200
```

### Via Configuration

Add web dashboard settings to your `herdctl.yaml`:

```yaml
fleet:
  name: my-fleet
  web:
    enabled: true
    port: 3232         # Default port
    host: "localhost"   # Default host
```

Then start your fleet normally:

```bash
herdctl start
```

### Programmatic Usage

```typescript
import { FleetManager } from "@herdctl/core";
import { WebManager } from "@herdctl/web";

const fleet = new FleetManager({ configPath: "./herdctl.yaml" });
await fleet.initialize();

const web = new WebManager(fleet, {
  port: 3232,
  host: "localhost",
  stateDir: ".herdctl",
});

await web.initialize();
await web.start();
// Dashboard available at http://localhost:3232
```

## Features

### Fleet Dashboard
- Real-time fleet status with uptime, agent counts, and job statistics
- Agent cards showing current status, schedule count, and recent activity
- Recent jobs feed with status indicators

### Agent Detail Pages
- Agent configuration and metadata
- Job history with pagination and filtering
- Live output streaming from running jobs
- DiceBear-generated avatars for each agent

### Chat with Agents
- Interactive conversations with any agent
- Session management with conversation history
- Streaming responses via WebSocket
- Create, resume, and delete chat sessions

### Schedule Management
- View all schedules across agents
- Enable and disable schedules
- Manually trigger schedules
- See last run and next run times

### Job Control
- Trigger jobs manually with custom prompts
- Cancel running jobs
- Fork existing jobs with optional prompt overrides
- Copy CLI commands for any job

### Real-Time Updates
- WebSocket connection for live fleet events
- Job status changes broadcast instantly
- Agent output streaming to subscribed clients
- Connection status indicator with auto-reconnect

## REST API

The dashboard exposes a REST API for programmatic access:

| Endpoint | Description |
|----------|-------------|
| `GET /api/fleet/status` | Fleet status snapshot |
| `GET /api/agents` | List all agents |
| `GET /api/agents/:name` | Agent detail |
| `POST /api/agents/:name/trigger` | Trigger a job |
| `GET /api/jobs` | List jobs (with pagination/filtering) |
| `POST /api/jobs/:id/cancel` | Cancel a job |
| `POST /api/jobs/:id/fork` | Fork a job |
| `GET /api/schedules` | List all schedules |
| `POST /api/schedules/:agent/:schedule/enable` | Enable a schedule |
| `POST /api/schedules/:agent/:schedule/disable` | Disable a schedule |

## Documentation

For complete setup instructions, visit [herdctl.dev](https://herdctl.dev):

- [Web Dashboard Guide](https://herdctl.dev/integrations/web-dashboard/)
- [Fleet Configuration](https://herdctl.dev/configuration/fleet-config/)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) - Core library for programmatic use
- [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) - Shared chat infrastructure (used internally)
- [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) - Discord connector
- [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) - Slack connector

## License

MIT
