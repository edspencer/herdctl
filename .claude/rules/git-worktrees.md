# Git Worktrees for Parallel Development

**Only use worktrees when explicitly asked to.** By default, work in the main repo directory with normal branch workflow.

## Layout

Worktrees live as a **sibling directory** of the repo, never nested inside it:

```
~/Code/
  herdctl/                    # main clone
  herdctl-worktrees/          # sibling directory for worktrees
    feature-web-auth/         # one worktree per feature branch
    fix-scheduler-bug/
```

Nesting worktrees inside the repo causes Node module resolution, ESLint config, and file watcher (EMFILE) problems. The sibling layout avoids all of these.

## Helper Script

```bash
./scripts/worktree.sh add feature/my-feature          # new branch from HEAD
./scripts/worktree.sh add fix/bug --from main          # new branch from main
./scripts/worktree.sh list                             # list all worktrees
./scripts/worktree.sh remove feature/my-feature        # remove worktree (keeps branch)
```

Each new worktree gets `pnpm install` automatically. Branch slashes are converted to dashes for directory names (e.g. `feature/foo` -> `feature-foo`).
