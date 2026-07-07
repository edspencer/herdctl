---
"@herdctl/core": minor
---

Add session forking to `trigger()`. Passing `fork: <sourceSessionId>` in `TriggerOptions`
runs a turn that resumes the source session's transcript as context but writes all new
turns to a brand-new session id (via Claude Code's `--fork-session`), leaving the source
untouched — letting a caller branch an existing conversation into independent children.

The runner already understood `RunnerOptions.fork`, but nothing on the public API passed
it, and the CLI runtime mis-handled it: it appended `--fork-session` yet still watched the
*resumed source* file, so it reported the parent's session id and missed the child's turns.
Now `trigger()`/`JobExecutor` thread `fork` (and optional `forkedFrom` lineage) through,
seed the resume target from the fork source (skipping agent-level session fallback), and the
CLI runtime waits for the newly-created fork file and reports its id — matching the SDK
runtime. Forks retry as a plain fresh session if the source is gone.
