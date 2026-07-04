---
"@herdctl/core": patch
---

Session-history parsing (`parseSessionMessages`) now skips Claude Code's injected `isMeta:true` user lines — a skill's `SKILL.md`, slash-command output, hook output — instead of surfacing them as ordinary user messages. Previously a skill's `SKILL.md` was emitted as a plain user message, so downstream chat UIs rendered it as a giant, out-of-order user bubble. Genuine tool results are unaffected (the guard only applies to the plain-text user branch).
