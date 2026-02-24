---
"@herdctl/core": minor
---

Add JSONL session parser for reading Claude Code native session files. Exports `parseSessionMessages()`, `extractSessionMetadata()`, and `extractSessionUsage()` for converting `.jsonl` session files into the `ChatMessage[]` format used by the web frontend.
