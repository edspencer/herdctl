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

After making changes to `packages/core/`, `packages/cli/`, `packages/web/`, `packages/chat/`, `packages/discord/`, or `packages/slack/`:

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
- `@herdctl/web` - Web dashboard (Vite + React + Tailwind)
- `@herdctl/discord` - Discord connector
- `@herdctl/slack` - Slack connector
- `@herdctl/chat` - Shared chat infrastructure

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
│   ├── web/            # @herdctl/web - Vite+React dashboard (see web/DESIGN_SYSTEM.md)
│   ├── chat/           # @herdctl/chat - Shared chat infrastructure
│   ├── discord/        # @herdctl/discord - Discord bot
│   └── slack/          # @herdctl/slack - Slack bot
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

### Logging
- **NEVER use raw `console.log/warn/error/debug`** for runtime logging
- Use `createLogger(prefix)` from `packages/core/src/utils/logger.ts` (exported from `@herdctl/core`)
- Logger respects `HERDCTL_LOG_LEVEL` env var (`debug`/`info`/`warn`/`error`, default: `info`)
- Each method accepts an optional `data` parameter: `logger.info("message", { key: "value" })`
- In external packages (discord, slack), import via `import { createLogger } from "@herdctl/core"`
- In core, use relative imports: `import { createLogger } from "../utils/logger.js"`
- Choose appropriate log levels: `debug` for internal details, `info` for significant events, `warn` for recoverable issues, `error` for failures

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
| `packages/core/src/utils/logger.ts` | Centralized logger (`createLogger`) |
| `packages/web/DESIGN_SYSTEM.md` | Web UI visual design system (colors, typography, components) |
| `tasks/web-ui-implementation-plan.md` | Web UI phased implementation plan |

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

---

## ⚠️ CRITICAL: Web UI Design System

**When working on `packages/web/` (the @herdctl/web dashboard), you MUST read and follow `packages/web/DESIGN_SYSTEM.md` before writing any UI code.**

This design system defines colors, typography, spacing, component patterns, animation, and dark mode implementation. Every UI component must use `herd-*` color tokens (never raw hex values), follow the canonical component patterns, and pass the checklist at the bottom of the document.

Do not improvise visual design. Do not use default Tailwind colors. Do not use Inter/Roboto/Arial. The design system is the single source of truth for how the web app looks.

---

## ⚠️ CRITICAL: Docker Network Requirements

**NEVER suggest `network: none` for Docker containers running Claude Code agents.**

Claude Code agents MUST have network access to communicate with Anthropic's APIs. Without network access, the agent cannot function at all. The available network modes are:

- `bridge` (default) - Standard Docker networking with NAT. Agent can reach the internet including Anthropic APIs.
- `host` - Share host's network namespace. Use only when specifically needed (e.g., for SSH access to local services).

**`network: none` will completely break the agent** - it won't be able to call Claude's APIs and will fail immediately.

When discussing Docker security, emphasize that `bridge` mode still provides network namespace isolation (separate network stack from host), just with outbound internet access enabled.

---

## Git Worktrees for Parallel Development

This repo supports Git worktrees for running multiple Claude Code sessions in parallel. **Only use worktrees when explicitly asked to.** By default, work in the main repo directory with normal branch workflow.

### Layout

Worktrees live as a **sibling directory** of the repo, never nested inside it:

```
~/Code/
  herdctl/                    # main clone
  herdctl-worktrees/          # sibling directory for worktrees
    feature-web-auth/         # one worktree per feature branch
    fix-scheduler-bug/
```

Nesting worktrees inside the repo causes Node module resolution, ESLint config, and file watcher (EMFILE) problems. The sibling layout avoids all of these.

### Helper Script

```bash
./scripts/worktree.sh add feature/my-feature          # new branch from HEAD
./scripts/worktree.sh add fix/bug --from main          # new branch from main
./scripts/worktree.sh list                             # list all worktrees
./scripts/worktree.sh remove feature/my-feature        # remove worktree (keeps branch)
```

Each new worktree gets `pnpm install` automatically. Branch slashes are converted to dashes for directory names (e.g. `feature/foo` → `feature-foo`).