---
"@herdctl/core": patch
---

Harden session discovery against a single unreadable transcript entry. An entry that
`stat()`s as a valid `.jsonl` file but is actually a directory (so `open(2)` succeeds
and `read(2)` throws `EISDIR`) previously threw out of the per-session enrichment and
took down the whole listing — `getAgentSessions` lost the agent's entire list, and
`getAllSessions` lost every agent's list because the throw escaped a loop nested in the
loop over directories. Both paths now isolate per-entry enrichment (sidechain / auto-name
/ preview) in a try/catch, skip the bad entry, and log a warning so a corrupt transcript
folder is diagnosable, while good transcripts next to it still come back.
