---
"@herdctl/core": minor
---

Stream tool results from Claude to Discord messages

Previously, when Claude used tools like Bash during a Discord conversation, only text responses were shown - tool outputs were silently dropped. The `onMessage` callback in `DiscordManager.handleMessage` only processed `assistant` type messages, ignoring `user` messages that contain tool results.

Now the Discord integration:
- Shows tool invocations (e.g., the Bash command being run, file paths being read/written)
- Streams tool output in Discord code blocks
- Truncates long tool output at 1800 characters to respect Discord's 2000 char limit
- Handles both content-block and top-level `tool_use_result` SDK message formats
