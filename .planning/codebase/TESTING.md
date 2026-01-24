# Testing Patterns

**Analysis Date:** 2026-01-24

## Test Framework

**Runner:**
- Vitest 4.0.17
- Config: `packages/core/vitest.config.ts` and `packages/cli/vitest.config.ts`

**Assertion Library:**
- Vitest built-in expect API (Chai-compatible)

**Run Commands:**
```bash
pnpm test              # Run all tests with coverage
pnpm test:watch        # Watch mode (CLI package)
pnpm --filter @herdctl/core test  # Run core package tests only
pnpm typecheck         # Type check without running tests
```

## Test File Organization

**Location:**
- Co-located with source: `src/__tests__/` directories adjacent to source code
- Example: `packages/core/src/fleet-manager/__tests__/errors.test.ts` tests `packages/core/src/fleet-manager/errors.ts`

**Naming:**
- Pattern: `<module-name>.test.ts` or `<module-name>.spec.ts`
- Examples: `errors.test.ts`, `fleet-manager.test.ts`, `job-queue.test.ts`, `coverage.test.ts`

**Structure:**
```
packages/core/src/
├── fleet-manager/
│   ├── errors.ts
│   ├── fleet-manager.ts
│   ├── types.ts
│   └── __tests__/
│       ├── errors.test.ts
│       ├── fleet-manager.test.ts
│       ├── coverage.test.ts
│       └── reload.test.ts
├── config/
│   ├── schema.ts
│   ├── loader.ts
│   └── __tests__/
│       ├── schema.test.ts
│       ├── loader.test.ts
│       └── parser.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
/**
 * Tests for fleet-manager error classes
 *
 * Tests all error classes, their constructors, properties, and type guards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FleetManagerError, ConfigurationError } from "../errors.js";

describe("FleetManagerError classes", () => {
  // ===========================================================================
  // FleetManagerError (base class)
  // ===========================================================================
  describe("FleetManagerError", () => {
    it("creates error with message", () => {
      const error = new FleetManagerError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("FleetManagerError");
      expect(error.code).toBe(FleetManagerErrorCode.FLEET_MANAGER_ERROR);
    });

    it("creates error with custom code", () => {
      const error = new FleetManagerError("Test error", {
        code: FleetManagerErrorCode.CONFIGURATION_ERROR,
      });
      expect(error.code).toBe(FleetManagerErrorCode.CONFIGURATION_ERROR);
    });
  });

  // ===========================================================================
  // ConfigurationError
  // ===========================================================================
  describe("ConfigurationError", () => {
    it("creates error with message only", () => {
      const error = new ConfigurationError("Config failed");
      expect(error.message).toContain("Config failed");
      expect(error.name).toBe("ConfigurationError");
    });
  });
});
```

**Patterns:**
- File-level JSDoc describing test scope
- Use `beforeEach`/`afterEach` for setup/teardown
- Section dividers with headers for logical grouping
- Descriptive test names using `.it("should ...")` or `.it("creates/returns/throws ...")`
- Clear assertions that validate single behavior per test

## Mocking

**Framework:** Vitest built-in `vi` mock functions

**Patterns:**
- Mock external dependencies: file system operations, subprocess management, external APIs
- Use `vi.fn()` for mock functions: `const mockLogger = vi.fn()`
- Create spy functions: `const spy = vi.spyOn(console, 'debug')`
- Mock modules with `vi.mock()` for file system and SDK adapters
- Create silent loggers for integration tests to avoid console spam

**Example from `packages/core/src/fleet-manager/__tests__/coverage.test.ts`:**
```typescript
function createSilentLogger(): FleetManagerLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// Usage in tests
const logger = createSilentLogger();
const manager = new FleetManager({
  configPath,
  stateDir,
  logger,
});

// Later verify logging was called
expect(logger.info).toHaveBeenCalled();
```

**What to Mock:**
- Logger instances (silent implementations for integration tests)
- File system operations (use `fs/promises` with temp directories in beforeEach)
- SDK/external API calls (use vi.mock or spies)
- Time-dependent code (may use fake timers in advanced cases)

**What NOT to Mock:**
- Core business logic classes (test them directly)
- Configuration loading (use real YAML files in temp directories)
- Error types (construct and test actual instances)
- Type guards and utility functions (real implementations)

## Fixtures and Factories

**Test Data:**
```typescript
// Helper function for creating test jobs
async function createTestJob(options: {
  agent: string;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: Date;
  prompt?: string;
}): Promise<JobMetadata> {
  const job = await createJob(jobsDir, {
    agent: options.agent,
    trigger_type: "manual",
    prompt: options.prompt ?? "Test prompt",
  });

  if (options.status && options.status !== "pending") {
    return await updateJob(jobsDir, job.id, {
      status: options.status,
      finished_at:
        options.status === "running" ? undefined : new Date().toISOString(),
      exit_reason:
        options.status === "completed"
          ? "success"
          : options.status === "failed"
            ? "error"
            : options.status === "cancelled"
              ? "cancelled"
              : undefined,
    });
  }

  return job;
}
```

