---
"@herdctl/core": minor
---

perf(state): make the attribution index incremental

Building the session attribution index read and YAML-parsed **every** job record
in `.herdctl/jobs/` on each build. For a long-running fleet that accumulates
thousands of jobs, that re-parse (repeated every time the per-listing attribution
cache expires) is the dominant cost of listing sessions.

Job records are effectively immutable except for a small tail — a job gains its
`session_id` and a terminal status when it finishes — so a new `AttributionIndexBuilder`
keeps a per-file cache keyed on mtime and re-parses only files that are new or
whose mtime changed. Each rebuild becomes O(jobs) cheap `stat`s plus O(changed)
parses instead of O(jobs) reads+parses. `SessionDiscoveryService` holds one
builder for its lifetime, so post-TTL refreshes are cheap. The standalone
`buildAttributionIndex` (full build) is unchanged for one-shot callers.

Measured on a real ~600-job state dir: a warm rebuild (nothing changed) dropped
from ~350 ms to ~10 ms.
