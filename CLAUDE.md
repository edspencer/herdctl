# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## LIVE PROJECT - Follow Semver

We are a live project. Breaking changes require a major version bump.

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
