# Herdctl Implementation Plan

> This document outlines the full implementation plan for herdctl, including bootstrapping and PRD-driven development via ralph-tui.

**Spec Document**: [herdctl.md](./herdctl.md)
**Primary Domain**: herdctl.dev

---

## npm Package Strategy

We use both scoped and unscoped packages:

| Package | Name | Install Command | Purpose |
|---------|------|-----------------|---------|
| CLI | `herdctl` | `pnpm add -g herdctl` | Command-line tool |
| Core Library | `@herdctl/core` | `pnpm add @herdctl/core` | Programmatic API |
| Web Dashboard | `@herdctl/web` | `pnpm add @herdctl/web` | Dashboard + HTTP API |
| Discord | `@herdctl/discord` | `pnpm add @herdctl/discord` | Discord connector |

**Rationale**: This follows the pattern used by TypeScript, Turborepo, ESLint, and other major projects:
- Unscoped `herdctl` for the primary CLI (what most users install)
- Scoped `@herdctl/*` for library packages (for developers integrating programmatically)

**npm Organization**: `@herdctl` (claimed and secured)

---

## Phase 0: Bootstrap (Manual)

Claude will create the GitHub repo and scaffold directly (not via ralph-tui).

### Repository Creation

```bash
gh repo create edspencer/herdctl --private --description "Autonomous Agent Fleet Management for Claude Code"
```

### Files to Create

```
herdctl/
├── .github/
│   └── CODEOWNERS
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   └── index.ts              # Export placeholder
│   │   ├── package.json              # @herdctl/core
│   │   └── tsconfig.json
│   ├── cli/
│   │   ├── src/
│   │   │   └── index.ts              # Placeholder
│   │   ├── bin/
│   │   │   └── herdctl.js            # CLI entry
│   │   ├── package.json              # herdctl
│   │   └── tsconfig.json
│   ├── web/
│   │   └── .gitkeep
│   └── discord/
│       └── .gitkeep
├── docs/
│   └── .gitkeep                      # Astro site (later)
├── examples/
│   ├── simple/
│   │   ├── herdctl.yaml
│   │   └── agents/
│   │       └── example-agent.yaml
│   └── multi-project/
│       └── .gitkeep
├── package.json                      # Root workspace
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.json                     # Base config
├── .gitignore
├── .nvmrc
├── README.md
└── SPEC.md                           # Copy of herdctl.md
```

### Key File Contents

**package.json (root)**:
```json
{
  "name": "herdctl-monorepo",
  "private": true,
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "test": "turbo test",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5"
  },
  "packageManager": "pnpm@9.0.0"
}
```

**pnpm-workspace.yaml**:
```yaml
packages:
  - "packages/*"
  - "docs"
```

**turbo.json**:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "test": {},
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

**packages/core/package.json**:
```json
{
  "name": "@herdctl/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "yaml": "^2.3.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "vitest": "^1"
  }
}
```

**packages/cli/package.json**:
```json
{
  "name": "herdctl",
  "version": "0.0.1",
  "description": "Autonomous Agent Fleet Management for Claude Code",
  "license": "UNLICENSED",
  "type": "module",
  "bin": {
    "herdctl": "./bin/herdctl.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@herdctl/core": "workspace:*",
    "commander": "^12"
  },
  "devDependencies": {
    "typescript": "^5"
  },
  "homepage": "https://herdctl.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/edspencer/herdctl"
  }
}
```

---

## Phase 1-8: PRD-Driven Development (via ralph-tui)

Each phase is a separate ralph-tui session with its own PRD.

> **Documentation-First Approach**: PRD 3 establishes the documentation site early. All subsequent PRDs include a mandatory documentation review step to keep docs in sync with implementation.

### PRD 1: herdctl-core-config ✓

**Scope**: Config parsing for fleet and agent YAML files

**Status**: Complete

