---
title: Docker Container Runtime
description: How herdctl executes agents inside Docker containers using the decorator pattern, manages container lifecycle, network configuration, MCP bridging, OAuth tokens, and security isolation
---

The Docker container runtime enables herdctl to execute Claude Code agents inside isolated Docker containers rather than directly on the host. It provides filesystem isolation, controlled environment variable passing, resource limits, and a consistent execution environment across deployments.

This page covers the internal architecture of the Docker runtime. For the runner system as a whole, see [Agent Execution Engine](/architecture/runner/). For the overall system design, see [System Architecture Overview](/architecture/overview/).

![Docker container architecture showing host process, container internals, volume mounts, network bridge, and MCP HTTP bridge](/diagrams/container-architecture.svg)

## Decorator Pattern

`ContainerRunner` implements the decorator pattern. It wraps any base runtime (`SDKRuntime` or `CLIRuntime`) and transparently redirects execution into a Docker container. The `RuntimeFactory` composes this automatically when an agent's configuration has `docker.enabled: true`:

```text
agent.runtime = "sdk" + docker.enabled  ──► ContainerRunner(SDKRuntime)
agent.runtime = "cli" + docker.enabled  ──► ContainerRunner(CLIRuntime)
```

From the `JobExecutor`'s perspective, a `ContainerRunner` is just another `RuntimeInterface`. The same `execute()` method returns the same `AsyncIterable<SDKMessage>` stream -- the Docker layer is invisible to callers.

```typescript
// RuntimeFactory.create() handles this composition automatically
const runtime = RuntimeFactory.create(agent, { stateDir });

// Whether this is SDKRuntime, CLIRuntime, or ContainerRunner(either),
// the interface is identical:
for await (const message of runtime.execute(options)) {
  // process messages
}
```

![ContainerRunner decorator pattern showing how it wraps base runtimes with container lifecycle management](/diagrams/container-runner-decorator.svg)

### How Wrapping Works

`ContainerRunner` does not call the wrapped runtime's `execute()` method directly. Instead, it re-implements the execution strategy for each runtime type inside a Docker container:

| Wrapped Runtime | Docker Execution Strategy |
|----------------|--------------------------|
| **CLIRuntime** | Spawns `claude` via `docker exec` with a custom process spawner. Session files are written inside the container but mounted to the host so the CLI session watcher can observe them. |
| **SDKRuntime** | Serializes SDK options to JSON, passes them via the `HERDCTL_SDK_OPTIONS` environment variable, and runs `docker-sdk-wrapper.js` inside the container via `docker exec`. The wrapper script calls the SDK's `query()` function and streams messages as JSONL to stdout. |

## Docker Image

The runtime image (`herdctl/runtime:latest`) is built from the `Dockerfile` at the repository root. It provides a complete execution environment for Claude Code agents.

### Contents

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 22 (slim) | JavaScript runtime for Claude CLI and SDK |
| **Claude CLI** | `@anthropic-ai/claude-code` | Official Anthropic CLI for agent execution |
| **Claude Agent SDK** | `@anthropic-ai/claude-agent-sdk` | SDK for programmatic agent execution |
| **GitHub CLI** | `gh` | GitHub API operations (issues, PRs, releases) |
| **Git** | System package | Version control operations |
| **docker-sdk-wrapper.js** | Bundled from source | Bridge script for SDK runtime in Docker |

### Key Directories

| Path | Purpose |
|------|---------|
| `/workspace` | Working directory, world-writable (mount point for host project) |
| `/home/claude/.claude/projects/` | Claude CLI configuration and session data |
| `/usr/local/lib/docker-sdk-wrapper.js` | SDK wrapper script for Docker execution |

### Entrypoint

The image includes an entrypoint script that configures Git authentication when `GITHUB_TOKEN` is present:

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

The entrypoint sets `git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"`, enabling agents to clone, fetch, and push to GitHub repositories without manual credential setup.

### Keep-Alive Process

