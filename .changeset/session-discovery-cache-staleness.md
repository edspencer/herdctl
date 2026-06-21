---
"@herdctl/core": minor
---

Make session discovery reflect newly-created sessions immediately, and add a way to force-refresh.

`SessionDiscoveryService` caches each working directory's discovered session
list for the cache TTL (default ~30s). Previously a brand-new session transcript
file appearing in `~/.claude/projects/<encoded-cwd>/` could stay invisible to
`getAgentSessions` for up to the full TTL, with no way to invalidate the internal
discovery service that `FleetManager` owns.

Two changes fix this:

- **mtime-aware cache (auto-invalidation).** The directory listing cache now
  records the transcript directory's own mtime when an entry is built. Before
  serving a cached listing it cheaply `stat`s the directory and rebuilds the
  entry when the mtime moved — adding or removing a session file bumps the
  directory mtime, so a newly-created session appears immediately without callers
  doing anything. The TTL remains as a secondary bound (and still covers appends
  to an existing transcript, which do not bump the directory mtime). The
  "don't cache a missing directory" behavior is preserved, and a transiently
  unreadable directory falls back to the TTL rather than dropping the cache.

- **Explicit invalidation.** New public `FleetManager.invalidateSessions(name)`
  resolves the agent's working directory from config and clears that directory's
  cached listing (and the shared attribution index) on the internal discovery
  service, so the next `getAgentSessions` rebuilds from disk. It throws
  `InvalidStateError` before `initialize()` and `AgentNotFoundError` for unknown
  agents, matching the other session methods. Backed by a new
  `SessionDiscoveryService.invalidateWorkingDirectory(workingDirectory, options?)`
  primitive. This lets callers force a fresh listing regardless of mtime
  granularity (e.g. after each chat turn).
