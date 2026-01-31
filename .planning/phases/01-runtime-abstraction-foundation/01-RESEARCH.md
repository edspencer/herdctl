# Phase 1: Runtime Abstraction Foundation - Research

**Researched:** 2026-01-31
**Domain:** TypeScript Runtime Abstraction, Claude Agent SDK
**Confidence:** HIGH

## Summary

This phase establishes a clean runtime abstraction layer that allows herdctl to support multiple Claude execution backends (SDK and CLI) through a unified interface. The existing codebase already has a dependency injection pattern via `SDKQueryFunction` passed to `JobExecutor`, making this refactoring straightforward.

The current implementation directly imports `query` from `@anthropic-ai/claude-agent-sdk` in two places (`job-control.ts` and `schedule-executor.ts`), then casts it to the internal `SDKQueryFunction` type. The goal is to replace this direct SDK coupling with a `RuntimeInterface` that can be implemented by multiple backends.

The primary pattern is the **Adapter Pattern** combined with a **Factory Pattern**. The `SDKRuntime` adapter wraps the existing SDK integration, while `RuntimeFactory` instantiates the appropriate runtime based on agent configuration. Phase 2 will add `CLIRuntime` as a second implementation.

**Primary recommendation:** Define `RuntimeInterface` with a single `execute()` method returning `AsyncIterable<SDKMessage>`, implement `SDKRuntime` adapter wrapping existing SDK integration, and refactor `JobExecutor` to accept `RuntimeInterface`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | ^0.1.0 (current) / 0.2.29 (latest) | Claude execution via SDK | Already in use, official Anthropic library |
| TypeScript | ^5 | Type-safe interface definitions | Already in use, enables compile-time interface checking |
| Zod | ^3.22.0 | Runtime schema validation | Already in use for config validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js AsyncIterable | Built-in | Streaming message interface | Return type for runtime execute() |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AsyncIterable | EventEmitter | AsyncIterable is simpler, already used by SDK |
| Factory class | Factory function | Class allows stateful factory patterns if needed |
| Interface | Abstract class | Interface is lighter, no inheritance issues |

**Installation:**
```bash
# No new dependencies required - using existing stack
```

## Architecture Patterns

### Recommended Project Structure
```
packages/core/src/
├── runner/
│   ├── index.ts              # Existing exports + new runtime exports
│   ├── types.ts              # Add RuntimeInterface, RuntimeOptions
│   ├── job-executor.ts       # Refactor to use RuntimeInterface
│   ├── runtime/              # NEW: Runtime implementations
│   │   ├── index.ts          # Export RuntimeInterface, SDKRuntime, RuntimeFactory
│   │   ├── interface.ts      # RuntimeInterface definition
│   │   ├── sdk-runtime.ts    # SDKRuntime adapter
│   │   └── factory.ts        # RuntimeFactory for runtime selection
│   ├── sdk-adapter.ts        # Keep: config transformation (used by SDKRuntime)
│   ├── message-processor.ts  # Keep: message processing (used by all runtimes)
│   └── errors.ts             # Keep: error types
```

### Pattern 1: RuntimeInterface (Strategy Pattern)
**What:** Single interface defining how any runtime executes Claude
**When to use:** Every runtime implementation must implement this
**Example:**
```typescript
// Source: TypeScript interface pattern, verified against SDK API
export interface RuntimeInterface {
  /**
   * Execute a prompt and stream messages
   *
   * @param options - Execution options including agent config and prompt
   * @returns AsyncIterable of SDK-compatible messages
   */
  execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage>;
}

export interface RuntimeExecuteOptions {
  /** The prompt to execute */
  prompt: string;
  /** Resolved agent configuration */
  agent: ResolvedAgent;
  /** Optional session ID to resume */
  resume?: string;
  /** Whether to fork the session */
  fork?: boolean;
  /** Abort controller for cancellation */
  abortController?: AbortController;
}
```

### Pattern 2: SDKRuntime Adapter
**What:** Wraps existing SDK `query()` function behind RuntimeInterface
**When to use:** When agent config specifies `runtime: 'sdk'` (or default)
**Example:**
```typescript
// Source: Adapter pattern from existing sdk-adapter.ts + SDK docs
import { query } from "@anthropic-ai/claude-agent-sdk";
import { toSDKOptions } from "../sdk-adapter.js";

export class SDKRuntime implements RuntimeInterface {
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    const sdkOptions = toSDKOptions(options.agent, {
      resume: options.resume,
      fork: options.fork,
    });

    // The SDK query() returns AsyncGenerator<SDKMessage>
    const messages = query({
      prompt: options.prompt,
      options: sdkOptions as Record<string, unknown>,
      abortController: options.abortController,
    });

    // Yield each message from SDK
    for await (const message of messages) {
      yield message as SDKMessage;
    }
  }
}
```

