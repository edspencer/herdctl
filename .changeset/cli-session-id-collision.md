---
"@herdctl/core": patch
---

fix(core): resolve a fresh CLI session by set difference, not mtime, so co-located agents can't steal each other's session id

`waitForNewSessionFile` resolved a freshly-spawned `resume:null` (or forked) CLI
turn by picking the newest `.jsonl` whose `mtime > startTime` in the agent's
session directory. When two agents **share a working directory** — hence the same
`~/.claude/projects/<encoded-cwd>/` session dir — a concurrently *streaming*
session from the other agent also has `mtime > startTime`, and can be newer than
the file the CLI just created. The new turn was then mis-resolved to the **other
agent's** session id and its job record written with that foreign `session_id`.
Because job attribution is last-writer-wins per `session_id`, the victim session
flipped to the wrong agent and vanished from its owner's chat list until a later,
correctly-attributed turn (so it was intermittent). Observed live on Paddock,
whose per-project keeper and sweeper share the project directory as cwd.

Fix: snapshot the set of `.jsonl` filenames *before* spawning the CLI
(`snapshotSessionFiles`) and identify the new session by **set difference** — the
file whose *name* is new since the snapshot — which a co-located agent's
pre-existing (merely-appended-to) file can never be, regardless of mtime. The
mtime heuristic is retained only as a post-deadline fallback (with a warning) for
genuinely degenerate cases where no new-named file ever appears.
