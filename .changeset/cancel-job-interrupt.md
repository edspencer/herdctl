---
"@herdctl/core": patch
---

Fix `cancelJob` so it actually interrupts a running job. Previously cancelling only
rewrote the job's status file to `cancelled` while the agent process kept running to
completion. `trigger()` now creates an `AbortController` per run and registers it by
job id; `cancelJob` aborts it, killing the CLI subprocess (or aborting the SDK query).
Aborted runs are finalized as `cancelled` rather than `failed`, and the SDK runtime now
honors `abortController` for one-shot execution.
