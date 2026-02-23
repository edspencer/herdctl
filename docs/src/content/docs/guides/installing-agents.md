---
title: Installing Agents
description: Install and manage pre-built agents from GitHub or local directories
---

The agent distribution system lets you install pre-configured agents with a single command. Agents are fully self-contained packages that include configuration, knowledge files, and optional Claude Code commands.

Think of it as "shadcn for herdctl agents" — simple installation, no complex dependency management, and full customization after install.

## Installation Sources

You can install agents from two sources:

- **GitHub repositories** — Public or private repos containing agent files
- **Local directories** — Agent directories on your filesystem (useful for development)

## Installing from GitHub

The most common way to install an agent is from a GitHub repository:

```bash
herdctl agent add github:user/repo
```

This clones the repository, validates the agent configuration, copies files to `./agents/<name>/`, and updates your `herdctl.yaml` to include the new agent.

### Specifying a Version

To install a specific version (tag, branch, or commit):

```bash
# Install a tagged release
herdctl agent add github:user/repo@v1.0.0

# Install from a specific branch
herdctl agent add github:user/repo@main

# Install from a specific commit
herdctl agent add github:user/repo@abc123
```

If no version is specified, the default branch (usually `main`) is used.

### Private Repositories

For private repositories, ensure your Git credentials are configured. herdctl uses your system's Git configuration for authentication:

```bash
# If you have SSH keys configured
herdctl agent add github:myorg/private-agent

# Or configure Git credentials first
gh auth login
herdctl agent add github:myorg/private-agent
```

## Installing from a Local Path

During development or when working with agents not yet published to GitHub, install from a local directory:

```bash
herdctl agent add ./path/to/my-agent
```

The path must contain at least an `agent.yaml` file. This is useful for:

- Testing agents before publishing
- Installing agents from a shared network drive
- Working with agents checked out alongside your project

## What Happens During Installation

When you run `herdctl agent add`, the following steps occur:

1. **Fetch** — Clone the repository (GitHub) or read the directory (local)
2. **Validate** — Verify `agent.yaml` exists and is valid
3. **Copy** — Copy agent files to `./agents/<name>/` (name from `agent.yaml`)
4. **Update config** — Add the agent reference to `herdctl.yaml`
5. **Create workspace** — Create a `workspace/` directory for the agent
6. **Scan env vars** — Identify required environment variables
7. **Print summary** — Show what was installed and what you need to configure

### Post-Installation Summary

After installation, you'll see a summary like this:

```
Agent 'competitive-analysis' installed successfully!

Files installed:
  ./agents/competitive-analysis/
    agent.yaml
    CLAUDE.md
    knowledge/ (3 files)
    workspace/

Fleet config updated:
  herdctl.yaml (added agent reference)

This agent requires the following environment variables:
  COMPETITOR_WEBSITES       (no default - required)
  DISCORD_WEBHOOK_URL       (no default - required)
  CRON_SCHEDULE             (default: 0 9 * * *)

Add required variables to your .env file before starting the fleet.

Next steps:
  1. Add environment variables to .env
  2. Review agent config: cat ./agents/competitive-analysis/agent.yaml
  3. Test the agent: herdctl trigger competitive-analysis
  4. Start the fleet: herdctl start
```

## Configuring Environment Variables

Most agents use environment variables for configuration — API keys, webhook URLs, schedules, etc. After installation, add the required variables to your `.env` file:

```bash
# .env
COMPETITOR_WEBSITES=acme.com,widgetco.com
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
CRON_SCHEDULE=0 9 * * *  # Optional, has default
```

Environment variables use the `${VAR}` syntax in `agent.yaml` and are resolved at runtime. Variables with `${VAR:-default}` have default values; variables with `${VAR}` are required.

## Preview with Dry Run

To see what would be installed without making changes:

```bash
herdctl agent add github:user/repo --dry-run
```

This shows all the files that would be copied, the fleet config changes, and required environment variables — without actually installing anything.

## Overwriting Existing Agents

By default, installation fails if an agent with the same name already exists. To overwrite:

```bash
herdctl agent add github:user/repo --force
```

This removes the existing agent directory and installs fresh. Use with caution — any customizations you made to the agent files will be lost.

## Custom Install Path

To install to a specific directory instead of the default `./agents/<name>/`:

```bash
herdctl agent add github:user/repo --path ./agents/my-custom-name
```

After installation, you may want to edit the agent's `name` field in `agent.yaml` to match the directory name.

## Managing Installed Agents

### List Installed Agents

See all installed agents:

```bash
herdctl agent list
```

Output:

```
NAME                  SOURCE                                      VERSION  INSTALLED
competitor-tracker    github:user/competitive-analysis-agent      1.0.0    2 days ago
content-writer        github:user/content-agent                   0.5.0    1 week ago
github-triager        ./agents/custom-triager                     -        3 days ago
```

### View Agent Details

Get detailed information about an installed agent:

```bash
herdctl agent info competitor-tracker
```

Output:

```
Name: competitor-tracker
Description: Competitive intelligence for Acme SaaS Platform
Source: github:edspencer/competitive-analysis-agent
Version: 1.0.0
Installed: 2 days ago

Files:
  ./agents/competitor-tracker/
    agent.yaml
    CLAUDE.md
    knowledge/ (3 files)
    workspace/

Environment variables:
  COMPETITOR_WEBSITES
  DISCORD_WEBHOOK_URL
  SLACK_CHANNEL

Schedules:
  daily-competitive-scan (0 8 * * *)
```

### Remove an Agent

Remove an installed agent:

```bash
herdctl agent remove competitor-tracker
```

This prompts for confirmation, then removes the agent directory and its reference from `herdctl.yaml`. The command also lists which environment variables were used by the agent (you can remove them from `.env` manually).

To skip confirmation:

```bash
herdctl agent remove competitor-tracker --force
```

To keep the workspace data while removing the agent:

```bash
herdctl agent remove competitor-tracker --keep-workspace
```

## Customizing Installed Agents

After installation, agent files are yours to customize:

- **Edit `agent.yaml`** — Adjust schedules, prompts, permissions
- **Modify knowledge files** — Add domain-specific information
- **Add custom commands** — Create `.claude/commands/` slash commands
- **Extend `CLAUDE.md`** — Add project-specific instructions

The agent distribution system copies files at installation time; after that, you have full control. There's no "sync" with the original repository — if you want upstream updates, remove and reinstall the agent.

## Next Steps

- [Creating Agents](/guides/creating-agents/) — Build and publish your own agents
- [herdctl.json Reference](/reference/herdctl-json/) — Agent metadata reference
- [Agent Configuration](/configuration/agent-config/) — Full agent.yaml reference
- [CLI Reference](/cli-reference/) — Complete command documentation
