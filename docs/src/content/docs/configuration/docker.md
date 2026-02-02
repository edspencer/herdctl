---
title: Docker Configuration
description: Run agents in isolated Docker containers for security
---

Herdctl supports running agents inside Docker containers for security isolation, resource limits, and clean execution environments. This page covers the Docker security model, configuration options, and best practices.

## Overview

Docker containerization provides multiple benefits for agent execution:

- **Security isolation** — Untrusted prompts run in isolated containers
- **Resource limits** — Control memory and CPU usage per agent
- **Network isolation** — Optional network restrictions (none/bridge/host)
- **Clean environment** — Fresh or ephemeral containers per job
- **Reproducibility** — Consistent execution environment across hosts

## Prerequisites

Before using Docker runtime, you must build the herdctl Docker image:

```bash
# From the herdctl repository root
docker build -t herdctl/runtime:latest .
```

This image includes:
- Node.js 22
- Claude CLI (`@anthropic-ai/claude-code`)
- Git and essential tools
- Workspace directory at `/workspace`

**Note:** The image must be built locally - there is no pre-built image on Docker Hub yet.

## Security Model

Herdctl's Docker implementation follows security best practices to isolate agents and protect the host system.

### Security Guarantees

When Docker is enabled, the following security measures are enforced:

1. **Non-root execution**
   - Containers run as non-root user (matches host UID:GID by default)
   - Prevents privilege escalation inside container
   - Files created match host user ownership

2. **Capability dropping**
   - `--cap-drop=ALL` removes all Linux capabilities
   - Prevents container from gaining elevated privileges
   - Limits kernel-level operations

3. **No new privileges**
   - `--security-opt no-new-privileges` prevents privilege escalation
   - Blocks setuid/setgid executables from gaining privileges
   - Prevents container breakout via SUID binaries

4. **Read-only auth mounts**
   - Authentication files mounted read-only at `~/.claude/`
   - Container cannot modify API keys or credentials
   - Prevents credential tampering

5. **Configurable workspace access**
   - Workspace mounted read-write by default (`workspace_mode: rw`)
   - Can be set to read-only (`workspace_mode: ro`) for maximum isolation
   - Prevents file modification when read-only

6. **Network isolation options**
   - `none` — No network access (maximum isolation)
   - `bridge` — Standard Docker networking with NAT (default)
   - `host` — Share host network (performance-critical, trusted only)

### Security Trade-offs

| Configuration | Security | Use Case |
|---------------|----------|----------|
| `network: none` + `workspace_mode: ro` | **Maximum** | Untrusted prompts, read-only analysis |
| `network: bridge` + `workspace_mode: rw` | **Balanced** | Standard agents, API access needed |
| `network: host` + `workspace_mode: rw` | **Minimal** | Trusted agents, performance-critical |

## Configuration Reference

All Docker configuration is optional. Defaults provide secure, sensible behavior.

### Complete Example

```yaml
docker:
  enabled: true
  image: "herdctl/runtime:latest"
  network: "bridge"
  memory: "2g"
  cpu_shares: 1024
  user: "1000:1000"
  workspace_mode: "rw"
  volumes:
    - "/host/data:/container/data:ro"
  ephemeral: false
  max_containers: 5
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Docker execution |
| `image` | string | `herdctl/runtime:latest` | Docker image to use |
| `network` | string | `bridge` | Network mode: `none`, `bridge`, `host` |
| `memory` | string | `2g` | Memory limit |
| `cpu_shares` | integer | — | CPU relative weight (optional) |
| `user` | string | Host UID:GID | Container user (e.g., `"1000:1000"`) |
| `workspace_mode` | string | `rw` | Workspace mount: `rw` (read-write) or `ro` (read-only) |
| `volumes` | array | `[]` | Additional volume mounts |
| `ephemeral` | boolean | `true` | Fresh container per job vs reuse |
| `max_containers` | integer | `5` | Container pool limit |

## Network Modes

Choose the appropriate network isolation level for your security requirements.

| Mode | Description | Use Case | Security Level |
|------|-------------|----------|----------------|
| `bridge` | Full network access via NAT | Agents needing internet/APIs | **Medium** |
| `host` | Share host network | Performance-critical, trusted agents | **Low** |
| `none` | No network access | Maximum isolation, offline tasks | **High** |

### Network Mode Examples

**Bridge (Default) — Standard isolation:**
```yaml
docker:
  enabled: true
  network: bridge  # Full network via NAT
```

Use for:
- Agents calling external APIs
- GitHub operations (clone, push, PR creation)
- Web scraping or data fetching
- Most standard agent workloads

**None — Maximum isolation:**
```yaml
docker:
  enabled: true
  network: none  # No network access
  workspace_mode: ro  # Read-only workspace
```

Use for:
- Untrusted prompts or experimental agents
- Static analysis tasks
- Local-only operations
- Security-critical environments

**Host — Performance-critical:**
```yaml
docker:
  enabled: true
  network: host  # Share host network
