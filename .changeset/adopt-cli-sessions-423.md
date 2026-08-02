---
"@herdctl/core": minor
---

feat(core): adopt pre-existing Claude Code sessions into an agent (#423)

A session a user ran themselves in a terminal is visible in all-sessions views
but invisible under any agent, because nothing attributes it to one. Adoption
lets an agent claim such a transcript so it becomes discoverable, attributed and
resumable like any session herdctl created.

**The adoption store.** Records live at
`<stateDir>/adopted-sessions/<session-id>.yaml` (`version`, `sessionId`,
`agentName`, `adoptedAt`, optional `sourceCwd`), created lazily on first write
like the sparse `<platform>-sessions` stores. This is a dedicated store rather
than a synthetic job record on purpose: a job record asserts that a run
happened, and forging one to buy attribution would make job listings, history
and metrics lie about work that never ran. Session IDs come from user input, so
paths are built through `buildSafeFilePath()`.

**A third attribution source.** `buildAttributionIndex()` (and the incremental
`AttributionIndexBuilder`) now read the adoption store alongside jobs and
platform records, and `SessionOrigin` gains the value `"adopted"`. Precedence is
job → platform → adopted → native: adoption is checked last, immediately before
the native fallback, because a real run record or a live platform binding is
stronger evidence of a session's origin than an after-the-fact claim. Adoption
only rescues sessions that would otherwise be unattributed. Adoption records are
few and mutable, so — unlike job records — they are re-read in full on each
build rather than mtime-cached.

**New `FleetManager` methods:**

- `listAdoptableSessions(name, fromWorkingDir?)` — native, non-sidechain
  transcripts that aren't already adopted and aren't attributed to a run.
  Returns `AdoptableSession[]` (`sessionId`, `sourceCwd`, `mtime`, `autoName`,
  `preview`, `sizeBytes`), newest first. Deliberately not `DiscoveredSession`:
  half that shape is meaningless before adoption, and a message count would
  require streaming every transcript.
- `adoptSession(name, sessionId, opts?)` — claim one session by ID, moving
  nothing. Idempotent.
- `adoptSessionsFrom(name, opts?)` — place and claim every adoptable session in
  a directory. `mode` defaults to `"copy"`, so the user's original `~/.claude`
  transcripts are never mutated unless they ask for `"move"` or `"link"`. Copies
  preserve the source mtime, which drives both list ordering and every metadata
  cache key. Existing destination files are never overwritten: every mode
  creates the destination exclusively (`COPYFILE_EXCL` for a copy, `link()` for
  the other two — `move` deliberately avoids `rename()`, which replaces an
  existing destination silently), so an occupied destination is a skip even when
  it is occupied by something the caller's pre-check cannot see. Every
  non-adopted candidate appears in `skipped` with a reason (`"sidechain"`,
  `"already-adopted"`, `"destination-exists"`, `"attributed-to-run"`,
  `"unreadable"`, `"placement-failed"`, `"record-failed"`), and one bad
  transcript never aborts the batch. `dryRun: true` writes nothing — not even
  the sidechain metadata cache. Returns an empty result when the agent has no
  configured `working_directory`, even with an explicit `fromWorkingDir`: there
  is no destination folder to place transcripts into.
- `unadoptSession(name, sessionId)` — release a claim; the transcript stays on
  disk. Returns `false` when the session isn't adopted or is adopted by a
  *different* agent, so one agent cannot drop another's claim.

**Title-based auto-naming.** Adopted terminal sessions used to render as their
raw session ID, because auto-naming read only `type: "summary"` entries and CLI
transcripts essentially never emit one. The new `extractSessionTitle()` returns
the highest-precedence title present: `custom-title` (field `customTitle`) →
`ai-title` (field `aiTitle`) → `summary`. Precedence is by **entry type, not
file position** — a later `ai-title` never clobbers an earlier `custom-title` —
and within one type the last occurrence wins, since titles are rewritten as a
session evolves. `resolveAutoName` falls back to the first user message when a
transcript has no title at all. `extractLastSummary()` is untouched, so the
contract of `extractSessionMetadata()` is unchanged.

**`autoNameVersion`.** The auto-name cache is authoritative on the presence of
`autoNameMtime`, not of `autoName` — a nameless transcript is negative-cached so
it is never re-streamed. Changing the extractor alone would therefore have done
*nothing* to existing data: every already-listed session holds a current-mtime
entry produced by the old extractor, so the old (usually empty) result would
keep winning forever. `SessionMetadataEntrySchema` gains an optional
`autoNameVersion`, stamped by `setAutoName`/`batchSetAutoNames` with
`AUTO_NAME_EXTRACTOR_VERSION`; an entry whose version doesn't match misses
exactly once, is re-extracted and rewritten stamped, while `customName`,
`preview`, `usage` and `isSidechain` survive untouched. It is an optional
*field* rather than a bump of `SessionMetadataFileSchema`'s `version` because
`loadMetadata()` discards the entire file when it fails to parse — a file-version
bump would silently destroy every user-set custom name instead of invalidating
one cached field.

**New exports:** `ADOPTED_SESSIONS_DIR_NAME`, `getAdoptedSessionsDir`,
`getAdoption`, `listAdoptions`, `recordAdoption`, `removeAdoption`,
`RecordAdoptionOptions`, `ADOPTED_SESSION_VERSION`, `AdoptedSession`,
`AdoptedSessionSchema`, `AdoptedSessionVersionSchema`, `extractSessionTitle`,
`AUTO_NAME_EXTRACTOR_VERSION`, and the `AdoptableSession`,
`AdoptionPlacementMode`, `AdoptSessionsFromOptions`, `AdoptSessionsResult`,
`AdoptSkippedSession` and `AdoptSkipReason` types.
