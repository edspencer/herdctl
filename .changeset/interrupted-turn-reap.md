---
"@herdctl/core": patch
---

Reap a managed session whose turn was interrupted. Claude Code does not fire its `Stop` hook on a user interrupt, so the session reaper never learned the turn had ended: the `claude` subprocess leaked, and the next resume of that session waited out the full 5-minute #403 defer ceiling before spawning anyway. The stream tap now emits a `turn_aborted` signal when a turn's `result` arrives without its `Stop` hook. It carries the last background-task set seen on the stream, and the reaper keeps or reaps on that (without reconciling crons).
