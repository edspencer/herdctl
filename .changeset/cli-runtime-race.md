---
"@herdctl/core": patch
---

Fix session file timeout when Claude Code CLI `-p` mode exits without writing a `.jsonl` session file. Races the session file watcher against process exit, and creates a stub session file from the captured `session_id` if the CLI finishes first. This prevents the 60-second timeout error seen with Claude Code 2.1.71+.
