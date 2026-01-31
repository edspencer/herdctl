# Pitfalls Research

**Domain:** Adding Runtime Abstraction and Docker Containerization to Existing Node.js Agent Execution System
**Researched:** 2026-01-31
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Leaky Runtime Abstraction - Exposing Implementation Details

**What goes wrong:**
The abstraction layer exposes SDK-specific or CLI-specific details to FleetManager, forcing conditional logic throughout the codebase based on runtime type. For example, session IDs from SDK are structured differently than CLI session file paths, or streaming message formats differ enough that consumers need to know which runtime is active.

**Why it happens:**
Developers try to avoid "over-abstracting" and create minimal interfaces that don't fully hide runtime differences. They assume "we can fix it later" but integration points multiply quickly. Modern examples (2026) show this pattern with Docker/container abstractions failing on networking, volume permissions, and platform-specific builds.

**How to avoid:**
- Define runtime interface based on what FleetManager NEEDS, not what SDK/CLI PROVIDE
- Session IDs must be opaque strings - FleetManager never parses them
- Message format must be identical regardless of source (SDK async iterator vs file watching)
- If runtimes have fundamentally different capabilities, make those explicit in runtime metadata, not leaked through different message types
- Test abstraction by implementing both runtimes BEFORE integrating - if integration code needs `if (runtime.type === 'sdk')` checks, abstraction has leaked

**Warning signs:**
- FleetManager code contains `if (runtime.type === 'sdk')` or similar conditionals
- Different code paths for SDK vs CLI in job-executor.ts
- Session file path logic appearing outside runtime implementation
- Message processing needs to know message source to interpret correctly

**Phase to address:**
Phase 1 (Runtime Abstraction) - Define interface contract FIRST, implement both runtimes against it, verify no leakage before integration

---

### Pitfall 2: Path Resolution Chaos - Host vs Container Path Confusion

**What goes wrong:**
Code uses host machine paths (like `/Users/ed/herdctl-workspace/bragdoc-ai`) when Docker needs container paths (like `/home/agent/workspace`). This manifests as "no such file or directory" errors, incorrect CWD inside containers, mounting wrong directories, or Docker can't find authentication files because paths are expressed in host coordinates.

**Why it happens:**
The existing codebase works entirely with host paths. Adding Docker requires dual path systems: host paths for mounting, container paths for execution. Developers forget to translate paths at the boundary, or worse, mix the two systems. Cross-platform issues (Windows vs Unix paths) compound the problem.

**How to avoid:**
- Establish STRICT boundary: FleetManager and state layer work ONLY in host paths
- Runtime abstraction translates host → container paths at execution boundary
- Docker runtime implementation owns the mapping:
  - Workspace: `/Users/ed/herdctl-workspace/X` → `/home/agent/workspace`
  - Auth: `~/.config/claude/auth.json` → `/home/agent/.config/claude/auth.json` (read-only mount)
  - State: `.herdctl/sessions/` → separate Docker vs host session storage
- Never pass container paths back to FleetManager
- Document which paths are "host coordinates" vs "container coordinates" in type definitions
- Use path validation at runtime boundaries to catch leakage

**Warning signs:**
- Docker runtime receives workspace path and doesn't transform it
- Container execution fails with "chdir to cwd failed: no such file or directory"
- Authentication files mounted but agent can't find them (wrong container path)
- Session files written to container path that doesn't exist on host
- Windows developers report different behavior than Mac/Linux (path format issues)

**Phase to address:**
Phase 2 (Docker Runtime) - Establish path translation layer immediately, before first container launch

---

### Pitfall 3: File Watching Race Conditions - CLI Session File Access Timing

**What goes wrong:**
CLI runtime watches session file for new messages. File watching introduces race conditions: messages written atomically but reader catches partial writes, file watcher fires before write completes, multiple writers (CLI itself + herdctl file watcher) cause concurrent access corruption, or inotify/FSEvents miss rapid successive writes.

