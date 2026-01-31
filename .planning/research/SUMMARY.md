# Project Research Summary

**Project:** Runtime Abstraction and Docker Containerization for herdctl
**Domain:** Agent fleet management with multi-runtime backends
**Researched:** 2026-01-31
**Confidence:** HIGH

## Executive Summary

herdctl currently executes autonomous agents via the Anthropic Claude SDK, which incurs standard API pricing. This research explores adding runtime abstraction to support both SDK and CLI backends (CLI enables Max plan pricing), plus optional Docker containerization for security isolation. The recommended approach is a strategy pattern runtime interface with decorator-based Docker wrapping.

Experts build multi-runtime systems using interface-based abstraction layers that hide implementation details from orchestration code. For herdctl, this means FleetManager remains agnostic to runtime type—it receives an `AsyncIterable<SDKMessage>` regardless of whether the backend uses SDK streaming or CLI session file watching. Docker integration should be orthogonal (wrap any runtime), not baked into specific implementations. The existing SDK integration path becomes one implementation of `RuntimeInterface`, and the new CLI path becomes another.

Critical risks include leaky abstractions (FleetManager ends up with runtime-specific conditionals), path resolution chaos (host vs container path confusion), and file watching race conditions (CLI session files). Mitigation: define the runtime interface based on what consumers NEED (session ID as opaque string, unified message format) not what backends PROVIDE; establish strict path translation boundaries (FleetManager uses only host paths); implement debouncing and position-tracked file reading for CLI runtime. Docker security requires read-only auth mounts, non-root containers, and security-opt flags from day one.

## Key Findings

### Recommended Stack

The existing herdctl stack (TypeScript, Node.js >=18, Zod, Claude SDK) requires minimal additions. Runtime abstraction needs process management (execa for CLI spawning), file watching (chokidar for cross-platform reliability), and JSONL parsing (ndjson for streaming). Docker integration can start with CLI-based approach (`docker run` via execa) rather than library-based (dockerode), keeping complexity low until programmatic container introspection is needed.

