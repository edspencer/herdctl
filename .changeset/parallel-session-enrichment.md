---
"@herdctl/core": patch
---

perf(state): enrich sessions with bounded concurrency in getAgentSessions

`getAgentSessions` enriched each session one at a time in a sequential
`for … await` loop, so its latency grew linearly with the session count even
though the per-session work (reading a transcript head for the sidechain check,
plus any uncached name/preview) is independent and I/O-bound. It now runs that
work through a bounded-concurrency map (cap 16), overlapping the I/O while
capping open file descriptors. Results are collected in input order, so the
mtime-descending sort is unchanged. Adds a small, tested `mapWithConcurrency`
helper.
