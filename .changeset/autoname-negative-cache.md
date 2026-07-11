---
"@herdctl/core": patch
---

perf(state): negative-cache resolveAutoName/resolvePreview so warm listings skip transcript re-scans

`SessionDiscoveryService.resolveAutoName` (and `resolvePreview`) only wrote to the
mtime-keyed metadata cache when a value was *found*. A transcript with no
`type:"summary"` entry cached nothing, so the next `getAgentSessions` re-scanned it
from scratch via `extractLastSummary` — a full O(filesize) stream of a multi-MB
file. CLI keeper sessions essentially never carry a summary, so the autoName cache
was 0%-effective (measured 0/298 sessions cached) and a fully-warm project switch
still spent ~580ms re-streaming every attributed transcript.

Both resolvers now record the mtime even for an empty result (mirroring
`resolveSidechain`), so a validated *negative* result is remembered and unchanged
sessions are never re-scanned. Warm project-switch enrichment drops from ~580ms to
tens of ms. `autoName`/`preview` may now be absent while `autoNameMtime`/
`previewMtime` are set — presence of the mtime, not the value, is what makes the
cache authoritative.