The container runs `sleep infinity` (or `tail -f /dev/null` in older builds) as its main process. This keeps the container alive so that herdctl can execute commands via `docker exec`. The container itself does no work -- it is an execution shell that waits for instructions.

### Building the Image

```bash
docker build -t herdctl/runtime:latest -f Dockerfile .
```

The image must be built locally before Docker runtime can be used. It is not published to a public registry.

## Container Lifecycle

`ContainerManager` handles all Docker API interactions through the `dockerode` library. The lifecycle follows a create-start-execute-stop-remove pattern.

### Creation

When herdctl needs to execute an agent with Docker enabled, `ContainerManager.getOrCreateContainer()` either reuses an existing container (persistent mode) or creates a new one (ephemeral mode).

Container names follow the pattern `herdctl-<agent-name>-<timestamp>`, for example `herdctl-assistant-1708012345678`.

### Persistent vs Ephemeral Containers

| Mode | Config | Behavior |
|------|--------|----------|
| **Ephemeral** | `ephemeral: true` (default) | Fresh container per job. `AutoRemove: true` cleans up after stop. No accumulated state between executions. |
| **Persistent** | `ephemeral: false` | Container is reused across jobs for the same agent. Faster startup (no container creation overhead). State persists between executions. |

### Execution

Commands run inside the container via `docker exec`:

- **CLI runtime**: `docker exec <container> sh -c 'cd /workspace && printf %s "prompt" | claude <args>'`
- **SDK runtime**: `docker exec <container> bash -l -c 'export HERDCTL_SDK_OPTIONS=... && node /usr/local/lib/docker-sdk-wrapper.js'`

The SDK runtime uses `bash -l` (login shell) to ensure the full environment (including `PATH`) is available.

### Cleanup

After execution completes:

1. **Ephemeral containers**: stopped immediately, triggering `AutoRemove` for automatic cleanup.
2. **All containers**: `cleanupOldContainers()` runs, removing the oldest containers when the count exceeds `maxContainers` (default: 5) per agent.
3. **Forced removal**: containers that fail to stop gracefully are removed with `force: true`.

## Network Configuration

Network mode controls how agent containers connect to the outside world.

![Network modes comparison showing bridge mode with NAT isolation versus host mode with shared network namespace](/diagrams/network-modes-comparison.svg)

| Mode | Config Value | Behavior |
|------|-------------|----------|
| **Bridge** | `bridge` (default) | Standard Docker networking with NAT. The container has its own network namespace but can reach the internet through Docker's bridge network. |
| **Host** | `host` | Container shares the host's network namespace. Use when agents need to access services bound to `localhost` on the host. |
| **Custom** | Via `host_config.NetworkMode` | Any Docker network name (e.g., `herdctl-net`). Used in production deployments where herdctl and agent containers share a named network for DNS-based service discovery. |

:::caution
Never use `network: none` for agent containers. Agents require internet access to reach Anthropic's APIs. A container with no network cannot call the Claude API and will fail immediately.
:::

### Custom Networks in Production

In production deployments, herdctl and its agent containers typically share a Docker bridge network (e.g., `herdctl-net`). This enables DNS-based service discovery -- agents can reach MCP servers by container name:

```yaml
defaults:
  docker:
    network: bridge                    # passes schema validation
    host_config:
      NetworkMode: herdctl-net         # actual network override
```

The schema currently validates against a fixed enum of `none`, `bridge`, and `host`. Custom network names are passed via the `host_config.NetworkMode` override to bypass this validation.

## Volume Mounts

`buildContainerMounts()` constructs the volume mount list for each container. Three categories of mounts are created automatically:

### Automatic Mounts

| Mount | Host Path | Container Path | Mode | Purpose |
|-------|-----------|---------------|------|---------|
| **Workspace** | Agent's `working_directory` | `/workspace` | `rw` (configurable) | The project directory the agent works in |
| **Docker sessions** | `<stateDir>/docker-sessions` | `/home/claude/.claude/projects/-workspace` | `rw` | Claude CLI session files, mounted so the host can watch session changes |

