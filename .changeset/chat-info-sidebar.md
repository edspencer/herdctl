---
"@herdctl/web": minor
---

Add chat info sidebar with session actions, token usage, and session metadata

- New togglable right-side panel in the chat view (default open, persisted to localStorage)
- "Continue in Claude Code" button copies `claude --resume` command to clipboard
- Token usage via REST endpoint `GET /api/chat/:agentName/sessions/:sessionId/usage` that reads Claude Code's session JSONL files from disk, deduplicating by message ID, showing context window fill (input + cache tokens) and API call count
- Context window progress bar showing approximate fill percentage
- Session info section with message count, model, working directory, and creation date
- New REST endpoint `GET /api/chat/:agentName/sessions/:sessionId/sdk-session` for SDK session ID retrieval
- Responsive: sidebar auto-hides below 1024px viewport width
