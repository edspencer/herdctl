# @herdctl/core

> Core library for herdctl fleet management

[![npm version](https://img.shields.io/npm/v/@herdctl/core.svg)](https://www.npmjs.com/package/@herdctl/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Documentation**: [herdctl.dev](https://herdctl.dev)

## Overview

`@herdctl/core` is the programmatic foundation for herdctl. Use it to embed autonomous Claude Code agents directly in your Node.js applications - build custom dashboards, integrate with your existing tools, or create entirely new agent orchestration systems.

## Installation

```bash
npm install @herdctl/core
```

## Quick Start

```typescript
import { FleetManager } from "@herdctl/core";

// Initialize from config file
const fleet = new FleetManager();
await fleet.initialize();

// Start the fleet
await fleet.start();

// Manually trigger an agent
const result = await fleet.trigger("my-agent", undefined, {
  prompt: "Review the latest changes",
});

console.log(`Job ${result.jobId} started`);

// Stop gracefully
await fleet.stop();
```

## Features

- **FleetManager** - Core orchestration class for managing agent fleets
- **Configuration** - Load and validate herdctl YAML configs programmatically
- **Job Control** - Trigger, cancel, and fork agent jobs
- **Scheduling** - Built-in scheduler for cron and interval triggers
- **Event System** - Subscribe to fleet events (job:created, job:completed, etc.)
- **State Management** - Persistent state for jobs, sessions, and fleet status
- **Hook Execution** - Run shell commands, webhooks, and Discord notifications

## Usage

### Loading Configuration

```typescript
import { loadConfig } from "@herdctl/core";

const config = await loadConfig("./herdctl.yaml");
console.log(`Loaded ${config.agents.length} agents`);
```

### Event Handling

```typescript
fleet.on("job:completed", (event) => {
  console.log(`Job ${event.job.id} completed for ${event.agentName}`);
});

fleet.on("job:failed", (event) => {
  console.error(`Job failed: ${event.error.message}`);
});
```

### Programmatic Triggers

```typescript
// Trigger with custom prompt
const result = await fleet.trigger("code-reviewer", undefined, {
  prompt: "Review PR #123 for security issues",
  onMessage: (message) => {
    // Stream agent output in real-time
    if (message.type === "assistant") {
      process.stdout.write(message.content);
    }
  },
});
```

## Documentation

For complete API documentation, visit [herdctl.dev](https://herdctl.dev):

- [Library Reference](https://herdctl.dev/library-reference/fleet-manager/)
- [Configuration](https://herdctl.dev/configuration/fleet/)
- [Concepts](https://herdctl.dev/concepts/architecture/)

## Related Packages

- [`herdctl`](https://www.npmjs.com/package/herdctl) - CLI for running agent fleets
- [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) - Web dashboard
- [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) - Discord connector
- [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) - Slack connector
- [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) - Shared chat infrastructure

## License

MIT