### Custom Mounts

Additional volumes are specified in the fleet-level Docker configuration:

```yaml
defaults:
  docker:
    volumes:
      - "/host/data:/container/data:ro"
      - "/host/config:/container/config:rw"
    workspace_mode: rw   # or "ro" for read-only workspace
```

Each volume string is parsed into a `PathMapping` with `hostPath`, `containerPath`, and `mode` (`ro` or `rw`).

### Credentials File Mount

For OAuth token management, the host's `~/.claude/.credentials.json` is bind-mounted (read-write) into the herdctl container. This allows `buildContainerEnv()` to read and refresh tokens without restarting the herdctl process. See [OAuth Token Management](#oauth-token-management) below.

## Security Model

Docker containers provide a different security model than Claude Code's native sandboxing. The two approaches are complementary, not mutually exclusive.

### Container Security Hardening

Every container is created with the following security settings:

```typescript
{
  SecurityOpt: ["no-new-privileges:true"],
  CapDrop: ["ALL"],
  ReadonlyRootfs: false,  // Claude needs to write temp files
  AutoRemove: config.ephemeral,
}
```

| Setting | Effect |
|---------|--------|
| `no-new-privileges` | Prevents processes from gaining additional privileges via `setuid`, `setgid`, or filesystem capabilities |
| `CapDrop: ALL` | Drops all Linux capabilities. The container cannot perform privileged operations like mounting filesystems, changing network config, or loading kernel modules. |
| `User: UID:GID` | Container runs as a non-root user. By default, matches the host user's UID/GID via `process.getuid()` / `process.getgid()`. |

### Resource Limits

| Resource | Config | Docker API | Default |
|----------|--------|-----------|---------|
| **Memory** | `memory: "2g"` | `Memory` + `MemorySwap` (no swap) | 2 GB |
| **CPU shares** | `cpu_shares: 512` | `CpuShares` | Unlimited |
| **CPU hard limit** | `cpu_period` + `cpu_quota` | `CpuPeriod` + `CpuQuota` | Unlimited |
| **Max processes** | `pids_limit: 100` | `PidsLimit` | Unlimited |

Memory swap is set equal to the memory limit, effectively disabling swap. This prevents containers from consuming host swap space.

### Docker vs Native Sandboxing

Claude Code includes native sandboxing via bubblewrap (Linux) and Seatbelt (macOS). Docker provides a different set of protections:

| Security Property | Native Sandbox | Docker |
|-------------------|---------------|--------|
| **Filesystem isolation** | Access controls on the same filesystem | Separate root filesystem; only explicit mounts are visible |
| **Network control** | Userspace domain-filtering proxy | Kernel-level network namespaces |
| **Environment variables** | No filtering; full host environment accessible | Fresh environment; only explicitly passed variables |
| **Resource limits** | None | cgroups (memory, CPU, PID limits) |
| **Ephemeral execution** | Persistent state across runs | Fresh container per job (ephemeral mode) |
| **Process isolation** | Partial (platform-dependent) | Full PID namespace isolation |

Docker's primary advantages are environment variable isolation (the container has no access to host environment variables unless explicitly passed), resource limits (preventing runaway memory or CPU usage), and true filesystem isolation (host files do not exist inside the container unless mounted).

Native sandboxing provides tool-level permission control that Docker does not -- the `permissionMode` and `allowedTools` / `deniedTools` settings operate at the Claude Code level regardless of whether Docker is used.

### hostConfigOverride

The `host_config` field in fleet-level Docker configuration passes raw `dockerode` HostConfig options directly to the Docker API. This can override security settings:

```yaml
defaults:
  docker:
    host_config:
      NetworkMode: herdctl-net
      ShmSize: 67108864
```

This field is intentionally restricted to fleet-level configuration only. Agent-level configs use a strict schema (`AgentDockerSchema`) that rejects unknown fields, preventing untrusted agent configs from weakening container security.