**Why it happens:**
File watching is inherently racy - filesystem events are not transactional. The existing SDK runtime has native async iterator streaming, avoiding this entirely. Adding file watching reintroduces classical concurrent file access problems. Recent 2025 vulnerabilities (CVE-2025-52881) showed race conditions with shared mounts leading to system compromise.

**How to avoid:**
- Use line-oriented reads from JSONL files - readline scanning minimizes partial read risk
- Never assume file watcher fires immediately or exactly once per write
- Implement debouncing: wait 50-100ms after file change before reading
- Read file from last known position, not from beginning (maintain file offset)
- Accept that some messages may be delayed by 100-200ms vs SDK streaming
- Consider tailing file continuously rather than event-driven watching (simpler, more reliable)
- Gracefully handle malformed JSON lines - log and skip, don't crash
- Test with rapid message generation (1000+ messages/sec) to verify no corruption

**Warning signs:**
- JSON parse errors in message processor when using CLI runtime
- Messages arrive out of order or are dropped
- File watcher triggers but no new messages found (race condition)
- Duplicate messages processed (watcher fires twice for one write)
- Tests pass but production shows message loss

**Phase to address:**
Phase 1 (Runtime Abstraction) - Design CLI file watching with race condition mitigation from day one

---

### Pitfall 4: Docker Authentication Leakage - Secrets in Image Layers or Logs

**What goes wrong:**
Claude authentication files/tokens copied into Docker image during build (baked into layer), mounted read-write allowing container to modify host credentials, logged to console/job output exposing API keys, or passed via environment variables that are visible in `docker inspect` and process lists.

**Why it happens:**
Developers prioritize "making it work" over security. Copying auth files into Dockerfile seems easy. Environment variables are familiar. Both are dangerous for secrets. Modern best practices (2026) emphasize BuildKit secret mounts and read-only mounting, but developers trained on older patterns skip these.

