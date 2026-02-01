# Phase 4: Documentation & Testing - Research

**Researched:** 2026-02-01
**Domain:** Testing (Vitest), Documentation (Astro Starlight), Docker containerization testing
**Confidence:** HIGH

## Summary

This phase involves creating comprehensive documentation and test coverage for the runtime abstraction system implemented in Phases 1-3. The research focused on three key areas: Vitest testing patterns for unit and integration tests with conditional skipping, Astro Starlight documentation structure, and Docker container inspection for security validation testing.

The testing approach follows the user's locked decisions: 85% unit coverage with mocks for fast feedback, integration tests for critical paths (SDK/CLI/Docker execution), and Docker tests that auto-skip when the daemon is unavailable. The documentation will extend the existing Starlight-based docs site with runtime-specific content.

**Primary recommendation:** Use Vitest's `describe.skipIf()` and `test.skipIf()` for Docker and CLI integration tests, combine with dockerode's `container.inspect()` for security validation, and structure documentation as concept pages plus configuration reference.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^2.0.0 | Test runner | Already in use, fast ESM-native testing |
| dockerode | ^4.0.0 | Docker API client | Already in use for ContainerRunner |
| @astrojs/starlight | ^0.31.0 | Documentation framework | Already in use for docs site |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | ^5.0.0 | File watching | Already in use, needed for CLISessionWatcher tests |
| execa | ^9.0.0 | Process spawning | Already in use, needed for CLI integration tests |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest mocks | MSW | MSW better for HTTP mocks, but project doesn't need external HTTP mocking |
| dockerode | testcontainers-node | testcontainers provides higher-level API but adds complexity for simple inspection tests |

**Installation:**

No new dependencies required - all libraries already installed in the project.

## Architecture Patterns

### Recommended Test Structure

```
packages/core/src/
├── runner/
│   ├── runtime/
│   │   ├── __tests__/
│   │   │   ├── sdk-runtime.test.ts         # Unit tests with mocks
│   │   │   ├── cli-runtime.test.ts         # Unit tests with mocks
│   │   │   ├── cli-output-parser.test.ts   # Unit tests
│   │   │   ├── cli-session-watcher.test.ts # Unit tests
│   │   │   ├── docker-config.test.ts       # Unit tests
│   │   │   ├── container-manager.test.ts   # Unit tests with mock dockerode
│   │   │   ├── container-runner.test.ts    # Unit tests with mock runtime
│   │   │   ├── factory.test.ts             # Unit tests
│   │   │   ├── cli-runtime.integration.ts  # Integration tests (real CLI)
│   │   │   └── docker.integration.ts       # Integration tests (real Docker)
```

### Documentation Structure

```
docs/src/content/docs/
├── concepts/
│   └── runtimes.md                         # NEW: Runtime concept explanation
├── configuration/
│   ├── agent-config.md                     # UPDATE: Add runtime/docker fields
│   └── docker.md                           # NEW: Docker configuration reference
├── guides/
│   ├── runtime-selection.md                # NEW: When to use SDK vs CLI
│   └── docker-troubleshooting.md           # NEW: Docker troubleshooting
└── internals/
    └── runner.md                           # UPDATE: Add runtime abstraction
```

### Pattern 1: Conditional Test Skipping

**What:** Use Vitest's `skipIf` for environment-dependent tests
**When to use:** Docker and CLI integration tests that require external dependencies

```typescript
// Source: https://vitest.dev/api/#describe-skip
import { describe, it, expect } from "vitest";
import Dockerode from "dockerode";

// Check Docker availability at test setup
async function isDockerAvailable(): Promise<boolean> {
  try {
    const docker = new Dockerode();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();

describe.skipIf(!dockerAvailable)("Docker integration tests", () => {
  it("creates container with security hardening", async () => {
    // Test runs only if Docker is available
  });
});
```

### Pattern 2: Mock RuntimeInterface for Unit Tests

