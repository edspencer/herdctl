---
"@herdctl/web": minor
---

Update frontend to display sessions from all origins (web, CLI, Discord, Slack, schedule). Add OriginBadge component showing session source. Session rows in sidebar, recent conversations, and agent chats tab now show origin badges and dim non-resumable (Docker) sessions. ChatInfoSidebar displays session metadata (git branch, Claude Code version) and handles resume commands using SDK session IDs directly. New chat flow no longer pre-creates sessions — first message triggers session creation. Removed delete session functionality (backend endpoint removed in prior milestone). Session detail endpoint now returns metadata alongside messages.
