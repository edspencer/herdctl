---
"@herdctl/core": patch
---

`extractSessionMetadata` now skips Claude Code's injected `isMeta:true` user
lines (a skill's SKILL.md, slash-command output, hook output). Previously these
inflated `messageCount` and — when one led the transcript — could seed
`firstMessagePreview`, `gitBranch`/`version`, and the timestamp bounds from
injected content rather than the real first user message. This completes the
`isMeta` handling started for `parseSessionMessages`, so history rendering and
session metadata now agree.