### Pattern 3: RuntimeFactory
**What:** Creates appropriate runtime based on agent configuration
**When to use:** When JobExecutor needs a runtime for a given agent
**Example:**
```typescript
// Source: Factory pattern standard
export type RuntimeType = 'sdk' | 'cli';

export class RuntimeFactory {
  /**
   * Create a runtime for the given agent configuration
   */
  static create(agent: ResolvedAgent): RuntimeInterface {
    const runtimeType = agent.runtime ?? 'sdk';

    switch (runtimeType) {
      case 'sdk':
        return new SDKRuntime();
      case 'cli':
        // Phase 2: return new CLIRuntime();
        throw new Error(`CLI runtime not yet implemented`);
      default:
        throw new Error(`Unknown runtime type: ${runtimeType}`);
    }
  }
}
```

### Pattern 4: JobExecutor Refactoring
**What:** Accept RuntimeInterface instead of SDKQueryFunction
**When to use:** The JobExecutor class needs to support any runtime
**Example:**
```typescript
// Source: Existing JobExecutor pattern, refactored
export class JobExecutor {
  private runtime: RuntimeInterface;
  private logger: JobExecutorLogger;

  constructor(runtime: RuntimeInterface, options: JobExecutorOptions = {}) {
    this.runtime = runtime;
    this.logger = options.logger ?? defaultLogger;
  }

  async execute(options: RunnerOptionsWithCallbacks): Promise<RunnerResult> {
    // ... existing job setup code ...

    // Replace sdkQuery call with runtime.execute()
    const messages = this.runtime.execute({
      prompt,
      agent: options.agent,
      resume: options.resume,
      fork: options.fork ? true : undefined,
      abortController: options.abortController,
    });

    for await (const sdkMessage of messages) {
      // ... existing message processing (unchanged) ...
    }

    // ... existing completion code ...
  }
}
```

### Anti-Patterns to Avoid
- **Leaking SDK types through interface:** RuntimeInterface returns `SDKMessage` which is acceptable since all runtimes must produce SDK-compatible messages. Do NOT return SDK-specific Query object features.
- **Runtime selection at execution time:** Agent runtime is fixed at config time. Do not allow changing runtime mid-execution.
- **Direct SDK imports in JobExecutor:** After refactoring, JobExecutor should never import from `@anthropic-ai/claude-agent-sdk`.
- **Backwards compatibility layers:** Per CLAUDE.md, this is pre-MVP - delete old code, don't keep it alongside new code.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async streaming | Custom EventEmitter | AsyncIterable | SDK already returns AsyncIterable, native JS pattern |
| Config transformation | New SDK options builder | Existing `toSDKOptions()` | Already handles all SDK option mapping correctly |
| Message processing | Runtime-specific processors | Existing `processSDKMessage()` | Already handles all SDK message types |
| Error wrapping | Runtime-specific errors | Existing `wrapError()` | Already provides context-rich error handling |

**Key insight:** The existing codebase already has excellent separation of concerns. The `sdk-adapter.ts` handles config-to-SDK transformation, `message-processor.ts` handles message normalization. These are runtime-agnostic and should be reused.

## Common Pitfalls

### Pitfall 1: Breaking AsyncIterable Contract
**What goes wrong:** Returning a Promise instead of AsyncIterable, or not properly implementing the async generator protocol
**Why it happens:** Confusion between `async function` returning Promise vs `async function*` returning AsyncGenerator
**How to avoid:** Use `async *execute()` generator function syntax
**Warning signs:** TypeScript errors about Promise vs AsyncIterable, for-await-of loops failing

### Pitfall 2: SDK Import Leak
**What goes wrong:** JobExecutor or other code still imports directly from SDK after refactoring
**Why it happens:** Incomplete refactoring, forgetting to update all call sites
**How to avoid:** After refactoring, grep for `@anthropic-ai/claude-agent-sdk` - should only appear in SDKRuntime
**Warning signs:** Multiple files importing from SDK, type mismatches

### Pitfall 3: Config Field Not Added to Schema
**What goes wrong:** Adding `runtime` field to agent config but forgetting to update Zod schema
**Why it happens:** Schema lives in separate file from types
**How to avoid:** Phase 2 adds `runtime` field to `AgentConfigSchema` - ensure schema and types stay in sync
**Warning signs:** Runtime validation errors at config load time

