# Architecture Research

**Domain:** Runtime Abstraction and Docker Integration for TypeScript Job Execution
**Researched:** 2026-01-31
**Confidence:** HIGH

## Current Architecture (Baseline)

herdctl's existing job execution flow:

```
FleetManager
    ↓
ScheduleExecutor.executeSchedule()
    ↓
JobExecutor.execute(options)
    ↓
sdkQuery({ prompt, options: sdkOptions })
    ↓
AsyncIterable<SDKMessage>
    ↓
processSDKMessage() → appendJobOutput()
```

**Key Components:**
- `JobExecutor` - Orchestrates job lifecycle (create job → stream messages → update status)
- `sdk-adapter.ts` - Transforms `ResolvedAgent` config to SDK options
- `message-processor.ts` - Converts SDK messages to job output format
- `SDKQueryFunction` - Type: `(params) => AsyncIterable<SDKMessage>`

**Current Integration Point:** JobExecutor receives SDK query function via dependency injection in constructor.

## Target Architecture (With Runtime Abstraction + Docker)

```
┌─────────────────────────────────────────────────────────────┐
│                     FleetManager                             │
├─────────────────────────────────────────────────────────────┤
│                  ScheduleExecutor                            │
├─────────────────────────────────────────────────────────────┤
│                    JobExecutor                               │
│  - Creates job record                                        │
│  - Manages job lifecycle                                     │
│  - Streams output to job log                                 │
│                        ↓                                     │
│                  RuntimeFactory                              │
│  - Selects runtime based on agent config                    │
│  - Optionally wraps with Docker                             │
│                        ↓                                     │
├──────────────┬──────────────────────┬──────────────────────┤
│  SDKRuntime  │    CLIRuntime        │  (Future runtimes)   │
│              │                      │                       │
│  SDK query() │  Spawns claude CLI   │                      │
│  directly    │  Watches .jsonl files│                      │
│              │  Converts to messages│                      │
├──────────────┴──────────────────────┴──────────────────────┤
│                  Optional Docker Layer                       │
│  - ContainerRunner wraps any runtime                        │
│  - Mounts workspace, auth files                             │
│  - Streams stdio from container                             │
│  - Manages container lifecycle                              │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **JobExecutor** | Job lifecycle orchestration | EXISTING - minimal changes |
| **RuntimeFactory** | Runtime selection based on config | NEW - factory pattern |
| **RuntimeInterface** | Unified API for all runtimes | NEW - TypeScript interface |
| **SDKRuntime** | Execute via Claude Agent SDK | NEW - wraps existing SDK adapter |
| **CLIRuntime** | Execute via Claude CLI with file watching | NEW - spawn + chokidar |
| **ContainerRunner** | Docker containerization wrapper | NEW - dockerode integration |
| **SessionFileParser** | Parse .jsonl session files to SDKMessage | NEW - for CLIRuntime |
| **StreamAdapter** | Convert events to AsyncIterable | NEW - event-iterator pattern |

## Integration Points with Existing System

### 1. JobExecutor Constructor Modification

**Current:**
```typescript
constructor(sdkQuery: SDKQueryFunction, options: JobExecutorOptions = {})
```

**Target:**
```typescript
constructor(
  runtime: RuntimeInterface | SDKQueryFunction,  // Backwards compatible
  options: JobExecutorOptions = {}
)
```

**Migration Strategy:**
- Accept both old `SDKQueryFunction` and new `RuntimeInterface`
- Type guard to detect which was provided
- Wrap `SDKQueryFunction` in SDKRuntime adapter if old API used
- Maintains backwards compatibility for existing code

### 2. RuntimeFactory Integration Point

**Location:** Between JobExecutor and runtime execution
**Triggered by:** JobExecutor.execute() or FleetManager.trigger()

```typescript
// In FleetManager or ScheduleExecutor initialization:
const runtime = RuntimeFactory.create(agent, {
  stateDir: this.stateDir,
  docker: agent.docker,
  logger: this.logger,
});

