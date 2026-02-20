---
"@herdctl/web": patch
---

Fix chat auto-scroll hijacking scroll position during streaming responses. The message feed now tracks whether the user is scrolled to the bottom via a scroll event listener and only auto-scrolls when pinned within 20px of the bottom, allowing users to freely read chat history while new messages stream in.
