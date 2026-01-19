# Context for PRD Creation: herdctl-docs

I'm building **herdctl** - an autonomous agent fleet management system for Claude Code.

## Project Documentation - READ THESE FILES

Please thoroughly read these files for full context:

1. **SPEC.md** - Complete technical specification with:
   - Core concepts (Agents, Schedules, Triggers, Jobs, Workspaces, Sessions)
   - Architecture diagrams
   - Configuration schemas (fleet config, agent config)
   - State management (.herdctl/ directory structure)
   - CLI commands
   - Web UI mockups
   - Chat integration design

2. **plan.md** - Implementation plan showing PRD sequence and dependencies

3. **packages/core/src/config/** - Implemented config parsing module (PRD 1):
   - `schema.ts` - All Zod schemas for configuration
   - `index.ts` - Public API exports
   - Look at the actual types to document accurately

4. **tasks/config-parsing-prd.md** - Example PRD format we expect

5. **README.md** - Current project overview

## What's Been Built

**PRD 1 (Config Parsing) - Complete:**
- Zod schemas for FleetConfig, AgentConfig, ScheduleSchema, PermissionsSchema, etc.
- YAML parsing with validation
- Environment variable interpolation (${VAR} and ${VAR:-default})
- Deep merge of fleet defaults with agent overrides
- Auto-discovery of herdctl.yaml walking up directory tree
- Comprehensive error classes (ConfigError, ValidationError, InterpolationError)

**PRD 2 (State Management) - In Progress:**
- .herdctl/ directory structure
- state.yaml for fleet state
- Job YAML files for metadata
- Job JSONL files for streaming output
- Atomic writes for safety

## PRD 3 Scope: herdctl-docs

Build the **documentation site** using Astro + Starlight in the `docs/` directory.

From plan.md, the user stories are:
1. Initialize Astro with Starlight theme in `docs/`
2. Create landing page (index.astro) with project overview
3. Create documentation structure (sidebars, navigation)
4. **Audit existing repo documentation** (SPEC.md, README.md, plan.md, PRD files) and extract content
5. Create **Concepts** section covering: Agents, Schedules, Triggers, Jobs, Workspaces, Sessions
6. Create **Configuration Reference** documenting all config schemas from PRD 1
7. Create **State Management** reference documenting .herdctl/ structure from PRD 2
8. Create **Getting Started** guide (placeholder for when CLI exists)
9. Set up local dev server (`pnpm dev` in docs/)
10. Configure for Cloudflare Pages deployment (can deploy later)

## Documentation Site Structure

The docs site should have this structure:

```
docs/
├── astro.config.mjs
├── package.json
├── src/
│   ├── content/
│   │   ├── docs/
│   │   │   ├── index.mdx              # Welcome/overview
│   │   │   ├── getting-started.mdx    # Quick start (placeholder until CLI)
│   │   │   ├── concepts/
│   │   │   │   ├── agents.mdx
│   │   │   │   ├── schedules.mdx
│   │   │   │   ├── triggers.mdx
│   │   │   │   ├── jobs.mdx
│   │   │   │   ├── workspaces.mdx
│   │   │   │   └── sessions.mdx
│   │   │   ├── configuration/
│   │   │   │   ├── fleet-config.mdx   # herdctl.yaml reference
│   │   │   │   ├── agent-config.mdx   # Agent YAML reference
│   │   │   │   ├── permissions.mdx    # Permission modes, allowed tools
│   │   │   │   ├── mcp-servers.mdx    # MCP configuration
│   │   │   │   └── environment.mdx    # Env var interpolation
│   │   │   ├── internals/
│   │   │   │   └── state.mdx          # .herdctl/ directory structure
│   │   │   └── cli/
│   │   │       └── reference.mdx      # CLI commands (placeholder)
│   │   └── config.ts                  # Starlight config
│   └── pages/
│       └── index.astro                # Landing page (optional, can use docs index)
└── public/
    └── favicon.svg
```

## Content Requirements

### Concepts Section
Extract and document from SPEC.md:
- **Agent**: Configured Claude instance with identity, workspace, permissions, schedules
- **Schedule**: Trigger + prompt combination defining when/how to invoke
- **Trigger**: What causes a job (interval, cron, webhook, chat)
- **Job**: Single execution of an agent with ID, status, session, output
- **Workspace**: Dedicated directory where agents operate (separate from dev clones)
- **Session**: Claude context that can persist or be fresh per job

Include the ASCII diagrams from SPEC.md where helpful.

### Configuration Reference
Document all schemas from packages/core/src/config/schema.ts:
- Fleet configuration (herdctl.yaml) with all fields
- Agent configuration with all fields
- Show YAML examples for each
- Document default values
- Document environment variable interpolation syntax

### State Management
Document from SPEC.md and PRD 2:
- .herdctl/ directory structure
- state.yaml format (fleet state)
- Job file formats (YAML metadata + JSONL output)
- Session storage

## Technical Requirements

- Use Astro 4.x with Starlight theme
- Configure for pnpm workspace (docs/ is already in pnpm-workspace.yaml)
- Use MDX for documentation pages (allows components)
- Configure Starlight sidebar to match structure above
- Set site title: "herdctl"
- Set site tagline: "Autonomous Agent Fleet Management for Claude Code"
- Configure for eventual deployment to herdctl.dev

## Quality Gates

For every user story:
- `pnpm build` succeeds in docs/
- Site renders correctly locally with `pnpm dev`
- All concepts from SPEC.md are documented
- Config reference matches implemented schemas in packages/core/src/config/
- No broken internal links

## Important Notes

- This is a **documentation-first** approach - we're building docs early so subsequent PRDs can update them incrementally
- Content should be extracted from SPEC.md, not invented - maintain consistency with the spec
- Where the spec has example YAML configs, include them in the docs
- The Getting Started guide will be a placeholder until the CLI (PRD 7) is complete
- Don't worry about deployment yet - PRD 8 handles that

Please create a detailed PRD with user stories, acceptance criteria, file structure, and verification steps - following the same quality and structure as ./tasks/config-parsing-prd.md
