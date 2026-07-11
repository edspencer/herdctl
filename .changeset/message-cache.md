---
"@herdctl/core": patch
---

perf(state): mtime-cache parsed transcript messages so repeat chat opens skip a full re-parse

`SessionDiscoveryService.getSessionMessages` delegated straight to
`parseSessionMessages` with no memo, so opening/refreshing a chat re-parsed the
entire JSONL every time — measured ~114ms of synchronous `JSON.parse`-per-line for
an ~8MB / 500K-token / 1107-message transcript, recomputed on every open and
stalling the event loop on the constrained host. Its siblings `getSessionUsage`
and `getSessionMetadata` were already mtime-cached; messages were the outlier.

Added a small mtime-keyed, LRU-bounded in-memory cache (keyed on the transcript
file path + its current mtime). A transcript is immutable except when a new turn
appends (which bumps mtime), so an exact-mtime match serves the parsed array with
no re-parse; a bumped mtime invalidates the entry. Repeat opens of an unchanged
chat drop from ~114ms to ~0.
