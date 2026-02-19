---
title: Fleet Configuration
description: Complete reference for herdctl.yaml fleet configuration schema
---

The fleet configuration file (`herdctl.yaml`) is the root configuration for your entire agent fleet. This document covers every available configuration option.

## Basic Structure

A minimal configuration requires only the `version` field:

```yaml
version: 1
```

A typical configuration includes workspace settings and agent references:

```yaml
version: 1

workspace:
  root: ~/herdctl-workspace
  auto_clone: true

agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml
```

## Configuration Reference

### version

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

The configuration schema version. Currently only version `1` is supported.

```yaml
version: 1
```

---

### fleet

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Fleet metadata for identification and documentation purposes.

#### fleet.name

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Human-readable name for the fleet.

#### fleet.description

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Description of the fleet's purpose.

```yaml
fleet:
  name: production-fleet
  description: Production agent fleet for automated code review and deployment
```

---

### defaults

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default settings applied to all agents in the fleet. Individual agent configurations can override these defaults.

#### defaults.model

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Default Claude model for all agents.

```yaml
defaults:
  model: claude-sonnet-4-20250514
```

#### defaults.max_turns

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `undefined` |
| **Required** | No |

Default maximum conversation turns per session.

```yaml
defaults:
  max_turns: 50
```

#### defaults.permission_mode

| Property | Value |
|----------|-------|
| **Type** | `enum` |
| **Default** | `undefined` |
| **Required** | No |
| **Valid Values** | `"default"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"` |

Default permission mode for all agents.

- `default` - Standard permission prompts
- `acceptEdits` - Automatically accept file edits
- `bypassPermissions` - Skip all permission checks
- `plan` - Planning mode only

```yaml
defaults:
  permission_mode: acceptEdits
```

