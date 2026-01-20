# PRD: herdctl-library-docs

## Overview

Comprehensive documentation for using `@herdctl/core` as a standalone TypeScript library. This documentation enables developers to programmatically manage fleets of autonomous Claude Code agents without going through the CLI.

## Problem Statement

The `@herdctl/core` library is designed to be consumed directly by developers building custom orchestration systems, dashboards, CI/CD integrations, and other applications. However, there is currently no dedicated documentation showing how to use the library programmatically. Developers must read source code or reverse-engineer the CLI to understand the API.

## Goals

1. Enable developers to get a basic fleet running programmatically in under 5 minutes
2. Provide complete API documentation with accurate TypeScript types
3. Document the event system for building reactive UIs and monitoring
4. Establish error handling patterns for robust integrations
5. Offer copy-paste recipes for common use cases across different developer personas

## Non-Goals

- CLI documentation (separate concern)
- Web UI documentation (future)
- HTTP API documentation (future)
- Deployment/production guides (future)
- Duplicating content from existing Configuration or Internals docs

## User Stories

### US-1: Installation & Getting Started
**As a** developer who wants to use herdctl programmatically  
**I want** clear installation instructions and a quick start guide  
**So that** I can get a basic fleet running in under 5 minutes

**Acceptance Criteria:**
- [ ] npm/pnpm installation commands documented
- [ ] Minimum viable code example (< 20 lines) that compiles and runs
- [ ] Required files/directories explained (config, state directory)
- [ ] First successful run produces visible output confirming it works
- [ ] Code example extracted from actual test file

### US-2: FleetManager API Reference
**As a** developer integrating herdctl into my application  
**I want** complete API documentation with type signatures  
**So that** I understand all available methods and their parameters

**Acceptance Criteria:**
- [ ] Constructor options documented with descriptions and defaults
- [ ] Each lifecycle method (`initialize`, `start`, `stop`, `reload`) has:
  - Method signature
  - Description
  - Parameters table (name, type, required, description)
  - Return type
  - One working code example
- [ ] Each query method (`getStatus`, `getAgents`, `getAgent`, `getSchedules`) documented same way
- [ ] Each action method (`trigger`, `cancelJob`, `forkJob`) documented same way
- [ ] All type definitions included or linked
- [ ] Examples extracted from test files

### US-3: Event Handling Guide
**As a** developer building a UI or monitoring system  
**I want** to understand the event system and payloads  
**So that** I can react to fleet state changes in real-time

**Acceptance Criteria:**
- [ ] Complete list of events with payload type signatures
- [ ] Example: subscribing to multiple events
- [ ] Example: building a simple progress monitor (console-based)
- [ ] Example: streaming job output to terminal with colors
- [ ] TypeScript type-safe event handling patterns shown
- [ ] Guidance on when to use events vs polling

### US-4: Error Handling Guide
**As a** developer building a robust integration  
**I want** to understand error types and recovery patterns  
**So that** my application handles failures gracefully

**Acceptance Criteria:**
- [ ] Error class hierarchy documented (text or simple diagram)
- [ ] Each error class has description and common causes
- [ ] Type guards documented with examples
- [ ] Common error scenarios with recommended handling
- [ ] Retry patterns for transient failures
- [ ] Graceful degradation patterns

### US-5: JobManager Documentation
**As a** developer who needs to query job history or stream output  
**I want** documentation for the JobManager API  
**So that** I can build job monitoring and log viewing features

**Acceptance Criteria:**
- [ ] JobManager instantiation (standalone and via FleetManager)
- [ ] `getJob()` documented with example
- [ ] `listJobs()` with filter options documented
- [ ] `streamOutput()` async iterator pattern documented
- [ ] Example: building a job history viewer
- [ ] Example: tailing job output in real-time

### US-6: Common Recipes & Patterns
**As a** developer with specific use cases  
**I want** code examples for common scenarios  
**So that** I can copy/paste and adapt for my needs

**Acceptance Criteria:**
- [ ] Recipe: Simple one-shot agent execution
- [ ] Recipe: Long-running daemon with graceful shutdown (SIGINT/SIGTERM)
- [ ] Recipe: Building a simple CLI wrapper
- [ ] Recipe: Building a simple web dashboard (Express)
- [ ] Recipe: Integrating with existing Fastify server
- [ ] Recipe: Running in CI/CD pipeline (GitHub Actions example)
- [ ] Recipe: Hot-reloading configuration changes
- [ ] Recipe: TypeScript project setup from scratch
- [ ] Recipe: Monorepo integration patterns
- [ ] Recipe: Testing patterns (unit testing with mocks)
- [ ] All recipes compile and run

## Technical Design

### File Structure

Create new documentation section in `docs/src/content/docs/library/`:

```
docs/src/content/docs/library/
├── index.mdx           # Overview, quick start, audience guide
├── installation.mdx    # Installation, prerequisites, project setup
├── fleet-manager.mdx   # FleetManager API reference
├── events.mdx          # Event system documentation
├── errors.mdx          # Error handling guide
├── job-manager.mdx     # Job querying and output streaming
└── recipes/
    ├── index.mdx       # Recipes overview
    ├── one-shot.mdx    # Simple one-shot execution
    ├── daemon.mdx      # Long-running daemon
    ├── cli-wrapper.mdx # Building CLI tools
    ├── web-dashboard.mdx # Express/Fastify integration
    ├── ci-cd.mdx       # CI/CD integration
    ├── hot-reload.mdx  # Configuration hot-reloading
    ├── project-setup.mdx # TypeScript project setup
    └── testing.mdx     # Testing patterns
```

