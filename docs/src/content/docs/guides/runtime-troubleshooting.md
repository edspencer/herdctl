---
title: Runtime Troubleshooting
description: Diagnose and fix common runtime and Docker issues
---

This guide helps diagnose and fix common issues with herdctl runtime configurations, including CLI runtime, Docker containers, and path resolution.

## CLI Runtime Issues

### "claude: command not found"

**Cause:** Claude CLI not installed or not in PATH.

**Solution:**
```bash
npm install -g @anthropic-ai/claude-code
claude --version  # Verify installation
```

After installation, verify the CLI is in your PATH:
```bash
which claude  # Should show the installed path
```

### "Not logged in" or authentication errors

**Cause:** Claude CLI session expired or never logged in.

**Solution:**
```bash
claude login
# Follow prompts to authenticate
```

The CLI will open a browser window for authentication. After successful login, verify:
```bash
claude whoami  # Should show your account details
```

### CLI sessions not appearing in .herdctl/

**Context:** This is expected behavior, not a bug.

CLI sessions are managed by the Claude CLI itself and stored in `~/.claude/` (not `.herdctl/`). When herdctl uses CLI runtime, session files are created by the Claude CLI in its own session directory.

**Why this matters:**
- SDK sessions: `.herdctl/sessions/` (managed by herdctl)
- CLI sessions: `~/.claude/` (managed by Claude CLI)
- Docker sessions: `.herdctl/docker-sessions/` (managed by herdctl)

This separation prevents conflicts and follows each tool's conventions.

### CLI runtime slower than expected

**Cause:** File watching overhead or session file write delays.

**Context:** CLI runtime watches session files for changes. Each message is written to disk by the Claude CLI, then detected by herdctl's file watcher.

**Solution:**
- For maximum performance, use SDK runtime
- For Max plan pricing, CLI runtime is still cost-effective despite slight overhead
- Consider Docker + SDK for best of both worlds (isolation + performance)

## Docker Issues

### "Cannot connect to Docker daemon"

**Cause:** Docker not running or permission issues.

**Solution:**
```bash
# Check Docker is running
docker info

# If not running, start Docker Desktop or daemon
# On macOS: Start Docker Desktop application
# On Linux: sudo systemctl start docker

# On Linux, ensure user is in docker group
sudo usermod -aG docker $USER
# Then log out and back in for group change to take effect
```

Verify Docker is accessible:
```bash
docker ps  # Should list running containers without errors
```

### Container exits immediately

**Cause:** Usually missing auth files, wrong image, or misconfiguration.

**Solution:**

1. **Check auth files exist:**
```bash
ls -la ~/.claude/
# Should show claude.json and other session files
```

2. **Verify image exists:**
```bash
docker pull anthropic/claude-code:latest
docker images | grep claude-code
```

3. **Check container logs:**
```bash
# List recent containers (including stopped)
docker ps -a --filter "name=herdctl" --latest

# View logs from the container
docker logs <container-id>
```

4. **Inspect container for errors:**
```bash
docker inspect <container-id>
# Look for "Error" or "ExitCode" fields
```

### "Permission denied" inside container

**Cause:** UID/GID mismatch between host and container.

**Solution:**

Check your host UID:
```bash
id
# Example output: uid=1000(username) gid=1000(username)
```

Update agent config to match:
```yaml
docker:
  enabled: true
  user: "1000:1000"  # Match your host UID:GID
```

**Why this matters:**
- Container processes run as specified user
- File operations use this UID:GID
- Mismatch causes "permission denied" errors
- Default tries to match host user automatically

### Network issues (can't reach APIs)

**Cause:** Wrong network mode configured.

**Solution:**

Use `bridge` mode for network access:
```yaml
docker:
  enabled: true
  network: bridge  # Use 'bridge' (default) for network access
```

