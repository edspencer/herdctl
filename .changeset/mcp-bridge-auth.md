---
"@herdctl/core": patch
---

Require a per-bridge bearer token on the MCP HTTP bridge, and bind it to loopback on the CLI runtime.

On the CLI runtime (`runtime: cli`), injected MCP servers (such as the Discord and Slack file sender) were served over an HTTP bridge that listened on `0.0.0.0` with no authentication, so anything that could reach the port during a run could call the injected tools. Every bridge now generates a random 256-bit token and rejects requests without `Authorization: Bearer <token>`. herdctl passes the token only to the agent it spawns, through the MCP config's `headers`, so consumers passing `injectedMcpServers` need no changes.

- The CLI runtime binds its bridges to `127.0.0.1`. The Docker path still binds `0.0.0.0` (the agent container must reach it) and relies on the token.
- The CLI runtime now writes the MCP config to an owner-only temp file and passes its path to `--mcp-config`, instead of passing the JSON on the command line where any local user can read it. This also keeps declared servers' `env` and `headers` out of the process arguments. The file is deleted when the run ends. When a custom `processSpawner` is supplied, the config is still passed inline, since the host path may not exist where `claude` runs; set `mcpConfigTransport` to override.

Fixes #54.
