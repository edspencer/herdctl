# herdctl Runtime Image

This Docker image provides a containerized runtime environment for [herdctl](https://github.com/edspencer/herdctl) agents. It enables secure, isolated execution of Claude Code agents with full access to development tools.

## What's Inside

- **Node.js 22** (slim variant)
- **Claude CLI** (`@anthropic-ai/claude-code`) - Official Anthropic CLI for Claude
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) - SDK for building Claude agents
- **GitHub CLI** (`gh`) - For GitHub API operations
- **Git** - Version control operations with automatic authentication support

## Features

### Automatic Git Authentication

The image includes an entrypoint that automatically configures Git to use the `GITHUB_TOKEN` environment variable for HTTPS authentication:

```bash
docker run -e GITHUB_TOKEN=your_token herdctl/runtime:latest
```

This allows agents to perform Git operations (clone, fetch, push) without manual authentication setup.

### Security Hardening

- Runs as non-root user (configurable via `--user` flag)
- No new privileges allowed (`no-new-privileges:true`)
- All capabilities dropped (`CapDrop: ALL`)
- Network isolation configurable
- Resource limits (memory, CPU) configurable

### Pre-configured Workspace

- Working directory: `/workspace` (where your code is mounted)
- Claude CLI configuration: `/home/claude/.claude/projects/`
- World-writable directories for multi-user compatibility

## Usage with herdctl

This image is automatically used by herdctl when you enable Docker runtime in your agent configuration:

```yaml
# herdctl-agent.yaml
name: my-agent
docker:
  enabled: true
  env:
    GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

herdctl handles:
- Container lifecycle (creation, reuse, cleanup)
- Volume mounting (workspace, sessions, custom volumes)
- Environment variable injection
- Process execution via `docker exec`

## Direct Usage

While this image is designed for herdctl, you can use it directly:

```bash
# Start a persistent container
docker run -d --name claude-agent \
  -v /path/to/workspace:/workspace \
  -e ANTHROPIC_API_KEY=your_key \
  -e GITHUB_TOKEN=your_token \
  --user 1000:1000 \
  herdctl/runtime:latest

# Execute Claude CLI
docker exec claude-agent claude "analyze the code in this repo"

# Execute commands as needed
docker exec claude-agent git status
docker exec claude-agent gh api user
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for Claude API access
- `CLAUDE_CODE_OAUTH_TOKEN` - Optional, for Claude Max web authentication
- `GITHUB_TOKEN` - Optional, enables automatic Git HTTPS authentication
- `HOME` - Set to `/home/claude` for CLI configuration

## Container Lifecycle

The container uses `tail -f /dev/null` as its main process to stay running. Commands are executed via `docker exec`. This approach allows:

- Persistent containers that can be reused across multiple jobs
- Ephemeral containers that auto-remove after execution
- Efficient resource usage (container stays idle when not processing)

## Building from Source

```bash
git clone https://github.com/edspencer/herdctl.git
cd herdctl
docker build -t herdctl/runtime:latest -f Dockerfile .
```

## Links

- **GitHub Repository**: https://github.com/edspencer/herdctl
- **Documentation**: https://herdctl.dev
- **Issues**: https://github.com/edspencer/herdctl/issues

## License

MIT - See [LICENSE](https://github.com/edspencer/herdctl/blob/main/LICENSE) in the GitHub repository.
