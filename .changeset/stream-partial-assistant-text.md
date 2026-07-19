---
"@herdctl/core": minor
"@herdctl/chat": minor
---

Stream partial assistant-text deltas on the SDK runtime.

- **@herdctl/core:** add an opt-in `includePartialMessages` flag on
  `ChatSessionOptions` / `RuntimeExecuteOptions` (and `SDKQueryOptions`), threaded
  from `openChatSession` down to the SDK `query()`. When set, the SDK emits
  `stream_event` / `text_delta` chunks so callers can stream assistant text
  token-by-token. Default off — batch/one-shot and non-opting session callers are
  unchanged.
- **@herdctl/chat:** `SDKMessageTranslator` now handles `stream_event` messages,
  emitting incremental `onText(delta)` calls for `content_block_delta` /
  `text_delta` events, and suppresses the terminal whole-`assistant` text re-emit
  when its text already streamed as deltas (the `onText` contract stays "deltas,
  in order"). Boundary and tool-call semantics are preserved; the partials-off
  path is byte-for-byte unchanged (one `onText` per assistant content block).
