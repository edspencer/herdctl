---
"@herdctl/core": minor
---

feat(state): filter `listJobs` by a SET of agents, and page the dashboard's `/api/jobs` inside it

Issue `#415` made `listJobs` index-backed, but only for callers that can express
what they want as a filter. A caller that needs several agents' jobs had no way to
say so — `ListJobsFilter` had `agent` (exactly one) and nothing else — so it had
to list the directory unfiltered and filter in JS, which reads, parses and
Zod-validates every record in the directory to return a handful.

`ListJobsFilter` gains **`agents?: string[]`**. It combines with `agent` as an
AND, and an empty array matches nothing (rather than being treated as "no
filter", which would silently turn "I have no agents to look up" back into a
full directory scan). Measured on a 2,016-record, 47.4 MB jobs directory, warm:

| call | time |
| --- | --- |
| `listJobs(dir)` + JS filter + `.slice(200)` | 1,935–2,095 ms |
| `listJobs(dir, { agents, limit: 200 })` | 125–146 ms |

**~15×**, and the results are identical — the returned ids and their order were
diffed against the JS-filtering shape on that real corpus, and in a unit test
that interleaves four agents across time so any per-agent grouping would
reorder.

Note that `agents` alone is not enough to get this win. With `limit` undefined
the index retains every match, so callers must pass **both** `agents` and
`limit`; the `listJobs` docs now say so, with the numbers.

**`packages/web`'s `/api/jobs` now pages inside `listJobs`** instead of asking
for everything and slicing. It is a paginated, user-facing endpoint that
returns at most 100 records, and it was hydrating the entire jobs directory on
every request — the exact pathology #415 set out to remove, in our own
dashboard. `total` now comes from `ListJobsResult.total` (the pre-pagination
match count, added by #415 for precisely this) rather than from the length of a
list that is no longer the full result.

Unblocks [paddock#535](https://github.com/edspencer/paddock/issues/535), whose
`listRunsForAgents` is the same bug downstream.

The remaining unfiltered callers named in #418 are deliberately left alone here:
`applyRetention` genuinely wants every record, and deleting the caller-less
public `buildAttributionIndex` is a breaking change that deserves its own
decision rather than riding along with a perf fix.
