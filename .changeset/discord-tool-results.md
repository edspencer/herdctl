---
"@herdctl/core": minor
"@herdctl/discord": minor
---

Show tool results as Discord embeds during chat conversations

Previously, when Claude used tools like Bash during a Discord conversation, only text responses were shown - tool outputs were silently dropped. Now tool results appear as compact Discord embeds with:

- Tool name and emoji (Bash, Read, Write, Edit, Grep, Glob, WebSearch, etc.)
- Input summary (the command, file path, or search pattern)
- Duration of the tool call
- Output length and truncated result in a code block
- Color coding: blurple for success, red for errors

The reply function now accepts both plain text and embed payloads, allowing rich message formatting alongside streamed text responses.
