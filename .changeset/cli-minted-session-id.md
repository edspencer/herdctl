---
"@herdctl/core": patch
---

Stop inferring a new CLI session's id — mint it and tell the CLI to use it (#357).

`waitForNewSessionFile` worked out which transcript a freshly-spawned `claude`
had created by looking at the session directory. Issue #357 fixed half of that:
a snapshot taken before spawning identifies the new session by set difference, so
a co-located agent *appending* to its own session can no longer be mistaken for
ours. The other half was left as a guess:

```js
// Normally exactly one; if several appeared (e.g. multiple co-located
// spawns raced), the newest is ours.
```

The newest is not ours — it is whoever spawned last. When two agents share a
working directory they share one `~/.claude/projects/<encoded-cwd>/`, and two
concurrent `resume:null` spawns produce two brand-new files that are
indistinguishable by name or mtime. The two agents then **trade session ids**:
each adopts the other's transcript, and each writes a job record claiming it.

Claude Code accepts `--session-id <uuid>` and names the transcript after it (this
also composes with `--fork-session`). So a turn that starts a new session now
mints its own id and passes it, and the file is known by name — no snapshot, no
mtime, no tie-break, nothing to get wrong. A plain resume already knows its id
and is unchanged. Set `HERDCTL_CLI_MINT_SESSION_ID=0` to restore the old
inference.

If the expected file never appears — a CLI too old to know the flag, or a test
harness's fake that has not been taught it — herdctl logs a warning and falls
back to the previous inference rather than failing the turn.

While the CLI is still running, the inference paths stay disabled: "take
whichever brand-new file shows up" is exactly the collision `--session-id` exists
to remove, so a co-located agent's file cannot be claimed just because it landed
first. But once the process has **exited** without writing the file we asked for,
that is settled rather than merely unknown, so the fallback runs immediately
instead of burning the full 60 s timeout. That distinction is what keeps this
change survivable for every existing fake-CLI harness.

Also make attribution of a doubly-claimed session id deterministic — #357's
proposed "secondary hardening", which was never implemented.
`AttributionIndexBuilder` filled its session→agent map in `Promise.all`
completion order, so when two records claimed one session id the winner was
whichever file's stat+parse finished last. That is decided by record size and
machine load: with the same two records on disk, making one record larger flips
the winner (measured 10/10 each way). Claims are now ordered explicitly — newest
`started_at` wins, ties broken on job id — so the answer is a pure function of
what is on disk. Newest-wins rather than first-owner-wins because adopting or
promoting a session is a legitimate change of owner, and those write a newer
record.

Together these turn a failure that was arbitrary in both directions into one that
cannot happen, and — where a collision is somehow still reached — into one that
is at least consistent.

Found via paddock#548, where a project's keeper and its post-turn sweeper share a
cwd: a sweep is scheduled after every keeper turn, so the sweeper's spawn raced
the next keeper turn and a user's chat could be bound to the curator's transcript
— streaming the wrong reply, resuming the wrong history, and disappearing from
the chat list depending on which record won attribution.
