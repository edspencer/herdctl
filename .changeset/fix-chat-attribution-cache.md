---
"@herdctl/core": patch
"@herdctl/web": patch
---

fix: invalidate attribution cache after chat message send

New web chat sessions were not appearing in the sidebar because the
SessionDiscoveryService's attribution index (30-second cache TTL) didn't
include the newly written session attribution. The next getAgentSessions()
call would filter out the new session since it wasn't yet in the index.

Added `invalidateAttributionCache()` to SessionDiscoveryService and call
it from WebChatManager.sendMessage() after writing session attribution.
This also clears the directory file listing cache for the agent's working
directory so new JSONL files are picked up immediately.