**User Stories**:
1. Parse herdctl.yaml fleet configuration
2. Parse agent YAML files with all fields
3. Validate config with Zod schemas
4. Merge defaults with agent-specific config
5. Support environment variable interpolation (${VAR})

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`

**Dependencies**: None (first PRD after bootstrap)

---

### PRD 2: herdctl-core-state ✓

**Scope**: State management via .herdctl/ directory

**Status**: Complete

**User Stories**:
1. Create .herdctl/ directory structure
2. Read/write state.yaml (fleet state)
3. Read/write job YAML files (metadata)
4. Append to job JSONL files (streaming output)
5. Atomic writes to prevent corruption

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`

**Dependencies**: herdctl-core-config (needs config types)

---

### PRD 3: herdctl-docs

**Scope**: Documentation site foundation + initial content

This PRD establishes the documentation site early so all subsequent work can update docs incrementally. It includes populating the site with everything known so far from PRDs 1-2 and the SPEC.md.

**User Stories**:
1. Initialize Astro with Starlight theme in `docs/`
2. Create landing page (index.astro) with project overview
3. Create documentation structure (sidebars, navigation)
4. **Audit existing repo documentation** (SPEC.md, README.md, plan.md, PRD files) and extract content
5. Create **Concepts** section covering: Agents, Schedules, Triggers, Jobs, Workspaces, Sessions
6. Create **Configuration Reference** documenting all config schemas from PRD 1:
   - Fleet configuration (herdctl.yaml)
   - Agent configuration
   - Environment variable interpolation
7. Create **State Management** reference documenting .herdctl/ structure from PRD 2
8. Create **Getting Started** guide (placeholder for when CLI exists)
9. Set up local dev server (`pnpm dev` in docs/)
10. Configure for Cloudflare Pages deployment (can deploy later)

**Quality Gates**:
- `pnpm build` succeeds in docs/
- Site renders correctly locally
- All concepts from SPEC.md are documented
- Config reference matches implemented schemas

**Dependencies**: herdctl-core-config, herdctl-core-state

---

### PRD 4: herdctl-core-runner

**Scope**: Agent runner wrapping Claude Agent SDK

**User Stories**:
1. Initialize SDK with agent config
2. Pass MCP servers from agent config
3. Pass allowed tools and permission mode
4. Stream output to job log (JSONL)
5. Capture session ID for resume/fork
6. Handle SDK errors gracefully
7. **Update documentation**: Add Runner section covering SDK integration, session management, output streaming

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`
- Documentation updated and builds successfully

**Dependencies**: herdctl-core-config, herdctl-core-state, herdctl-docs

---

### PRD 5: herdctl-core-github

**Scope**: GitHub Issues as work source

**User Stories**:
1. Query issues by label filter
2. Filter by exclude labels
3. Claim issue (add in-progress label, remove ready)
4. Complete issue (close, add comment, remove in-progress)
5. Handle GitHub API rate limits
6. Handle API errors gracefully
7. **Update documentation**: Add Work Sources section covering GitHub Issues configuration and workflow

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`
- Documentation updated and builds successfully

**Dependencies**: herdctl-core-config, herdctl-docs

---

### PRD 6: herdctl-core-scheduler ✓

**Scope**: Interval-based scheduler

**Status**: Complete

