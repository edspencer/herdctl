---
title: herdctl.json
description: Agent metadata schema reference
---

The `herdctl.json` file contains metadata about a distributable agent. It documents the agent's requirements, authorship, and version information, and is validated during installation.

## When to Use

- **Recommended** for any shared agent — it documents requirements clearly
- **Optional** for agents distributed via GitHub URL or local path

## Quick Example

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "competitive-analysis",
  "version": "1.0.0",
  "description": "Daily competitive intelligence agent that monitors competitor websites",
  "author": "edspencer",
  "repository": "github:edspencer/competitive-analysis-agent",
  "license": "MIT",
  "keywords": ["marketing", "competitive-analysis", "monitoring"],
  "category": "marketing"
}
```

## Complete Schema

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Agent name (kebab-case) |
| `version` | string | Yes | Semantic version (e.g., `1.0.0`) |
| `description` | string | Yes | Short description (max 200 characters) |
| `author` | string | Yes | Author username or name |
| `repository` | string | Yes | GitHub repository (`github:user/repo`) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string | JSON schema URL for validation |
| `homepage` | string | Project homepage URL |
| `license` | string | License identifier (MIT, Apache-2.0, etc.) |
| `keywords` | string[] | Descriptive keywords |
| `category` | string | Primary category |
| `tags` | string[] | Additional categorization tags |
| `requires` | object | Runtime requirements |
| `screenshots` | string[] | Screenshot URLs |
| `examples` | object | Example configurations |

### The `requires` Object

The `requires` field documents what the agent needs to function:

| Field | Type | Description |
|-------|------|-------------|
| `herdctl` | string | Minimum herdctl version (semver range, e.g., `>=0.1.0`) |
| `runtime` | string | Required runtime: `sdk`, `cli`, or `both` |
| `env` | string[] | Required environment variables (without defaults) |
| `workspace` | boolean | Whether the agent needs a workspace directory |
| `docker` | boolean | Whether the agent requires Docker |

## Field Reference

### name

The unique identifier for your agent. Must be:
- Lowercase letters, numbers, and hyphens only
- Start with a letter

```json
{
  "name": "competitive-analysis"
}
```

### version

Semantic version following [semver](https://semver.org/):

```json
{
  "version": "1.0.0"
}
```

Use:
- Patch (`1.0.1`) for bug fixes
- Minor (`1.1.0`) for new features (backward compatible)
- Major (`2.0.0`) for breaking changes

### description

A short, clear description of what the agent does. Keep it under 200 characters.

```json
{
  "description": "Daily competitive intelligence agent that monitors competitor websites and generates reports"
}
```

### author

Your username or name.

```json
{
  "author": "edspencer"
}
```

### repository

The GitHub repository in `github:owner/repo` format:

```json
{
  "repository": "github:edspencer/competitive-analysis-agent"
}
```

This is used to resolve the agent source during installation.

### homepage

Optional URL for documentation or project homepage:

```json
{
  "homepage": "https://github.com/edspencer/competitive-analysis-agent"
}
```

### license

The license under which the agent is distributed. Use standard [SPDX identifiers](https://spdx.org/licenses/):

```json
{
  "license": "MIT"
}
```

Common licenses:
- `MIT` — Permissive, minimal restrictions
- `Apache-2.0` — Permissive with patent grant
- `GPL-3.0` — Copyleft, requires derivative works to be GPL
- `UNLICENSED` — Proprietary, not open source

### keywords

Keywords that describe your agent:

```json
{
  "keywords": ["marketing", "competitive-analysis", "research", "monitoring"]
}
```

Keep keywords relevant and specific.

### category

The primary category for your agent:

```json
{
  "category": "marketing"
}
```

Standard categories:
- `marketing` — Marketing automation and analytics
- `development` — Developer productivity and code tools
- `content` — Content creation and management
- `operations` — DevOps, infrastructure, monitoring
- `support` — Customer support and engagement
- `research` — Research and data gathering
- `finance` — Financial analysis and reporting

### tags

Additional categorization beyond the primary category:

```json
{
  "tags": ["monitoring", "automation", "reporting"]
}
```

### requires

Document what your agent needs to function:

```json
{
  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": ["COMPETITOR_WEBSITES", "DISCORD_WEBHOOK_URL"],
    "workspace": true,
    "docker": false
  }
}
```

#### requires.herdctl

Minimum herdctl version as a semver range:

```json
{
  "requires": {
    "herdctl": ">=0.1.0"
  }
}
```

Common patterns:
- `>=0.1.0` — Any version 0.1.0 or higher
- `^1.0.0` — Any 1.x version
- `>=1.2.0 <2.0.0` — Specific range

#### requires.runtime

The runtime your agent requires:

| Value | Description |
|-------|-------------|
| `sdk` | Claude Agent SDK (default herdctl runtime) |
| `cli` | Claude CLI (requires CLI installed, Max plan pricing) |
| `both` | Works with either runtime |

```json
{
  "requires": {
    "runtime": "cli"
  }
}
```

#### requires.env

Environment variables that the user must set (variables without defaults in `agent.yaml`):

```json
{
  "requires": {
    "env": ["COMPETITOR_WEBSITES", "DISCORD_WEBHOOK_URL"]
  }
}
```

Only list required variables — variables with defaults (`${VAR:-default}`) should not be listed here.

#### requires.workspace

Whether the agent needs a workspace directory for storing data:

```json
{
  "requires": {
    "workspace": true
  }
}
```

Most agents need a workspace. Set to `false` only for stateless agents.

#### requires.docker

Whether the agent requires Docker for execution:

```json
{
  "requires": {
    "docker": false
  }
}
```

Set to `true` if your agent requires Docker isolation or uses Docker-specific features.

### screenshots

URLs to screenshots:

```json
{
  "screenshots": [
    "https://github.com/user/repo/raw/main/screenshots/dashboard.png",
    "https://github.com/user/repo/raw/main/screenshots/report.png"
  ]
}
```

Use absolute URLs to images in your repository.

### examples

Named example configurations:

```json
{
  "examples": {
    "basic": "Simple daily monitoring of two competitors",
    "advanced": "Multi-competitor analysis with custom metrics and Slack integration"
  }
}
```

## Complete Examples

### Minimal herdctl.json

A minimal example with only the required fields:

```json
{
  "name": "uptime-monitor",
  "version": "1.0.0",
  "description": "Website uptime monitoring with Discord alerts",
  "author": "yourname",
  "repository": "github:yourname/uptime-monitor"
}
```

### Full herdctl.json

A complete example with all fields:

```json
{
  "$schema": "https://herdctl.dev/schemas/agent-metadata.json",
  "name": "competitive-analysis",
  "version": "1.2.0",
  "description": "Daily competitive intelligence agent that monitors competitor websites and generates comprehensive reports",
  "author": "edspencer",
  "repository": "github:edspencer/competitive-analysis-agent",
  "homepage": "https://github.com/edspencer/competitive-analysis-agent",
  "license": "MIT",
  "keywords": [
    "marketing",
    "competitive-analysis",
    "research",
    "monitoring",
    "intelligence"
  ],
  "category": "marketing",
  "tags": ["monitoring", "automation", "reporting", "discord"],
  "requires": {
    "herdctl": ">=0.1.0",
    "runtime": "cli",
    "env": [
      "COMPETITOR_WEBSITES",
      "DISCORD_WEBHOOK_URL"
    ],
    "workspace": true,
    "docker": false
  },
  "screenshots": [
    "https://github.com/edspencer/competitive-analysis-agent/raw/main/screenshots/report.png"
  ],
  "examples": {
    "basic": "Monitor 2-3 competitor websites daily",
    "advanced": "Track 10+ competitors with custom analysis dimensions"
  }
}
```

## Relationship to agent.yaml

The `herdctl.json` and `agent.yaml` files serve different purposes:

| File | Purpose |
|------|---------|
| `agent.yaml` | Runtime configuration — how the agent runs |
| `herdctl.json` | Metadata — how the agent is discovered and documented |

Some information overlaps (name, description) but serves different uses:
- `agent.yaml` fields are used at runtime
- `herdctl.json` fields are used for documentation and validation

Keep both files in sync — the `name` field should match in both.

## Validation

Validate your `herdctl.json` before publishing:

```bash
# Install from local path to trigger validation
herdctl agent add ./my-agent --dry-run
```

The installation process validates both `agent.yaml` and `herdctl.json` schemas.

## Related Pages

- [Creating Agents](/guides/creating-agents/) — Complete guide to building agents
- [Installing Agents](/guides/installing-agents/) — User guide for installation
- [Agent Configuration](/configuration/agent-config/) — Full agent.yaml reference