**What:** Create mock implementations of RuntimeInterface for testing consumers
**When to use:** Testing RuntimeFactory, ContainerRunner, and JobExecutor without real SDK/CLI

```typescript
// Source: Existing pattern from job-executor.test.ts
import type { RuntimeInterface, RuntimeExecuteOptions } from "../interface.js";
import type { SDKMessage } from "../../types.js";

export function createMockRuntime(
  messages: SDKMessage[]
): RuntimeInterface {
  return {
    async *execute(_options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
      for (const message of messages) {
        yield message;
      }
    },
  };
}

// Usage in tests
const mockRuntime = createMockRuntime([
  { type: "system", content: "Init", subtype: "init", session_id: "test-123" },
  { type: "assistant", content: "Done" },
]);
```

### Pattern 3: Docker Container Security Inspection

**What:** Inspect running containers to verify security options
**When to use:** Integration tests validating security hardening

```typescript
// Source: dockerode API documentation
import Dockerode from "dockerode";

it("applies security hardening to containers", async () => {
  const docker = new Dockerode();
  const container = docker.getContainer(containerId);
  const info = await container.inspect();

  // Verify security options
  expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
  expect(info.HostConfig.CapDrop).toContain("ALL");
  expect(info.Config.User).not.toBe("root");
  expect(info.HostConfig.Memory).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024);
});
```

### Pattern 4: CLI Availability Check

**What:** Check if Claude CLI is installed before running CLI tests
**When to use:** CLI runtime integration tests

```typescript
// Source: Existing pattern from cli-runtime.ts
import { execa } from "execa";

async function isCLIAvailable(): Promise<boolean> {
  try {
    await execa("claude", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const cliAvailable = await isCLIAvailable();

describe.skipIf(!cliAvailable)("CLI runtime integration tests", () => {
  // Tests that spawn real `claude` commands
});
```

### Anti-Patterns to Avoid

- **Mocking dockerode for integration tests:** Integration tests should use real Docker API - mocks are for unit tests only
- **Testing SDK/CLI internals:** Test through RuntimeInterface, not internal implementation details
- **Hardcoded test paths:** Use tmpdir for temporary test directories
- **Synchronous file assertions after async writes:** Use proper async/await or polling

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Async iterator mocking | Custom generator utilities | `async function*` with yield | Standard JavaScript feature, well-tested |
| Temp directory management | Custom temp folder logic | `tmpdir()` + `mkdir(recursive: true)` | Node.js built-in, handles platform differences |
| Docker availability check | Shell command parsing | `docker.ping()` via dockerode | Proper API call, handles auth issues |
| JSONL file assertions | Line-by-line parsing | `readJobOutputAll()` from state module | Already implemented, handles edge cases |

**Key insight:** The project already has utilities for state management, job output reading, and agent configuration. Tests should use these existing utilities rather than reimplementing parsing logic.

## Common Pitfalls

### Pitfall 1: Docker Socket Permissions

**What goes wrong:** Integration tests fail with "permission denied" when accessing Docker socket
**Why it happens:** Docker daemon runs as root, test runner doesn't have socket access
**How to avoid:** Check socket permissions in CI setup, use `skipIf` to gracefully handle unavailability
**Warning signs:** EACCES or ENOENT errors on `/var/run/docker.sock`

### Pitfall 2: CLI Session Path Conflicts

**What goes wrong:** Tests interfere with each other's session files
**Why it happens:** Claude CLI writes to `~/.claude/` which is shared between tests
**How to avoid:** Use unique temp directories for each test, set `--session-dir` if supported
**Warning signs:** Tests pass individually but fail when run together

### Pitfall 3: Race Conditions in File Watcher Tests

**What goes wrong:** CLISessionWatcher tests are flaky
**Why it happens:** File write and watch events have timing dependencies
**How to avoid:** Use `awaitWriteFinish` config (already in place), add reasonable delays in tests
**Warning signs:** Tests pass locally but fail in CI

### Pitfall 4: Memory Limit Format Variations