### Code Example Strategy

Use mdx-code-blocks to extract examples from actual test files:

1. Create `packages/core/src/fleet-manager/__examples__/` directory
2. Write executable example files that serve as both documentation and tests
3. Use Astro's code import feature to include snippets in docs
4. CI validates examples compile and run

Example structure:
```typescript
// packages/core/src/fleet-manager/__examples__/quick-start.ts
import { FleetManager } from "../index.js";

// [docs:quick-start-basic]
const fleet = new FleetManager({
  configPath: "./herdctl.yaml",
  stateDir: "./.herdctl",
});

await fleet.initialize();
await fleet.start();

fleet.on("job:completed", (payload) => {
  console.log(`Job ${payload.jobId} completed!`);
});

// Trigger an agent manually
await fleet.trigger("my-agent");

// Graceful shutdown on Ctrl+C
process.on("SIGINT", async () => {
  await fleet.stop();
  process.exit(0);
});
// [/docs:quick-start-basic]
```

### Sidebar Configuration

Update `docs/astro.config.mjs` to add Library section:

```javascript
sidebar: [
  // ... existing sections
  {
    label: 'Library',
    items: [
      { label: 'Overview', link: '/library/' },
      { label: 'Installation', link: '/library/installation' },
      { label: 'FleetManager API', link: '/library/fleet-manager' },
      { label: 'Events', link: '/library/events' },
      { label: 'Error Handling', link: '/library/errors' },
      { label: 'JobManager', link: '/library/job-manager' },
      {
        label: 'Recipes',
        items: [
          { label: 'Overview', link: '/library/recipes/' },
          { label: 'One-Shot Execution', link: '/library/recipes/one-shot' },
          { label: 'Long-Running Daemon', link: '/library/recipes/daemon' },
          { label: 'CLI Wrapper', link: '/library/recipes/cli-wrapper' },
          { label: 'Web Dashboard', link: '/library/recipes/web-dashboard' },
          { label: 'CI/CD Integration', link: '/library/recipes/ci-cd' },
          { label: 'Hot Reloading', link: '/library/recipes/hot-reload' },
          { label: 'Project Setup', link: '/library/recipes/project-setup' },
          { label: 'Testing Patterns', link: '/library/recipes/testing' },
        ],
      },
    ],
  },
]
```

### Cross-References

Link to existing docs rather than duplicate:

- Configuration options → `/configuration/fleet-config`
- Agent configuration → `/configuration/agent-config`
- Concepts (agents, jobs, triggers) → `/concepts/*`
- State management internals → `/internals/state-management`
- Runner internals → `/internals/runner`

## Dependencies

- FleetManager implementation complete (PRD 7) ✓
- Existing documentation structure (PRD 3) ✓
- `packages/core` exports all necessary types

## Quality Gates

1. **Compilation**: All code examples compile with `tsc --noEmit`
2. **Execution**: Example files in `__examples__/` run without errors
3. **Type Accuracy**: Type signatures match actual implementation
4. **Build**: Documentation builds successfully (`pnpm build` in docs/)
5. **Links**: All internal cross-references resolve
6. **Navigation**: Sidebar shows all pages correctly

## Implementation Notes

### Page Content Guidelines

**index.mdx (Overview)**
- Brief intro to what @herdctl/core provides
- Audience guide: "Are you a backend dev? Start here. DevOps? Start here."
- Quick start (20 lines or less)
- Link to full installation guide

**installation.mdx**
- Prerequisites (Node.js version, etc.)
- Package installation (npm, pnpm, yarn)
- Peer dependencies if any
- Basic project structure
- TypeScript configuration tips

**fleet-manager.mdx**
- Constructor section with options table
- Lifecycle Methods section (initialize, start, stop, reload)
- Query Methods section (getStatus, getAgents, getAgent, getSchedules)
- Action Methods section (trigger, cancelJob, forkJob)
- Each method: signature, description, params table, return type, example
- Link to Events page for event handling

**events.mdx**
- Event system overview
- Complete event reference table (event name, payload type, when fired)
- TypeScript patterns for type-safe handlers
- Example: Simple event logger
- Example: Progress tracking
- Example: Job output streaming

**errors.mdx**
- Error hierarchy overview
- Each error class with description and common causes
- Type guards section
- Error handling patterns (try/catch, error boundaries)
- Recovery strategies

**job-manager.mdx**
- Getting JobManager reference
- Querying jobs (getJob, listJobs)
- Filter options
- Streaming output (async iterator pattern)
- Examples for common queries

**recipes/**
- Each recipe is standalone and copy-pasteable
- Include required imports
- Show complete working example
- Note any prerequisites or assumptions
- Cross-link to API reference for details

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| API changes break examples | Medium | High | Extract examples from test files, CI validates |
| Documentation drift from code | Medium | Medium | Generate types from source, review process |
| Overwhelming amount of content | Low | Medium | Clear navigation, audience guides |

## Success Metrics

- Developers can run their first programmatic fleet in < 5 minutes (based on quick start)
- Zero broken code examples in documentation
- Documentation coverage: 100% of public API surface documented
- All recipes tested and working

## Timeline Estimate

Not providing timeline estimates per project guidelines. Work is broken into user stories above for prioritization.