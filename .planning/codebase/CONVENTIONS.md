# Coding Conventions

**Analysis Date:** 2026-01-24

## Naming Patterns

**Files:**
- TypeScript source files: `camelCase.ts` - Example: `fleet-manager.ts`, `schedule-executor.ts`, `job-control.ts`
- Test files: `name.test.ts` - Example: `errors.test.ts`, `fleet-manager.test.ts`
- Index files: `index.ts` - Used for barrel exports at module level
- Configuration files: `schema.ts`, `loader.ts`, `parser.ts`

**Functions:**
- camelCase for all function and method names
- Descriptive names that include action: `createDefaultLogger()`, `isScheduleDue()`, `updateScheduleState()`
- Helper functions with prefix: `calculateNextTrigger()`, `formatLogEntry()`, `computeConfigChanges()`

**Variables:**
- camelCase for variables: `checkInterval`, `configPath`, `statusQueries`, `logger`
- CONSTANT_CASE for module-level constants: `DEFAULT_CHECK_INTERVAL`, `DEFAULT_SHUTDOWN_TIMEOUT`
- Private fields with underscore prefix: `private readonly stateDir: string` (public) vs internal state tracking

**Types:**
- PascalCase for all types and interfaces: `FleetManager`, `ConfigurationError`, `ScheduleInfo`, `TriggerResult`
- Enum-like objects: PascalCase keys as uppercase strings: `FleetManagerErrorCode.CONFIGURATION_ERROR`
- Type suffix conventions:
  - `Error` - for error classes
  - `Options` - for configuration objects
  - `Logger` - for logging interfaces
  - `Result` - for return types from operations
  - `Payload` - for event emission data
  - `EventMap` - for typed event maps
  - `Info` - for informational object types (e.g., `AgentInfo`, `ScheduleInfo`)

## Code Style

**Formatting:**
- TypeScript strict mode enabled (see `tsconfig.json`)
- ES2022 target with NodeNext module resolution
- 2-space indentation (inferred from source files)
- Line length: Not explicitly enforced but typically 80-100 characters

**Linting:**
- No explicit eslint/prettier configuration in project root
- Rely on TypeScript compiler (`tsc --noEmit` for type checking)
- Use strict TypeScript settings: `strict: true`, `forceConsistentCasingInFileNames: true`

**JSDoc/Comments:**
- Module-level documentation at top of every file
- Example:
```typescript
/**
 * Error classes for fleet manager operations
 *
 * Provides typed errors with descriptive messages and error codes for fleet manager failures.
 * All errors extend FleetManagerError and include relevant context for debugging.
 */
```
- Class-level JSDoc with description and usage examples
- Function-level JSDoc for public APIs with @param, @example, @throws
- Inline comments for complex logic or non-obvious code paths
- Section headers with comment dividers for large files:
```typescript
// =============================================================================
// Configuration Errors
// =============================================================================
```

## Import Organization

**Order:**
1. Node.js built-ins: `import { EventEmitter } from "node:events"`
2. External packages: `import { z } from "zod"`, `import yaml from "yaml"`
3. Relative imports from other modules: `import type { ResolvedConfig } from "../config/index.js"`
4. Type imports: `import type { FleetManagerContext } from "./context.js"`

**Path Aliases:**
- No path aliases configured; uses relative imports with explicit `.js` extensions (ES module style)
- Module re-exports via barrel files (`index.ts`) for clean public APIs

**Example from `packages/core/src/fleet-manager/fleet-manager.ts`:**
```typescript
import { EventEmitter } from "node:events";
import { resolve } from "node:path";

import {
  loadConfig,
  type ResolvedConfig,
  type ResolvedAgent,
  ConfigNotFoundError,
  ConfigError,
} from "../config/index.js";
import { initStateDirectory, type StateDirectory } from "../state/index.js";
import { Scheduler, type TriggerInfo } from "../scheduler/index.js";

import type { FleetManagerContext } from "./context.js";
import type { FleetManagerOptions, FleetManagerState } from "./types.js";
import {
  InvalidStateError,
  ConfigurationError,
  FleetManagerStateDirError,
} from "./errors.js";
```

## Error Handling

**Patterns:**
- All errors extend `FleetManagerError` base class with error codes
- Errors include structured information: `code`, `message`, optional `cause`
- Type guards provided for every error class (e.g., `isConfigurationError()`)
- Error codes defined in enum-like object (`FleetManagerErrorCode`)
- Validation errors include path, message, and value: `ValidationError` interface

**Error Classes by Category:**
- Configuration: `ConfigurationError` - file load, schema validation
- Not Found: `AgentNotFoundError`, `JobNotFoundError`, `ScheduleNotFoundError`
- State: `InvalidStateError` - invalid state transitions, `FleetManagerStateDirError` - directory issues
- Operational: `ConcurrencyLimitError` - concurrency exceeded, `FleetManagerShutdownError` - shutdown failures
- Job Control: `JobCancelError`, `JobForkError` - job operation failures

