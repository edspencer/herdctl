---
"@herdctl/core": patch
"@herdctl/chat": patch
---

Move tool-parsing utilities from @herdctl/chat to @herdctl/core for reuse by new session discovery modules. @herdctl/chat re-exports all symbols for backwards compatibility.
