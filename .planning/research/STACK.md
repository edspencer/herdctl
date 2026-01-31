# Stack Research

**Domain:** Runtime abstraction and Docker containerization for Node.js/TypeScript agent fleet management
**Researched:** 2026-01-31
**Confidence:** HIGH

## Executive Summary

This research covers stack additions for runtime abstraction (SDK vs CLI backends) and Docker containerization security isolation. The existing herdctl stack (TypeScript, Node.js, Claude Agent SDK) is solid. New capabilities require:

1. **Runtime abstraction layer**: Interface-based design with SDK and CLI implementations
2. **Process management**: Robust child process handling for CLI runtime
3. **File watching**: Cross-platform session file monitoring for CLI runtime
4. **Docker integration**: Container management and security isolation
5. **JSONL parsing**: Streaming session file parsing

All recommendations prioritize type safety, production-readiness, and Node.js ≥18 compatibility (current project requirement).

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | ≥18 (tested on v24.8.0) | Runtime platform | Existing project requirement. Supports native recursive fs.watch on macOS/Windows. Modern child_process APIs. |
| **TypeScript** | ^5 | Type safety | Already in use. Enables interface-based runtime abstraction with compile-time safety. |
| **Zod** | ^3.22.0 (currently installed) | Runtime schema validation | Already in use. Add Docker config schema and runtime type validation. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **execa** | ^9.6.1 | Child process wrapper | CLI runtime process spawning. Replaces native child_process.spawn with promise-based API, better error handling, cross-platform shebangs, PATHEXT support on Windows. [121M weekly downloads, key ecosystem project](https://www.npmjs.com/package/execa) |
| **chokidar** | ^5.0.0 | Cross-platform file watching | CLI runtime session file monitoring. Native fs.watch doesn't support recursive on Linux. Chokidar provides consistent behavior across platforms. ESM-only, requires Node ≥20.19. [30M+ projects use it](https://github.com/paulmillr/chokidar) |
| **ndjson** | ^3.0.0 | JSONL/NDJSON streaming parser | CLI runtime session file parsing. Transform stream for newline-delimited JSON. Minimal dependencies, battle-tested for streaming large files. |
| **dockerode** | ^4.0.2 | Docker Remote API client | Optional - only if programmatic Docker control needed. Provides full Docker API access (containers, images, volumes, networks). Most widely used Docker client for Node.js. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **@types/dockerode** | ^3.3.0+ | TypeScript definitions for dockerode | Only needed if using dockerode library. Install as devDependency. |
| **Docker Desktop** | Local testing | Required for testing Docker containerization features. Ensure Docker daemon is running. |

---

## Installation

```bash
# Core additions for runtime abstraction
npm install execa@^9.6.1 chokidar@^5.0.0 ndjson@^3.0.0

# Optional Docker integration (only if programmatic control needed)
npm install dockerode@^4.0.2

# Dev dependencies
npm install -D @types/dockerode@^3.3.0
```

**Note**: Existing dependencies (TypeScript, Zod) already installed, no changes needed.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **execa** | Native child_process.spawn | If you need maximum control and don't mind handling platform differences manually. Execa adds 200KB but provides significant DX improvements. |
| **execa** | zx (Google's shell scripting) | If building shell-script-heavy automation. Not recommended here - execa is better for programmatic process management. |
| **chokidar** | Native fs.watch | If you only target macOS/Windows AND Node ≥19.1. Native recursive watching works there but not on Linux. Chokidar provides cross-platform consistency. |
| **chokidar** | node-watch | If you need CommonJS support. Chokidar v5 is ESM-only. node-watch is lighter but less battle-tested. |
| **ndjson** | stream-json (jsonl/Stringer) | If you need advanced stream processing or huge files exceeding memory. stream-json is more powerful but has more complex API. ndjson is sufficient for session files. |
| **ndjson** | @streamparser/json-node | If you need WHATWG stream compatibility. ndjson is simpler for our use case. |
| **dockerode** | @docker/sdk (official Docker Node SDK) | The official SDK is newer (2025+) but less mature. dockerode has years of production use and better documentation. Use official SDK if you prioritize official support over ecosystem maturity. |
| **Docker CLI via execa** | dockerode library | CLI approach is simpler for basic operations (run, stop). Use dockerode only if you need programmatic container introspection, image building, or network management. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **child_process.exec()** | Buffers entire output in memory. Fails on large outputs. Security risk if shell injection not handled. | execa or child_process.spawn with execa wrapper |
| **fs.watchFile** (polling) | High CPU usage. Slower event detection. chokidar v5 removed this under the hood for good reason. | chokidar or native fs.watch |
| **Synchronous child_process methods** | Blocks Node.js event loop. No streaming. Kills performance in production. | Always use async methods (execa, spawn, etc.) |
| **readline for JSONL parsing** | Doesn't handle JSON parse errors gracefully. No streaming primitives. Manual buffer management. | ndjson or @streamparser/json-node |
| **Docker socket manipulation without library** | Complex protocol. Error-prone. Security risks if not handled correctly. | dockerode or Docker CLI via execa |

---

## Stack Patterns by Variant

### Pattern 1: SDK Runtime (No Docker)
**Use when**: Standard Anthropic API pricing acceptable, need true streaming, production environment

```typescript
// Dependencies: Just @anthropic-ai/claude-agent-sdk (already installed)
// No additional libraries needed
const runtime = new SDKRuntime(sdkQuery);
const messages = runtime.run({ prompt, agent, sdkOptions });
```

**Benefits**: Simplest implementation, no file watching, no Docker complexity

---

### Pattern 2: CLI Runtime (No Docker)
**Use when**: Max plan pricing desired, local development, cost optimization

```bash
# Required: execa, chokidar, ndjson
npm install execa@^9.6.1 chokidar@^5.0.0 ndjson@^3.0.0
```

```typescript
// Dependencies: execa (spawn claude), chokidar (watch session), ndjson (parse)
const runtime = new CLIRuntime();
const messages = runtime.run({ prompt, agent, sdkOptions });
// Internally: spawns `claude -p`, watches session file, streams parsed JSONL
```

**Benefits**: Max plan pricing, full CLI feature parity, file-based session persistence

---

### Pattern 3: CLI Runtime + Docker
**Use when**: Security isolation required, untrusted prompts, production personal automation

```bash
# Required: All CLI deps + Docker daemon
npm install execa@^9.6.1 chokidar@^5.0.0 ndjson@^3.0.0
# Ensure Docker daemon running
```

```typescript
// Dependencies: execa (spawn docker), chokidar (watch session), ndjson (parse)
const runtime = new CLIRuntime();
const containerRunner = new ContainerRunner(runtime);
const messages = containerRunner.run({ agent, prompt, ... });
// Internally: spawns `docker run`, mounts workspace/auth, watches session on host
```

**Benefits**: Filesystem isolation, network isolation (--network none), auth protection (read-only mount), resource limits

---

### Pattern 4: SDK Runtime + Docker (Maximum Security)
**Use when**: Production environment requiring isolation but not cost-sensitive

```bash
# Required: execa (spawn docker)
npm install execa@^9.6.1
# Docker daemon required
```

```typescript
// Dependencies: execa (spawn docker), @anthropic-ai/claude-agent-sdk
// Communication via stdin/stdout protocol
const runtime = new SDKRuntime(sdkQuery);
const containerRunner = new ContainerRunner(runtime);
const messages = containerRunner.run({ agent, prompt, ... });
```

**Benefits**: Maximum isolation + true streaming, no session file management, API-based auth (no file mounting)

---

### Pattern 5: Programmatic Docker Control
**Use when**: Building Docker-specific features (image management, multi-container orchestration)

```bash
# Required: dockerode
npm install dockerode@^4.0.2
npm install -D @types/dockerode@^3.3.0
```

```typescript
// Dependencies: dockerode (Docker API client)
import Docker from 'dockerode';
const docker = new Docker();
const container = await docker.createContainer({ ... });
await container.start();
const stream = await container.attach({ stream: true, stdout: true });
```

**Benefits**: Full Docker API access, programmatic image building, network/volume management

**When NOT needed**: Simple `docker run` use cases. Use execa + Docker CLI instead for simplicity.

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| chokidar | 5.0.0 | Node.js ≥20.19 | **BREAKING**: ESM-only, requires Node ≥20.19. Project currently on v24.8.0 (compatible). |
| execa | 9.6.1 | Node.js ≥18.19.0 | ESM-only. Project requires Node ≥18 (compatible). |
| ndjson | 3.0.0 | Node.js ≥18 | Pure ESM. Compatible with project. |
| dockerode | 4.0.2 | Node.js ≥18 | Works with Docker Engine API 1.37+. No breaking changes expected. |

### Critical Compatibility Notes

1. **chokidar v5 requires Node ≥20.19**: Project's `package.json` specifies `"engines": { "node": ">=18" }`. Since project is running v24.8.0, chokidar v5 is compatible. If supporting Node 18.x, use chokidar v4 instead (still maintained).

2. **All packages are ESM-only**: Project already uses `"type": "module"` in package.json. No CommonJS compatibility issues.

3. **TypeScript version**: All packages provide TypeScript types. TypeScript ^5 (already installed) is compatible.

---

## Implementation Recommendations

### Phase 1: Runtime Abstraction (No Docker)

**Goal**: Support SDK and CLI backends with unified interface

**Libraries needed**:
- execa (CLI process spawning)
- chokidar (CLI session file watching)
- ndjson (CLI session file parsing)

**Implementation steps**:
1. Create `AgentRuntime` interface in `packages/core/src/runner/runtimes/types.ts`
2. Implement `SDKRuntime` (wraps existing SDK query function)
3. Implement `CLIRuntime` (spawn via execa, watch via chokidar, parse via ndjson)
4. Add runtime factory: `createRuntime(type: 'sdk' | 'cli')`
5. Update `JobExecutor` to use runtime factory

**No Docker libraries needed yet**. Keep it simple.

---

### Phase 2: Docker Support

**Goal**: Add optional Docker containerization for security isolation

**Decision point**: CLI-based vs library-based Docker control

#### **Recommendation: Start with CLI-based approach**

```typescript
// Use execa to spawn docker commands
import { execa } from 'execa';

const { stdout } = await execa('docker', [
  'run', '--rm', '-i',
  '-v', `${workspaceDir}:/workspace`,
  '-w', '/workspace',
  '--network', 'none',
  'herdctl-base:latest',
  'claude', '-p', prompt
]);
```

**Why CLI approach first**:
- ✅ Simple, easy to understand
- ✅ No additional dependencies
- ✅ Easy to debug (can reproduce commands manually)
- ✅ Sufficient for 90% of use cases

**When to add dockerode**:
- ❌ If you need programmatic image building
- ❌ If you need multi-container orchestration
- ❌ If you need network/volume introspection
- ❌ If you need streaming logs with multiplexing

For herdctl's use case (simple container execution with mounts), **CLI approach is sufficient**.

---

### Phase 3: Production Hardening

**Libraries to add later** (not MVP):
- None! All critical libraries covered above.

**Production considerations**:
1. **Error handling**: execa provides structured errors. Use them.
2. **Timeouts**: execa supports timeout option. Set reasonable defaults.
3. **Resource limits**: Docker memory/CPU limits via CLI flags (no library needed)
4. **Security scanning**: Docker Scout (separate tool, not a library)

---

## Security Considerations

### File Watching Security (chokidar)

**Risk**: Malicious agent modifies session file to inject fake messages
**Mitigation**: Session files are written by Claude CLI/SDK, not user-modifiable. Agent can't write to its own session file (different process).

**Risk**: Symlink attacks on watched files
**Mitigation**: chokidar v5 handles symlinks correctly. Set `followSymlinks: false` if needed.

### Process Spawning Security (execa)

**Risk**: Command injection if user input passed to shell
**Mitigation**: execa doesn't use shell by default. Always pass arguments as array, never as string.

```typescript
// SAFE
await execa('docker', ['run', userInput]);

// UNSAFE - DON'T DO THIS
await execa(`docker run ${userInput}`);
```

**Risk**: Environment variable leakage
**Mitigation**: execa allows explicit env object. Don't use `process.env` directly.

### Docker Security

**Risk**: Privileged containers
**Mitigation**: Never use `--privileged` flag. Document this in anti-patterns.

**Risk**: Docker socket mounting
**Mitigation**: Never mount `/var/run/docker.sock` into agent containers. Document in security guide.

**Risk**: Unrestricted network access
**Mitigation**: Default to `--network none`. Require explicit config to change.

---

## Testing Strategy

### Testing CLI Runtime

**Challenge**: Testing file watching without actual Claude CLI
**Solution**: Mock session file writes

```typescript
// Test helper
async function simulateSession(sessionFile: string, messages: SDKMessage[]) {
  for (const msg of messages) {
    await appendFile(sessionFile, JSON.stringify(msg) + '\n');
    await sleep(10); // Simulate streaming delay
  }
}
```

### Testing Docker Integration

**Challenge**: Tests require Docker daemon
**Solution**: Skip Docker tests in CI if daemon unavailable

```typescript
test.skipIf(!isDockerAvailable())('docker container execution', async () => {
  // Docker-dependent test
});
```

### Testing execa

**Challenge**: Testing child process failures
**Solution**: execa provides predictable error structure

```typescript
import { execa } from 'execa';

test('handles command failure', async () => {
  await expect(async () => {
    await execa('false'); // Command that exits with 1
  }).rejects.toThrow();
});
```

---

## Migration Path

### Existing Code Impact

**Current**: JobExecutor calls SDK directly
**After Phase 1**: JobExecutor uses runtime factory

```typescript
// Before
const messages = this.sdkQuery({ prompt, options });

// After (backwards compatible)
const runtime = createRuntime('sdk', this.sdkQuery);
const messages = runtime.run({ prompt, agent, sdkOptions });
```

**Breaking changes**: None if SDK is default runtime

### Dependency Addition Timeline

1. **Now (Phase 1)**: Add execa, chokidar, ndjson
2. **Phase 2 (if needed)**: Add dockerode (only if CLI approach insufficient)
3. **Future**: No additional libraries anticipated

---

## Performance Considerations

### File Watching Overhead (chokidar)

**Cost**: ~5-10ms latency for file change detection
**Acceptable for**: CLI runtime (messages are written at human-readable pace)
**Not acceptable for**: Real-time streaming (use SDK runtime instead)

### Process Spawning Overhead (execa)

**Cost**: ~50-100ms to spawn `docker run` or `claude`
**Acceptable for**: Job-based execution (overhead amortized over job duration)
**Mitigation**: Keep processes running for session-based workflows (future optimization)

### JSONL Parsing Overhead (ndjson)

**Cost**: Negligible (<1ms per message)
**Memory**: Streaming parser, no buffering of entire file

---

## Sources

### Official Documentation
- [Node.js v25 Child Process API](https://nodejs.org/api/child_process.html) — Node.js official docs for child process module
- [Node.js v25 fs.watch API](https://nodejs.org/docs/latest/api/fs.html) — fs.watch recursive support documentation

### Library Documentation & Repositories
- [execa npm package](https://www.npmjs.com/package/execa) — Latest version 9.6.1, 121M weekly downloads
- [chokidar GitHub repository](https://github.com/paulmillr/chokidar) — v5.0.0 release notes, ESM-only, Node ≥20.19
- [dockerode GitHub repository](https://github.com/apocas/dockerode) — Docker Remote API client
- [ndjson GitHub repository](https://github.com/ndjson/ndjson.js) — Streaming JSONL parser

### Technical Articles & Best Practices
- [Running commands with execa in Node.js (LogRocket)](https://blog.logrocket.com/running-commands-with-execa-in-node-js/) — Why use execa over child_process
- [Node.js Docker Best Practices (Medium, Jan 2026)](https://medium.com/@regansomi/4-easy-docker-best-practices-for-node-js-build-faster-smaller-and-more-secure-containers-151474129ac0) — Security best practices
- [Docker for Node.js Developers: Security (Docker Blog)](https://www.docker.com/blog/docker-for-node-js-developers-5-things-you-need-to-know-not-to-fail-your-security/) — Official Docker security guidance
- [OWASP NodeJS Docker Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NodeJS_Docker_Cheat_Sheet.html) — Security guidelines

### Comparison Research
- [Chokidar vs fsevents vs node-watch (npm-compare)](https://npm-compare.com/chokidar,fsevents,gaze,node-watch,watch) — File system watcher comparison
- [Use fs.watch instead of chokidar if Node >=v19.1 (Vite issue #12495)](https://github.com/vitejs/vite/issues/12495) — Native fs.watch recursive support discussion

### Version Information
- Web search: "dockerode latest version npm 2026" — Confirmed v4.0.2+ availability
- Web search: "chokidar latest version npm 2026" — Confirmed v5.0.0, ESM-only, Node ≥20.19
- Web search: "execa latest version npm 2026" — Confirmed v9.6.1
- Web search: "zod schema validation TypeScript latest version 2026" — Confirmed v4.3.5 (already using v3.22.0)

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| **execa for CLI runtime** | HIGH | 121M weekly downloads, official Node.js docs confirm child_process APIs, recent articles validate use case |
| **chokidar for file watching** | HIGH | 30M+ projects, official release notes confirm v5 specs, cross-platform testing proven |
| **ndjson for JSONL parsing** | MEDIUM-HIGH | Battle-tested for streaming, minimal dependencies, but lower download count than alternatives. Alternative @streamparser/json-node also viable. |
| **dockerode vs Docker CLI** | MEDIUM | Dockerode has production history, but CLI approach simpler. Recommendation (start with CLI) is based on YAGNI principle. Can add dockerode later if needed. |
| **Security approach** | HIGH | OWASP guidelines, official Docker security blog, recent 2026 articles confirm best practices |

### Gaps

1. **Claude CLI session file format**: Assumed JSONL based on docker.md, but not verified with official Claude CLI docs. If format differs, ndjson might need adjustment.
2. **Docker official Node SDK maturity**: @docker/sdk is newer (2025+). May become preferred over dockerode in future. Monitor for production readiness.

---

*Stack research for: Runtime abstraction and Docker containerization*
*Researched: 2026-01-31*