const executor = new JobExecutor(runtime, { logger: this.logger });
```

### 3. Configuration Extension Point

**Existing:** `ResolvedAgent` from config parser
**New fields:**

```typescript
interface ResolvedAgent {
  // ... existing fields ...
  runtime?: {
    type: 'sdk' | 'cli';
    cli_path?: string;  // Path to claude CLI binary
  };
  docker?: {
    enabled: boolean;
    image?: string;  // Default: 'node:20-alpine'
    network?: 'none' | 'bridge' | 'host';
    volumes?: Array<{ host: string; container: string; readonly?: boolean }>;
    limits?: {
      cpus?: number;
      memory?: string;  // e.g., '512m'
    };
  };
}
```

**Parser changes:** Extend Zod schema in `packages/core/src/config/schema.ts`

### 4. Message Flow Preservation

**Critical:** All runtimes must produce `AsyncIterable<SDKMessage>`

**For SDKRuntime:** Direct pass-through (no change)
**For CLIRuntime:** File watcher → parser → event emitter → async iterator adapter

```typescript
interface RuntimeInterface {
  execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage>;
}
```

This ensures JobExecutor's existing message processing logic remains unchanged.

## New Components Design

### RuntimeInterface (Core Abstraction)

**Pattern:** Strategy pattern with async iterable output

```typescript
interface RuntimeExecuteParams {
  prompt: string;
  options: SDKQueryOptions;
  abortController?: AbortController;
}

interface RuntimeInterface {
  execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage>;
  cleanup?(): Promise<void>;  // Optional cleanup (remove temp files, etc.)
}
```

**Why this interface:**
- Matches existing `SDKQueryFunction` signature semantically
- AsyncIterable enables streaming (existing pattern)
- AbortController for cancellation (existing pattern)
- cleanup() for runtime-specific teardown

### RuntimeFactory (Selection Logic)

**Pattern:** Factory pattern with runtime selection

```typescript
class RuntimeFactory {
  static create(agent: ResolvedAgent, options: RuntimeFactoryOptions): RuntimeInterface {
    const runtimeType = agent.runtime?.type ?? 'sdk';  // Default to SDK

    let baseRuntime: RuntimeInterface;

    switch (runtimeType) {
      case 'sdk':
        baseRuntime = new SDKRuntime(agent, options);
        break;
      case 'cli':
        baseRuntime = new CLIRuntime(agent, options);
        break;
      default:
        throw new Error(`Unknown runtime type: ${runtimeType}`);
    }

    // Wrap with Docker if enabled
    if (agent.docker?.enabled) {
      return new ContainerRunner(baseRuntime, agent, options);
    }

    return baseRuntime;
  }
}
```

**Why factory:**
- Centralizes runtime selection logic
- Encapsulates Docker wrapping decision
- Easy to extend with new runtime types
- Type-safe with TypeScript discriminated unions

### SDKRuntime (SDK Adapter)

**Pattern:** Adapter pattern wrapping existing SDK code

```typescript
class SDKRuntime implements RuntimeInterface {
  constructor(
    private agent: ResolvedAgent,
    private options: { logger?: JobExecutorLogger }
  ) {}

  async *execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage> {
    // Use existing sdk-adapter logic
    const sdkOptions = toSDKOptions(this.agent, {
      resume: params.options.resume,
      fork: params.options.forkSession,
    });

    // Call SDK directly (existing code path)
    const messages = query({
      prompt: params.prompt,
      options: sdkOptions,
      abortController: params.abortController,
    });

    yield* messages;
  }
}
```

**Why adapter:**
- Minimal changes to existing SDK integration
- Reuses `toSDKOptions()` from sdk-adapter.ts
- Just wraps the call in RuntimeInterface shape

### CLIRuntime (CLI + File Watcher)

**Pattern:** Adapter + Observer pattern

**Complexity:** High - must convert file-based CLI to streaming interface

```typescript
class CLIRuntime implements RuntimeInterface {
  private sessionDir: string;
  private cliPath: string;