**User Stories**:
1. Parse interval config (5m, 1h, etc.)
2. Track last run time per schedule
3. Determine when next trigger is due
4. Trigger agent when interval elapsed
5. Respect max_concurrent limit
6. Handle schedule errors gracefully
7. **Update documentation**: Add Scheduling section covering interval configuration, trigger behavior, concurrency

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`
- Documentation updated and builds successfully

**Dependencies**: herdctl-core-config, herdctl-core-runner, herdctl-docs

---

### PRD 7: herdctl-fleet-manager ✓

**Scope**: FleetManager orchestration layer in @herdctl/core

**Status**: Complete (implementation done, test coverage needs improvement - see CI notes)

**User Stories**:
1. Create FleetManager class that wires together config, scheduler, state, runner, and work-sources
2. Implement lifecycle methods: `initialize()`, `start()`, `stop()`, `reload()`
3. Implement query methods: `getStatus()`, `getAgents()`, `getAgent()`, `getJobs()`, `getJob()`, `getSchedules()`
4. Implement action methods: `trigger()`, `cancelJob()`, `resumeJob()`, `forkJob()`, `enableSchedule()`, `disableSchedule()`
5. Extend EventEmitter for real-time updates (started, stopped, job:created, job:output, job:completed, etc.)
6. Implement log streaming utilities: `streamLogs()`, `streamJobOutput()`, `streamAgentLogs()`
7. Define specific error types: `FleetManagerError`, `AgentNotFoundError`, `JobNotFoundError`, etc.
8. **Update documentation**: Add FleetManager section covering programmatic usage, events, library integration

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`
- All interaction layers (CLI, Web, API) can use FleetManager without calling lower-level modules
- Documentation updated and builds successfully

**Dependencies**: All core modules (config, state, runner, work-sources, scheduler), herdctl-docs

---

### Library Documentation ✓

**Scope**: Comprehensive documentation for using @herdctl/core as a standalone library

**Status**: Complete

Added after PRD 7 to document the FleetManager API for library consumers. Includes:
- `docs/src/content/docs/library-reference/` - FleetManager, Events, Errors, JobManager API docs
- `docs/src/content/docs/guides/recipes.mdx` - Common patterns and examples
- `examples/quickstart/` - Minimal working example
- `examples/library-usage/` - Comprehensive API usage examples
- `examples/recipes/` - Production patterns (daemon, CI, Express/Fastify integration)

---

### PRD 8: herdctl-cli

**Scope**: Thin CLI wrapper on FleetManager

**Architecture Note**: The CLI is a **thin wrapper** that delegates all operations to FleetManager. It contains only input parsing (commander.js), output formatting, and calls to FleetManager methods. No business logic lives in the CLI package.

**User Stories**:
1. `herdctl start` - calls `FleetManager.start()`
2. `herdctl start <agent>` - calls `FleetManager.startAgent(name)`
3. `herdctl stop` - calls `FleetManager.stop()`
4. `herdctl stop <agent>` - calls `FleetManager.stopAgent(name)`
5. `herdctl status` - calls `FleetManager.getStatus()` and formats output
6. `herdctl status <agent>` - calls `FleetManager.getAgent(name)` and formats output
7. `herdctl logs` - subscribes to `FleetManager.streamLogs()` and formats output
8. `herdctl logs <agent>` - subscribes to `FleetManager.streamAgentLogs(name)` and formats output
9. `herdctl logs -f` - follow mode using FleetManager event streams
10. `herdctl trigger <agent>` - calls `FleetManager.trigger(name)`
11. `herdctl init` - scaffold new herdctl project
12. **Update documentation**: Complete CLI Reference with all commands, options, examples
13. **Update documentation**: Finalize Getting Started guide with full walkthrough

**Quality Gates**:
- `pnpm typecheck`
- `pnpm test`
- CLI contains NO business logic (all delegated to FleetManager)
- Manual test of each command
- Documentation updated and builds successfully
- Getting Started guide is complete and accurate

**Dependencies**: herdctl-fleet-manager, herdctl-docs

---

### PRD 9: herdctl-docs-deploy

**Scope**: Documentation site deployment and polish

**User Stories**:
1. Deploy to Cloudflare Pages at herdctl.dev
2. Set up custom domain and SSL
3. Add search functionality (if Starlight supports)
4. Review all documentation for completeness and accuracy
5. Add any missing examples or clarifications
6. Create CHANGELOG.md

**Quality Gates**:
- Site deployed and accessible at herdctl.dev
- All links work
- Search works (if implemented)

**Dependencies**: herdctl-cli (MVP complete)

---

## Future PRDs (Post-MVP)

### PRD 10: herdctl-core-cron

