---
"@herdctl/web": minor
---

Add interactive ad hoc chat sessions for unattributed Claude Code sessions

- Users can now resume and interact with sessions that don't belong to any fleet agent
- New `/adhoc/:encodedPath/chat/:sessionId` route for ad hoc chat view
- WebChatManager uses RuntimeFactory + JobExecutor directly (bypasses FleetManager.trigger())
- "Continue conversation" button added to read-only session view
- Recent conversations and All Chats page now route resumable unattributed sessions to ad hoc chat