  constructor(
    private agent: ResolvedAgent,
    private options: RuntimeFactoryOptions
  ) {
    this.cliPath = agent.runtime?.cli_path ?? 'claude';
    this.sessionDir = join(options.stateDir, 'cli-sessions', agent.name);
  }

  async *execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage> {
    const sessionId = randomUUID();
    const sessionFile = join(this.sessionDir, `${sessionId}.jsonl`);

    // 1. Spawn claude CLI process
    const cliProcess = this.spawnCLI(params, sessionId);

    // 2. Watch session file for new lines
    const watcher = this.createFileWatcher(sessionFile);

    // 3. Convert file events to async iterable
    const messageStream = this.watchToAsyncIterable(watcher, sessionFile);

    // 4. Yield messages as they arrive
    yield* messageStream;

    // 5. Cleanup
    await this.cleanup(cliProcess, watcher);
  }

  private spawnCLI(params: RuntimeExecuteParams, sessionId: string): ChildProcess {
    // Build CLI arguments from SDKQueryOptions
    const args = this.buildCLIArgs(params.options);

    return spawn(this.cliPath, [
      ...args,
      '--session', sessionId,
      params.prompt,
    ], {
      cwd: params.options.cwd ?? this.agent.workspace,
      env: { ...process.env, ...this.buildEnv(params.options) },
    });
  }

  private createFileWatcher(sessionFile: string): FSWatcher {
    // Use chokidar for reliable cross-platform file watching
    return watch(sessionFile, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });
  }

  private async *watchToAsyncIterable(
    watcher: FSWatcher,
    sessionFile: string
  ): AsyncIterable<SDKMessage> {
    const parser = new SessionFileParser();
    let lastPosition = 0;

    for await (const event of on(watcher, 'change')) {
      // Read new content since last position
      const newLines = await this.readNewLines(sessionFile, lastPosition);
      lastPosition += Buffer.byteLength(newLines);

      // Parse new JSONL lines to SDKMessages
      const messages = parser.parseLines(newLines);

      for (const msg of messages) {
        yield msg;

        // Check if terminal message
        if (isTerminalMessage(msg)) {
          return;
        }
      }
    }
  }
}
```

**Key mechanisms:**
- **Chokidar file watching:** Reliable cross-platform file system events
- **JSONL parsing:** Line-by-line streaming parser for session files
- **AsyncIterable adapter:** event-iterator or on() from Node.js events
- **Position tracking:** Read only new content, avoid re-parsing
- **Terminal detection:** Stop watching when session ends

**Data flow:**
```
claude CLI writes → .jsonl file
    ↓
chokidar emits 'change' event
    ↓
readNewLines(lastPosition) → new JSONL lines
    ↓
SessionFileParser.parseLines() → SDKMessage[]
    ↓
yield messages via AsyncIterable
    ↓
JobExecutor processes (existing code)
```

### SessionFileParser (JSONL to SDKMessage)

**Pattern:** Streaming parser with format adapter

```typescript
class SessionFileParser {
  parseLines(jsonl: string): SDKMessage[] {
    const messages: SDKMessage[] = [];
    const lines = jsonl.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const message = this.recordToSDKMessage(record);
        if (message) {
          messages.push(message);
        }
      } catch (err) {
        // Log but don't crash on malformed lines
        console.warn('Failed to parse session line:', err);
      }
    }

    return messages;
  }

  private recordToSDKMessage(record: unknown): SDKMessage | null {
    // Transform Claude CLI session format to SDK message format
    // This requires understanding CLI's .jsonl schema

    // Example transformation (schema TBD based on CLI format):
    if (isAssistantMessage(record)) {
      return {
        type: 'assistant',
        message: { content: record.content },
        ...
      };
    }

    if (isToolUseRecord(record)) {
      return {
        type: 'tool_use',
        tool_name: record.name,
        input: record.input,
        ...
      };
    }

    // ... more transformations
  }
}
```

**Critical dependency:** Requires understanding Claude CLI's .jsonl session file schema. This is LOW confidence without official CLI documentation.

**Verification needed:**
- Inspect actual .jsonl files from `~/.claude/projects/`
- Document CLI session format
- Build schema mapping to SDK message types

### ContainerRunner (Docker Wrapper)

**Pattern:** Decorator pattern (wraps any runtime)

```typescript
class ContainerRunner implements RuntimeInterface {
  constructor(
    private innerRuntime: RuntimeInterface,
    private agent: ResolvedAgent,
    private options: RuntimeFactoryOptions
  ) {}

