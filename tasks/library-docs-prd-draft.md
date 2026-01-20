# Library Documentation PRD Prompt Draft

Use this prompt with ralph-tui to generate the Library Documentation PRD.

---

## Prompt

Create a PRD for `herdctl-library-docs` - comprehensive documentation for using `@herdctl/core` as a standalone library, similar to how the Claude Agent SDK is documented.

### Context

herdctl is a TypeScript-based system for managing fleets of autonomous Claude Code agents. The core library (`@herdctl/core`) is designed to be consumed as a standalone library, not just via the CLI.

**Architectural Goal**: The CLI, Web UI, and HTTP API are thin wrappers around `@herdctl/core`. Anything you can do in the CLI, you can do programmatically via the library.

The FleetManager class has been implemented and provides:
- **Lifecycle**: `initialize()`, `start()`, `stop()`, `reload()`
- **Status queries**: `getStatus()`, `getAgents()`, `getAgent()`, `getSchedules()`
- **Actions**: `trigger()`, `cancelJob()`, `forkJob()`
- **Events**: Full EventEmitter with typed events for all state changes
- **Job management**: `JobManager` for querying job history and streaming output
- **Concurrency control**: `JobQueue` for managing job execution limits

### Current Documentation Gap

The docs site (`docs/`) currently has:
- Concepts (agents, jobs, triggers, schedules, work-sources, workspaces, sessions)
- Configuration reference (fleet-config, agent-config, permissions, mcp-servers, environment, github-work-source)
- Internals (runner, scheduler, state-management)
- Guides (scheduling-troubleshooting)

**Missing**: A dedicated "Library Usage" or "Using @herdctl/core" section showing:
- How to install and import the library
- Getting started with FleetManager
- Complete API reference with code examples
- Event handling patterns
- Error handling patterns
- Common use cases and recipes

### Reference: Claude Agent SDK Docs

