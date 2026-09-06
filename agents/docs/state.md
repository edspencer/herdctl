---
last_checked_commit: 7c238e0
last_run: "2026-09-05T00:00:00Z"
docs_gaps_found: 6
branches_created: ["docs/auto-update-2026-02-21", "docs/auto-update-2026-03-01", "docs/auto-update-2026-03-05", "docs/auto-update-2026-03-07", "docs/auto-update-2026-03-13", "docs/auto-update-2026-06-30", "docs/auto-update-2026-07-10"]
status: completed
---

# Documentation Audit State

**Last Updated:** 2026-07-10

This document tracks the state of the documentation audit agent, enabling
incremental reviews that analyze only new commits since the last check.

---

## Current Position

| Metric | Value | Notes |
|--------|-------|-------|
| Last checked commit | 7c238e0 | chore(engineer): daily housekeeping |
| Last run | 2026-09-05T00:00:00Z | Manual invocation |
| Gaps found (last run) | 6 | CLI session ID minting, Web chat improvements, listJobs filtering API docs, includePartialMessages docs, What's New outdated (24 days) |
| Branches created | None (manual run) | Audit report generated, no branch created |

---

## Run History

| Date | Commits Analyzed | Gaps Found | Action | Branch |
|------|-----------------|------------|--------|--------|
| 2026-09-05 | 96 | 6 | audit-only | - |
| 2026-07-10 | 51 | 7 | created-branch | docs/auto-update-2026-07-10 |
| 2026-06-30 | 20 | 3 | created-branch | docs/auto-update-2026-06-30 |
| 2026-03-13 | 3 | 5 | created-branch | docs/auto-update-2026-03-13 |
| 2026-03-07 | 4 | 1 | created-branch | docs/auto-update-2026-03-07 |
| 2026-03-05 | 10 | 1 | created-branch | docs/auto-update-2026-03-05 |
| 2026-03-01 | 51 | 1 | created-branch | docs/auto-update-2026-03-01 |
| 2026-02-21 | 18 | 3 | created-branch | docs/auto-update-2026-02-21 |
| 2026-02-19 | 10 | 2 | created-branch | docs/audit-first-run |
| 2026-02-19 | 10 | 5 | updated-docs | docs/audit-first-run |
| 2026-02-19 | 10 | 4 | updated-docs | docs/audit-first-run |
| 2026-02-19 | 8 | 2 | updated-docs | docs/audit-first-run |

---

## Update Protocol

### At Audit Start
1. Read this file to get `last_checked_commit` from frontmatter
2. Run `git log --oneline <last_checked_commit>..origin/main` to find new commits
3. If no new commits, update `last_run` timestamp and exit early

### At Audit End
1. Update `last_checked_commit` to the latest commit on main that was analyzed
2. Update `last_run` with ISO timestamp
3. Update `docs_gaps_found` with count from this run
4. If a branch was created, append to `branches_created`
5. Update `status` to `completed` or `error`
6. Add entry to Run History table
