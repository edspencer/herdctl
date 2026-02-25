<p align="center">
  <img src="https://raw.githubusercontent.com/edspencer/herdctl/main/docs/public/herdctl-logo.svg" alt="herdctl" width="120" />
</p>

<h1 align="center">herdctl</h1>

<p align="center">
  <strong>Let Claude Code invoke itself.</strong><br/>
  Run agents on schedules, chat with them on Discord, and resume any session in your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/herdctl"><img src="https://img.shields.io/npm/v/herdctl.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/edspencer/herdctl/actions"><img src="https://github.com/edspencer/herdctl/workflows/CI/badge.svg" alt="CI Status"></a>
</p>

<p align="center">
  <a href="https://herdctl.dev">Documentation</a> •
  <a href="https://herdctl.dev/getting-started/">Getting Started</a> •
  <a href="https://discord.gg/d2eXZKtNrh">Discord</a> •
  <a href="https://github.com/edspencer/herdctl/issues">Issues</a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/edspencer/herdctl/main/docs/public/demo/herdctl-demo.gif" alt="herdctl demo — fleet startup and web dashboard" width="720">
</p>

## The Vision

Claude Code has changed the world, but most of the work it does is supervised by a human. What if Claude Code could invoke itself?

**herdctl** is an orchestration layer for Claude Code. Under the hood, it uses the Claude Agents SDK to trigger Claude Code sessions on schedules, via webhooks, or via chat messages.

It uses simple .yml files that are a thin wrapper around Claude Agents SDK configs, plus a couple of extra features provided by herdctl - `schedules`, `chat` and `hooks`. Each Agent defined this way can have any number of **schedules** that trigger the agent to do something automatically.

herdctl can run **fleets of agents**, each with their own source-controllable configurations. Agent fleets can be run anywhere via a simple `herdctl start` command.

herdctl allows you to interact with all of your existing Claude Code projects via **chat apps like Discord and Slack** (Telegram support coming soon).

## Key Features

- **Self-Invoking Agents** — Define agents that wake themselves up on schedules or triggers. Coordinate an entire fleet from a single `herdctl start` command.

- **Fleet Composition** — Build "super-fleets" from multiple project fleets. Each project keeps its own agent configurations, but they all run together with a unified web dashboard and CLI.

- **Full Claude Code Power** — If Claude Code can do it, your herdctl agent can do it. Same tools, same MCP servers, same capabilities. herdctl is a thin orchestration layer, not a sandbox.

- **Two Runtimes** — CLI runtime uses your Claude Max subscription (much cheaper per token). SDK runtime uses API pricing. Both support Docker isolation with resource limits and network controls.

- **Chat From Anywhere** — Connect agents to Discord or Slack. Message your agents from your phone, get responses, and they continue working based on your conversation. Your PR reviewer bot becomes a team member you can @ mention.

- **Session Continuity** — Every job creates a real Claude SDK session. When an agent finishes, you can `claude --resume` that exact session in your terminal. Pick up where the agent left off with full context intact.

- **Bidirectional Communication** — Agents write structured data back to herdctl via metadata files. Hooks act on that data. Coming soon: agents that request schedule changes, store persistent context, and evolve their own behavior over time.

## Intro Video

In which we try to cover all of the main parts of herdctl in 20 minutes:

<div align="center">
  <a href="https://www.youtube.com/watch?v=b3MRrpHLu8M">
    <img src="https://img.youtube.com/vi/b3MRrpHLu8M/maxresdefault.jpg" alt="herdctl demo" width="600">
  </a>
  <p><em>Watch the demo</em></p>
</div>

## Quick Start

```bash
# Install herdctl globally
npm install -g herdctl

# Initialize a new project with example agents
herdctl init

# Start your agent fleet
herdctl start
```

Your agents are now running. Check their status:

```bash
herdctl status
```

## Web Dashboard

<div align="center">
  <img src="https://raw.githubusercontent.com/edspencer/herdctl/main/docs/src/assets/screenshots/fleet-overview.png" alt="herdctl web dashboard" width="800">
  <p><em>Fleet overview showing agents, status, and recent jobs</em></p>
</div>

The web dashboard gives you a browser-based control panel for your fleet. Enable it with `herdctl start --web` or `web.enabled: true` in your config.

- **Fleet overview** — real-time status of all agents and recent jobs
- **Agent detail** — live output streaming, schedule controls, job history
- **Interactive chat** — message any agent directly from the browser
- **Schedule management** — trigger, enable, and disable schedules
- **Job management** — cancel, fork, and inspect jobs

See the [web dashboard documentation](https://herdctl.dev/integrations/web-dashboard/) for full details.

## Packages

| Package | Description |
|---------|-------------|
| [`herdctl`](https://www.npmjs.com/package/herdctl) | CLI for fleet management. Install globally, run `herdctl start`. |
| [`@herdctl/core`](https://www.npmjs.com/package/@herdctl/core) | Core library. Embed fleet management in your own applications. |
| [`@herdctl/web`](https://www.npmjs.com/package/@herdctl/web) | Web dashboard. Real-time fleet monitoring, agent chat, and job management in your browser. |
| [`@herdctl/discord`](https://www.npmjs.com/package/@herdctl/discord) | Discord connector. Chat with your agents via Discord DMs and channels. |
| [`@herdctl/slack`](https://www.npmjs.com/package/@herdctl/slack) | Slack connector. Chat with your agents via Slack channels and DMs. |
| [`@herdctl/chat`](https://www.npmjs.com/package/@herdctl/chat) | Shared chat infrastructure. Session management, streaming, and message handling used by all connectors. |

## Documentation

Full documentation at [herdctl.dev](https://herdctl.dev):

- [Getting Started](https://herdctl.dev/getting-started/)
- [Configuration Reference](https://herdctl.dev/configuration/fleet-config/)
- [CLI Reference](https://herdctl.dev/cli-reference/)
- [Library Reference](https://herdctl.dev/library-reference/fleet-manager/)
- [Guides & Recipes](https://herdctl.dev/guides/recipes/)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](https://github.com/edspencer/herdctl/blob/main/CONTRIBUTING.md) for development setup and guidelines.

## Community

- [Discord](https://discord.gg/d2eXZKtNrh) - Chat with the community
- [GitHub Discussions](https://github.com/edspencer/herdctl/discussions) - Ask questions, share ideas
- [Developer Blog](https://edspencer.net/blog/tag/herdctl) - Articles and deep dives
- [Twitter/X](https://twitter.com/edspencer) - Updates and announcements

## License

MIT License - see [LICENSE](https://github.com/edspencer/herdctl/blob/main/LICENSE) for details.

---

<p align="center">
  Built by <a href="https://edspencer.net">Ed Spencer</a>
</p>
