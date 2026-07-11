---
"@herdctl/core": minor
---

perf(state): cache derived per-session facts (isSidechain, usage) in the session metadata store

Session discovery re-derived two facts from every transcript on each listing: the
sidechain flag (`getAgentSessions` opened the first JSONL line of **every**
session, every call) and the context-window usage (`getSessionUsage` streamed the
whole transcript). Both are now memoized in `SessionMetadataStore` keyed on the
transcript's mtime — the same mtime-invalidated pattern already used for
`preview`/`autoName` — so an unchanged session is never re-read.

- New `SessionMetadataEntry` fields: `isSidechain`/`isSidechainMtime` and
  `usage`/`usageMtime`, with `getSidechain`/`batchSetSidechains` and
  `getUsage`/`setUsage` on the store.
- `getSessionUsage` gains optional `agentName` (enables the persistent cache) and
  `mtime` (skips a `stat` when the caller already knows it). `FleetManager.getAgentSessionUsage`
  passes the agent name, so callers get durable, restart-surviving usage caching
  for free.

Measured on a real 289-transcript project (after a simulated restart): bulk usage
reads dropped from ~600 ms to ~2 ms, and `getAgentSessions` from ~1.29 s to ~0.91 s
(the remainder is the attribution-index rebuild, addressed separately).