The Claude Agent SDK documentation (https://docs.anthropic.com/en/docs/claude-code/sdk) provides a good model:
- Clear getting started section
- Code snippets for common patterns
- API reference with type signatures
- Examples for streaming, sessions, tools

### FleetManager API Surface

Based on the implemented code in `packages/core/src/fleet-manager/`:

```typescript
import { FleetManager } from "@herdctl/core";

// Construction
const fleet = new FleetManager({
  configPath: "./herdctl.yaml",  // or "./agents" directory
  stateDir: "./.herdctl",
  logger?: FleetManagerLogger,
  checkInterval?: number,  // default: 1000ms
});

// Lifecycle
await fleet.initialize();  // Load config, validate, prepare state
await fleet.start();       // Start scheduler, begin processing
await fleet.stop(options?: FleetManagerStopOptions);  // Graceful shutdown
await fleet.reload();      // Hot-reload configuration

// Status Queries
fleet.getStatus(): FleetStatus;
fleet.getAgents(): AgentInfo[];
fleet.getAgent(name: string): AgentInfo | undefined;
fleet.getSchedules(): ScheduleInfo[];

// Actions
await fleet.trigger(agentName, scheduleName?, options?: TriggerOptions): TriggerResult;
await fleet.cancelJob(jobId: string): CancelJobResult;
await fleet.forkJob(jobId: string, modifications?: JobModifications): ForkJobResult;

// Events (extends EventEmitter)
fleet.on('started', () => {});
fleet.on('stopped', (reason) => {});
fleet.on('config:reloaded', (payload: ConfigReloadedPayload) => {});
fleet.on('agent:started', (payload: AgentStartedPayload) => {});
fleet.on('agent:stopped', (payload: AgentStoppedPayload) => {});
fleet.on('schedule:triggered', (payload: ScheduleTriggeredPayload) => {});
fleet.on('schedule:skipped', (payload: ScheduleSkippedPayload) => {});
fleet.on('job:created', (payload: JobCreatedPayload) => {});
fleet.on('job:output', (payload: JobOutputPayload) => {});
fleet.on('job:completed', (payload: JobCompletedPayload) => {});
fleet.on('job:failed', (payload: JobFailedPayload) => {});
fleet.on('job:cancelled', (payload: JobCancelledPayload) => {});
fleet.on('job:forked', (payload: JobForkedPayload) => {});

// Job Manager (via fleet.jobs or standalone)
import { JobManager } from "@herdctl/core";
const jobs = fleet.jobs;  // or new JobManager(options)
await jobs.getJob(jobId): Job | null;
await jobs.listJobs(filter?: JobFilter): JobListResult;
jobs.streamOutput(jobId): JobOutputStream;  // async iterator

// Error handling
import {
  FleetManagerError,
  ConfigurationError,
  AgentNotFoundError,
  JobNotFoundError,
  ScheduleNotFoundError,
  InvalidStateError,
  ConcurrencyLimitError,
  isFleetManagerError,
  isConfigurationError,
  // ... type guards for each error
} from "@herdctl/core";
```

### User Stories

#### US-1: Installation & Getting Started
**As a** developer who wants to use herdctl programmatically
**I want** clear installation instructions and a quick start guide
**So that** I can get a basic fleet running in under 5 minutes

**Documentation should include:**
- npm/pnpm installation command
- Minimum viable code example (< 20 lines)
- What files/directories to create
- First successful run confirmation

#### US-2: FleetManager API Reference
**As a** developer integrating herdctl into my application
**I want** complete API documentation with type signatures
**So that** I understand all available methods and their parameters

**Documentation should include:**
- Constructor options with descriptions
- All lifecycle methods with examples
- All query methods with return types
- All action methods with examples
- State/status type definitions

#### US-3: Event Handling Guide
**As a** developer building a UI or monitoring system
**I want** to understand the event system and payloads
**So that** I can react to fleet state changes in real-time

**Documentation should include:**
- List of all events with payload types
- Example: subscribing to events
- Example: building a simple progress monitor
- Example: streaming job output to a terminal
- TypeScript type-safe event handling

#### US-4: Error Handling Guide
**As a** developer building a robust integration
**I want** to understand error types and recovery patterns
**So that** my application handles failures gracefully

**Documentation should include:**
- Error class hierarchy diagram
- Type guards for error discrimination
- Common error scenarios and solutions
- Retry and recovery patterns

#### US-5: Common Recipes & Patterns
**As a** developer with specific use cases
**I want** code examples for common scenarios
**So that** I can copy/paste and adapt for my needs

**Recipes to include:**
- Simple one-shot agent execution
- Long-running daemon with graceful shutdown
- Building a simple CLI wrapper
- Building a simple web dashboard
- Integrating with existing Express/Fastify server
- Running in a CI/CD pipeline
- Hot-reloading configuration changes

### Documentation Structure

Create these new pages in `docs/src/content/docs/library/`:

```
docs/src/content/docs/library/
├── index.md           # Overview and quick start
├── installation.md    # Installation and setup
├── fleet-manager.md   # FleetManager API reference
├── events.md          # Event system documentation
├── errors.md          # Error handling guide
├── job-manager.md     # Job querying and output streaming
└── recipes.md         # Common patterns and examples
```

Also update:
- `docs/astro.config.mjs` - Add "Library" section to sidebar
- `docs/src/content/docs/index.md` - Add link to library docs

### Quality Gates

- All code examples must compile without errors
- All code examples must be tested (either in docs or via snapshot tests)
- API documentation must match actual implementation
- Type signatures must be accurate
- Examples must work with latest @herdctl/core
- Documentation builds successfully (`pnpm build` in docs/)
- Sidebar navigation works correctly
- Cross-references between pages work

### Constraints

- Documentation is in Markdown with MDX extensions (Astro/Starlight)
- Code examples should be TypeScript
- Keep examples concise but complete
- Use consistent code style matching existing codebase
- Don't duplicate content already in Configuration or Internals sections - link to them

### Dependencies

- FleetManager implementation complete (PRD 7)
- Existing documentation structure (PRD 3)

### Out of Scope

- CLI documentation (separate PRD)
- Web UI documentation (future)
- HTTP API documentation (future)
- Deployment guides (future)

---

## Notes for PRD Generation

- Focus on the developer experience - make it easy to get started
- Include TypeScript types in examples where helpful
- Reference the actual source files in `packages/core/src/fleet-manager/`
- Cross-link to existing docs (configuration, concepts, internals) rather than duplicating
- Consider the docs as the "onboarding experience" for library users
