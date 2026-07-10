---
"@herdctl/core": patch
---

Surface a stable per-message id on `ChatMessage` from `parseSessionMessages` (edspencer/herdctl#312).

Each source JSONL transcript entry carries a stable `uuid` (assigned when the line is written, append-only, and preserved across a fork), but the parser previously dropped it — leaving consumers with no reload-stable identifier for a rendered message. `ChatMessage` now exposes an optional `uuid`:

- Populated from each entry's `uuid` for user and assistant messages.
- For a paired tool message (a `tool_use` in an assistant entry collapsed with its following `tool_result`), the id is the **originating `tool_use` entry's** `uuid`, so it stays deterministic even when several `tool_result`s share a single user line. An orphan `tool_result` with no matching `tool_use` falls back to its own line's `uuid`.
- Additive and optional — `undefined` when the source line has no `uuid` — so existing consumers are unaffected.

This unblocks keying per-message UI state (collapse/height/pin state, deep-linking) on an identifier that survives reloads.