**Scope**: Cron-based scheduling (in addition to interval)

**User Stories**:
1. Parse cron expressions
2. Calculate next trigger time from cron
3. Integrate with existing scheduler
4. **Update documentation**: Add cron scheduling to Scheduling section

---

### PRD 11: herdctl-web

**Scope**: Local Next.js dashboard

**User Stories**:
1. Dashboard showing all agents
2. Agent detail view with live streaming
3. Job history view
4. Log viewer
5. WebSocket streaming from CLI
6. Resume/Fork button functionality
7. **Update documentation**: Add Web Dashboard guide

---

### PRD 12: herdctl-discord

**Scope**: Discord bot connector

**User Stories**:
1. Discord.js bot setup
2. Message router (channel → agent)
3. Per-channel session management
4. Mention mode for group channels
5. Auto mode for DMs
6. Chat commands (/help, /reset, /status)
7. **Update documentation**: Add Discord Integration guide

---

### PRD 13: herdctl-webhooks

**Scope**: Incoming webhook triggers

**User Stories**:
1. HTTP server for incoming webhooks
2. Route webhooks to agents
3. Signature verification
4. **Update documentation**: Add Webhooks guide

---

### PRD 14: herdctl-slack

**Scope**: Slack app connector

**User Stories**:
1. Slack app setup
2. Event routing to agents
3. Per-channel sessions
4. **Update documentation**: Add Slack Integration guide

---

## Implementation Order Summary

| Order | PRD | Creates | Docs Impact | Status |
|-------|-----|---------|-------------|--------|
| 0 | Bootstrap (manual) | Repo scaffold, turborepo, packages | - | ✓ |
| 1 | herdctl-core-config | Config parsing | - | ✓ |
| 2 | herdctl-core-state | .herdctl/ state files | - | ✓ |
| 3 | herdctl-docs | Documentation site | Initial content from SPEC + PRDs 1-2 | ✓ |
| 4 | herdctl-core-runner | Claude SDK wrapper | + Runner docs | ✓ |
| 5 | herdctl-core-github | GitHub Issues work source | + Work Sources docs | ✓ |
| 6 | herdctl-core-scheduler | Interval scheduler | + Scheduling docs | ✓ |
| 7 | herdctl-fleet-manager | FleetManager orchestration | + Library usage docs | ✓ |
| - | Library Documentation | API docs, examples, recipes | Comprehensive library docs | ✓ |
| **8** | **herdctl-cli** | **CLI commands** | **+ CLI Reference, Getting Started** | **Next** |
| 9 | herdctl-docs-deploy | Deploy to herdctl.dev | Final review + deploy | |

**Note**: PRD 7 (FleetManager) is functionally complete but has test coverage gaps that are causing CI failures. The global coverage threshold (90%) is not met due to undertested error handling paths in fleet-manager.ts and errors.ts. This should be addressed before or during the CLI work.

After PRD 8, we have a working MVP that can:
- Parse config files
- Track state
- Run agents via Claude SDK
- Fetch/claim GitHub issues
- Trigger on intervals
- Be controlled via CLI
- **Be fully documented at herdctl.dev**

---

## Using ralph-tui

For each PRD after bootstrap:

```bash
cd ~/Code/herdctl

# Create the PRD interactively
# Use /ralph-tui-prd in Claude Code with the scope from this plan

# Convert to prd.json
/ralph-tui-create-json

# Run ralph-tui
ralph-tui run --prd ./prd.json
```

Each PRD session should:
1. Read the spec (SPEC.md / herdctl.md)
2. Implement the user stories
3. Pass all quality gates
4. Commit working code

---

## Notes

- **Package manager**: pnpm (not bun)
- **License**: UNLICENSED (keeping options open for monetization)
- **Repo visibility**: Private initially
- **MCP per agent**: Fully supported via SDK's programmatic mcpServers option
- **Workspace git strategy**: Out of scope (left to agent CLAUDE.md)
