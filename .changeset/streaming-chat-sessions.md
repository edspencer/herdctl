---
"@herdctl/core": minor
---

Add streaming chat sessions (`FleetManager.openChatSession`) for interactive, multi-turn control over a live agent query.

Until now every turn ran as a one-shot `query()` with a string prompt, which cannot use the SDK's control requests (they are "only supported when streaming input/output is used"). The new `SDKRuntime.openSession()` drives the SDK's streaming-input mode instead, keeping one query open across turns and retaining the `Query` handle. This exposes a `RuntimeSession` with:

- `send(text)` — send a follow-up user turn; a leading-slash text (e.g. `/compact`, `/clear`) is dispatched by the CLI as a slash command (commands are just user messages — there is no separate "run command" call),
- `interrupt()` — stop the current turn without closing the session,
- `listCommands()` — enumerate available slash commands for a command palette,
- `setModel(model)` — switch models mid-session,
- `close()` — end the input stream and shut the query down.

`FleetManager.openChatSession(agentName, options)` resolves the agent with the same working-directory-override and session-resume semantics as `trigger()` and returns the session. Additive and backward-compatible: the one-shot `execute()`/`trigger()` path is unchanged. Streaming sessions always run on the SDK runtime (the only streaming-capable one) regardless of the agent's configured `runtime` — a `cli`-configured agent works fine (same `CLAUDE_CODE_OAUTH_TOKEN` auth, shared on-disk session store), so a session resumes a CLI-created conversation cleanly; only Docker-wrapped agents are unsupported and throw the new `StreamingSessionUnsupportedError`. Also exports a small `MessageQueue` helper (pushable `AsyncIterable`) used to feed the streaming input.