**Network mode comparison:**
- `bridge` (default): Full network access, NAT to host
- `host`: Share host network namespace (not recommended)
- `none`: No network access (only for isolated tasks)

**Don't use `none` if your agent needs:**
- GitHub API access
- npm/pip/cargo package installation
- External API calls
- Git operations (clone, push, pull)

### Container out of memory

**Cause:** Memory limit too low for task.

**Symptoms:**
- Container killed unexpectedly
- "Out of memory" errors in logs
- Tasks failing partway through

**Solution:**

Increase memory limit:
```yaml
docker:
  enabled: true
  memory: "4g"  # Increase from default 2g
```

**Memory recommendations:**
- Small codebases: 2g (default)
- Medium codebases: 4g
- Large codebases: 8g
- Complex AI tasks: 8g+

Check memory usage:
```bash
docker stats <container-id>
```

### Auth files not accessible in container

**Cause:** Missing or misconfigured auth volume mount.

**Context:** Auth files from `~/.claude/` are auto-mounted by default. You should only see this issue if you've manually configured volumes.

**Solution:**

Don't override default auth mounting:
```yaml
docker:
  enabled: true
  # Auth files auto-mounted - don't override volumes unless needed
  volumes:
    - "/additional/data:/data:ro"  # OK - adding extra mounts
```

**Bad configuration to avoid:**
```yaml
docker:
  enabled: true
  volumes: []  # BAD - removes default auth mount
```

## Path Resolution Issues

### Files not found inside container

**Cause:** Host paths don't exist inside container.

**Context:** Container has its own filesystem. Only the workspace and explicit volume mounts are accessible inside the container.

**What's accessible:**
- Workspace directory: Auto-mounted at same path
- Auth files: Auto-mounted from `~/.claude/`
- Explicit volumes: Configured via `volumes` field

**What's NOT accessible:**
- Random host paths (unless mounted)
- Parent directories (unless explicitly mounted)
- System directories (for security)

**Solution:**

Use `volumes` to mount needed paths:
```yaml
docker:
  enabled: true
  volumes:
    - "/host/data:/data:ro"      # Now accessible as /data in container
    - "/host/config:/config:ro"  # Now accessible as /config
```

**Example error:**
```
Error: ENOENT: no such file or directory, open '/Users/ed/data/file.txt'
```

**Fix:**
```yaml
docker:
  enabled: true
  volumes:
    - "/Users/ed/data:/data:ro"  # Mount the directory
# Agent can now access /data/file.txt in container
```

### Docker sessions not persisting

**Context:** This is expected behavior, not a bug.

Docker sessions are stored in `.herdctl/docker-sessions/`, separate from host sessions in `.herdctl/sessions/`. This separation prevents path confusion between host and container execution.

**Why separate session directories:**
- Host SDK runtime → `.herdctl/sessions/`
- Host CLI runtime → `~/.claude/` (managed by CLI)
- Docker runtime → `.herdctl/docker-sessions/`

**Benefits:**
- No path confusion (container `/workspace` vs host path)
- Session files optimized for each runtime
- Easy to inspect which runtime created which session

**Don't try to:**
- Share sessions between Docker and host execution
- Manually move sessions between directories
- Configure custom session paths

### Relative paths breaking in container

**Cause:** Working directory differs between host and container.

**Solution:**

Use absolute paths in agent configs:
```yaml
# BAD - Relative paths
workspace: ../my-project

# GOOD - Absolute paths
workspace: /Users/ed/projects/my-project
```

Or use environment variables:
```yaml
workspace: ${HOME}/projects/my-project
```

## Common Anti-Patterns

### Missing auth files

```yaml
# BAD - Manually setting volumes removes default auth mount
docker:
  enabled: true
  volumes: []  # Claude can't authenticate!

# GOOD - Auth is auto-mounted (default behavior)
docker:
  enabled: true
  # Auth files mounted automatically from ~/.claude/
  # Only add volumes if you need additional mounts
```

