---
"@herdctl/core": patch
---

fix(core): stop SessionMetadataStore from replacing an unreadable metadata file with an empty one (#419)

`loadMetadata()` collapsed three outcomes into the same `null`: the file was
absent (legitimate — storage is sparse), the file could not be read (EACCES /
EIO / EISDIR / a truncated read), or the file parsed but failed schema
validation. Every setter treated `null` as "start fresh", so the next
`atomicWriteJson` replaced the **whole** agent file with an empty structure —
silently destroying every `customName`, `preview`, `autoName`, `isSidechain`
and `usage` entry for that agent. One failed read followed by one write (a
listing warming its caches is enough) wiped the file, and because the atomic
write succeeded it looked clean.

Reads and writes now distinguish absent from unreadable:

- **Absent** → an empty structure is created, exactly as before.
- **Unreadable / corrupt** → writes refuse and throw the new
  `SessionMetadataUnreadableError`, leaving the damaged file untouched so its
  bytes stay recoverable. Getters keep returning `null`/`undefined` (graceful
  read degradation is unchanged).

Session-discovery's background cache-warming (`batchSet*` / `setUsage`) tolerates
that refusal and continues — a poisoned metadata file for one agent no longer
aborts a whole listing; the cache just stays cold until the file is repaired.
The transient failure is never cached, so a temporary read error does not become
sticky.

`SessionMetadataUnreadableError` and `isSessionMetadataUnreadableError` are
exported from `@herdctl/core`.