  async *execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage> {
    const docker = new Dockerode();
    const config = this.agent.docker!;

    // 1. Create container
    const container = await docker.createContainer({
      Image: config.image ?? 'node:20-alpine',
      Cmd: this.buildContainerCommand(params),
      Env: this.buildContainerEnv(params),
      HostConfig: {
        Binds: this.buildVolumeMounts(config),
        NetworkMode: config.network ?? 'bridge',
        Memory: this.parseMemoryLimit(config.limits?.memory),
        NanoCpus: (config.limits?.cpus ?? 1) * 1e9,
        ReadonlyRootfs: true,  // Security: prevent filesystem modification
      },
      WorkingDir: '/workspace',
    });

    try {
      // 2. Start container
      await container.start();

      // 3. Attach to stdio streams
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      // 4. Parse container output as SDKMessages
      // This assumes innerRuntime produces recognizable output
      // For CLIRuntime: forward to session file watcher inside container
      // For SDKRuntime: would need SDK to support stdio protocol (future)

      yield* this.parseContainerStream(stream);

      // 5. Wait for completion
      await container.wait();
    } finally {
      // 6. Cleanup
      await container.remove();
    }
  }

  private buildVolumeMounts(config: DockerConfig): string[] {
    const mounts: string[] = [];

    // Workspace mount (read-write by default)
    if (this.agent.workspace) {
      mounts.push(`${this.agent.workspace}:/workspace`);
    }

    // Auth files mount (READ-ONLY for security)
    const authDir = join(homedir(), '.claude');
    mounts.push(`${authDir}:/root/.claude:ro`);

    // Custom volume mounts
    if (config.volumes) {
      for (const vol of config.volumes) {
        const readonly = vol.readonly ? ':ro' : '';
        mounts.push(`${vol.host}:${vol.container}${readonly}`);
      }
    }

    return mounts;
  }

  private buildContainerEnv(params: RuntimeExecuteParams): string[] {
    const env: string[] = [];

    // Pass through essential env vars
    if (process.env.ANTHROPIC_API_KEY) {
      env.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
    }

    // Agent-specific env vars from config
    if (this.agent.env) {
      for (const [key, value] of Object.entries(this.agent.env)) {
        env.push(`${key}=${value}`);
      }
    }

    return env;
  }
}
```

**Key mechanisms:**
- **Dockerode:** Node.js Docker API client (well-established, 30M+ downloads/year)
- **Read-only mounts:** Auth files mounted :ro for security
- **Resource limits:** Memory and CPU constraints via HostConfig
- **Network isolation:** Configurable network mode
- **Readonly root filesystem:** Prevents container compromise from persisting

**Security considerations:**
- Auth files read-only prevents credential corruption
- Readonly root filesystem limits attack surface
- Network isolation can prevent exfiltration (network: 'none')
- Resource limits prevent DoS from runaway agent

**Session isolation:**
- Docker sessions stored in separate directory
- Prevents path confusion when resuming
- Container paths vs host paths kept distinct

## Data Flow Diagrams

### SDK Runtime Flow (No Docker)

```
FleetManager.trigger()
    ↓
JobExecutor.execute()
    ↓
RuntimeFactory.create(agent) → SDKRuntime
    ↓
SDKRuntime.execute({ prompt, options })
    ↓
SDK query() → AsyncIterable<SDKMessage>
    ↓
JobExecutor processes messages (existing)
    ↓
appendJobOutput() → .herdctl/jobs/{id}.output
```

**Changes:** Minimal - just wrapping SDK call in RuntimeInterface

### CLI Runtime Flow (No Docker)

```
FleetManager.trigger()
    ↓