## Environment Variable Passing

`buildContainerEnv()` constructs the environment variable array for each container. Variables are passed as `KEY=value` strings.

### Automatically Passed Variables

| Variable | Source | Condition |
|----------|--------|-----------|
| `ANTHROPIC_API_KEY` | `process.env` | If set in herdctl's environment |
| `CLAUDE_CODE_OAUTH_TOKEN` | Credentials file or `process.env` | OAuth access token |
| `CLAUDE_REFRESH_TOKEN` | Credentials file or `process.env` | OAuth refresh token |
| `CLAUDE_EXPIRES_AT` | Credentials file or `process.env` | Token expiration timestamp |
| `TERM` | Hardcoded | Always `xterm-256color` |
| `HOME` | Hardcoded | Always `/home/claude` |

### Custom Variables

Additional variables from the Docker config's `env` field:

```yaml
defaults:
  docker:
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
      MY_CUSTOM_VAR: "some-value"
```

Values support `${VAR}` interpolation from the host environment.

## Git Authentication

The Docker image automatically configures Git HTTPS authentication when `GITHUB_TOKEN` is present in the container's environment. The entrypoint script runs:

```bash
git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
```

This rewrites all `https://github.com/` URLs to include the token, enabling `git clone`, `git fetch`, and `git push` operations without interactive authentication.

To pass the token, include it in the Docker environment configuration:

```yaml
defaults:
  docker:
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

## MCP HTTP Bridge

When MCP servers are injected at runtime (for example, the Slack file sender), the `SDKRuntime` and `ContainerRunner` handle them differently:

- **SDKRuntime** (non-Docker): converts `InjectedMcpServerDef` to an in-process MCP server using the Claude Agent SDK's `tool()` and `createSdkMcpServer()` functions. The server runs in the same process as the SDK.
- **ContainerRunner** (Docker): in-process function closures cannot be serialized into a Docker container. The solution is the MCP HTTP bridge.

### The Problem

An `InjectedMcpServerDef` contains handler functions -- JavaScript closures that capture state from their enclosing scope (like a Slack API client). These closures cannot be serialized to JSON and passed into a Docker container.

### The Solution

`ContainerRunner` starts an HTTP server on the herdctl side that implements the MCP Streamable HTTP transport (JSON-RPC 2.0 over POST). The agent container connects to this server via Docker network DNS:

```text
herdctl container                    agent container
┌─────────────────────┐              ┌─────────────────────┐
│ MCP HTTP Bridge     │◄── HTTP ────►│ Claude Agent SDK    │
│ port: <random>      │              │ MCP client          │
│ host: 0.0.0.0       │              │ url: http://herdctl │
│                     │              │      :<port>/mcp    │
│ routes to in-process│              └─────────────────────┘
│ handler functions   │
└─────────────────────┘
```

### Bridge Lifecycle

1. **Start**: `startMcpHttpBridge(def)` creates an HTTP server bound to `0.0.0.0:0` (random available port).
2. **Inject**: The bridge URL (`http://herdctl:<port>/mcp`) is added to `sdkOptions.mcpServers` as an HTTP-type MCP server config.
3. **Execute**: The agent container calls the bridge via HTTP during execution. The bridge translates tool calls to the in-process handler functions.
4. **Cleanup**: All bridges are closed in a `finally` block after execution completes, regardless of success or failure.

### Supported MCP Methods

The bridge implements a minimal subset of the MCP protocol:

| Method | Behavior |
|--------|----------|
| `initialize` | Returns server info and capabilities |
| `notifications/initialized` | Returns 204 No Content (JSON-RPC notification) |
| `tools/list` | Returns tool definitions from the `InjectedMcpServerDef` |
| `tools/call` | Executes the tool's handler function with path translation |
| `ping` | Returns empty result |

### Docker Path Translation