```

Use for:
- Trusted agents only
- Performance-critical networking
- Local service access (localhost APIs)
- Development environments

:::caution[Host Network Security]
`network: host` bypasses container network isolation. Only use for trusted agents in controlled environments.
:::

## Volume Mounts

Herdctl automatically mounts required paths and supports additional custom volumes.

### Automatic Mounts

The following are mounted automatically when Docker is enabled:

1. **Workspace** — Agent's working directory
   - Host: Agent workspace path
   - Container: `/workspace`
   - Mode: `rw` (or `ro` if `workspace_mode: ro`)

2. **Auth files** — Claude authentication
   - Host: `~/.claude/`
   - Container: `~/.claude/`
   - Mode: `ro` (always read-only)

### Additional Volumes

Add custom volume mounts via the `volumes` array:

```yaml
docker:
  enabled: true
  volumes:
    - "/host/models:/models:ro"           # Read-only model files
    - "/host/data:/data:rw"                # Read-write data directory
    - "/host/cache:/cache:rw"              # Shared cache
```

**Volume format:** `"host:container:mode"`
- **host** — Absolute path on host system
- **container** — Path inside container
- **mode** — `ro` (read-only) or `rw` (read-write)

### Volume Examples

**Shared model files:**
```yaml
volumes:
  - "/data/models:/models:ro"
```

**Shared cache directory:**
```yaml
volumes:
  - "${HOME}/.cache/agent:/cache:rw"
```

**Multiple volumes:**
```yaml
volumes:
  - "/data/models:/models:ro"
  - "/data/outputs:/outputs:rw"
  - "/data/config:/config:ro"
```

## Resource Limits

Control container resource usage to prevent runaway processes.

### Memory Limits

Memory format: `"<number><unit>"` where unit is `k`, `m`, `g`, `t`, or `b`.

```yaml
docker:
  memory: "2g"    # 2 gigabytes (default)
  memory: "512m"  # 512 megabytes
  memory: "4g"    # 4 gigabytes
  memory: "2048"  # 2048 bytes (no unit = bytes)
```

**Default:** `2g` (2 gigabytes)

**Recommended values:**
- Light agents: `512m` - `1g`
- Standard agents: `2g` - `4g`
- Heavy workloads: `4g` - `8g`

### CPU Shares

CPU shares control relative CPU weight when contention occurs.

```yaml
docker:
  cpu_shares: 1024  # Normal priority
  cpu_shares: 512   # Half priority
  cpu_shares: 2048  # Double priority
```

**Default:** No limit (full CPU access)

**How it works:**
- Value is relative, not absolute
- `1024` is "normal" weight
- Higher values = more CPU when contended
- No effect when CPU is idle

**When to use:**
- Multiple containers competing for CPU
- Prioritize critical agents
- Limit background agents

## Path Translation

Herdctl automatically translates paths between host and container contexts.

### How It Works

When Docker is enabled:
1. Agent receives workspace path (e.g., `/home/user/projects/my-app`)
2. Runtime translates to container path (`/workspace`)
3. All file operations use container path
4. Results translated back to host path

### Session Storage Separation

Docker sessions are stored separately from host sessions to prevent path conflicts:

- **Host sessions:** `.herdctl/sessions/`
- **Docker sessions:** `.herdctl/docker-sessions/`

This prevents issues when the same agent runs in both Docker and host modes.

## Container Lifecycle

Control whether containers are reused or recreated per job.

### Ephemeral Containers (Default)

```yaml
docker:
  enabled: true
  # ephemeral: true is the default (can be omitted)
```

**Behavior:**
- New container created for each job
- Container removed after job completes (AutoRemove)
- Clean state every run
- No container accumulation
- ~300-400ms overhead with cached images

**Use for:**
- Production environments (recommended)
- Maximum isolation
- Avoiding state leakage between jobs
- Most use cases

### Persistent Containers

```yaml
docker:
  enabled: true
  ephemeral: false  # Opt-in to container reuse
  max_containers: 5  # Keep last 5 containers
```

**Behavior:**
- Container created on first job
- Reused for subsequent jobs (same agent)
- Faster execution (~100-150ms overhead)
- Containers kept for inspection
- Old containers cleaned when limit reached

**Use for:**
- Development and debugging
- Very frequent jobs (every few seconds)
- When startup time is critical
- Preserving installed tools between runs

### Container Pool Management

The `max_containers` setting limits how many containers are kept per agent:

```yaml
docker:
  max_containers: 5  # Keep last 5 containers (default)
```

When the limit is reached, the oldest container is removed before creating a new one.

## User Mapping

Containers run as a specific user to align file permissions with the host.

### Default User (Recommended)

By default, containers run as the host user:

```yaml
docker:
  enabled: true
  # user defaults to host UID:GID automatically
```

**How it works:**
- Detects host user's UID and GID
- Runs container as `{UID}:{GID}`
- Files created have correct host ownership
- No permission issues accessing workspace

### Custom User

Override the user for specific requirements:

```yaml
docker:
  user: "1000:1000"  # Specific UID:GID
