---
"@herdctl/core": minor
---

Add host-side MCP server support for Docker agents. Servers with `host: true` are spawned on the host and bridged into the container via HTTP, enabling MCP servers that need host resources (filesystem, credentials) while the agent runs in Docker. Also fix MCP HTTP bridge URLs to use `host.docker.internal` so containers can reach host-side bridges.
