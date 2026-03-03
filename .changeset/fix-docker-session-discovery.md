---
"@herdctl/core": patch
"@herdctl/web": patch
---

fix: discover Docker agent sessions from .herdctl/docker-sessions/

Docker agents store session JSONL files in `.herdctl/docker-sessions/` on the
host (the container's `~/.claude/projects/` is ephemeral and gone after exit).
`SessionDiscoveryService` only scanned `~/.claude/projects/`, so Docker agent
sessions were invisible in the UI despite existing on disk.

Now `getAgentSessions()` scans the docker-sessions directory when
`dockerEnabled` is true. `getAllSessions()` also includes Docker session groups
so they appear in the All Chats view. Session message/metadata/usage retrieval
methods accept an optional `{ dockerEnabled }` option to resolve the correct
file path.
