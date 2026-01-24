# Technology Stack

**Analysis Date:** 2026-01-24

## Languages

**Primary:**
- TypeScript 5 - All source code, strict mode enabled
- JavaScript - Build output, runtime execution

**Secondary:**
- YAML - Configuration files (herdctl.yaml, agent configs)
- Shell - CLI entry point scripts

## Runtime

**Environment:**
- Node.js >=18 (development: v20 per .nvmrc, CI uses v22)

**Package Manager:**
- pnpm 9.0.0 (monorepo workspace manager)
- Lockfile: pnpm-lock.yaml (present)
- OIDC trusted publishing enabled for npm (see release workflow)

## Frameworks & Core Libraries

**SDK Integration:**
- @anthropic-ai/claude-agent-sdk ^0.1.0 - Streaming agent execution API
  - Used in `packages/core/src/runner/job-executor.ts` and schedule executor
  - Imported as `query` function for SDKQueryFunction type
  - Handles all Claude Code agent execution and message streaming

**Configuration & Validation:**
- zod ^3.22.0 - Runtime schema validation
  - Used for: herdctl.yaml parsing, agent config validation, GitHub work source config
  - Schemas in `packages/core/src/config/schema.ts`

**Data Format Parsing:**
- yaml ^2.3.0 - YAML file parsing and generation
  - Used in config loading and state persistence
  - In packages: core (config), discord (config handling)

**Scheduling:**
- cron-parser ^4.9.0 - Cron expression parsing
  - Used in `packages/core/src/scheduler/` for schedule evaluation
  - Parses schedule.type: "cron" expressions

**CLI Framework:**
- commander ^12 - Command-line argument parsing
  - Used in `packages/cli/` for herdctl CLI

**Discord Integration:**
- discord.js ^14.16.0 - Discord bot client
- @discordjs/rest ^2.6.0 - Discord REST API client
  - Used in `packages/discord/` for per-agent bot architecture

**Inquirer/Prompts:**
- @inquirer/prompts ^8.2.0 - Interactive CLI prompts
  - Used in CLI for user input

## Testing Framework

**Runner:**
- vitest ^4.0.17 - Unit test runner and assertion library
- @vitest/coverage-v8 ^4.0.17 - V8 coverage provider

**Configuration:**
- vitest.config.ts in each package
- Coverage thresholds: 85% lines/functions/statements, 65% branches
- Test location pattern: `src/**/__tests__/**/*.test.ts`

## Build & Development

**Monorepo Orchestration:**
- turbo ^2 - Build system and task orchestrator
  - Orchestrates: build, dev, test, lint, typecheck across packages
  - turbo.json defines task dependencies

**TypeScript:**
- typescript ^5 - Language compiler and type checker
- Strict mode enabled in root tsconfig.json
- Targets: ES2022, module: NodeNext, for Node.js environments

**Module System:**
- ESM (ES modules) - All packages configured with "type": "module"
- NodeNext module resolution for proper package boundary handling

## Package Structure

**Workspace Packages:**
- `packages/core/` - @herdctl/core (main library)
- `packages/cli/` - herdctl (command-line tool)
- `packages/discord/` - @herdctl/discord (Discord connector)
- `docs/` - Documentation site

**Workspace Config:**
- pnpm-workspace.yaml defines: packages/*, docs/

## State & Storage

**Persistence:**
- Local filesystem only (.herdctl/ directory)
  - Format: JSON, YAML, JSONL files
  - Managed by `packages/core/src/state/`
  - No database dependency

## Configuration

**Environment Variables Required:**
- `ANTHROPIC_API_KEY` - Claude SDK authentication (required)
- `GITHUB_TOKEN` - GitHub API access for work source (required for GitHub integration)
- Per-agent Discord bot tokens via environment (for Discord integration)

**Configuration Files:**
- herdctl.yaml - Root fleet configuration (mandatory)
- agent-*.yaml - Individual agent configurations (per agent)
- Both validated against Zod schemas in `packages/core/src/config/schema.ts`

**Runtime Config:**
- Environment variable interpolation in YAML via `${VAR_NAME}` syntax
- Validation on load, parsed by `packages/core/src/config/loader.ts`

## Platform Requirements

**Development:**
- Node.js >=18
- pnpm >=9.0.0
- TypeScript 5 (via devDependencies)
- Git for repository operations (changesets, GitHub integration)

**Production:**
- Node.js >=18 (runtime only, not dev tools needed)
- Environment variables: ANTHROPIC_API_KEY (required), GITHUB_TOKEN (optional)
- Disk space for .herdctl/ state directory
- Network access for Claude API and optional GitHub API

**CI/CD:**
- GitHub Actions (see .github/workflows/)
- Node.js 22 for CI builds
- OIDC for npm trusted publishing (no long-lived secrets)

## Output Artifacts

**Distributed Packages (npm):**
- @herdctl/core - Main library (dist/ folder)
- herdctl - CLI tool (dist/ + bin/ folders)
- @herdctl/discord - Discord integration (dist/ folder)
- Source maps included in dist/
- Declaration files (.d.ts) generated via TypeScript compiler

**Local Build Output:**
- dist/ directories in each package
- ESM JavaScript with source maps
- TypeScript declaration files

---

*Stack analysis: 2026-01-24*
