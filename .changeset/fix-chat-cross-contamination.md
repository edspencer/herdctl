---
"@herdctl/web": patch
---

Fix chat bugs: prevent messages from other agents appearing in new chats, and ensure new chats appear in sidebar immediately after first message

The WebSocket message handler now tracks the active agent (activeChatAgent) in addition to the active session ID. This prevents messages from concurrent chats in different agents from being routed to the wrong chat window. Additionally, the sidebar session list is refreshed immediately after completing a new chat's first message.
