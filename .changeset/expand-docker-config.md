---
"@herdctl/core": minor
---

Expand Docker configuration options for better resource control and capabilities.

**New options:**

- `ports` - Port bindings in format "hostPort:containerPort" or "containerPort"
  ```yaml
  docker:
    ports:
      - "8080:80"    # Map host 8080 to container 80
      - "3000"       # Map same port on both
  ```

- `tmpfs` - Tmpfs mounts for fast in-memory temp storage
  ```yaml
  docker:
    tmpfs:
      - "/tmp"
      - "/run:size=50m"
  ```

- `pids_limit` - Maximum number of processes (prevents fork bombs)
  ```yaml
  docker:
    pids_limit: 100
  ```

- `labels` - Container labels for organization and filtering
  ```yaml
  docker:
    labels:
      app: myagent
      env: production
  ```

- `cpu_period` / `cpu_quota` - Hard CPU limits (more precise than cpu_shares)
  ```yaml
  docker:
    cpu_period: 100000   # 100ms period
    cpu_quota: 50000     # 50ms quota = 50% of one CPU
  ```

These options provide better control over container resources and enable new use cases like agents running web servers (port bindings) and improved security (pids_limit).