**What goes wrong:** Docker tests fail on memory limit assertions
**Why it happens:** Memory specified as "2g" but Docker reports bytes
**How to avoid:** Use `parseMemoryToBytes()` helper for comparisons
**Warning signs:** Assertion failures on `memoryBytes` comparisons

### Pitfall 5: Incomplete Documentation Examples

**What goes wrong:** Users copy examples that don't work
**Why it happens:** Examples not validated against actual schema
**How to avoid:** Create runnable example configs in `examples/`, reference from docs
**Warning signs:** GitHub issues about config validation errors

## Code Examples

### Unit Test: RuntimeFactory Selection Logic

```typescript
// Source: Existing pattern from packages/core/src/runner/__tests__
import { describe, it, expect } from "vitest";
import { RuntimeFactory } from "../runtime/factory.js";
import type { ResolvedAgent } from "../../config/index.js";

function createTestAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "test-agent",
    configPath: "/path/to/agent.yaml",
    ...overrides,
  };
}

describe("RuntimeFactory", () => {
  it("creates SDKRuntime by default", () => {
    const agent = createTestAgent();
    const runtime = RuntimeFactory.create(agent);
    expect(runtime).toBeInstanceOf(SDKRuntime);
  });

  it("creates CLIRuntime when runtime is 'cli'", () => {
    const agent = createTestAgent({ runtime: "cli" });
    const runtime = RuntimeFactory.create(agent);
    expect(runtime).toBeInstanceOf(CLIRuntime);
  });

  it("wraps with ContainerRunner when docker.enabled", () => {
    const agent = createTestAgent({
      docker: { enabled: true, memory: "1g" },
    });
    const runtime = RuntimeFactory.create(agent, { stateDir: "/tmp/.herdctl" });
    expect(runtime).toBeInstanceOf(ContainerRunner);
  });

  it("throws on unknown runtime type", () => {
    const agent = createTestAgent({ runtime: "unknown" as "sdk" });
    expect(() => RuntimeFactory.create(agent)).toThrow("Unknown runtime type");
  });
});
```

### Unit Test: Docker Config Parsing

```typescript
// Source: Existing docker-config.ts module
import { describe, it, expect } from "vitest";
import {
  parseMemoryToBytes,
  parseVolumeMount,
  resolveDockerConfig,
  getHostUser,
} from "../runtime/docker-config.js";

describe("parseMemoryToBytes", () => {
  it("parses gigabytes", () => {
    expect(parseMemoryToBytes("2g")).toBe(2 * 1024 * 1024 * 1024);
  });

  it("parses megabytes", () => {
    expect(parseMemoryToBytes("512m")).toBe(512 * 1024 * 1024);
  });

  it("parses plain bytes", () => {
    expect(parseMemoryToBytes("1024")).toBe(1024);
  });

  it("throws on invalid format", () => {
    expect(() => parseMemoryToBytes("invalid")).toThrow("Invalid memory format");
  });
});

describe("parseVolumeMount", () => {
  it("parses host:container format", () => {
    expect(parseVolumeMount("/host:/container")).toEqual({
      hostPath: "/host",
      containerPath: "/container",
      mode: "rw",
    });
  });

  it("parses host:container:ro format", () => {
    expect(parseVolumeMount("/host:/container:ro")).toEqual({
      hostPath: "/host",
      containerPath: "/container",
      mode: "ro",
    });
  });

  it("throws on invalid format", () => {
    expect(() => parseVolumeMount("invalid")).toThrow("Invalid volume format");
  });
});
```

### Integration Test: Docker Security Validation