**Location:**
- Defined in test file in `beforeEach` or as helper functions within test suites
- Factories for complex setup (agents with schedules, multi-level configurations)
- Configuration builders for YAML setup:

```typescript
async function createConfig(config: object) {
  const configPath = join(configDir, "herdctl.yaml");
  const yaml = await import("yaml");
  await writeFile(configPath, yaml.stringify(config));
  return configPath;
}

async function createAgentConfig(name: string, config: object) {
  const agentDir = join(configDir, "agents");
  await mkdir(agentDir, { recursive: true });
  const agentPath = join(agentDir, `${name}.yaml`);
  const yaml = await import("yaml");
  await writeFile(agentPath, yaml.stringify(config));
  return agentPath;
}
```

## Coverage

**Requirements:**
- Lines: 85% minimum
- Functions: 85% minimum
- Statements: 85% minimum
- Branches: 65% minimum

**View Coverage:**
```bash
pnpm --filter @herdctl/core test   # Generates coverage report in html/
# Open coverage report at packages/core/coverage/index.html
```

**Configuration in `vitest.config.ts`:**
```typescript
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/**/*.test.ts"],
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 65,
        statements: 85,
      },
    },
  },
});
```

## Test Types

**Unit Tests:**
- Scope: Individual functions and methods, error classes, utility functions
- Location: `packages/core/src/fleet-manager/__tests__/errors.test.ts` - extensive error class testing
- Approach: Mock all external dependencies, test contract and edge cases
- Example: `errors.test.ts` has 600+ lines testing 10 error classes with comprehensive assertions

**Integration Tests:**
- Scope: FleetManager with real config loading, scheduler, state persistence
- Location: `packages/core/src/fleet-manager/__tests__/coverage.test.ts`, `integration.test.ts`
- Approach: Use real temp directories, real YAML files, create agents and trigger schedules
- Handles: Config reloading, schedule changes, job lifecycle, event emission

**E2E Tests:**
- Framework: Not explicitly set up
- Could use: CLI invocation tests via subprocess, full workflow tests

## Common Patterns

**Async Testing:**
```typescript
it("initializes with valid config", async () => {
  await createAgentConfig("test-agent", {
    name: "test-agent",
  });

  const configPath = await createConfig({
    version: 1,
    agents: [{ path: "./agents/test-agent.yaml" }],
  });

  const manager = new FleetManager({
    configPath,
    stateDir,
    logger: createSilentLogger(),
  });

  await manager.initialize();

  const agents = manager.getAgents();
  expect(agents).toHaveLength(1);
  expect(agents[0].name).toBe("test-agent");
});
```

**Error Testing:**
```typescript
it("throws ConfigurationError for missing config", async () => {
  const manager = new FleetManager({
    configPath: "/nonexistent/path/config.yaml",
    stateDir,
    logger: createSilentLogger(),
  });

  await expect(manager.initialize()).rejects.toThrow(ConfigurationError);
});

it("type guard returns correct result", () => {
  const error = new ConfigurationError("test");
  expect(isConfigurationError(error)).toBe(true);

  const otherError = new FleetManagerError("test");
  expect(isConfigurationError(otherError)).toBe(false);
});
```

**Setup/Teardown with Temp Files:**
```typescript
let tempDir: string;
let configDir: string;
let stateDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "fleet-test-"));
  configDir = join(tempDir, "config");
  stateDir = join(tempDir, ".herdctl");
  await mkdir(configDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});
```

**Event Listening:**
```typescript
it("emits initialized event", async () => {
  const manager = new FleetManager({
    configPath,
    stateDir,
    logger: createSilentLogger(),
  });

  const initHandler = vi.fn();
  manager.on("initialized", initHandler);

  await manager.initialize();

  expect(initHandler).toHaveBeenCalledTimes(1);
});
```

## Test Execution Context

**Isolation:**
- Each test creates isolated temp directory
- Tests clean up after themselves via afterEach
- No shared state between test suites
- Concurrent execution safe (no global state mutation)

**Timing:**
- No hardcoded delays in most tests
- Some tests wait for events: `await new Promise((resolve) => setTimeout(resolve, 100))`
- Used cautiously to allow schedules to fire or log buffering
- Consider using fake timers for timing-critical tests in future

## Common Testing Gaps

**Areas with comprehensive tests:**
- Error classes and type guards (`errors.test.ts` - 600+ lines)
- Config loading and validation (`config/**/*.test.ts`)
- Schedule state management (`scheduler/**/*.test.ts`)
- Job metadata persistence (`state/**/*.test.ts`)

**Areas where tests are focused on coverage:**
- `coverage.test.ts` targets specific uncovered code paths
- FleetManager lifecycle edge cases (stop variants, reload scenarios)
- Log streaming filters and edge cases
- Schedule trigger event emission

---

*Testing analysis: 2026-01-24*
