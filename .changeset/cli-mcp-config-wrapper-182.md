---
"@herdctl/core": patch
---

Lock in the correct `--mcp-config` JSON shape for the CLI runtime (issue #182).

The Claude CLI validates `--mcp-config` against a schema that requires a top-level `mcpServers` record (the same shape as `.mcp.json`). The pre-fix flat form `{"<name>":{...}}` fails validation with `mcpServers: Invalid input: expected record, received undefined`, and the headless process hangs until the job times out instead of surfacing an error.

The CLI runtime already emits the wrapped `{"mcpServers":{...}}` form; this change adds regression tests asserting that emitted shape so it can't silently revert to the flat form.
