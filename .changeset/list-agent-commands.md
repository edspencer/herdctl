---
"@herdctl/core": minor
---

Add `FleetManager.listAgentCommands(agentName, options?)` — a one-shot way to
read the slash commands available to an agent for populating a command palette /
autocomplete, without hand-managing a live streaming session.

Internally it opens a chat session, reads its command list, and **always closes
the session** (in a `finally`, even if the listing throws), so consumers never
have to guard the underlying `claude` subprocess lifecycle themselves:

- Returns the full `SlashCommand[]` — `{ name, description, argumentHint }` per
  command (built-ins + project `.claude/commands` + MCP-provided commands) for
  the resolved session's cwd/config.
- Accepts the same `ChatSessionOptions` as `openChatSession` (notably
  `workingDirectory` and `injectedMcpServers`) so the list reflects the intended
  project context.
- Works for `cli`-runtime agents (the session runs on the SDK runtime
  regardless of the agent's configured runtime) and surfaces
  `StreamingSessionUnsupportedError` unchanged for Docker-wrapped agents.

Each call spawns and tears down a `claude` subprocess (~seconds); the list is
essentially static per project, so callers that query it repeatedly should
cache the result.

Also re-exports the `SlashCommand` type from `@herdctl/core`, so consumers can
`import type { SlashCommand } from "@herdctl/core"` instead of reaching into the
Claude Agent SDK directly.
