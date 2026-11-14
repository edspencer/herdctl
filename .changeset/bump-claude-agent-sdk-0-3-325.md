---
"@herdctl/core": patch
---

Raise the `@anthropic-ai/claude-agent-sdk` floor to `^0.3.325` (current npm `latest`, bundling Claude Code 2.1.325).

The bundled Claude Code version is what gates new models: the API refuses a model whose minimum client version is newer than the CLI making the request, answering `400 claude_code_version_too_old` (Claude Fable 5.2 needs 2.1.290 or newer). On the SDK runtime the CLI is the SDK's own bundled binary, not the `claude` on `PATH`, so a consumer cannot fix this by upgrading Claude Code — only by resolving a newer SDK. Raising the floor makes every consumer that installs this release resolve a binary new enough for the current model lineup.

No code adaptation was needed: none of the APIs changed across 0.3.303–0.3.325 are used by herdctl. Behaviour changes worth knowing about if you configure permissions yourself:

- **0.3.325:** read-only `git` commands now go through the permission flow instead of being auto-approved, and sandboxed Bash commands are no longer auto-approved unless `autoAllowBashIfSandboxed: true`. An agent whose `allowed_tools` includes `Bash` is unaffected. Deny rules now also remove in-process SDK MCP tools from Claude's tool list, as they always should have.
- **0.3.317:** the `file_unchanged` variant of `FileReadOutput` was removed.
- **0.3.311:** minimum Node.js raised to 18.14.0.
