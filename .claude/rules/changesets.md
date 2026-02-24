---
globs: packages/**
---

# Changesets and Release Workflow

**ALWAYS create a changeset when modifying any npm package code.** Without a changeset, changes won't be released to npm, making the work pointless.

## Creating a Changeset

After making changes to `packages/core/`, `packages/cli/`, `packages/web/`, `packages/chat/`, `packages/discord/`, or `packages/slack/`:

```bash
pnpm changeset
```

Then select:
- Which packages were modified
- The semver bump type: `major` (breaking), `minor` (new feature), `patch` (bug fix)
- A description of the change

**Commit the changeset file (`.changeset/*.md`) with your code.**

If you forget the changeset, the PR will be incomplete and the release pipeline won't publish new versions.

## Release Process (Automated)

We use **changesets** for version management and **OIDC trusted publishing** for npm releases.

1. PRs with changesets are merged to main
2. GitHub Action creates a "Version Packages" PR
3. When that PR is merged, packages are published to npm via OIDC

OIDC means no long-lived npm tokens are needed. GitHub Actions authenticates directly with npm and provenance attestations are automatic.
