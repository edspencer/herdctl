---
"@herdctl/core": patch
---

Fix job streaming events during schedule execution.

Added `onJobCreated` callback to `RunnerOptionsWithCallbacks` so the job ID is available before execution starts. Previously, the job ID was only set after `executor.execute()` returned, which meant `job:output` streaming events couldn't be emitted during execution.

Now the schedule executor receives the job ID via callback as soon as the job is created, enabling real-time streaming of job output events throughout execution.