#### defaults.docker

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default Docker settings. See [docker](#docker) for field details.

```yaml
defaults:
  docker:
    enabled: true
    base_image: node:20-alpine
```

#### defaults.allowed_tools

| Property | Value |
|----------|-------|
| **Type** | `string[]` |
| **Default** | `undefined` |
| **Required** | No |

List of tools the agent is allowed to use. Use `Bash()` patterns to allow specific bash commands.

```yaml
defaults:
  allowed_tools:
    - Read
    - Write
    - Edit
    - "Bash(npm *)"
    - "Bash(git *)"
    - "Bash(pnpm *)"
```

#### defaults.denied_tools

| Property | Value |
|----------|-------|
| **Type** | `string[]` |
| **Default** | `undefined` |
| **Required** | No |

List of tools the agent is not allowed to use. Use `Bash()` patterns to deny specific bash commands or patterns.

```yaml
defaults:
  denied_tools:
    - WebFetch
    - "Bash(rm -rf *)"
    - "Bash(sudo *)"
```

:::tip[Bash Permissions]
Bash command permissions are now specified using `Bash()` patterns in `allowed_tools` and `denied_tools`. This matches the Claude Agents SDK format. For example:
- `"Bash(npm *)"` - Allow npm commands
- `"Bash(git *)"` - Allow git commands
- `"Bash(rm -rf *)"` - Deny rm -rf patterns
- `"Bash(sudo *)"` - Deny sudo commands
:::

#### defaults.work_source

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default work source configuration for agents.

##### defaults.work_source.type

| Property | Value |
|----------|-------|
| **Type** | `enum` |
| **Default** | N/A |
| **Required** | **Yes** (if work_source is specified) |
| **Valid Values** | `"github"` |

##### defaults.work_source.labels

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

GitHub label configuration for work items.

- `ready` (`string`) - Label indicating an issue is ready for processing
- `in_progress` (`string`) - Label applied when work begins

##### defaults.work_source.cleanup_in_progress

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `undefined` |
| **Required** | No |

Whether to clean up in-progress items on startup.

```yaml
defaults:
  work_source:
    type: github
    labels:
      ready: ready-for-dev
      in_progress: in-progress
    cleanup_in_progress: true
```

#### defaults.instances

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default instance concurrency settings.

##### defaults.instances.max_concurrent

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

Maximum number of concurrent agent instances.

```yaml
defaults:
  instances:
    max_concurrent: 3
```

#### defaults.session

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Default session configuration.

- `max_turns` (`number`, positive integer) - Maximum conversation turns
- `timeout` (`string`) - Session timeout duration (e.g., `"30m"`, `"1h"`)
- `model` (`string`) - Claude model for the session

```yaml
defaults:
  session:
    max_turns: 100
    timeout: 1h
    model: claude-sonnet-4-20250514
```

---

### workspace

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Global workspace configuration for repository management.

#### workspace.root

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | N/A |
| **Required** | **Yes** (if workspace is specified) |

Root directory for all agent workspaces. Supports `~` for home directory expansion.

#### workspace.auto_clone

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `true` |
| **Required** | No |

Automatically clone repositories when needed.

#### workspace.clone_depth

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `1` |
| **Required** | No |

Git shallow clone depth. Use `1` for shallow clones (faster), or a higher number for more history.

#### workspace.default_branch

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `"main"` |
| **Required** | No |

Default branch to checkout when cloning repositories.

```yaml
workspace:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1
  default_branch: main
```

---

### fleets

| Property | Value |
|----------|-------|
| **Type** | `array` of fleet references |
| **Default** | `[]` |
| **Required** | No |

List of sub-fleet configuration file references. Fleet composition allows you to build "super-fleets" from multiple project fleets, each with their own agents.

#### Fleet Reference Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | **Yes** | Path to sub-fleet config file (relative or absolute) |
| `name` | string | No | Override the sub-fleet's name (for qualified name computation) |
| `overrides` | object | No | Fleet-level configuration overrides |

```yaml
version: 1

fleet:
  name: all-projects
  web:
    enabled: true
    port: 3232

fleets:
  - path: ./herdctl/herdctl.yaml
  - path: ./bragdoc/herdctl.yaml
    name: bragdoc                    # Override sub-fleet's name
  - path: ./other-project/herdctl.yaml
    overrides:
      defaults:
        model: claude-opus-4-20250514

agents:                               # Direct agents still supported
  - path: ./global-agents/monitor.yaml
```

#### Qualified Names

When composing fleets, agents receive a **qualified name** that includes their fleet hierarchy:

| Fleet Path | Agent Name | Qualified Name |
|---|---|---|
| `["herdctl"]` | `security-auditor` | `herdctl.security-auditor` |
| `["bragdoc"]` | `developer` | `bragdoc.developer` |
| `["project", "frontend"]` | `designer` | `project.frontend.designer` |
| `[]` (root) | `monitor` | `monitor` |

The root fleet's name is not included in qualified names. Agents directly on the root fleet have a qualified name equal to their local name, so single-fleet setups are unaffected.

Use qualified names with CLI commands:

```bash
# Trigger a sub-fleet agent
herdctl trigger herdctl.security-auditor

# Check status
herdctl status bragdoc.developer
```

#### Fleet Name Resolution

Sub-fleet names are resolved in this priority order:

1. **Parent's explicit `name`** — the `name` field on the fleet reference (highest priority)
2. **Sub-fleet's own `fleet.name`** — from the sub-fleet's configuration
3. **Directory name** — derived from the config file path (e.g., `./herdctl/herdctl.yaml` yields `herdctl`)

Fleet names must match the pattern `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` (no dots allowed, since dots are the hierarchy separator).

#### Defaults Merging

When composing fleets, defaults merge across levels with this priority (lowest to highest):

1. Super-fleet `defaults` (gap-filler)
2. Sub-fleet `defaults`
3. Agent's own config
4. Per-agent `overrides` from the sub-fleet's `agents` entry
5. Per-fleet `overrides` from the super-fleet's `fleets` entry (highest priority)

```yaml
# Super-fleet sets a default model
defaults:
  model: claude-sonnet-4-20250514

fleets:
  - path: ./project/herdctl.yaml
    overrides:
      defaults:
        model: claude-opus-4-20250514  # Forces all agents in this sub-fleet to use Opus
```

#### Web Suppression

Only the **root fleet's** web configuration is honored. Sub-fleet web configurations are automatically suppressed to ensure a single dashboard serves all agents. This is handled automatically during fleet loading.

#### Cycle Detection

The config loader detects cycles in fleet references. If fleet A references fleet B which references fleet A, loading fails with a clear error message showing the cycle chain.

#### Example: Multi-Project Super-Fleet

```yaml
version: 1

fleet:
  name: engineering
  description: All engineering project agents

web:
  enabled: true
  port: 3232

defaults:
  model: claude-sonnet-4-20250514
  permission_mode: acceptEdits

fleets:
  - path: ~/projects/herdctl/herdctl.yaml
    name: herdctl
  - path: ~/projects/bragdoc/herdctl.yaml
    name: bragdoc
  - path: ~/projects/webapp/herdctl.yaml
    name: webapp

agents:
  - path: ./agents/overseer.yaml  # Fleet-wide monitoring agent
```

This creates a unified fleet where:
- All agents are visible in one web dashboard
- Agents are grouped by project in the sidebar (herdctl, bragdoc, webapp)
- Each project's agents retain their own defaults and configurations
- The overseer agent monitors the entire fleet

---

### agents

| Property | Value |
|----------|-------|
| **Type** | `array` of agent references |
| **Default** | `[]` |
| **Required** | No |

List of agent configuration file references.

#### Agent Reference Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | **Yes** | Path to agent config file (relative or absolute) |
| `overrides` | object | No | Per-agent configuration overrides |

```yaml
agents:
  - path: ./agents/coder.yaml
  - path: ./agents/reviewer.yaml
  - path: /etc/herdctl/agents/shared-agent.yaml
```

#### Agent Overrides

Use `overrides` to customize specific agents without modifying their config files. Overrides are deep-merged with the agent config after fleet defaults are applied.

```yaml
agents:
  - path: ./agents/standard-agent.yaml
    # No overrides - uses fleet defaults

  - path: ./agents/trusted-agent.yaml
    overrides:
      docker:
        network: host           # Grant host network access
        env:
          SPECIAL_TOKEN: "${SPECIAL_TOKEN}"

  - path: ./agents/high-resource-agent.yaml
    overrides:
      session:
        max_turns: 200
      docker:
        memory: "8g"
```

**Common override use cases:**

1. **Grant dangerous Docker options to specific agents:**
   ```yaml
   overrides:
     docker:
       network: host
       volumes:
         - "/data:/data:ro"
       env:
         GITHUB_TOKEN: "${GITHUB_TOKEN}"
   ```

2. **Override session settings:**
   ```yaml
   overrides:
     session:
       max_turns: 500
       timeout: 8h
   ```

3. **Override model:**
   ```yaml
   overrides:
     model: claude-opus-4-20250514
   ```

:::tip[Tiered Security]
Per-agent overrides are the recommended way to grant [fleet-level Docker options](/configuration/docker/#tiered-security-model) to specific agents while keeping other agents restricted.
:::

---

:::note[Chat Configuration]
Chat integrations (Discord, Slack) are configured **per-agent**, not at fleet level. Each chat-enabled agent has its own bot with its own token. See [Agent Configuration](/configuration/agent-config#chat) for details.
:::

---

### fleet.web

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Web dashboard configuration. When enabled, herdctl serves a browser-based dashboard for real-time fleet monitoring, agent chat, and job/schedule management. See [Web Dashboard](/integrations/web-dashboard/) for full documentation.

#### fleet.web.enabled

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `false` |
| **Required** | No |

Enable the web dashboard server.

#### fleet.web.port

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `3232` |
| **Required** | No |

Port for the web dashboard to listen on.

#### fleet.web.host

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `"localhost"` |
| **Required** | No |

Host to bind the web dashboard to.

#### fleet.web.session_expiry_hours

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `24` |
| **Required** | No |

Hours before web chat sessions expire.

```yaml
fleet:
  web:
    enabled: true
    port: 3232
    host: "localhost"
    session_expiry_hours: 24
```

---

### webhooks

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Webhook server configuration for receiving external triggers.

#### webhooks.enabled

| Property | Value |
|----------|-------|
| **Type** | `boolean` |
| **Default** | `false` |
| **Required** | No |

Enable the webhook server.

#### webhooks.port

| Property | Value |
|----------|-------|
| **Type** | `number` (positive integer) |
| **Default** | `8081` |
| **Required** | No |

Port for the webhook server to listen on.

#### webhooks.secret_env

| Property | Value |
|----------|-------|
| **Type** | `string` |
| **Default** | `undefined` |
| **Required** | No |

Name of the environment variable containing the webhook secret for request validation.

```yaml
webhooks:
  enabled: true
  port: 8081
  secret_env: WEBHOOK_SECRET
```

---

### docker

| Property | Value |
|----------|-------|
| **Type** | `object` |
| **Default** | `undefined` |
| **Required** | No |

Global Docker runtime configuration. Fleet config has access to **all** Docker options, including dangerous ones restricted from agent config.

:::note[Tiered Security Model]
Fleet config can set dangerous options like `network`, `volumes`, `env`, `image`, `user`, and `ports`. These are restricted from agent config because agents can modify their own config files. See [Docker Configuration](/configuration/docker/#tiered-security-model).
:::

#### Safe Options (also available in agent config)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Docker execution |
| `ephemeral` | boolean | `true` | Fresh container per job |
| `memory` | string | `2g` | Memory limit |
| `cpu_shares` | integer | — | CPU relative weight |
| `cpu_period` | integer | — | CPU CFS period |
| `cpu_quota` | integer | — | CPU CFS quota |
| `max_containers` | integer | `5` | Container pool limit |
| `workspace_mode` | string | `rw` | Workspace mount mode |
| `tmpfs` | string[] | — | Tmpfs mounts |
| `pids_limit` | integer | — | Max processes |
| `labels` | object | — | Container labels |

#### Dangerous Options (fleet-level only)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `image` | string | `herdctl/runtime:latest` | Docker image |
| `network` | string | `bridge` | Network mode: `none`, `bridge`, `host` |
| `user` | string | Host UID:GID | Container user |
| `volumes` | string[] | `[]` | Additional volume mounts |
| `ports` | string[] | — | Port bindings |
| `env` | object | — | Environment variables |
| `host_config` | object | — | Raw dockerode HostConfig passthrough |

#### Example

```yaml
defaults:
  docker:
    enabled: true
    image: "herdctl/runtime:latest"
    network: bridge
    memory: "2g"
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
    volumes:
      - "/data/models:/models:ro"
```

#### Advanced: host_config Passthrough

For dockerode options not in our schema:

```yaml
defaults:
  docker:
    enabled: true
    host_config:
      ShmSize: 67108864      # 64MB shared memory
      Privileged: true       # Use with extreme caution!
```

Values in `host_config` override translated options. See [dockerode HostConfig](https://github.com/apocas/dockerode) for available options.

---

## Complete Example

Here's a comprehensive example demonstrating all configuration options:

```yaml
version: 1

fleet:
  name: production-fleet
  description: Production agent fleet for automated development workflows

defaults:
  model: claude-sonnet-4-20250514
  max_turns: 50
  permission_mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - Edit
    - Glob
    - Grep
    - "Bash(npm *)"
    - "Bash(pnpm *)"
    - "Bash(git *)"
    - "Bash(node *)"
  denied_tools:
    - "Bash(rm -rf *)"
    - "Bash(sudo *)"
  docker:
    enabled: true
    network: bridge           # Fleet-level: set network for all agents
    env:                      # Fleet-level: pass credentials to all agents
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
  work_source:
    type: github
    labels:
      ready: ready-for-dev
      in_progress: in-progress
    cleanup_in_progress: true
  instances:
    max_concurrent: 2
  session:
    max_turns: 100
    timeout: 1h

workspace:
  root: ~/herdctl-workspace
  auto_clone: true
  clone_depth: 1
  default_branch: main

agents:
  - path: ./agents/coder.yaml
    # Uses fleet defaults

  - path: ./agents/reviewer.yaml
    # Uses fleet defaults

  - path: ./agents/homelab.yaml
    overrides:
      docker:
        network: host         # This agent needs host network for SSH
        env:
          SSH_AUTH_SOCK: "${SSH_AUTH_SOCK}"

# Note: Chat (Discord/Slack) is configured per-agent, not here.
# See agent config files for chat integration settings.

webhooks:
  enabled: true
  port: 8081
  secret_env: GITHUB_WEBHOOK_SECRET
```

## Validation

Validate your configuration with:

```bash
herdctl config validate
```

## Related

- [Agent Configuration](/configuration/agent-config/) - Individual agent settings
- [Permissions](/configuration/permissions/) - Permission system details
- [Workspaces](/concepts/workspaces/) - Workspace isolation concepts
- [Environment Variables](/configuration/environment/) - Using environment variables
- [Web Dashboard](/integrations/web-dashboard/) - Fleet monitoring and chat interface
