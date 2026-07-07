---
"@herdctl/chat": patch
"@herdctl/core": patch
---

Filter out the Claude Code CLI's synthetic placeholder assistant turns (model
`"<synthetic>"`, e.g. "No response requested.") so they no longer leak into chat
output. After a `/compact`, the CLI injects a continuation summary and emits a
synthetic assistant turn as a placeholder, which previously rendered as a real
assistant message at the head of the next turn.

- `@herdctl/chat`: the live SDK-message translator now skips synthetic assistant
  messages (no text, no turn boundary). Exposes `isSyntheticMessage` /
  `SYNTHETIC_MODEL` from `message-extraction`.
- `@herdctl/core`: the JSONL history parser drops synthetic assistant lines, so
  reopening a compacted chat no longer shows the placeholder bubble.