JobExecutor.execute()
    ↓
RuntimeFactory.create(agent) → CLIRuntime
    ↓
CLIRuntime.execute({ prompt, options })
    ↓
    ├─→ spawn('claude', [...args])
    │       ↓
    │   Claude CLI writes to ~/.claude/projects/{sessionId}.jsonl
    │
    └─→ chokidar.watch(sessionFile)
            ↓
        'change' event
            ↓
        readNewLines(lastPosition)
            ↓
        SessionFileParser.parseLines()
            ↓
        yield SDKMessage via AsyncIterable
            ↓
        JobExecutor processes messages (existing)
            ↓
        appendJobOutput() → .herdctl/jobs/{id}.output
```

**Changes:** New file watching layer, JSONL parsing, but same message output

### Docker + CLI Runtime Flow

```
FleetManager.trigger()
    ↓
JobExecutor.execute()
    ↓
RuntimeFactory.create(agent)
    ↓
    └─→ ContainerRunner wraps CLIRuntime
            ↓
        docker.createContainer({ ... })
            ↓
        container.start()
            ↓
        Inside container:
            ├─→ spawn('claude', [...args])
            │       ↓
            │   Claude CLI writes to /root/.claude/projects/{sessionId}.jsonl
            │
            └─→ chokidar.watch(sessionFile) [inside container]
                    ↓
                'change' event
                    ↓
                readNewLines(lastPosition)
                    ↓
                SessionFileParser.parseLines()
                    ↓
                stdout to container
                    ↓
            ↓
        container.attach({ stdout: true })
            ↓
        Parse container stream to SDKMessage
            ↓
        yield SDKMessage via AsyncIterable
            ↓
        JobExecutor processes messages (existing)
            ↓
        appendJobOutput() → .herdctl/jobs/{id}.output

        container.wait()
            ↓
        container.remove()
```

**Changes:** Container lifecycle management, stdio forwarding, session path isolation

## Architectural Patterns

### Pattern 1: Strategy Pattern for Runtime Selection

**What:** Different runtime implementations (SDK, CLI) share common interface
**When to use:** When multiple algorithms/implementations should be swappable
**Trade-offs:**
- ✅ Easy to add new runtimes
- ✅ Runtime selection isolated to factory
- ✅ Each runtime independently testable
- ⚠️ Interface must be generic enough for all runtimes

**Example:**
```typescript
interface RuntimeInterface {
  execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage>;
}

class SDKRuntime implements RuntimeInterface { ... }
class CLIRuntime implements RuntimeInterface { ... }

// Selection happens once at factory creation
const runtime = RuntimeFactory.create(agent, options);
```

### Pattern 2: Decorator Pattern for Docker Wrapping

**What:** ContainerRunner wraps any runtime without changing its interface
**When to use:** When adding cross-cutting concern (containerization) to existing abstractions
**Trade-offs:**
- ✅ Docker is orthogonal to runtime type
- ✅ Can compose: Docker(CLIRuntime) or Docker(SDKRuntime)
- ✅ Easy to disable Docker without code changes
- ⚠️ Wrapper adds indirection

**Example:**
```typescript
class ContainerRunner implements RuntimeInterface {
  constructor(private innerRuntime: RuntimeInterface, ...) {}

  async *execute(params: RuntimeExecuteParams): AsyncIterable<SDKMessage> {
    const container = await this.createContainer();
    // ... run innerRuntime inside container ...
    yield* containerMessages;
  }
}

// Wrapping happens at factory
if (agent.docker?.enabled) {
  return new ContainerRunner(baseRuntime, agent, options);
}
```

### Pattern 3: Adapter Pattern for Event-to-AsyncIterable

**What:** Convert chokidar file watcher events to AsyncIterable<SDKMessage>
**When to use:** When integrating push-based events with pull-based iteration
**Trade-offs:**
- ✅ Maintains existing consumer interface (AsyncIterable)
- ✅ Standard Node.js pattern (events.on())
- ⚠️ Requires buffering between event emission and iteration
- ⚠️ Backpressure handling needed

**Example:**
```typescript
import { on } from 'node:events';

