---
"@herdctl/core": minor
---

Expand Docker configuration with tiered security model and new options.

## Security: Tiered Docker Configuration

Docker options are now split into two schemas based on security risk:

**Agent-level config** (`herdctl-agent.yml`) - Safe options only:
- `enabled`, `ephemeral`, `memory`, `cpu_shares`, `cpu_period`, `cpu_quota`
- `max_containers`, `workspace_mode`, `tmpfs`, `pids_limit`, `labels`

**Fleet-level config** (`herdctl.yml`) - All options including dangerous ones:
- All agent-level options, plus:
- `image`, `network`, `volumes`, `user`, `ports`, `env`
- `host_config` - Raw dockerode HostConfig passthrough for advanced options

This prevents agents from granting themselves dangerous capabilities (like `network: "host"` or mounting sensitive volumes) since agent config files live in the agent's working directory.

## New Options

- `ports` - Port bindings in format "hostPort:containerPort" or "containerPort"
- `tmpfs` - Tmpfs mounts for fast in-memory temp storage
- `pids_limit` - Maximum number of processes (prevents fork bombs)
- `labels` - Container labels for organization and filtering
- `cpu_period` / `cpu_quota` - Hard CPU limits (more precise than cpu_shares)

## Fleet-level `host_config` Passthrough

For advanced users who need dockerode options not in our schema:

```yaml
defaults:
  docker:
    enabled: true
    memory: "2g"
    host_config:         # Raw dockerode HostConfig
      ShmSize: 67108864
      Privileged: true   # Use with caution!
```

Values in `host_config` override any translated options.
