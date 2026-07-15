---
"@herdctl/core": patch
---

fix(session): don't reap a managed session out from under a background task's re-invocation

In session drive-mode, when an asynchronous background task (a `run_in_background`
Bash/Agent/Monitor) completed, the reaper closed the session synchronously on the
`background_tasks_changed → empty` signal — before the SDK's re-invocation turn (which
delivers the completed task's result) could produce output. The keeper appeared to
"stop" the instant its background work finished, never consuming the result (#368).
This is the asynchronous counterpart of #366/#367 (which covered only the synchronous
`SubagentStop` path).

The empty-task-set signal now arms a short grace reap instead of reaping immediately: a
following `activity` signal (the re-invocation) cancels it, while a genuine
fire-and-forget completion still reaps once the window elapses — so no session is leaked.
Grace defaults to 15s and is configurable via `SessionReaperOptions.reinvocationGraceMs`.