### Pitfall 4: Losing Abort Controller Propagation
**What goes wrong:** AbortController not passed through to SDK, making jobs uncancellable
**Why it happens:** AbortController is an optional parameter that's easy to forget
**How to avoid:** Ensure RuntimeExecuteOptions includes abortController, and SDKRuntime passes it to query()
**Warning signs:** Jobs cannot be cancelled, AbortController has no effect

### Pitfall 5: Message Type Incompatibility
**What goes wrong:** CLI runtime (Phase 2) returns different message structure than SDK
**Why it happens:** CLI session files have different format than SDK streaming messages
**How to avoid:** All runtimes MUST return `SDKMessage` type - this is the contract
**Warning signs:** Type errors in message processor, undefined fields in messages

## Code Examples

Verified patterns from official sources and existing codebase:

### SDK Query Function (Current Usage)
```typescript
// Source: @anthropic-ai/claude-agent-sdk official docs + existing job-control.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

// The SDK query function signature
for await (const message of query({
  prompt: "Fix the bug in auth.ts",
  options: { allowedTools: ["Read", "Edit", "Bash"] }
})) {
  console.log(message);
}
```

### SDK Message Types (From SDK TypeScript Reference)
```typescript
// Source: https://platform.claude.com/docs/en/agent-sdk/typescript
type SDKMessage =
  | SDKAssistantMessage    // type: 'assistant'
  | SDKUserMessage         // type: 'user'
  | SDKResultMessage       // type: 'result' (terminal)
  | SDKSystemMessage       // type: 'system' (includes init with session_id)
  | SDKPartialAssistantMessage  // type: 'stream_event'
  | SDKCompactBoundaryMessage;  // type: 'system', subtype: 'compact_boundary'
```

### Existing SDKQueryFunction Type (For Reference)
```typescript
// Source: packages/core/src/runner/job-executor.ts line 70
export type SDKQueryFunction = (params: {
  prompt: string;
  options?: Record<string, unknown>;
  abortController?: AbortController;
}) => AsyncIterable<SDKMessage>;
```

### RuntimeInterface Definition
```typescript
// Recommended implementation based on existing patterns
export interface RuntimeInterface {
  execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage>;
}

export interface RuntimeExecuteOptions {
  prompt: string;
  agent: ResolvedAgent;
  resume?: string;
  fork?: boolean;
  abortController?: AbortController;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude Code SDK | Claude Agent SDK | Sept 2025 | Renamed, broader agent scope |
| Direct SDK coupling | Runtime abstraction | This phase | Enables multiple backends |
| SDKQueryFunction | RuntimeInterface | This phase | Cleaner contract, easier testing |

**Deprecated/outdated:**
- `@anthropic-ai/claude-code-sdk`: Renamed to `@anthropic-ai/claude-agent-sdk` in Sept 2025

## Open Questions

Things that couldn't be fully resolved:

1. **SDK Version Update**
   - What we know: package.json has `^0.1.0`, latest is `0.2.29`
   - What's unclear: Whether 0.2.x has breaking changes affecting our integration
   - Recommendation: Research in Phase 2 or update separately; current version works

2. **AbortController Behavior**
   - What we know: SDK accepts abortController, current code passes it through
   - What's unclear: Exact behavior when abort is signaled - does SDK clean up gracefully?
   - Recommendation: Verify during implementation; add integration test

3. **Multiple RuntimeInterface Instances**
   - What we know: Factory creates new instance per call
   - What's unclear: Whether runtime should be singleton or per-execution
   - Recommendation: Start with per-execution (safer); optimize if profiling shows issue

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - Full API, message types, options
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - Capabilities, streaming interface
- Existing codebase: `packages/core/src/runner/` - Current SDK integration patterns

### Secondary (MEDIUM confidence)
- [TypeScript Design Patterns - Adapter](https://refactoring.guru/design-patterns/adapter/typescript/example) - Adapter pattern reference
- [TypeScript Design Patterns - Factory](https://sbcode.net/typescript/factory/) - Factory pattern reference
- [MDN AsyncIterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) - AsyncIterable protocol

### Tertiary (LOW confidence)
- None - all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using existing dependencies, no new libraries
- Architecture: HIGH - Patterns verified against existing codebase and official docs
- Pitfalls: HIGH - Derived from codebase analysis and SDK documentation

**Research date:** 2026-01-31
**Valid until:** 60 days (SDK is stable, patterns are evergreen)