```

**Format:** `"UID:GID"` where both are numeric IDs.

**When to use:**
- Shared environments with specific users
- Rootless Docker configurations
- Custom security requirements

:::caution[User Mismatch]
If container user doesn't match host user, you may encounter permission issues accessing workspace files.
:::

## Complete Examples

### High Security Configuration

Maximum isolation for untrusted prompts:

```yaml
docker:
  enabled: true
  image: "herdctl/runtime:latest"
  network: none              # No network access
  workspace_mode: ro         # Read-only workspace
  memory: "1g"               # Limited memory
  cpu_shares: 512            # Lower priority
  # ephemeral: true is default (fresh container each run)
  user: "1000:1000"          # Non-root user
```

### Balanced Configuration

Standard security with API access:

```yaml
docker:
  enabled: true
  image: "herdctl/runtime:latest"
  network: bridge            # Full network via NAT
  workspace_mode: rw         # Read-write workspace
  memory: "2g"               # Standard memory
  ephemeral: false           # Opt-in to container reuse for speed
  max_containers: 5          # Keep last 5 containers
```

### Development Configuration

Fast iteration with debugging:

```yaml
docker:
  enabled: true
  network: host              # Full network access
  workspace_mode: rw         # Read-write access
  memory: "4g"               # Generous memory
  ephemeral: false           # Opt-in to container reuse for faster iteration
  max_containers: 10         # Keep more containers for debugging
  volumes:
    - "${HOME}/.cache:/cache:rw"  # Shared cache
```

## Combining with Runtime Selection

Docker works with both SDK and CLI runtimes. You can switch between runtimes within Docker and sessions will resume seamlessly.

### SDK Runtime + Docker (Default)

```yaml
name: sdk-dockerized
runtime: sdk  # SDK runtime (default, can be omitted)
docker:
  enabled: true
  network: bridge
  memory: "2g"
```

**Characteristics:**
- Standard API pricing
- Requires only `ANTHROPIC_API_KEY`
- Full SDK features available
- Sessions stored in `.herdctl/docker-sessions/`

### CLI Runtime + Docker

```yaml
name: cli-dockerized
runtime: cli  # CLI runtime
docker:
  enabled: true
  network: bridge
  memory: "2g"
```

**Characteristics:**
- Max plan pricing (if subscribed)
- Requires Claude CLI authentication
- Full Claude Code capabilities
- Sessions stored in `.herdctl/docker-sessions/` (same as SDK)

### Runtime Switching Within Docker

Sessions are compatible when switching runtimes within Docker:

```yaml
# Job 1: SDK runtime in Docker
runtime: sdk
docker:
  enabled: true

# Job 2: Switch to CLI runtime
runtime: cli
docker:
  enabled: true
# ✅ Session resumes from Job 1
```

Both runtimes share the same Docker session storage, enabling seamless runtime switching without losing conversation context.

:::tip[Cross-Runtime Sessions]
Within Docker, SDK and CLI runtimes share session storage. You can switch between them without losing context. However, Docker sessions are separate from local (non-Docker) sessions.
:::

See [Runtime Configuration](/configuration/runtime/) for detailed runtime comparison and [Execution Modes](/configuration/runtime/#execution-modes) for session compatibility across all modes.

## Troubleshooting

### Docker Not Available

**Error:** `Docker daemon not running`
- **Solution:** Start Docker Desktop or Docker daemon

**Error:** `Cannot connect to Docker socket`
- **Solution:** Verify Docker is installed and user has permissions

### Permission Issues

**Problem:** Cannot access workspace files
- **Cause:** User mismatch between container and host
- **Solution:** Check `user` setting matches host UID:GID

**Problem:** Files created by container have wrong owner
- **Cause:** Container running as different user
- **Solution:** Set `user: "{UID}:{GID}"` matching host user

### Network Issues

**Problem:** Cannot reach external APIs
- **Cause:** `network: none` blocks all network
- **Solution:** Change to `network: bridge` for API access

**Problem:** Cannot access localhost services
- **Cause:** Bridge network isolates from host
- **Solution:** Use `network: host` (trusted agents only)

### Resource Issues

**Error:** Container killed (OOM)
- **Cause:** Memory limit too low
- **Solution:** Increase `memory` setting

**Problem:** Container consuming too much memory
- **Cause:** No memory limit set
- **Solution:** Add `memory` limit

## Security Best Practices

1. **Start with maximum isolation** — Use `network: none` + `workspace_mode: ro` initially
2. **Relax as needed** — Only grant network/write access when required
3. **Prefer ephemeral containers** — Default `ephemeral: true` provides best isolation (avoid `ephemeral: false` in production)
4. **Set resource limits** — Always configure `memory` limits
5. **Avoid host network** — Only use `network: host` for trusted agents
6. **Match host user** — Keep default `user` setting for file permissions
7. **Read-only auth** — Auth files are always read-only (automatic)

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Complete agent config reference
- [Runtime Configuration](/configuration/runtime/) — SDK vs CLI runtime selection
- [Fleet Configuration](/configuration/fleet-config/) — Global fleet settings