The bridge includes path translation for the sibling container model. When the agent calls a tool with a file path like `/workspace/report.pdf`, the bridge strips the `/workspace/` prefix before passing it to the handler. The handler runs on the host side where paths are relative to the working directory, not the container's mount point.

### Tool Permission Auto-Addition

When injected MCP servers are present and the agent has an explicit `allowedTools` list, `ContainerRunner` automatically adds `mcp__<name>__*` patterns for each injected server. Without this, agents with restrictive tool lists would be unable to call injected tools -- the `allowedTools` filter would block them.

## OAuth Token Management

Claude OAuth access tokens have an 8-hour TTL. For long-running herdctl deployments, tokens must be refreshed automatically to avoid agent authentication failures.

### Two-Layer Architecture

The token management system uses two complementary strategies:

#### Layer 1: Proactive Refresh

On every agent spawn, `buildContainerEnv()` reads the OAuth credentials and checks expiry:

1. Reads `~/.claude/.credentials.json` (bind-mounted from the host).
2. Checks if the access token expires within a 5-minute buffer.
3. If expired or expiring, calls the Claude OAuth refresh endpoint.
4. Writes the refreshed tokens back to the credentials file (persisted via bind mount).
5. Passes the fresh token as environment variables to the agent container.

| Parameter | Value |
|-----------|-------|
| Refresh endpoint | `POST https://console.anthropic.com/v1/oauth/token` |
| Grant type | `refresh_token` |
| Client ID | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code CLI public client) |
| Access token TTL | 8 hours |
| Refresh buffer | 5 minutes before expiry |
| Refresh token rotation | Each refresh returns a new refresh token; the old one is invalidated |

#### Layer 2: Reactive Retry

If an agent session runs longer than 8 hours and the token expires mid-execution:

1. The Claude SDK fails with an authentication error.
2. `isTokenExpiredError()` in the job executor detects the error pattern.
3. The job is retried automatically (one retry maximum).
4. The retry creates a new container, triggering `buildContainerEnv()` which refreshes the token.
5. The agent resumes with a fresh token in a new session.

### Backwards Compatibility

If the credentials file is not available (no bind mount), `buildContainerEnv()` falls back to reading from `process.env`. This preserves compatibility with deployments that pass static tokens via environment variables.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Token valid | Read from file, pass as env vars. No refresh. |
| Token expired, refresh succeeds | Refresh, write back to file, pass fresh token. |
| Token expired, refresh fails | Pass the expired token anyway (agent will fail). Fall back to env vars if file is unreadable. |
| Agent runs >8h, token expires mid-session | Auth error detected, job retried with fresh token. |
| Refresh token itself expired | Requires manual re-auth on host (`claude` interactive login), then restart herdctl. |
| Multiple concurrent agent spawns | Each reads the file independently. First to refresh writes back; others read the already-refreshed file. No locking needed since refresh is idempotent. |

## Sibling Container Pattern

herdctl uses the **sibling container pattern**, not Docker-in-Docker (DinD). The herdctl container mounts the Docker socket (`/var/run/docker.sock`) and calls the Docker API to spawn agent containers as peers on the same Docker daemon:

```text
Docker daemon (host)
├── herdctl container      (mounts /var/run/docker.sock)
├── agent-1 container      (spawned by herdctl via Docker API)
├── agent-2 container      (spawned by herdctl via Docker API)
└── mcp-server container   (independently deployed)
```

Agent containers are siblings of the herdctl container, not children nested inside it. This is important because:

1. **No privileged mode required** -- Docker-in-Docker requires `--privileged`, which weakens security. Sibling containers need only the Docker socket mount.
2. **Shared network** -- All containers can join the same Docker network for DNS-based service discovery.
3. **Resource visibility** -- The host Docker daemon manages all container resources directly.

### Path Mapping Constraint

The sibling container pattern introduces a critical constraint: **all volume mount paths must be real host paths**, not paths inside the herdctl container.

When herdctl calls the Docker API to create an agent container, the Docker daemon resolves mount source paths relative to the host filesystem, not relative to the herdctl container. This means:

