---
"@herdctl/core": patch
---

Prune stale session metadata entries during full session scans (#168)

`SessionMetadataStore` accumulated autoName/preview/sidechain/usage cache entries
for every discovered session but never removed them, so files like `adhoc.json`
grew unboundedly — entries persisted long after the underlying JSONL transcript
was deleted. Added `SessionMetadataStore.prune(agentName, validSessionIds)` and
wired it into `getAllSessions()`, which reconciles each metadata key against the
sessions still present on disk. Pruning runs only on a full (unlimited)
enumeration and unions valid sessionIds across every directory sharing a key
(all unattributed dirs share `"adhoc"`), so a limited/top-N scan never deletes
live entries, and it writes only when something was actually removed.
