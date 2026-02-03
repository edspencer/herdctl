---
"@herdctl/core": patch
---

Detect and clear stale sessions when working_directory changes

Adds automatic detection of working directory changes between sessions. When the `working_directory` changes, Claude Code looks for the session file in a different project directory and fails with ENOENT errors.

**Behavior**:
- Session metadata now stores the `working_directory` path
- On session resume, validates that `working_directory` hasn't changed
- If changed, logs a warning with old → new paths
- Automatically clears the stale session
- Starts fresh session instead of attempting failed resume

**Example Warning**:
```
Working directory changed from /old/path to /new/path - clearing stale session abc123
```

This prevents confusing "session file not found" errors when users change their agent's `working_directory` configuration.
