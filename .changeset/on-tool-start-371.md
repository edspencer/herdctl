---
"@herdctl/chat": minor
---

feat(chat): emit in-flight tool_use via a new `onToolStart` handler

`SDKMessageTranslator` previously only surfaced a tool call once its `tool_use`
was paired with the eventual `tool_result` (via `onToolCall`), so long-running
tools — especially subagents (`Task`/`Agent`) that run for minutes — were
invisible to consumers until they completed. Adds an optional
`onToolStart(toolUse: TranslatedToolStart)` handler fired from `handleAssistant`
the moment a `tool_use` block appears, carrying `{ toolName, inputSummary,
toolUseId, parentToolUseId }`. Consumers can render a pending/"running…" row
keyed by `toolUseId` and reconcile it against the existing `onToolCall`
completion. Backward compatible (the handler is optional; `onToolCall` is
unchanged) and fires regardless of the `toolResults` option. Refs #371.
