---
"@herdctl/web": patch
---

Fix web chat session cross-contamination when SDK session mapping is missing. Previously, if a web chat session had no stored SDK session ID (e.g. after migration or expiry), the system would fall back to the agent's global session, causing the agent to resume a different conversation's context. Now explicitly starts a fresh session instead of using the fallback.
