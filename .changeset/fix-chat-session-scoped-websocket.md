---
"@herdctl/web": patch
---

Fix chat messages leaking between sessions and vanishing on navigation. WebSocket chat handlers now validate the incoming sessionId against the active session before updating state, preventing streaming chunks from one chat appearing in another and ensuring messages aren't lost when navigating away mid-response.
