---
"@herdctl/core": minor
---

Fix dropped assistant answers when reloading a chat, and expose per-session usage.

- **Bugfix (`parseSessionMessages`).** An assistant turn that uses extended
  thinking is written by Claude Code as several JSONL lines sharing one
  `message.id` — a `thinking` block line (which carries no text) followed by the
  `text` block line. The previous dedup marked the `message.id` as "seen" on the
  thinking line, so the following text line was discarded as a duplicate and the
  assistant's actual answer disappeared when a session was reloaded from history
  (most visibly: the final turn of any thinking-enabled conversation). Dedup now
  keys on whether text has actually been emitted for an ID, so no-text lines
  (thinking / tool_use) no longer suppress the real answer. Tool-use pairing and
  text dedup of genuinely duplicated lines are unchanged.

- **New: `FleetManager.getAgentSessionUsage(name, sessionId)`** wraps
  `SessionDiscoveryService.getSessionUsage`, returning the most recent
  context-window fill level (last assistant turn's input + cache tokens) and turn
  count for a session — so a UI can show "context used" for a chat opened from
  history, before any new turn streams a fresh `usage`.
