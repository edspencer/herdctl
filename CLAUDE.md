# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## ⚠️ PRE-MVP PROJECT - NO BACKWARDS COMPATIBILITY

**This is a pre-MVP project. The following rules MUST be followed:**

1. **NO backwards compatibility** - Do not maintain old APIs, events, or interfaces
2. **NO deprecation patterns** - Do not mark things as `@deprecated` and keep them around
3. **NO legacy support** - Remove old code entirely rather than keeping it alongside new code
4. **NO migration paths** - Just update the code directly; there are no external consumers yet
5. **Breaking changes are fine** - We have no users to break yet

When refactoring or updating APIs:
- Delete the old code completely
- Update all internal usages to the new pattern
- Do not emit both old and new events "for compatibility"
- Do not keep old error classes as subclasses of new ones
- Do not add `@deprecated` JSDoc tags - just remove the code

This directive overrides any instinct to be "safe" with backwards compatibility. We are building fast and will establish stable APIs only when approaching MVP release.

---

## ⚠️ CRITICAL: Git Workflow - Use Branches, Not Main

**NEVER work directly on the `main` branch** unless explicitly instructed AND already in-flight on a task.

When starting new work:
1. **First action**: Create a feature branch (`git checkout -b feature/description`)
2. Do all work on the feature branch
3. Push the branch and create a PR
4. Merge to main only after review

The only exception is if you're explicitly told to work on main AND you're already mid-task. Even then, prefer branches.

---

## ⚠️ CRITICAL: Always Create Changesets

**ALWAYS create a changeset when modifying any npm package code.** Without a changeset, changes won't be released to npm, making the work pointless.

After making changes to `packages/core/`, `packages/cli/`, or `packages/discord/`:

```bash
pnpm changeset
```

Then select:
- Which packages were modified
- The semver bump type (major/minor/patch)
- A description of the change

**Commit the changeset file (`.changeset/*.md`) with your code.**

If you forget the changeset, the PR will be incomplete and the release pipeline won't publish new versions.

---

## Project Overview

**herdctl** is a TypeScript-based system for managing fleets of autonomous Claude Code agents. It provides:
- `@herdctl/core` - Core library for programmatic fleet management
- `herdctl` - CLI for command-line fleet operations
- `@herdctl/web` - Web dashboard (future)
- `@herdctl/discord` - Discord connector (future)

## Architecture Principles

1. **Library-First Design**: All business logic lives in `@herdctl/core`
2. **Thin Clients**: CLI, Web, and API are thin wrappers around FleetManager
3. **Single Process Model**: Fleet runs in one process, agents are child processes

## Repository Structure

```
herdctl/
├── packages/
│   ├── core/           # @herdctl/core - FleetManager, config, scheduler, state
│   ├── cli/            # herdctl CLI - thin wrapper on FleetManager
│   ├── web/            # @herdctl/web - Next.js dashboard (future)
│   └── discord/        # @herdctl/discord - Discord bot (future)
├── docs/               # Documentation site (Astro/Starlight) → herdctl.dev
├── examples/           # Example configurations
├── tasks/              # PRD drafts and task tracking
├── SPEC.md             # Full specification document
└── plan.md             # Implementation plan and PRD tracking
```

## Development Commands

```bash
pnpm install            # Install dependencies
pnpm build              # Build all packages
pnpm test               # Run all tests
pnpm typecheck          # TypeScript type checking
pnpm dev                # Development mode (watch)
```

## Code Conventions

### TypeScript
- Use strict TypeScript with explicit types
- Prefer `interface` over `type` for object shapes
- Use Zod for runtime validation schemas
- Export types from package entry points

### Testing
- Tests live in `__tests__/` directories adjacent to source
- Use Vitest for unit tests
- Coverage thresholds: 85% lines/functions/statements, 65% branches
- Mock external dependencies (SDK, file system, GitHub API)

### Error Handling
- Use typed error classes extending `FleetManagerError`
- Provide type guards for error discrimination
- Include actionable error messages

## Release Workflow

We use **changesets** for version management and **OIDC trusted publishing** for npm releases.

### Creating Changesets

When making changes that should be released:

```bash
pnpm changeset
```

This creates a changeset file describing the change. Commit it with your code.

### Changeset Types
- `major` - Breaking changes
- `minor` - New features (backwards compatible)
- `patch` - Bug fixes

### Release Process (Automated)

1. PRs with changesets are merged to main
2. GitHub Action creates a "Version Packages" PR
3. When that PR is merged, packages are published to npm via OIDC

### OIDC Trusted Publishing

As of December 2025, we use OIDC instead of npm tokens:
- No long-lived secrets needed
- GitHub Actions authenticates directly with npm
- Provenance attestations are automatic

## Key Files to Know

| File | Purpose |
|------|---------|
| `SPEC.md` | Full project specification |
| `plan.md` | Implementation plan, PRD tracking |
| `packages/core/src/fleet-manager/` | FleetManager orchestration layer |
| `packages/core/src/config/` | Configuration parsing and validation |
| `packages/core/src/scheduler/` | Job scheduling |
| `packages/core/src/state/` | State persistence (.herdctl/) |

## Quality Gates

Before merging:
- `pnpm typecheck` passes
- `pnpm test` passes with coverage thresholds
- `pnpm build` succeeds

## Documentation

Documentation lives in `docs/` and deploys to herdctl.dev. When adding features:
1. Update relevant docs in `docs/src/content/docs/`
2. Run `pnpm build` in docs/ to verify
3. Docs deploy automatically on merge to main


DO NOT use `git add -A` or `git add .` to stage changes. Stage just the files you definitely want to commit.