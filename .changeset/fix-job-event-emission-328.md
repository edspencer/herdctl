---
"@herdctl/core": minor
---

Fix job lifecycle event ordering and add `job:output` on manual triggers (#328)

`job:created` is now emitted the moment the job record is created (status
`pending`), before any `job:output` and before the run completes — on both the
manual `trigger()` path and the scheduled path. Previously it was emitted only
*after* `JobExecutor.execute()` resolved, so consumers saw `job:created` fire
after the job had already run (and, on the scheduled path, after its own
`job:output` events).

Manual `trigger()` now also emits `job:output` events as the agent streams,
matching the scheduled path. Previously manual triggers emitted zero
`job:output`.

This aligns the observable event stream with the documented contract
("`job:created` … status will be 'pending' at this point") and restores the
`created → output → completed` ordering. The SDK-message → `job:output` payload
mapping is now shared between both paths, so payloads are identical. This is a
public event-contract change, hence the minor bump.