**Example error creation from `packages/core/src/fleet-manager/errors.ts`:**
```typescript
export class ConfigurationError extends FleetManagerError {
  public readonly configPath?: string;
  public readonly validationErrors: ValidationError[];

  constructor(message: string, options?: {
    configPath?: string;
    validationErrors?: ValidationError[];
    cause?: Error;
  }) {
    // ... implementation
    this.code = FleetManagerErrorCode.CONFIGURATION_ERROR;
  }
}
```

## Logging

**Framework:** Custom interface `FleetManagerLogger` with methods: `debug()`, `info()`, `warn()`, `error()`

**Patterns:**
- Loggers use namespace prefix: `[fleet-manager]`, `[scheduler]`, `[job-manager]`
- Default logger provided if none supplied (uses `console.*` methods)
- Logger interface allows custom implementations for testing/integration
- Messages include context: agent names, job IDs, schedule names where relevant

**Example usage:**
```typescript
function createDefaultLogger(): FleetManagerLogger {
  return {
    debug: (message: string) => console.debug(`[fleet-manager] ${message}`),
    info: (message: string) => console.info(`[fleet-manager] ${message}`),
    warn: (message: string) => console.warn(`[fleet-manager] ${message}`),
    error: (message: string) => console.error(`[fleet-manager] ${message}`),
  };
}
```

## Validation

**Framework:** Zod for runtime validation schemas

**Patterns:**
- Define schemas in `schema.ts` files alongside types
- Schemas validate configuration YAML structure and values
- Validation errors captured with field paths: `"agents[0].schedules[0].interval"`
- Schema composition for nested structures (permissions, work sources, schedules)

**Example from `packages/core/src/config/schema.ts`:**
```typescript
export const GitHubWorkSourceSchema = z.object({
  type: z.literal("github"),
  repo: z.string().regex(GITHUB_REPO_PATTERN),
  labels: WorkSourceLabelsSchema.optional(),
  auth: GitHubAuthSchema.optional(),
});
```

## Module Design

**Exports:**
- Barrel files (`index.ts`) export public API of each module
- Separate type exports from value exports for clarity
- Re-export helper/utility functions that have external value
- Group exports by category with comments

**Example from `packages/core/src/fleet-manager/index.ts`:**
```typescript
// Main class
export { FleetManager } from "./fleet-manager.js";

// Error classes
export {
  FleetManagerError,
  ConfigurationError,
  AgentNotFoundError,
  // ... more errors
} from "./errors.js";

// Type guards
export {
  isFleetManagerError,
  isConfigurationError,
  // ... more guards
} from "./errors.js";
```

**Composition Pattern:**
- FleetManager orchestrates functionality through composed module classes
- Module classes: `StatusQueries`, `ScheduleManagement`, `ConfigReload`, `JobControl`, `LogStreaming`, `ScheduleExecutor`
- Each module class implements specific domain functionality
- Modules depend on shared `FleetManagerContext` interface for access to common state

## Function Design

**Size:** Functions keep focused responsibility, 50-150 lines typical for methods, longer for complex business logic

**Parameters:**
- Object parameters for configurations: `FleetManagerOptions`, `FleetManagerStopOptions`
- Discriminated unions for different operation modes (e.g., trigger with/without schedule)
- Optional parameters grouped in options objects to avoid positional chaos

**Return Values:**
- Explicit return types on all functions
- Result objects with success indicators and structured data: `TriggerResult`, `CancelJobResult`, `ForkJobResult`
- Async functions for I/O operations (file system, process management)
- Iterables/Async iterables for streaming: `LogEntry`, `JobOutputStream`

**Example from fleet-manager.ts:**
```typescript
public async trigger(
  agentName: string,
  scheduleName?: string,
  options?: TriggerOptions
): Promise<TriggerResult> {
  // ... implementation
  return {
    jobId: result.jobId,
    agentName,
    scheduleName,
    prompt: options?.prompt ?? schedule.prompt,
    createdAt: new Date().toISOString(),
  };
}
```

## State Management

**Patterns:**
- Immutable type returned from queries: `getFleetStatus()` returns snapshot
- Event emission for state changes: `on('config:reloaded')`, `on('job:created')`
- State persistence to disk in `.herdctl/` directory
- Atomic file operations for consistency

## Type Safety

**Conventions:**
- Explicit typing throughout, no implicit `any`
- `type` imports use `import type { ... }` syntax
- Discriminated unions for complex state (e.g., schedule types)
- Readonly properties on data classes where mutation not intended

---

*Convention analysis: 2026-01-24*
