---
"@herdctl/core": minor
---

perf(state): make `listJobs` skip work it throws away

`listJobs` read and Zod-validated every `job-*.yaml` sequentially and only then
applied `filter.agent`, so listing one agent's jobs on a 1,996-record directory
spent ~1.2s parsing 1,996 records to return 463 of them. `limit` was applied to
the finished result, so paging saved nothing.

Filtering, sorting and pagination now run against an incremental, mtime-keyed
index of each job file's `agent`/`status`/`started_at` (the same approach
`AttributionIndexBuilder` already used for session attribution), and only the
records actually returned are read and parsed in full. Measured on a 1,996-record,
46.6 MB jobs directory, warm:

| call | before | after |
| --- | --- | --- |
| `listJobs(dir, { agent })` | 1127 ms | 141 ms |
| `listJobs(dir, { agent, limit: 50 })` | 1139 ms | 31 ms |
| `listJobs(dir, { limit: 1 })` | 1364 ms | 31 ms |
| `listJobs(dir)` | 1407 ms | 1094 ms |

The index costs ~2 MB for 1,996 records and is validated against file mtime and
size on every call, so results stay correct without explicit invalidation. Full
job records are deliberately not cached — records returned to callers are still
freshly parsed on every call, exactly as before.

Additions (all backwards compatible):

- `ListJobsFilter` gains `limit` and `offset`. Prefer these over slicing the
  result: only the returned page is read and parsed.
- `ListJobsResult` gains `total`, the match count before `limit`/`offset`.
- `JobManager.getJobs()` pushes `limit`/`offset` down instead of slicing.
- New `clearJobIndexCache(jobsDir?)` export, for tests and for releasing memory.