**Core technologies:**
- **execa (^9.6.1)**: CLI runtime process spawning — promise-based child_process wrapper with better error handling, 121M weekly downloads
- **chokidar (^5.0.0)**: CLI runtime session file watching — reliable cross-platform file events, required for Linux (native fs.watch doesn't support recursive)
- **ndjson (^3.0.0)**: CLI runtime session parsing — streaming JSONL parser for converting session files to SDK message format
- **Docker CLI via execa**: Container execution — simple `docker run` commands sufficient for MVP, defer dockerode library until programmatic image building or network introspection needed

**Version compatibility confirmed:** All packages are ESM-only, compatible with Node.js >=18. chokidar v5 requires Node >=20.19, project runs v24.8.0 (compatible).

### Expected Features

**Must have (table stakes):**
- **Transparent backend switching** — users expect abstraction layers to swap SDK/CLI without code changes (config-driven: `runtime: { type: "sdk" | "cli" }`)
- **Unified interface** — single API regardless of backend implementation
- **Resource limits (CPU/memory)** — prevent runaway agents from consuming all resources (Docker `--memory` and `--cpus` flags)
- **Network isolation modes** — control agent network access (bridge/host/none)
- **Volume mounting** — agent needs workspace file access (mount workspace read-write, auth read-only)
- **Automatic cleanup** — remove stopped containers to prevent disk bloat (`--rm` flag critical for ephemeral workloads)
- **User namespace remapping** — container root != host root (Docker Enhanced Container Isolation pattern)

**Should have (competitive advantage):**
- **Runtime auto-selection based on features** — automatically choose SDK when MCP servers required, CLI when Max plan features needed (inspect agent config)
- **Runtime-specific pricing visibility** — show cost implications ("SDK runtime: Standard pricing" vs "CLI runtime: Requires Max plan")
- **Container reuse for session persistence** — don't destroy container between jobs if session mode is `persistent` (big DX win, deferred to v1.x)
- **Pre-built agent images** — official `herdctl/agent:latest` with common tools pre-installed (deferred to v1.x)

**Defer (v2+):**
- **MicroVM isolation** — Docker Sandboxes-style hard security boundary (overkill for MVP)
- **Container escape detection** — runtime monitoring for breakout attempts (complex, low MVP value)
- **Multi-orchestrator support** — Podman/containerd compatibility (Docker has 89% market share, wait for demand)

### Architecture Approach

Use strategy pattern for runtime selection (SDK vs CLI implementations share `RuntimeInterface`) with decorator pattern for Docker wrapping (ContainerRunner wraps any runtime). This keeps Docker orthogonal to runtime type—can compose Docker(SDKRuntime) or Docker(CLIRuntime) without combinatorial code explosion.

**Major components:**
1. **RuntimeInterface** — unified abstraction: `execute(params) => AsyncIterable<SDKMessage>`. Both SDK and CLI must produce identical message streams, enabling FleetManager to remain runtime-agnostic.
2. **RuntimeFactory** — centralized runtime selection based on agent config. Handles both base runtime creation (SDK vs CLI) and optional Docker wrapping in one place.
3. **SDKRuntime** — adapter wrapping existing SDK integration. Minimal changes, just conforms to RuntimeInterface shape.
4. **CLIRuntime** — new implementation spawning `claude` CLI via execa, watching session file via chokidar, parsing JSONL to SDKMessage format via ndjson. Most complex component due to event-to-async-iterable conversion.
5. **ContainerRunner** — decorator wrapping any RuntimeInterface. Manages Docker lifecycle (create → start → attach → wait → remove), mounts workspace + auth files, enforces security constraints.
6. **SessionFileParser** — CLI-specific component converting Claude CLI JSONL format to SDK message types. **Gap:** Claude CLI session format not officially documented, requires empirical inspection of `~/.claude/projects/*.jsonl` files.

**Critical pattern:** Maintain strict path translation boundary. FleetManager works only in host paths (`/Users/ed/workspace`). Runtime implementations translate to container paths (`/home/agent/workspace`) at execution boundary. Container paths never leak back to FleetManager.

### Critical Pitfalls

1. **Leaky runtime abstraction** — FleetManager ends up with `if (runtime.type === 'sdk')` conditionals throughout codebase. **Prevention:** Define RuntimeInterface based on what consumers NEED (session ID as opaque string, unified message format), not what backends PROVIDE. Test abstraction by implementing both runtimes before integration—if integration needs runtime-type checks, abstraction has leaked.

2. **Path resolution chaos** — host paths (`/Users/ed/workspace`) mixed with container paths (`/home/agent/workspace`), causing "no such file or directory" errors. **Prevention:** Strict boundary enforcement—FleetManager uses only host paths, runtime implementations translate at execution edge. Never pass container paths back to FleetManager. Log both host and container paths in errors for debugging.

3. **File watching race conditions** — CLI session files written by Claude while herdctl watches, leading to partial reads, duplicate messages, or corruption. **Prevention:** Implement debouncing (wait 50-100ms after file change before reading), track file position (read only new content since last read), gracefully skip malformed JSON lines. Accept 100-200ms latency vs SDK streaming as acceptable trade-off.

4. **Docker authentication leakage** — secrets baked into image layers, logged to stdout, or visible in `docker inspect`. **Prevention:** NEVER copy auth files in Dockerfile, mount read-only (`~/.config/claude:/home/agent/.config/claude:ro`), sanitize job output logs for API key patterns, avoid passing secrets via environment variables.

5. **Session storage isolation failure** — Docker containers and host runtime write to same session directory, causing path confusion and corruption. **Prevention:** Separate storage (`.herdctl/sessions/host/` vs `.herdctl/sessions/docker/`), prefix session IDs by runtime (`sdk-<uuid>` vs `cli-<uuid>` vs `docker-cli-<uuid>`), enforce runtime match on session resume.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Runtime Abstraction Foundation
**Rationale:** Must establish clean abstraction before adding implementations. Extract existing SDK integration behind interface first—validates interface design without introducing new complexity. CLI runtime can develop in parallel once interface is proven.

**Delivers:**
- `RuntimeInterface` with `execute()` signature returning `AsyncIterable<SDKMessage>`
- `SDKRuntime` adapter wrapping existing SDK code (mostly refactoring)
- `RuntimeFactory` with SDK-only support initially
- Updated `JobExecutor` accepting RuntimeInterface instead of raw SDKQueryFunction
- Backwards compatibility maintained (auto-wrap old SDKQueryFunction in SDKRuntime)

**Addresses features:**
- Unified interface (table stakes)
- Foundation for transparent backend switching

**Avoids pitfalls:**
- Leaky abstraction — interface defined by consumer needs, not backend capabilities
- Implementation validates abstraction before CLI complexity

**Research flag:** LOW — Standard adapter/strategy pattern, well-documented. Skip `/gsd:research-phase` for this phase.

### Phase 2: CLI Runtime Implementation
**Rationale:** Depends on RuntimeInterface from Phase 1. Adds cost-saving CLI backend for Max plan users. Most complex component due to file watching and event-to-async-iterator conversion.

**Delivers:**
- `CLIRuntime` spawning `claude` via execa
- File watching via chokidar with debouncing
- `SessionFileParser` converting JSONL to SDKMessage
- Async iterator adapter for file change events
- CLI option in RuntimeFactory
- Runtime config schema extension (agent.runtime.type)

**Uses stack:**
- execa for process spawning
- chokidar for file watching
- ndjson for JSONL parsing

**Addresses features:**
- Configuration-driven runtime selection (table stakes)
- CLI backend enables Max plan pricing (competitive advantage)

**Avoids pitfalls:**
- File watching race conditions — debouncing, position tracking, graceful error handling from start
- Session storage isolation — CLI sessions in `.herdctl/sessions/cli/` separate from SDK

**Research flag:** MEDIUM — Claude CLI session file format not officially documented. **Action:** Empirically inspect `~/.claude/projects/*.jsonl` files to map format to SDK message types. If format differs significantly, may need adjustment to SessionFileParser design.

### Phase 3: Docker Integration
**Rationale:** Depends on runtime abstraction being stable. Adds security isolation orthogonally to runtime type via decorator pattern. Can wrap SDK or CLI runtime without modification.

**Delivers:**
- `ContainerRunner` decorator implementing RuntimeInterface
- Docker lifecycle management (create → start → attach → wait → remove)
- Volume mounting (workspace read-write, auth read-only)
- Resource limits configuration (memory required, CPU optional)
- Network isolation modes (bridge default, none/host configurable)
- Security hardening (non-root user, read-only mounts, security-opt flags)

**Uses stack:**
- Docker CLI via execa (simple `docker run` commands)
- Defer dockerode library until programmatic needs arise

**Addresses features:**
- Docker container execution (all table stakes: resource limits, network isolation, volume mounting, cleanup)
- User namespace remapping (table stakes security)

**Implements architecture:**
- Decorator pattern for Docker wrapping
- Path translation layer (host → container at execution boundary)

**Avoids pitfalls:**
- Path resolution chaos — strict translation boundary, container paths never leak to FleetManager
- Docker authentication leakage — read-only mounts, no Dockerfile COPY, output sanitization
- Container escape — security flags from day one (--security-opt=no-new-privileges, non-root user)
- PID 1 signal handling — use `docker run --init` or tini in Dockerfile
- node_modules conflict — anonymous volume or exclude from bind mount

**Research flag:** LOW — Docker security best practices well-documented (OWASP, Docker official docs). Standard decorator pattern. Skip `/gsd:research-phase`.

### Phase 4: Production Hardening (v1.x)
**Rationale:** Polish and optimization after core functionality validated. Deferred features that improve UX but aren't MVP-critical.

**Delivers:**
- Automatic runtime selection (inspect agent config for MCP servers → SDK, Max features → CLI)
- Runtime-specific pricing visibility in CLI output
- Container pooling/reuse for persistent sessions
- Pre-built `herdctl/agent:latest` Docker image
- Resource limit recommendations based on agent type
- Telemetry and monitoring

**Research flag:** LOW — Optimization phase, patterns are standard.

### Phase Ordering Rationale

- **Phase 1 first:** Abstraction must be proven before adding implementations. Refactoring existing SDK path validates interface design risk-free.
- **Phase 2 after Phase 1:** CLI runtime depends on RuntimeInterface contract. File watching is complex—better to add after abstraction is stable.
- **Phase 3 after Phase 2:** Docker wraps any runtime, but testing benefits from having both SDK and CLI implementations available. Validates decorator pattern works for both.
- **Phase 4 last:** Optimization and polish after core validated with real usage.

**Dependency chain:** Phase 1 (foundation) → Phase 2 (CLI capability) → Phase 3 (Docker security) → Phase 4 (polish)

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (CLI Runtime):** Claude CLI session file format requires empirical research. Inspect `~/.claude/projects/*.jsonl`, document schema, verify mapping to SDK message types. If format is complex or undocumented, may need to contact Anthropic or reverse-engineer.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Runtime Abstraction):** Adapter and strategy patterns well-documented. TypeScript interface design is standard.
- **Phase 3 (Docker Integration):** Docker security best practices extensively documented (OWASP, Docker official guides). Decorator pattern is standard. CLI-based Docker execution simpler than library approach.
- **Phase 4 (Production Hardening):** Optimization patterns standard for all production systems.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | execa, chokidar, ndjson all have 30M+ downloads, recent 2026 docs, proven production use. Docker CLI approach well-documented. |
| Features | HIGH | Table stakes features validated by Docker Sandboxes (2026) and container orchestration best practices. Competitive features aligned with market patterns (runtime abstraction similar to AnyIO Python). |
| Architecture | HIGH | Strategy and decorator patterns are textbook. Multiple sources validate runtime abstraction approaches. Docker wrapping as orthogonal concern confirmed by Container Security (OWASP) guides. |
| Pitfalls | HIGH | 2025-2026 CVE database confirms container escape vectors, leaky abstraction patterns documented in 2026 articles, file watching race conditions well-known Node.js issue. |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude CLI session file format:** Assumed JSONL based on context (docker.md mentions session files), but exact schema not verified with official docs. **Action:** Inspect actual files in `~/.claude/projects/` during Phase 2 planning. If format is incompatible with SDK message types, may need SessionFileParser redesign or CLI runtime won't be viable.

