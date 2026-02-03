---
"@herdctl/core": patch
---

fix(core): Docker CLI runtime session persistence

Fixed session resumption for CLI runtime agents running in Docker containers.

**The bug:** When resuming a session with Docker enabled, the CLI runtime was watching the wrong session file path (`~/.claude/projects/...`) instead of the Docker-mounted session directory (`.herdctl/docker-sessions/`). This caused the session watcher to yield 0 messages, resulting in fallback responses despite Claude correctly remembering conversation context.

**The fix:**
1. Updated `validateSessionWithFileCheck` to check Docker session files at `.herdctl/docker-sessions/` when `session.docker_enabled` is true
2. Updated `CLIRuntime` to use `sessionDirOverride` when resuming sessions, not just when starting new ones

This ensures both session validation and session file watching use the correct paths for Docker-based CLI runtime execution.
