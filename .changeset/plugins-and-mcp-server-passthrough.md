---
"@herdctl/core": minor
---

Stop narrowing what the Agent SDK supports: plugins passthrough and full MCP server config

**Plugins (#444).** New optional `plugins` field on an agent config and on fleet `defaults`, passed through `toSDKOptions` to the SDK's `plugins` option. Entries are either a bare path string or `{ type: "local", path, skipMcpDiscovery? }`; the shorthand normalises to the object form. An agent's own array replaces the fleet default, consistent with `tools` / `allowed_tools`.

Both runtimes honour it: the SDK runtime sets the `plugins` option, and the CLI runtime emits `--plugin-dir` (or `--plugin-dir-no-mcp` for `skipMcpDiscovery`) per entry, which is exactly what the SDK does with its own option.

Note that the SDK *also* auto-discovers plugins under `$CLAUDE_CONFIG_DIR/plugins`, but only enables them via the `enabledPlugins` key in the **user** settings source — which herdctl does not load unless an agent opts in with `setting_sources: ["user", ...]`. An explicit `plugins` list needs no such opt-in, and avoids inheriting the rest of the user source along with it.

**MCP servers (#445).** `McpServerSchema` was `{command, args, env, url}` and silently stripped everything else, while `transformMcpServer` rewrote every `url` to `type: "http"`. It now also accepts `headers`, an explicit `type` (`"stdio" | "sse" | "http"`), `timeout` and `alwaysLoad`, mirroring the SDK's own `McpServerConfig`. This fixes authenticated remote servers (which lost their bearer token) and SSE servers (which were misconfigured as HTTP) — and with them the stored OAuth token, which Claude Code keys on a hash of `{type, url, headers}`, so a stripped field also made a previously-authorised server unrecognisable.

Backwards compatible: a bare `url` with no `type` still resolves to `type: "http"`, and stdio servers are unchanged.
