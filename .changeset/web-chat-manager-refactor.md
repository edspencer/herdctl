---
"@herdctl/web": minor
---

Refactor web chat backend to use SessionDiscoveryService for unified session access. WebChatManager now delegates read operations (listing sessions, fetching messages, usage stats) to the core discovery service instead of managing its own web chat history files. SDK session ID replaces web UUID as the canonical session identifier. New REST endpoints `GET /api/chat/all` and `GET /api/chat/all/:encodedPath` provide machine-wide session discovery grouped by working directory. Removed endpoints for session pre-creation, deletion, and SDK session ID lookup.
