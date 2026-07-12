---
"@herdctl/web": patch
---

fix(web): forward agentName so the dashboard usage endpoint hits the persistent usage cache

`WebChatManager.getSessionUsage` had the `agentName` in scope but omitted it from
the options passed to `SessionDiscoveryService.getSessionUsage`, so the
mtime-keyed persistent usage cache (added in #320) was never engaged on the web
`/usage` path. Every dashboard navigation that read per-session usage took the
uncached `extractSessionUsage` branch and re-streamed the whole transcript — the
exact O(transcript-size) cost the cache was meant to eliminate.

Forwarding `agentName` in the options opts the web path into the cache, matching
the sibling `getSessionMessages` call that already forwards its options.
