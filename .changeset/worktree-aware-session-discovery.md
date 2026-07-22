---
"@herdctl/core": minor
---

Make `getAgentSessions` worktree-aware so sessions that enter a native git worktree stay discoverable (#401)

`SessionDiscoveryService.getAgentSessions` discovered sessions from a single
`~/.claude/projects/{encoded-workingDir}` bucket. But Claude Code's native
git-worktree support (≥ 2.1.198) deliberately relocates a session's transcript to
the worktree's cwd bucket when the agent enters a worktree (worktrees live at
`<workingDir>/.claude/worktrees/<name>`). That bucket encodes to a *different*
directory, so a session that entered a worktree silently dropped out of
discovery/attribution even though its transcript was intact — making the chat
render empty downstream (e.g. in Paddock).

Discovery now unions the agent's own bucket with every `~/.claude/projects/*`
bucket whose decoded path is a strict descendant of the working directory (covers
`.claude/worktrees/*` and any subdir the agent `cd`s into). The union is deduped
by session id, re-sorted mtime-descending, and the top-N `limit` enrichment is
applied across the whole set. Attribution (keyed on session id) still gates which
sessions map to the agent, so over-included buckets contribute nothing spurious;
per-bucket listings reuse the mtime-cache to bound the extra `readdir` cost. The
Docker path (flat host `docker-sessions/` dir) is unchanged.

This follows Claude Code's model rather than fighting it — the resumed session is
intentionally left in its worktree bucket, not pinned back to the checkout.
