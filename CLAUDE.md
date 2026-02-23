# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## ⚠️ LIVE PROJECT - Follow Semver

We are now a live project, so it's important to follow semver properly. Breaking changes require a major version bump.

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
└── examples/           # Example configurations
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
| `docs/src/content/docs/architecture/` | Architecture documentation (14 pages) |
| `packages/core/src/fleet-manager/` | FleetManager orchestration layer |
| `packages/core/src/config/` | Configuration parsing and validation |
| `packages/core/src/scheduler/` | Job scheduling |
| `packages/core/src/state/` | State persistence (.herdctl/) |
| `packages/core/src/utils/logger.ts` | Centralized logger (`createLogger`) |
| `packages/web/DESIGN_SYSTEM.md` | Web UI visual design system (colors, typography, components) |

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

### Diagrams

We use two diagramming tools at different quality tiers:

**Mermaid** — for inline diagrams in documentation pages. Rendered at build time via `rehype-mermaid` (configured in `docs/astro.config.mjs` with `img-svg` strategy and dark mode). Use standard ` ```mermaid ` code blocks in markdown. Good for flowcharts, sequence diagrams, and simple architecture diagrams. Note: Mermaid diagrams don't render in `astro dev` mode — use `pnpm dev` (which runs `astro build && astro preview`) to see them.

**D2** — for high-quality, professional diagrams where Mermaid's rendering isn't good enough (complex hierarchies, nested containers, landing page hero diagrams). D2 produces significantly better visual output for nested/containment diagrams.

#### D2 Workflow

Prerequisites: `brew install d2`

1. Source files live in `docs/d2-spike/` (`.d2` extension)
2. Render to SVG and PNG:
   ```bash
   cd docs/d2-spike
   d2 --pad=20 my-diagram.d2 my-diagram.svg
   d2 --pad=20 my-diagram.d2 my-diagram.png
   ```
3. Always use `--pad=20` for tight, professional framing (default padding is too generous)
4. Embed the rendered SVG/PNG in docs pages via `<img>` tags or markdown image syntax

#### Diagram Color Palette

Colors are derived from the herdctl logo blue (`#326CE5`). All diagrams use these colors consistently.

**Primary colors** — for containers and structural hierarchy:

| Role | Fill | Stroke | Text | Usage |
|------|------|--------|------|-------|
| Top-level container | `#1e3a5f` | `#142842` | `#ffffff` | Super fleets, outermost containers |
| Major components | `#326CE5` | `#2857b8` | `#ffffff` | Sub-fleets, core modules (logo blue) |
| Secondary groupings | `#2a9d8f` | `#21867a` | `#ffffff` | Team groups, processing components |

**Secondary colors** — for leaf nodes, agents, and individual elements. Each agent should get its own distinct color to aid visual identification. For non-agent diagrams, pick from this set for variety:

| Name | Fill | Stroke | Text |
|------|------|--------|------|
| White | `#f8fafc` | `#cbd5e1` | `#1e293b` |
| Slate | `#94a3b8` | `#64748b` | `#0f172a` |
| Light blue | `#93c5fd` | `#60a5fa` | `#1e293b` |
| Sky | `#38bdf8` | `#0ea5e9` | `#0c4a6e` |
| Peach | `#fdba74` | `#f59e0b` | `#451a03` |
| Amber | `#fbbf24` | `#d97706` | `#451a03` |
| Coral | `#f87171` | `#ef4444` | `#ffffff` |
| Rose | `#fda4af` | `#fb7185` | `#4c0519` |
| Lavender | `#c4b5fd` | `#a78bfa` | `#2e1065` |
| Mint | `#6ee7b7` | `#34d399` | `#064e3b` |
| Sand | `#d6d3d1` | `#a8a29e` | `#1c1917` |
| Warm gray | `#78716c` | `#57534e` | `#ffffff` |
| Cyan | `#22d3ee` | `#06b6d4` | `#083344` |
| Lime | `#a3e635` | `#84cc16` | `#1a2e05` |
| Orange | `#fb923c` | `#f97316` | `#431407` |
| Steel | `#475569` | `#334155` | `#ffffff` |

**Guidelines:**
- In agent diagrams, give each agent a unique secondary color so they're visually distinct.
- In non-agent diagrams (architecture, flows, state machines), pick secondary colors for variety and contrast rather than using a single color for all leaf nodes.
- Text color varies per secondary color (some are light-on-dark, some dark-on-light) — always use the text color from the table above.

#### Reference Implementation

See `docs/d2-spike/fleet-composition-subteams.d2` for the canonical example using the full palette with individually-colored agents.


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