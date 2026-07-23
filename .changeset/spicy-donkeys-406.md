---
"@herdctl/core": minor
---

Fix a resume self-interrupt that loses the human's turn (#406). On a real
(non-fork) resume that carries a human prompt, if the prior process died mid-turn
leaving pending background-task state, the CLI replays that leftover as its own
turn ahead of the human turn; the `SessionReaper` reaping on the replayed backlog
turn's `turn_end` closed the session out from under the in-flight human turn,
producing `[Request interrupted by user]` / `interruptedByShutdown` and dropping
the human's message.

`SessionReaper.manage` now accepts a `turnEndReapGraceMs` (via
`ManageSessionOptions`) that defers a `turn_end` reap so an immediately-following
turn's `activity` can cancel it — mirroring the existing background-drain grace.
Default `0` preserves current behavior. `openChatSession` arms this grace
(`DEFAULT_REINVOCATION_GRACE_MS`, 15s) unconditionally on any real resume that
carries a prompt, so a replayed backlog turn can no longer reap the resumed prompt
turn; a genuinely final turn still reaps once its grace elapses. Fresh (non-resume)
sessions and `--fork-session` resumes are unaffected.