```typescript
// Source: dockerode API + project security requirements
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Dockerode from "dockerode";
import { ContainerManager, buildContainerMounts, buildContainerEnv } from "../runtime/container-manager.js";
import { resolveDockerConfig } from "../runtime/docker-config.js";

async function isDockerAvailable(): Promise<boolean> {
  try {
    const docker = new Dockerode();
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();

describe.skipIf(!dockerAvailable)("Docker security integration tests", () => {
  let docker: Dockerode;
  let manager: ContainerManager;
  let containerId: string;

  beforeAll(async () => {
    docker = new Dockerode();
    manager = new ContainerManager(docker);
  });

  afterAll(async () => {
    // Cleanup test containers
    if (containerId) {
      try {
        const container = docker.getContainer(containerId);
        await container.remove({ force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("applies CAP_DROP ALL to containers", async () => {
    const config = resolveDockerConfig({ enabled: true });
    const container = await manager.getOrCreateContainer(
      "security-test",
      config,
      [],
      []
    );
    containerId = container.id;

    const info = await container.inspect();
    expect(info.HostConfig.CapDrop).toContain("ALL");
  });

  it("applies no-new-privileges security option", async () => {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    expect(info.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
  });

  it("sets memory limit correctly", async () => {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    // Default is 2GB
    expect(info.HostConfig.Memory).toBe(2 * 1024 * 1024 * 1024);
  });

  it("runs as non-root user", async () => {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    expect(info.Config.User).not.toBe("");
    expect(info.Config.User).not.toBe("root");
  });
});
```

### Example Configuration: Mixed Fleet

```yaml
# examples/mixed-fleet/herdctl.yaml
# Mixed fleet example: SDK (cost-optimized), CLI (more control), Docker (security)
version: 1

fleet:
  name: mixed-fleet-example
  description: Demonstrates different runtime configurations

defaults:
  permissions:
    mode: acceptEdits

workspace:
  root: ~/workspaces

agents:
  - path: ./agents/cost-optimized.yaml  # SDK runtime (default)
  - path: ./agents/full-control.yaml    # CLI runtime
  - path: ./agents/isolated.yaml        # Docker containerized
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SDK-only execution | Runtime abstraction (SDK/CLI) | Phase 1-2 (2026-01) | Flexible backend selection |
| Host-only execution | Docker containerization | Phase 3 (2026-01) | Security isolation |
| Manual test skipping | `describe.skipIf` | Vitest 1.0 (2023) | Cleaner conditional tests |

**Deprecated/outdated:**
- Direct SDK query calls without RuntimeInterface: Use RuntimeFactory.create() instead
- `base_image` Docker config field: Use `image` field instead

## Open Questions

1. **CLI Session Directory Override**
   - What we know: Claude CLI writes sessions to `~/.claude/`
   - What's unclear: Whether `--session-dir` or similar flag exists for test isolation
   - Recommendation: Use unique agent names per test to avoid conflicts

2. **Docker Image Availability in CI**
   - What we know: Tests need `anthropic/claude-code:latest` image
   - What's unclear: Whether image is public or needs authentication
   - Recommendation: Add image pull step to CI or skip Docker tests in CI initially

3. **CLI Authentication in Tests**
   - What we know: CLI requires `claude login` authentication
   - What's unclear: How to handle auth in CI environments
   - Recommendation: Skip CLI integration tests in CI, run locally only

## Sources

### Primary (HIGH confidence)
- [Vitest Official Documentation](https://vitest.dev/guide/) - Test organization, mocking, conditional skipping
- [Vitest API Reference](https://vitest.dev/api/) - skipIf, runIf, describe.skip patterns
- Existing project test files in `packages/core/src/**/__tests__/` - Testing patterns already in use

### Secondary (MEDIUM confidence)
- [dockerode GitHub](https://github.com/apocas/dockerode) - Container inspection API
- [Starlight Documentation](https://starlight.astro.build/) - Documentation site structure
- [Vitest Best Practices](https://www.projectrules.ai/rules/vitest) - Community patterns

### Tertiary (LOW confidence)
- WebSearch results for 2026 testing practices - General patterns, not project-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Libraries already in use, verified in package.json
- Architecture: HIGH - Patterns derived from existing codebase
- Pitfalls: MEDIUM - Based on common Docker/CLI testing issues, not project-specific failures
- Code examples: HIGH - Adapted from existing test files in the project

**Research date:** 2026-02-01
**Valid until:** 30 days (stable libraries and patterns)