async *watchToAsyncIterable(watcher: FSWatcher): AsyncIterable<SDKMessage> {
  for await (const [filepath] of on(watcher, 'change')) {
    const messages = await this.parseFile(filepath);
    for (const msg of messages) {
      yield msg;
    }
  }
}
```

**Libraries:** Use event-iterator or Node.js events.on() for robust implementation

### Pattern 4: Factory Pattern for Centralized Creation

**What:** RuntimeFactory handles all runtime construction logic
**When to use:** When object creation has complex conditional logic
**Trade-offs:**
- ✅ Single source of truth for runtime selection
- ✅ Easy to add new runtime types
- ✅ Type safety with discriminated unions
- ⚠️ Factory becomes coupling point

**Example:**
```typescript
class RuntimeFactory {
  static create(agent: ResolvedAgent, options: RuntimeFactoryOptions): RuntimeInterface {
    const runtimeType = agent.runtime?.type ?? 'sdk';
    let baseRuntime = this.createBaseRuntime(runtimeType, agent, options);

    if (agent.docker?.enabled) {
      baseRuntime = new ContainerRunner(baseRuntime, agent, options);
    }

    return baseRuntime;
  }

  private static createBaseRuntime(...): RuntimeInterface {
    switch (runtimeType) {
      case 'sdk': return new SDKRuntime(...);
      case 'cli': return new CLIRuntime(...);
      default: throw new Error(`Unknown runtime: ${runtimeType}`);
    }
  }
}
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 agents | Single-process FleetManager with runtime abstraction works fine. Docker overhead minimal. |
| 10-100 agents | Docker resource limits become important. Consider container reuse for repeated jobs (pool pattern). CLI runtime file watching scales well (one watcher per active job). |
| 100+ agents | Consider separate Docker host or Kubernetes. File watching may need optimization (debouncing). Rate limiting on SDK/CLI calls. |

### Scaling Priorities

1. **First bottleneck:** Docker container creation overhead
   - **Fix:** Container pooling (reuse containers for same agent)
   - **Fix:** Pre-warm containers during initialization

2. **Second bottleneck:** File descriptor limits from chokidar watchers
   - **Fix:** Debounce file watching (batch reads)
   - **Fix:** Close watchers aggressively when jobs complete

## Anti-Patterns

### Anti-Pattern 1: Tightly Coupling Runtime to JobExecutor

**What people do:** Add SDK-specific or CLI-specific logic directly in JobExecutor
**Why it's wrong:** JobExecutor becomes aware of runtime implementation details, violates abstraction
**Do this instead:** Keep JobExecutor agnostic - it only knows RuntimeInterface

### Anti-Pattern 2: Mixing Docker Logic with Runtime Logic

**What people do:** Add Docker-specific code inside SDKRuntime or CLIRuntime
**Why it's wrong:** Docker is orthogonal to runtime type, creates combinatorial explosion
**Do this instead:** Use decorator pattern - ContainerRunner wraps any runtime

### Anti-Pattern 3: Synchronous File Reading in CLI Runtime

**What people do:** Read entire session file on each change event
**Why it's wrong:** Performance degrades as session file grows, re-parses old messages
**Do this instead:** Track file position, read only new content since last read

### Anti-Pattern 4: Shared Session Directories Between Host and Docker

**What people do:** Mount ~/.claude as read-write in container
**Why it's wrong:** Path confusion when resuming, session corruption risk, security issue
**Do this instead:** Separate session directories (.herdctl/docker-sessions vs .herdctl/cli-sessions)

### Anti-Pattern 5: Hardcoding Runtime Selection

**What people do:** if (useCLI) { ... } else { ... } scattered throughout codebase
**Why it's wrong:** Runtime selection logic duplicated, hard to extend
**Do this instead:** Centralize in RuntimeFactory, use strategy pattern

## Integration Timeline (Suggested Build Order)

Based on dependencies and risk, recommended implementation order:

### Phase 1: Runtime Abstraction (Foundation)
**Goal:** Extract existing SDK integration behind interface