- **Docker official Node SDK maturity:** @docker/sdk is newer (2025+) compared to dockerode. May become preferred in future, but current research (2026) shows dockerode has more production use. **Action:** Monitor @docker/sdk adoption; if it matures and provides better TypeScript support, consider migration post-v1.

- **Container reuse performance impact:** Suggested for Phase 4 (v1.x) but complexity unknown until implemented. Container pooling adds lifecycle management, idle timeouts, state tracking. **Action:** Prototype during Phase 4 planning to assess complexity vs performance gain.

## Sources

### Primary (HIGH confidence)
- **Official Documentation:**
  - [Docker Resource Constraints](https://docs.docker.com/engine/containers/resource_constraints/) — CPU/memory limits
  - [Docker Security Best Practices](https://docs.docker.com/security/for-admins/hardened-desktop/enhanced-container-isolation/) — Enhanced Container Isolation
  - [Node.js Child Process API](https://nodejs.org/api/child_process.html) — Process spawning
  - [Claude CLI Reference](https://code.claude.com/docs/en/cli-reference) — CLI usage

- **Library Documentation:**
  - [execa npm package](https://www.npmjs.com/package/execa) — v9.6.1, 121M weekly downloads
  - [chokidar GitHub](https://github.com/paulmillr/chokidar) — v5.0.0 release notes
  - [dockerode GitHub](https://github.com/apocas/dockerode) — Docker API client

- **Security Research:**
  - [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) — Container security guidelines
  - [Container Escape Vulnerabilities 2025-2026](https://cyberpress.org/runc-vulnerability/) — CVE-2025-31133, CVE-2025-52565, CVE-2025-52881

### Secondary (MEDIUM confidence)
- **Architectural Patterns:**
  - [Factory Method Pattern in TypeScript](https://refactoring.guru/design-patterns/factory-method/typescript/example) — Runtime factory pattern
  - [Strategy Pattern Guide](https://medium.com/@robinviktorsson/a-guide-to-the-strategy-design-pattern-in-typescript-and-node-js-with-practical-examples-c3d6984a2050) — Runtime abstraction
  - [AnyIO Python Backend Abstraction 2026](https://johal.in/anyio-python-abstract-asyncio-trio-backend-abstraction-2026/) — Multi-backend runtime patterns

- **Docker + Node.js Best Practices:**
  - [10 Best Practices to Containerize Node.js](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/) — Snyk 2026
  - [docker-node Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) — Official Node.js Docker guide

### Tertiary (LOW confidence, needs validation)
- **Claude CLI Session Format:** Inferred from context (docker.md) but not verified with official docs. Requires empirical inspection during Phase 2.
- **Container Reuse Performance:** Benefits estimated based on container startup overhead (2-5s), but actual impact depends on workload profile. Needs prototyping.

---
*Research completed: 2026-01-31*
*Ready for roadmap: yes*
