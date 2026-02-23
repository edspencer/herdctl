---
title: Creating Agents
description: Build and share distributable agents for herdctl
---

This guide covers how to create agents that can be shared and installed via `herdctl agent add`. Whether you're building agents for your team or the broader community, this guide walks through the structure, best practices, and publishing workflow.

## Agent Repository Structure

A distributable agent is a directory (typically a GitHub repository) containing configuration and supporting files. At minimum, you need an `agent.yaml` file.

### Minimal Structure

```
my-agent/
  agent.yaml      # Required: herdctl agent configuration
  README.md       # Recommended: installation and usage docs
```

### Full Structure

```
my-agent/
  agent.yaml           # Required: herdctl agent configuration
  herdctl.json         # Optional: metadata for registry listing
  CLAUDE.md            # Optional: agent instructions for Claude
  README.md            # Recommended: documentation
  LICENSE              # Recommended: license file
  knowledge/           # Optional: domain knowledge files
    research-guide.md
    industry-terms.md
  .claude/             # Optional: Claude Code project config
    commands/          # Optional: custom slash commands
      analyze.md
      report.md
```

## Required: agent.yaml

The `agent.yaml` file is a standard herdctl agent configuration. It must conform to the `AgentConfigSchema` — the same schema used for all herdctl agents.

```yaml
name: competitive-analysis
description: "Daily competitive intelligence agent"

runtime: cli
working_directory: ./workspace

# Tell Claude Code to discover CLAUDE.md and .claude/ from the workspace
setting_sources:
  - project

schedules:
  daily-scan:
    type: cron
    cron: "${CRON_SCHEDULE:-0 9 * * *}"
    prompt: |
      Check competitor websites: ${COMPETITOR_WEBSITES}

      Analyze for:
      - New features or product updates
      - Pricing changes
      - Blog posts and announcements

      Generate report and post to Discord: ${DISCORD_WEBHOOK_URL}

permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - WebFetch
  - Bash

docker:
  enabled: ${DOCKER_ENABLED:-false}
  network: bridge  # Always use bridge - agents need network for Anthropic API
```

### Key Fields

| Field | Purpose |
|-------|---------|
| `name` | Unique identifier for the agent |
| `description` | Human-readable description |
| `schedules` | When and how the agent runs |
| `permission_mode` | Permission level for the agent |
| `allowed_tools` | Tools the agent can use |
| `setting_sources` | Where Claude Code finds CLAUDE.md |

For the complete schema reference, see [Agent Configuration](/configuration/agent-config/).

### Environment Variable References

Use `${VAR}` syntax for values that vary per installation:

| Syntax | Meaning |
|--------|---------|
| `${VAR}` | Required — error if not set |
| `${VAR:-default}` | Optional — uses default if not set |

Common patterns:

```yaml
# Required variables (user must set these)
cron: "${CRON_SCHEDULE}"
prompt: "Post to: ${DISCORD_WEBHOOK_URL}"

# Optional variables with defaults
docker:
  enabled: ${DOCKER_ENABLED:-false}

schedules:
  check:
    type: cron
    cron: "${SCHEDULE:-0 9 * * *}"
```

Environment variables are resolved at runtime from the user's `.env` file or environment. There's no install-time substitution — the `agent.yaml` you write is exactly what gets installed.

## Optional: herdctl.json

The `herdctl.json` file contains metadata about your agent — version, author, requirements, and other details. It's optional for installation but useful for documenting your agent's requirements and dependencies.

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "competitive-analysis",
  "version": "1.0.0",
  "description": "Daily competitive intelligence agent that monitors competitor websites",
  "author": "edspencer",
  "repository": "github:edspencer/competitive-analysis-agent",
  "homepage": "https://github.com/edspencer/competitive-analysis-agent",
  "license": "MIT",
  "keywords": ["marketing", "competitive-analysis", "monitoring"],
  "category": "marketing",
  "tags": ["monitoring", "automation", "reporting"],
  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": ["COMPETITOR_WEBSITES", "DISCORD_WEBHOOK_URL"],
    "workspace": true,
    "docker": false
  }
}
```

For the complete field reference, see [herdctl.json Reference](/reference/herdctl-json/).

## Optional: CLAUDE.md

The `CLAUDE.md` file provides instructions to Claude when running as this agent. It's discovered automatically when `setting_sources: ["project"]` is set in `agent.yaml`.

```markdown
# Competitive Analysis Agent

You are a competitive intelligence analyst. Your job is to monitor competitor
websites and identify changes that matter to the business.

## Analysis Framework

When analyzing competitors, focus on:
1. Product changes (new features, removed features)
2. Pricing changes (increases, decreases, new tiers)
3. Messaging changes (positioning, value propositions)
4. Content (blog posts, case studies, announcements)

## Reporting

Always structure reports with:
- Executive summary (2-3 sentences)
- Key findings (bulleted list)
- Detailed analysis (one section per competitor)
- Recommended actions

## Knowledge Files

Reference the following for domain knowledge:
- `knowledge/research-framework.md` — analysis methodology
- `knowledge/industry-glossary.md` — terminology definitions
```

## Optional: knowledge/ Directory

Knowledge files are markdown documents containing domain-specific information that the agent references at runtime. They're just regular files — herdctl doesn't process them specially.

```
knowledge/
  research-framework.md    # How to conduct analysis
  industry-glossary.md     # Domain terminology
  competitor-profiles.md   # Known competitor information
