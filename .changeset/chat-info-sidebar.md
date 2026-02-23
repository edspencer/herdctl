---
"@herdctl/web": minor
---

Add chat info sidebar with session actions, live token usage, and session metadata

- New togglable right-side panel in the chat view (default open, persisted to localStorage)
- "Continue in Claude Code" button copies `claude --resume` command to clipboard
- Live token usage tracking: input/output tokens update during streaming via new `chat:usage_update` WebSocket message
- Context window progress bar showing approximate fill percentage
- Session info section with message count, model, working directory, and creation date
- New REST endpoint `GET /api/chat/:agentName/sessions/:sessionId/sdk-session` for SDK session ID retrieval
- Responsive: sidebar auto-hides below 1024px viewport width