1. Create `RuntimeInterface` with execute() signature
2. Create `SDKRuntime` wrapping existing SDK code
3. Create `RuntimeFactory` with only SDK support
4. Modify `JobExecutor` to accept RuntimeInterface
5. Update tests to use factory

**Risk:** Low - mostly code organization
**Value:** Unlocks parallel development of CLI and Docker

### Phase 2: CLI Runtime (New Capability)
**Goal:** Add CLI runtime without Docker

1. Research Claude CLI session file format (inspect ~/.claude/projects/)
2. Create `SessionFileParser` with CLI format mapping
3. Create `CLIRuntime` with file watching
4. Add CLI option to RuntimeFactory
5. Add runtime config to agent schema
6. Add CLI runtime tests

**Risk:** Medium - file format understanding required (LOW confidence)
**Value:** Enables cost savings for Max plan users

### Phase 3: Docker Integration (Security)
**Goal:** Wrap any runtime in container

1. Create `ContainerRunner` decorator
2. Add Docker config to agent schema
3. Integrate dockerode for container lifecycle
4. Add volume mounting logic (workspace, auth)
5. Add resource limits configuration
6. Add Docker integration tests

**Risk:** Medium - Docker API complexity, session path isolation
**Value:** Enables secure execution of untrusted prompts

### Phase 4: Optimization and Hardening
**Goal:** Production-ready

1. Add container pooling for reuse
2. Optimize file watching (debouncing)
3. Add telemetry (runtime selection, Docker overhead)
4. Error recovery (container cleanup on failure)
5. Documentation and examples

**Risk:** Low - polish phase
**Value:** Production reliability

## Sources

**Runtime Abstraction & DI:**
- [Webiny DI - TypeScript dependency injection](https://github.com/webiny/di)
- [TSyringe - Microsoft TypeScript DI container](https://github.com/microsoft/tsyringe)
- [Deepkit Dependency Injection](https://deepkit.io/en/documentation/dependency-injection)
- [Factory Method Pattern in TypeScript](https://refactoring.guru/design-patterns/factory-method/typescript/example)
- [Abstract Factory Pattern in TypeScript (January 2026)](https://ro-zcn.medium.com/abstract-factory-using-typescript-5f1bc73bf755)
- [Strategy Pattern in TypeScript](https://medium.com/@robinviktorsson/a-guide-to-the-strategy-design-pattern-in-typescript-and-node-js-with-practical-examples-c3d6984a2050)

**Docker Integration:**
- [Docker container logs documentation](https://docs.docker.com/reference/cli/docker/container/logs/)
- [Dockerode - Docker + Node.js](https://github.com/apocas/dockerode)
- [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Security Best Practices](https://blog.gitguardian.com/how-to-improve-your-docker-containers-security-cheat-sheet/)
- [Docker Read-Only Volumes](https://medium.com/@maheshwar.ramkrushna/best-practices-for-secure-docker-containerization-non-root-user-read-only-volumes-and-resource-d34ed09b1bd3)
- [Container Security - OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

**File Watching & Streaming:**
- [Chokidar - Cross-platform file watching](https://github.com/paulmillr/chokidar)
- [event-iterator - Event emitter to async iterator](https://github.com/rolftimmermans/event-iterator)
- [Node.js async iterators](https://nodejsdesignpatterns.com/blog/javascript-async-iterators/)
- [Logdy - Streaming log parser](https://logdy.dev/blog/post/live-log-tail-with-logdy-stream-logs-from-anywhere-to-web-browser)
- [frontail - Streaming logs to browser](https://github.com/mthenw/frontail)

**Claude CLI:**
- [Claude CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Session Management](https://stevekinney.com/courses/ai-development/claude-code-session-management)
- [Claude Sessions and Resumable Workflow (January 2026)](https://medium.com/@porter.nicholas/teaching-claude-to-remember-part-3-sessions-and-resumable-workflow-1c356d9e442f)

---
*Architecture research for: Runtime Abstraction and Docker Integration*
*Researched: 2026-01-31*
