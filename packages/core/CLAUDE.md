# @herdctl/core — Package Guide

The core library. **ALL business logic lives here.** CLI, web, discord, and slack are thin wrappers that import from `@herdctl/core`.

## Module Overview

| Module | Purpose |
|--------|---------|
| `fleet-manager/` | Orchestration layer — job control, scheduling, config reload, log streaming, events |
| `config/` | YAML parsing, schema validation, interpolation, fleet composition merging |
| `scheduler/` | Cron and interval scheduling, schedule state persistence |
| `state/` | `.herdctl/` directory — sessions, job metadata, job output, fleet state |
| `runner/` | Claude SDK adapter, job execution, message processing, MCP file sender |
| `work-sources/` | Pluggable work source adapters (GitHub Issues, etc.) with registry |
| `distribution/` | Agent discovery, installation, repository fetching, source specifiers |
| `hooks/` | Execution hooks system — pre/post hook runners |
| `utils/` | Logger, shared helpers |

## Key Conventions

- **Logging**: Use `createLogger("Prefix")` — never raw `console.*`. Within core, use relative imports: `import { createLogger } from "../utils/logger.js"`.
- **Errors**: Extend `FleetManagerError` from `fleet-manager/errors.ts`. Always include actionable messages.
- **Validation**: Use Zod schemas for all external input (config files, CLI args, API payloads).
- **Imports**: Always use relative imports with `.js` extensions within this package.
- **Tests**: Place in `__tests__/` directories adjacent to source files. Run with `pnpm test`.
- **Exports**: All public API surfaces are re-exported through `src/index.ts`.

## Coverage Thresholds (vitest.config.ts)

| Metric | Threshold |
|--------|-----------|
| Lines | 74% |
| Functions | 75% |
| Branches | 65% |
| Statements | 74% |

## Commands

```bash
pnpm build       # Compile TypeScript to dist/
pnpm test        # Run tests with coverage
pnpm typecheck   # Type-check without emitting
pnpm lint        # Biome linter
```
