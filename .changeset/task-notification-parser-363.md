---
"@herdctl/core": minor
---

Parser: recognise harness-injected `<task-notification>` transcript entries (#363). The Claude Code harness writes a `<task-notification>` block (emitted whenever a background Task/Agent stops or completes) as a synthetic `type:"user"` line stamped `origin:{kind:"task-notification"}`. Unlike skill/hook context it is **not** flagged `isMeta:true`, so it previously slipped past the parser's synthetic-content guards and was surfaced to every consumer as if the human had typed the raw XML.

- `ChatMessage` now carries an optional `origin?: { kind: string }`. `parseSessionMessages` **keeps** task-notification user lines (a chat UI may render their `<summary>` as a subtle status line) but tags them with `origin` so consumers can classify them structurally instead of sniffing `content`.
- `extractSessionMetadata` now **drops** task-notifications (like `isMeta` lines) so they no longer inflate `messageCount`, seed the first-message preview, or drag the session's timestamp bounds.
- `extractFirstMessagePreview` gained the `isMeta` + task-notification guards it was missing entirely, so a synthetic leading line can never seed a chat's preview.