```

Reference these files in your `CLAUDE.md`:

```markdown
For analysis methodology, see `knowledge/research-framework.md`.
For industry terminology, refer to `knowledge/industry-glossary.md`.
```

## Optional: .claude/commands/

Custom slash commands let users interact with your agent in specific ways. Place markdown files in `.claude/commands/`:

```
.claude/
  commands/
    analyze.md      # /analyze command
    report.md       # /report command
```

Each file becomes a slash command that Claude Code recognizes:

```markdown
# /analyze

Analyze a competitor website for recent changes.

## Usage

/analyze [url]

## Behavior

1. Fetch the website at [url]
2. Compare against previous snapshot in workspace
3. Identify and categorize changes
4. Update the competitor profile
```

## Directory Structure After Installation

When a user runs `herdctl agent add github:you/your-agent`, the files are copied to:

```
project/
  herdctl.yaml                  # Updated with agent reference
  .env                          # User adds env vars here
  agents/
    competitive-analysis/       # Your agent's directory
      agent.yaml               # From your repo
      herdctl.json             # From your repo
      CLAUDE.md                # From your repo
      knowledge/               # From your repo
      .claude/commands/        # From your repo
      metadata.json            # Created by herdctl (installation tracking)
      workspace/               # Created by herdctl (agent workspace)
```

## Testing Your Agent Locally

Before publishing, test your agent:

```bash
# Install from local directory
herdctl agent add ./path/to/my-agent

# Check it appears in the list
herdctl agent list

# Review the installed configuration
herdctl agent info my-agent

# Test manually
herdctl trigger my-agent --prompt "Test prompt"

# When done testing, remove
herdctl agent remove my-agent
```

## Publishing to GitHub

Once your agent works locally, publish to GitHub:

```bash
cd my-agent
git init
git add .
git commit -m "Initial agent release"

# Create public repo
gh repo create my-agent --public --source=. --push

# Or create private repo (for internal use)
gh repo create my-org/my-agent --private --source=. --push
```

Users can now install with:

```bash
herdctl agent add github:yourname/my-agent
```

### Versioning with Tags

Create releases with Git tags:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Users can install specific versions:

```bash
herdctl agent add github:yourname/my-agent@v1.0.0
```

## Best Practices

### Security

- **Always use `network: bridge`** for Docker — agents need network access for the Anthropic API
- **Never use `network: none`** — this completely breaks agent functionality
- **Document required permissions** — be clear about what tools and access the agent needs
- **Minimize permissions** — only request tools the agent actually uses

### Documentation

- **Write a good README** — include installation, configuration, and usage instructions
- **Document all environment variables** — explain what each one does
- **Provide examples** — show sample `.env` entries and expected outputs
- **Include a LICENSE** — make usage terms clear

### Configuration

- **Use meaningful defaults** — `${VAR:-sensible-default}` reduces setup friction
- **Group related variables** — use consistent naming (`MYAGENT_API_KEY`, `MYAGENT_WEBHOOK`)
- **Validate in prompts** — have the agent check for missing configuration gracefully

### Knowledge Files

- **Keep files focused** — one topic per file
- **Use clear names** — `research-framework.md` not `rf.md`
- **Reference explicitly** — tell Claude exactly which files to read

## Example: Complete Agent Repository

Here's a complete example for a website uptime monitor:

```
uptime-monitor/
  agent.yaml
  herdctl.json
  CLAUDE.md
  README.md
  LICENSE
  knowledge/
    monitoring-best-practices.md
    incident-response.md
  .claude/
    commands/
      check-now.md
      status.md
```

**agent.yaml:**

```yaml
name: uptime-monitor
description: "Website uptime monitoring with alerts"

runtime: cli
working_directory: ./workspace
setting_sources: [project]

schedules:
  check:
    type: interval
    interval: "${CHECK_INTERVAL:-5m}"
    prompt: |
      Check the status of: ${WEBSITES_TO_MONITOR}

      If any site is down or slow (>3s response):
      1. Log the incident to workspace/incidents.json
      2. Post alert to Discord: ${DISCORD_WEBHOOK_URL}

permission_mode: acceptEdits
allowed_tools:
  - Read
  - Write
  - WebFetch
```

**herdctl.json:**

```json
{
  "name": "uptime-monitor",
  "version": "1.0.0",
  "description": "Website uptime monitoring with Discord alerts",
  "author": "yourname",
  "repository": "github:yourname/uptime-monitor",
  "license": "MIT",
  "keywords": ["monitoring", "uptime", "alerts"],
  "category": "operations",
  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": ["WEBSITES_TO_MONITOR", "DISCORD_WEBHOOK_URL"]
  }
}
```

## Next Steps

- [Installing Agents](/guides/installing-agents/) — User guide for installing agents
- [herdctl.json Reference](/reference/herdctl-json/) — Complete metadata schema
- [Agent Configuration](/configuration/agent-config/) — Full agent.yaml reference
- [Hooks](/concepts/hooks/) — Add notifications to your agent