**How to avoid:**
- NEVER copy auth files in Dockerfile - use volume mounting ONLY
- Mount auth directory read-only: `-v ~/.config/claude:/home/agent/.config/claude:ro`
- Never pass API keys via `-e ANTHROPIC_API_KEY=xxx` (visible in docker inspect)
- If environment variables needed, use Docker secrets or read from mounted file
- Sanitize job output logs - strip any message containing API keys before writing to .herdctl/jobs/*.jsonl
- Use .dockerignore to prevent accidental auth file inclusion
- Test: Run `docker inspect <container>` and verify no secrets visible

**Warning signs:**
- Dockerfile contains `COPY ~/.config/claude ./config` or similar
- Container can write to auth directory (mounted read-write)
- Job logs contain strings matching API key patterns
- Docker inspect shows ANTHROPIC_API_KEY environment variable
- Auth files show up in `docker history <image>`

**Phase to address:**
Phase 2 (Docker Runtime) - Security review BEFORE first production deployment

---

### Pitfall 5: Session Storage Isolation Failure - Docker vs Host Session Confusion

**What goes wrong:**
Docker containers write session files to `/home/agent/.local/share/claude/sessions/` inside container, which either disappears when container stops (no volume mount) or overwrites host session files (mounted to host .local), leading to session ID collisions, host runtime loading Docker sessions (incompatible paths inside session state), or lost sessions after container restarts.

**Why it happens:**
Developers assume "sessions are sessions" and mount host session directory into container. But Docker sessions contain container paths (/home/agent/workspace) while host sessions contain host paths (/Users/ed/herdctl-workspace). Mixing them corrupts both. Session ID collisions are also likely if both runtimes generate IDs simultaneously.

**How to avoid:**
- Store Docker sessions SEPARATELY from host sessions:
  - Host sessions: `.herdctl/sessions/host/`
  - Docker sessions: `.herdctl/sessions/docker/`
- Docker runtime mounts its own session directory: `-v $(pwd)/.herdctl/sessions/docker:/home/agent/.local/share/claude/sessions`
- Session IDs prefixed by runtime: `sdk-<uuid>` vs `cli-<uuid>` vs `docker-cli-<uuid>`
- FleetManager tracks which runtime created each session (metadata in job)
- Session resume must use SAME runtime that created it (enforce in runtime abstraction)
- Document that Docker sessions are not portable to host runtime

**Warning signs:**
- Session resume fails with "workspace not found" errors
- `docker inspect` shows no volume mount for session storage
- Session files disappear after container restart
- Session files contain mixed host/container paths
- Two runtimes try to use same session ID simultaneously

**Phase to address:**
Phase 2 (Docker Runtime) - Session isolation architecture defined before container implementation

---

### Pitfall 6: Container Escape and Privilege Escalation

**What goes wrong:**
Agent running in container exploits vulnerabilities to escape and execute on host, gains access to host filesystem beyond mounted volumes, escalates to root on host machine, or modifies sensitive host files through volume mounts (like /proc files in recent CVE-2025-52881).

**Why it happens:**
Containers run with excessive privileges by default (not using `--security-opt=no-new-privileges`), mount dangerous host directories, run as root inside container, or use outdated runc/Docker versions with known escape vulnerabilities. Recent 2025 vulnerabilities (CVE-2025-31133, CVE-2025-52565, CVE-2025-52881) showed race conditions and mount operations enabling container escape.

**How to avoid:**
- Run containers with minimal privileges:
  - `--security-opt=no-new-privileges:true`
  - `--cap-drop=ALL` and only add required capabilities
  - `--read-only` for root filesystem where possible
- Use non-root user inside container (Dockerfile: `USER agent`)
- Never mount sensitive host directories (/, /proc, /sys, /var/run/docker.sock)
- Mount workspace and auth read-only where possible
- Keep Docker and runc updated (>= 1.2.8, 1.3.3, or 1.4.0-rc.3 for 2025 CVEs)
- Use user namespace remapping for additional isolation
- Monitor container activity for suspicious behavior

**Warning signs:**
- Containers running as root user
- Wide volume mounts like `-v /:/host`
- Docker socket mounted into containers
- Missing --security-opt flags
- Running Docker Desktop < 4.41.0 or runc < 1.2.8

**Phase to address:**
Phase 2 (Docker Runtime) - Security hardening implemented from first container launch

---

### Pitfall 7: Node.js PID 1 Signal Handling Failure

**What goes wrong:**
Node.js process runs as PID 1 inside Docker container and doesn't respond to SIGTERM/SIGINT signals, container hangs on shutdown requiring `docker kill -9`, graceful shutdown hooks never fire causing data loss, or zombie processes accumulate inside container.

**Why it happens:**
Kernel treats PID 1 specially - it doesn't invoke default signal handlers. Node.js wasn't designed to run as PID 1. When `docker stop` sends SIGTERM to container, Node.js PID 1 process ignores it, Docker waits for timeout (10s default), then sends SIGKILL. This is a well-known 2026 pitfall for Node.js in containers.

**How to avoid:**
- Use lightweight init system like tini or dumb-init as PID 1:
  ```dockerfile
  RUN apk add --no-cache tini
  ENTRYPOINT ["/sbin/tini", "--"]
  CMD ["node", "runner.js"]
  ```
- Or use `docker run --init` flag (uses Docker's built-in tini)
- Implement proper signal handlers in Node.js code regardless:
  ```typescript
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await cleanup();
    process.exit(0);
  });
  ```
- Test graceful shutdown: `docker stop <container>` should complete in < 10s

**Warning signs:**
- `docker stop` takes 10+ seconds (hitting timeout)
- Container logs show no "shutting down" messages
- Orphaned processes inside container (docker exec ps aux shows zombies)
- Data loss after container stops (writes not flushed)

**Phase to address:**
Phase 2 (Docker Runtime) - Container setup includes init system from start

---

### Pitfall 8: node_modules Mount Conflict - Dependencies Vanish in Container

**What goes wrong:**
Workspace mounted from host into container with `-v ~/herdctl-workspace/project:/home/agent/workspace`, but host's node_modules (compiled for macOS) overwrites container's node_modules (compiled for Linux), causing "module not found" or "incompatible binary" errors. Or container has no node_modules because host doesn't (agent workspace is a git clone with no install).

**Why it happens:**
Docker bind mount replaces the entire destination directory. If host directory contains node_modules, it shadows the container's. If native dependencies exist (like sqlite3, canvas, sharp), they're compiled for host OS, not container OS. This is a persistent Docker + Node.js pitfall in 2026.

**How to avoid:**
- Use anonymous volume to protect container's node_modules:
  ```bash
  docker run \
    -v ~/herdctl-workspace/project:/home/agent/workspace \
    -v /home/agent/workspace/node_modules \
    image
  ```
- Or exclude node_modules from bind mount entirely (keep it only in container)
- Or don't run npm install in Dockerfile - let agent run it if needed (depends on workflow)
- Add node_modules to .dockerignore
- For herdctl agents: workspace is a git clone, probably has no node_modules anyway
- Document whether agents are expected to run `npm install` themselves

**Warning signs:**
- "Cannot find module" errors when running in container
- "Error: Module did not self-register" (native module compiled for wrong OS)
- Slow container startup because npm install runs every time
- Works locally but fails in Docker

**Phase to address:**
Phase 2 (Docker Runtime) - Volume mount strategy defined before first agent execution

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Treating containers like VMs (install everything: nginx, pm2, supervisord) | Familiar workflow | Massive image sizes (>1GB), slow deploys, security surface, unclear PID 1 responsibility | Never - containers are single-process isolation units |
| Using environment variables for secrets | Easy to configure | Visible in `docker inspect`, process lists, logs; security vulnerability | Only for non-sensitive config (ports, feature flags) |
| File watching without debouncing | Simple implementation | Race conditions, duplicate messages, corrupted reads | Never in production - always debounce file watchers |
| Mounting workspace read-write | Agent can modify files | Agent can corrupt host workspace, security risk if container compromised | Acceptable IF workspace is dedicated agent clone (not developer's working copy) |
| Single runtime implementation first | Faster to ship | Abstraction designed for one implementation, hard to add second | Acceptable for Phase 1 IF abstraction interface is defined properly upfront |
| Copying auth files into Docker image | Easy during development | Secrets baked into layers, leaked in docker history, security nightmare | Never acceptable even in dev - use volume mounts |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Agent SDK in Docker | Assuming SDK works identically in container | SDK needs same auth file paths, but mounted from host; session storage must be volume-mounted or lost on restart |
| File watching (CLI runtime) | Using native fs.watch which misses events on some systems | Use chokidar or similar library with polling fallback; implement debouncing; handle missed events gracefully |
| Docker volume mounts | Mounting entire workspace including .git, node_modules | Mount selectively OR use anonymous volumes for node_modules; .git usually safe but large |
| Session file JSONL | Assuming writes are atomic line-by-line | JSONL writes CAN be partial; use readline scanning, skip malformed lines, don't assume atomicity |
| Cross-platform paths | Using Unix paths everywhere | Abstract path operations; test on Windows; Docker uses Unix paths internally even on Windows host |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading entire session file on every update | 100% CPU on file watcher, slowdown over time | Read from last known file offset, only process new lines | Session files > 10MB (~50K messages) |
| Starting new Docker container for every job | 2-5s overhead per job, slow agent scheduling | Reuse long-running containers, execute jobs via `docker exec` | High-frequency jobs (< 5min intervals) |
| Synchronous file I/O in message processor | Event loop blocking, delayed streaming | Use async file operations (fs/promises), stream processing | High message throughput (>100 msg/sec) |
| No container resource limits | One agent consumes all memory/CPU, starves others | Set `--memory`, `--cpus` limits per container | Multiple agents on same host |
| Polling file watcher (no inotify/FSEvents) | High CPU usage checking for changes | Use native file watching with polling fallback only | Watching many files or high-frequency changes |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Mounting Docker socket into agent container | Agent can control host Docker daemon, complete compromise | Never mount /var/run/docker.sock unless explicitly needed for Docker-in-Docker use cases |
| Read-write auth file mounts | Agent can steal/modify credentials | Mount auth directory read-only (`:ro` flag) |
| Running agents as root in container | Container escape = root on host | Create non-root user in Dockerfile, use `USER agent` directive |
| Logging API keys in job output | Credentials leaked to .herdctl/jobs/*.jsonl files | Sanitize output before writing to logs; detect and redact API key patterns |
| Shared session storage between runtimes | Session path confusion enables arbitrary file access | Segregate Docker vs host sessions; enforce runtime-specific session directories |
| Wide volume mounts (mounting /) | Container can read arbitrary host files | Mount minimal necessary paths; never mount /, /etc, /proc, /sys |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cryptic path resolution errors | User sees "no such file or directory" with container path they never specified | Log both host and container paths in error messages; explain path translation |
| Silent session file corruption | Job completes but session can't resume, no explanation | Validate session file integrity on write; checksum or schema validation; clear error if corrupted |
| No indication of runtime type | User confused why behavior differs between agents | Log runtime type at job start; expose in status output; document runtime-specific behaviors |
| Docker failure with no Docker installed | Stack trace instead of helpful error | Check for Docker availability on startup; friendly error: "Docker runtime requires Docker installed" |
| Mixed host/Docker sessions with same ID | Resume fails mysteriously | Prefix session IDs by runtime; validate runtime match on resume; error: "Session X created with SDK, cannot resume with CLI" |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Runtime abstraction:** Often missing session resume compatibility check - verify runtime that created session matches runtime attempting resume
- [ ] **Docker implementation:** Often missing security flags - verify `--security-opt=no-new-privileges`, non-root user, read-only mounts
- [ ] **CLI file watching:** Often missing debouncing and partial read handling - verify works with rapid message generation (stress test)
- [ ] **Session isolation:** Often missing runtime-specific storage - verify Docker sessions in `.herdctl/sessions/docker/`, host in separate directory
- [ ] **Path translation:** Often missing validation at boundaries - verify container never receives host paths, FleetManager never receives container paths
- [ ] **Authentication mounting:** Often missing read-only flag - verify auth mounts have `:ro` suffix
- [ ] **Signal handling:** Often missing graceful shutdown - verify `docker stop` completes in < 10s without timeout
- [ ] **Error messages:** Often missing context - verify errors include both host and container paths, runtime type, session metadata

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Leaked abstraction (runtime-specific code in FleetManager) | HIGH | Extract runtime-specific logic to runtime implementations; add tests verifying both runtimes work; may require refactoring FleetManager |
| Path confusion (mixed host/container paths) | MEDIUM | Audit all path usages; add TypeScript branded types for HostPath vs ContainerPath; add validation at runtime boundaries |
| Session corruption from race conditions | LOW | Implement session file validation; rebuild corrupted sessions from job metadata; improve file watching debouncing |
| Secrets leaked in Docker image | HIGH | Revoke leaked credentials immediately; rebuild image without secrets; audit for exposure; implement secret scanning in CI |
| Container escape vulnerability | CRITICAL | Update Docker/runc immediately; restart all containers with security flags; audit for compromise; review all volume mounts |
| PID 1 signal handling failure | LOW | Add tini to container; redeploy with `--init` flag; implement signal handlers in code |
| node_modules conflict | LOW | Add anonymous volume for node_modules; document in agent setup; may need container rebuild |
| Session isolation failure | MEDIUM | Migrate sessions to separate directories; update session metadata with runtime type; implement session validation |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Leaky runtime abstraction | Phase 1 (Runtime Abstraction) | Both SDK and CLI runtimes implemented; FleetManager has zero `if (runtime.type)` conditionals |
| Path resolution chaos | Phase 2 (Docker Runtime) | Path translation layer tested; container receives only container paths; errors show both path types |
| File watching race conditions | Phase 1 (Runtime Abstraction) | CLI runtime stress-tested with 1000+ rapid messages; no corruption or dropped messages |
| Docker auth leakage | Phase 2 (Docker Runtime) | `docker inspect` shows no secrets; auth mounted read-only; job logs sanitized |
| Session storage isolation | Phase 2 (Docker Runtime) | Docker sessions in separate directory; session resume validates runtime match |
| Container escape | Phase 2 (Docker Runtime) | Security flags verified; non-root user; minimal volume mounts; Docker/runc updated |
| PID 1 signal handling | Phase 2 (Docker Runtime) | `docker stop` completes < 10s; graceful shutdown logged |
| node_modules conflict | Phase 2 (Docker Runtime) | Anonymous volume for node_modules; documented in agent setup guide |

## Sources

**Docker & Node.js Best Practices:**
- [10 best practices to containerize Node.js web applications with Docker | Snyk Blog](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/)
- [10 Common Docker Mistakes That Hurt Node.js App Performance - DEV Community](https://dev.to/arunangshu_das/10-common-docker-mistakes-that-hurt-nodejs-app-performance-1olc)
- [Pitfalls to Avoid When Implementing Node.js and Containers - Linux.com](https://www.linux.com/tutorials/pitfalls-avoid-when-implementing-nodejs-and-containers/)
- [docker-node/docs/BestPractices.md at main · nodejs/docker-node](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)

**Docker Volume and Path Issues:**
- [Docker Volumes and the node_modules Conundrum | by Justinecodez | Medium](https://medium.com/@justinecodez/docker-volumes-and-the-node-modules-conundrum-fef34c230225)
- [The problem with Docker and node modules for Node.js development | Jay Gould](https://jaygould.co.uk/2022-08-12-docker-node-problems-development-prisma/)
- [How to Configure Docker Working Directory Paths Effectively | LabEx](https://labex.io/tutorials/docker-how-to-configure-docker-working-directory-paths-effectively-392792)

**Docker Security Best Practices:**
- [4 Ways to Securely Store & Manage Secrets in Docker](https://blog.gitguardian.com/how-to-handle-secrets-in-docker/)
- [How to Keep Docker Secrets Secure: Complete Guide](https://spacelift.io/blog/docker-secrets)
- [Secrets | Docker Docs](https://docs.docker.com/build/building/secrets/)
- [Manage sensitive data with Docker secrets | Docker Docs](https://docs.docker.com/engine/swarm/secrets/)

**Container Escape Vulnerabilities (2025-2026):**
- [runc Vulnerability Enables Container Isolation Bypass - Active Exploits Possible](https://cyberpress.org/runc-vulnerability/)
- [Container Privilege Escalation Vulnerabilities Explained](https://www.aikido.dev/blog/container-privilege-escalation)
- [Container Breakout Vulnerabilities | container-security.site](https://www.container-security.site/attackers/container_breakout_vulnerabilities.html)
- [Leaky Vessels: Deep Dive on Container Escape Vulnerabilities | Wiz Blog](https://www.wiz.io/blog/leaky-vessels-container-escape-vulnerabilities)
- [Stop Container Escape and Prevent Privilege Escalation](https://goteleport.com/blog/stop-container-escape-privilege-escalation/)

**Leaky Abstractions (2026):**
- [Modern Law of Leaky Abstractions](https://codecube.net/2026/1/modern-law-leaky-abstractions/)
- [The Law of Leaky Abstractions – Joel on Software](https://www.joelonsoftware.com/2002/11/11/the-law-of-leaky-abstractions/)
- [Leaky Abstractions | Alex Kondov - Software Engineer](https://alexkondov.com/leaky-abstractions/)

**Concurrency and Session Management:**
- [Concurrency control - Wikipedia](https://en.wikipedia.org/wiki/Concurrency_control)
- [Concurrent Sessions Control :: Spring Security](https://docs.spring.io/spring-security/reference/reactive/authentication/concurrent-sessions-control.html)

**Project Context:**
- herdctl SPEC.md - Architecture and design decisions
- herdctl .planning/STATE.md - Current implementation status
- herdctl packages/core/src/runner/ - Existing SDK-based execution

---
*Pitfalls research for: herdctl milestone v1.0 (Runtime Abstraction + Docker)*
*Researched: 2026-01-31*
*Focus: Integration pitfalls when adding multi-runtime support and containerization to existing agent execution system*