- `working_directory` in agent config must be the **host path** (e.g., `/home/dev/projects/myapp`), not a path inside the herdctl container (e.g., `/workspace`).
- The state directory must use host paths, mounted at matching paths in both the herdctl and agent containers.
- Docker named volumes do not work for state because the Docker daemon interprets mount sources as host paths.

```yaml
# Correct: host path
agents:
  - name: my-agent
    working_directory: /home/dev/projects/myapp

# Incorrect: container-internal path (Docker daemon can't resolve this)
agents:
  - name: my-agent
    working_directory: /workspace
```

## Configuration Reference

### Agent-Level Options (Safe)

These options can be set in agent config files. The schema uses `strict()` mode to reject unknown fields at the agent level.

```yaml
docker:
  enabled: true
  ephemeral: false
  memory: 2g
  cpu_shares: 512
  pids_limit: 100
  max_containers: 5
  workspace_mode: rw
  tmpfs:
    - "/tmp"
  labels:
    team: backend
```

### Fleet-Level Options (Full)

These options are set in `herdctl.yaml` under `defaults.docker`. They include all agent-level options plus security-sensitive options:

```yaml
defaults:
  docker:
    enabled: true
    image: herdctl/runtime:latest
    network: bridge
    memory: 2g
    user: "1000:1000"
    ephemeral: false
    volumes:
      - "/host/data:/data:ro"
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
    ports:
      - "8080:80"
    host_config:
      NetworkMode: herdctl-net
```

### Configuration Hierarchy

Docker configuration follows the same merge strategy as other agent settings: agent-level values override fleet-level defaults. However, security-sensitive fields (`image`, `network`, `volumes`, `env`, `user`, `ports`, `host_config`) are only accepted at the fleet level.

## Source Code Layout

| File | Purpose |
|------|---------|
| `Dockerfile` | Runtime image definition |
| `packages/core/src/runner/runtime/container-runner.ts` | `ContainerRunner` decorator -- execution delegation for CLI and SDK runtimes in Docker |
| `packages/core/src/runner/runtime/container-manager.ts` | `ContainerManager` -- container lifecycle (create, start, stop, remove, cleanup), `buildContainerMounts()`, `buildContainerEnv()`, OAuth token refresh |
| `packages/core/src/runner/runtime/docker-config.ts` | `DockerConfig` type, `resolveDockerConfig()`, parsers for memory, ports, volumes, tmpfs |
| `packages/core/src/runner/runtime/mcp-http-bridge.ts` | `startMcpHttpBridge()` -- HTTP server implementing MCP Streamable HTTP transport for Docker |
| `packages/core/src/runner/runtime/docker-sdk-wrapper.js` | In-container wrapper script that runs the Claude Agent SDK and streams JSONL to stdout |
| `packages/core/src/runner/runtime/factory.ts` | `RuntimeFactory` -- composes ContainerRunner around base runtimes when Docker is enabled |
| `packages/core/src/runner/runtime/interface.ts` | `RuntimeInterface` and `RuntimeExecuteOptions` types |
| `packages/core/src/runner/types.ts` | `InjectedMcpServerDef`, `InjectedMcpToolDef`, `McpToolCallResult` types |
| `packages/core/src/config/schema.ts` | `AgentDockerSchema`, `FleetDockerSchema` -- Zod validation schemas |
| `packages/core/src/state/session-validation.ts` | `isTokenExpiredError()` -- detects OAuth token expiry errors for retry |

## Related Pages

- [Agent Execution Engine](/architecture/runner/) -- Runner module, runtime selection, job execution lifecycle
- [System Architecture Overview](/architecture/overview/) -- FleetManager, packages, design principles
- [State Persistence](/architecture/state-management/) -- `.herdctl/` directory, session storage
- [Chat Infrastructure](/architecture/chat-infrastructure/) -- How chat integrations inject MCP servers
- [Slack Connector](/architecture/slack/) -- Production deployment architecture using Docker
