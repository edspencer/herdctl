---
"@herdctl/web": patch
---

Fix a cluster of dashboard bugs in chat and All Chats.

- **Chat messages now time out and can be retried (#170).** `fetchChatMessages` (and the ad hoc equivalent) had no timeout, so a hung API call left the feed on "Loading messages..." forever. Requests are now aborted after 15s with a clear error, and both the error banner and the empty state offer a Retry.
- **Existing sessions no longer show a misleading empty state (#170).** A session that loaded zero messages said "Send a message to start the conversation"; it now reports "No messages found for this session" with a retry, while genuinely new chats keep the original prompt.
- **"Show all" in a directory group actually expands it (#150).** The render slice was pinned to the first 10 sessions no matter how many were loaded. Clicking now reveals every loaded session and keeps paging from the server while more remain.
- **Search no longer leaves empty directory groups behind (#275).** A group that matched only by its path or agent name filtered all of its own sessions away and rendered a confusing per-group "no sessions" message. Such a group now shows all of its sessions, and groups that match nothing are dropped entirely so the single top-level "No matching sessions" state is used consistently.
- **WebSocket messages sent immediately on connect are no longer dropped (#275).** The server attached its `message` listener only after awaiting the initial fleet-status snapshot, so a frame sent the instant the socket opened could be lost on a cold or loaded server. Listeners are now attached synchronously.
