---
"@herdctl/core": minor
"@herdctl/web": minor
---

Add configurable message grouping for web chat

When a Claude Code agent produces multiple assistant text turns separated by tool calls, the web chat now supports displaying each turn as a separate message bubble ("separate" mode) or merging them into one ("grouped" mode).

- Add `message_grouping` config option to `WebSchema` (default: "separate")
- Add `chat:message_boundary` WebSocket message for signaling turn boundaries
- Add client-side toggle to switch between separate and grouped display modes
- Persist user preference in localStorage with server config as default
- Add `GET /api/chat/config` endpoint for client to read server defaults
