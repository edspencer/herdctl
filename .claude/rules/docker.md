---
globs: Dockerfile,docker-compose*,packages/core/src/runner/**
---

# Docker Network Requirements

**NEVER suggest `network: none` for Docker containers running Claude Code agents.**

Claude Code agents MUST have network access to communicate with Anthropic's APIs. Without network access, the agent cannot function at all. Available network modes:

- `bridge` (default) - Standard Docker networking with NAT. Agent can reach the internet including Anthropic APIs.
- `host` - Share host's network namespace. Use only when specifically needed (e.g., for SSH access to local services).

**`network: none` will completely break the agent** - it won't be able to call Claude's APIs and will fail immediately.

When discussing Docker security, emphasize that `bridge` mode still provides network namespace isolation (separate network stack from host), just with outbound internet access enabled.