### Network isolation with API agents

```yaml
# BAD - No network but agent needs APIs
docker:
  enabled: true
  network: none  # Agent can't reach GitHub, npm, etc.
  runtime: cli   # CLI needs network for authentication!

# GOOD - Bridge for network access
docker:
  enabled: true
  network: bridge  # Default - full network access
```

### Read-only workspace for coding agents

```yaml
# BAD - Can't write code
docker:
  enabled: true
  workspace_mode: ro  # Agent can't create/edit files!

# GOOD - Read-write for coding
docker:
  enabled: true
  workspace_mode: rw  # Default - allows file modifications
```

### Insufficient memory for complex tasks

```yaml
# BAD - May OOM on large codebases
docker:
  enabled: true
  memory: "512m"  # Too small for most coding tasks!

# GOOD - Adequate memory
docker:
  enabled: true
  memory: "2g"  # Default - increase if needed
```

### Running as root in production

```yaml
# BAD - Security risk
docker:
  enabled: true
  user: "0:0"  # Running as root!

# GOOD - Non-root user
docker:
  enabled: true
  user: "1000:1000"  # Match host user (default)
```

### Persisting containers in production

```yaml
# BAD - Containers accumulate over time
docker:
  enabled: true
  ephemeral: false  # Opt-in to container reuse
  max_containers: 100  # Eventually fills disk!

# GOOD - Fresh containers per job (default)
docker:
  enabled: true
  # ephemeral: true is default - containers auto-removed after job
```

## Debugging Checklist

When troubleshooting runtime issues, check these in order:

1. **Basic connectivity:**
   - [ ] Docker daemon running (`docker info`)
   - [ ] Network accessible (`ping github.com`)
   - [ ] Auth files present (`ls ~/.claude/`)

2. **Configuration:**
   - [ ] Runtime specified correctly (`sdk` or `cli`)
   - [ ] Docker enabled if using containers (`docker.enabled: true`)
   - [ ] Network mode appropriate (`bridge` for most cases)
   - [ ] Memory sufficient for task (`2g` minimum)

3. **Permissions:**
   - [ ] User in docker group (Linux: `groups $USER`)
   - [ ] UID:GID matches host (`id` vs `docker.user`)
   - [ ] Workspace writable (`workspace_mode: rw`)

4. **Logs:**
   - [ ] Check herdctl logs (`~/.herdctl/logs/`)
   - [ ] Check container logs (`docker logs <id>`)
   - [ ] Check Docker daemon logs (varies by platform)

5. **Test minimal config:**
   - [ ] Try SDK runtime without Docker
   - [ ] If that works, add Docker incrementally
   - [ ] Test with hello-world example first

## Working Examples

See the [runtime-showcase examples](https://github.com/edspencer/herdctl/tree/main/examples/runtime-showcase) for complete, tested configurations:

- **sdk-agent.yaml** - Development setup (SDK runtime, no Docker)
- **cli-agent.yaml** - Cost-optimized setup (CLI runtime, Max plan pricing)
- **docker-agent.yaml** - Production setup (Docker isolation with security hardening)
- **mixed-fleet.yaml** - Multiple runtime strategies with anti-pattern examples

These examples are runnable without modification (after setting required environment variables).

## Getting Help

If you're still stuck after trying these solutions:

1. Check the [GitHub Issues](https://github.com/edspencer/herdctl/issues) for similar problems
2. Run with verbose logging (set `DEBUG=herdctl:*` environment variable)
3. Include relevant logs when asking for help
4. Specify your platform (macOS, Linux, Windows) and Docker version

**Useful diagnostic commands:**
```bash
# System info
uname -a
docker --version
docker info

# herdctl info
herdctl version
herdctl agents list

# Docker diagnostics
docker ps -a
docker images
docker inspect <container-id>

# Logs
tail -f ~/.herdctl/logs/fleet.log
docker logs -f <container-id>
```
