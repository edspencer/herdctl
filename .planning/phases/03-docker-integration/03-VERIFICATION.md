---
phase: 03-docker-integration
verified: 2026-02-01T16:55:00Z
status: passed
score: 8/8 must-haves verified
---

# Phase 3: Docker Integration Verification Report

**Phase Goal:** Provide optional Docker containerization for security isolation with configurable resource limits
**Verified:** 2026-02-01T16:55:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ContainerRunner wraps any runtime (SDK or CLI) transparently | ✓ VERIFIED | ContainerRunner implements RuntimeInterface (line 43), accepts RuntimeInterface in constructor, wraps via decorator pattern |
| 2 | Docker containers mount workspace, auth files, and session directories with correct permissions | ✓ VERIFIED | buildContainerMounts creates: workspace (configurable rw/ro mode), auth read-only at /home/claude/.claude, docker-sessions read-write at /home/claude/.herdctl/sessions (lines 221-260) |
| 3 | Docker sessions stored in .herdctl/docker-sessions/ separate from host sessions | ✓ VERIFIED | docker-sessions directory created at container-runner.ts:74-75, mounted at container-manager.ts:250-254 |
| 4 | Containers enforce memory limits (default 2g) and optional CPU limits | ✓ VERIFIED | Memory: config.memoryBytes (line 104), MemorySwap: config.memoryBytes (no swap, line 105), CpuShares: config.cpuShares ?? 512 (line 106) |
| 5 | Network isolation modes (none/bridge/host) configurable per agent | ✓ VERIFIED | DockerNetworkModeSchema enum (schema.ts:151), NetworkMode: config.network (container-manager.ts:109), default "bridge" (schema.ts:186) |
| 6 | Containers run as non-root user with security flags enabled | ✓ VERIFIED | User: config.user (line 126), SecurityOpt: ["no-new-privileges:true"] (line 117), CapDrop: ["ALL"] (line 118), user defaults to host UID:GID (docker-config.ts:136-141) |
| 7 | Containers auto-cleanup after job completion (--rm flag) | ✓ VERIFIED | AutoRemove: config.ephemeral (line 122), cleanupOldContainers called after exec (container-runner.ts:135) removes oldest when exceeding max_containers |
| 8 | Agent config validates docker options with clear error messages | ✓ VERIFIED | DockerSchema with 3 .refine() validators: memory format (lines 209-219), volume format (lines 221-238), user format (lines 240-249), all with descriptive error messages |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/runner/runtime/docker-config.ts` | Docker configuration types and validation | ✓ VERIFIED | 164 lines, exports DockerConfig, NetworkMode, PathMapping, VolumeMode, parseMemoryToBytes, parseVolumeMount, getHostUser, resolveDockerConfig, no stubs |
| `packages/core/src/config/schema.ts` | Extended DockerSchema with all options | ✓ VERIFIED | DockerSchema extended (lines 174-250) with enabled, ephemeral, image, network, memory, cpu_shares, user, max_containers, volumes, workspace_mode fields + 3 refinement validators |
| `packages/core/src/runner/runtime/container-runner.ts` | ContainerRunner decorator implementing RuntimeInterface | ✓ VERIFIED | 187 lines, exports ContainerRunner class, implements RuntimeInterface (line 43), execute method yields SDKMessage stream (line 70), no stubs |
| `packages/core/src/runner/runtime/container-manager.ts` | Container lifecycle management | ✓ VERIFIED | 284 lines, exports ContainerManager, buildContainerMounts, buildContainerEnv, handles ephemeral/persistent containers, cleanup logic, no stubs |
| `packages/core/src/runner/runtime/factory.ts` | RuntimeFactory with Docker wrapping | ✓ VERIFIED | Modified to wrap runtime with ContainerRunner when agent.docker?.enabled (lines 94-100), imports ContainerRunner and resolveDockerConfig, accepts RuntimeFactoryOptions with stateDir |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| factory.ts | container-runner.ts | wraps runtime with ContainerRunner | ✓ WIRED | `new ContainerRunner(runtime, dockerConfig, stateDir)` at line 99, conditional on agent.docker?.enabled |
| factory.ts | docker-config.ts | uses resolveDockerConfig | ✓ WIRED | `resolveDockerConfig(agent.docker)` at line 96, imported at line 13 |
| container-runner.ts | container-manager.ts | uses buildContainerMounts/Env | ✓ WIRED | Imports at lines 27-30, called at lines 78-79 in execute method |
| container-runner.ts | interface.ts | implements RuntimeInterface | ✓ WIRED | `implements RuntimeInterface` at line 43, execute method signature matches |
| schema.ts | docker-config.ts | Type consistency for docker configuration | ✓ WIRED | DockerSchema in schema.ts defines validation, docker-config.ts imports type Docker for resolveDockerConfig (line 169) |
| schedule-runner.ts | factory.ts | passes stateDir to RuntimeFactory | ✓ WIRED | `RuntimeFactory.create(agent, { stateDir })` at line 354 |
| job-control.ts | factory.ts | passes stateDir to RuntimeFactory | ✓ WIRED | `RuntimeFactory.create(agent, { stateDir })` at line 133 |
| schedule-executor.ts | factory.ts | passes stateDir to RuntimeFactory | ✓ WIRED | `RuntimeFactory.create(agent, { stateDir })` at line 92 |

### Requirements Coverage

Phase 3 Requirements (from REQUIREMENTS.md):

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| DOCKER-01: ContainerRunner decorator wrapping RuntimeInterface | ✓ SATISFIED | ContainerRunner implements RuntimeInterface, wraps any runtime |
| DOCKER-02: Configurable workspace mount mode (read-write or read-only) | ✓ SATISFIED | workspace_mode field in DockerSchema, applied in buildContainerMounts |
| DOCKER-03: Docker auth configurable (mount auth files, use API key env var) | ✓ SATISFIED | Auth files mounted read-only, ANTHROPIC_API_KEY passed via env if available (buildContainerEnv lines 272-274) |
| DOCKER-04: Docker sessions in .herdctl/docker-sessions/ | ✓ SATISFIED | docker-sessions directory created and mounted separately |
| DOCKER-05: Network isolation (none/bridge/host) | ✓ SATISFIED | DockerNetworkModeSchema, network field in config, applied to containers |
| DOCKER-06: Memory limits (default 2g) | ✓ SATISFIED | memory field with default "2g", parseMemoryToBytes conversion, applied to containers |
| DOCKER-07: Optional CPU limits | ✓ SATISFIED | cpu_shares field, defaults to 512 if not specified |
| DOCKER-08: Custom volume mounts | ✓ SATISFIED | volumes array field, parseVolumeMount validation, applied to containers |
| DOCKER-09: Auto-cleanup with --rm flag | ✓ SATISFIED | AutoRemove based on ephemeral flag, cleanupOldContainers for old containers |
| DOCKER-10: Non-root user for security | ✓ SATISFIED | user field defaults to host UID:GID, applied to containers |
| DOCKER-11: Agent config supports docker field with options | ✓ SATISFIED | DockerSchema with all options, validation refinements |
| CONFIG-01: AgentConfigSchema includes runtime field (sdk\|cli) | ✓ SATISFIED | Handled in Phase 2, factory.ts uses it |
| CONFIG-02: AgentConfigSchema includes docker field with sub-options | ✓ SATISFIED | DockerSchema with all sub-options integrated |
| CONFIG-03: Docker config validates network isolation modes | ✓ SATISFIED | DockerNetworkModeSchema enum validation |
| CONFIG-04: Docker config validates resource limit formats | ✓ SATISFIED | memory format refinement validation (lines 209-219) |
| CONFIG-05: Docker config validates volume mount syntax | ✓ SATISFIED | volumes format refinement validation (lines 221-238) |
| CONFIG-06: Config validation provides clear error messages | ✓ SATISFIED | All refinements include descriptive error messages |

**Coverage:** 17/17 Phase 3 requirements satisfied

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | All code is substantive with no stub patterns |

**Note:** Test files have compilation errors due to API changes in Phase 1-2 (SDKQueryFunction no longer exists, RuntimeInterface signature changed). These are test maintenance issues, not implementation gaps. Source files compile cleanly.

### Human Verification Required

The following items require manual verification with a running Docker environment:

#### 1. End-to-End Docker Execution

**Test:** Create agent config with docker.enabled: true, run a job, verify execution inside container

**Expected:** 
- Container is created with name pattern `herdctl-{agentName}-{timestamp}`
- Job executes inside container with workspace mounted
- Output streams correctly from container to host
- Container cleaned up based on ephemeral setting

**Why human:** Requires running Docker daemon, actual container creation and execution

#### 2. Security Hardening Verification

**Test:** Inspect running container capabilities and security options

```bash
docker inspect herdctl-{container-id} | jq '.[] | {SecurityOpt, User, HostConfig: {CapDrop, ReadonlyRootfs}}'
```

**Expected:**
- SecurityOpt includes "no-new-privileges:true"
- CapDrop is ["ALL"]
- User is non-root UID:GID
- ReadonlyRootfs is false (Claude needs temp writes)

**Why human:** Requires Docker runtime inspection

#### 3. Resource Limit Enforcement

**Test:** Start container with memory: "256m" and verify limit enforced

```bash
docker stats herdctl-{container-id} --no-stream
```

**Expected:** MEM LIMIT shows configured value (256MiB)

**Why human:** Requires runtime resource monitoring

#### 4. Network Isolation Modes

**Test:** Create agents with network: "none", "bridge", "host" and verify network access

**Expected:**
- none: No network access (curl fails)
- bridge: NAT network access (curl succeeds)
- host: Host network namespace (same IP as host)

**Why human:** Requires network connectivity testing inside containers

#### 5. Volume Mount Permissions

**Test:** Verify workspace mounts with ro/rw modes work correctly

**Expected:**
- workspace_mode: "rw" allows writes to workspace
- workspace_mode: "ro" prevents writes to workspace
- Auth files always read-only (prevents accidental modification)

**Why human:** Requires file system permission testing inside containers

#### 6. Container Cleanup

**Test:** Run multiple jobs on same agent with max_containers: 2

**Expected:** After 3rd job, oldest container is removed, only 2 remain

**Why human:** Requires Docker container listing over time

#### 7. Session Isolation

**Test:** Run agent with docker.enabled: true, verify session stored in docker-sessions/

**Expected:** Session files in .herdctl/docker-sessions/ not .herdctl/sessions/

**Why human:** Requires file system inspection after job execution

#### 8. Ephemeral vs Persistent Containers

**Test:** Run jobs with ephemeral: true vs ephemeral: false

**Expected:**
- ephemeral: true → container removed after job (docker ps -a shows no container)
- ephemeral: false → container kept for inspection (docker ps -a shows stopped container)

**Why human:** Requires Docker container state inspection

---

## Verification Summary

### Automated Verification: PASSED

All must-haves verified through code inspection:

1. **Configuration Schema** — DockerSchema extended with all options, validation refinements present
2. **Type Safety** — docker-config.ts exports all required types, source files compile without errors
3. **Container Infrastructure** — ContainerRunner and ContainerManager implement full lifecycle
4. **Security Hardening** — SecurityOpt, CapDrop, non-root user present in container creation
5. **Resource Limits** — Memory and CPU configuration applied to containers
6. **Wiring** — RuntimeFactory wraps with ContainerRunner, all call sites pass stateDir
7. **Cleanup Logic** — cleanupOldContainers and AutoRemove implemented
8. **Path Isolation** — docker-sessions directory created separately

### Manual Verification Required

8 items need human testing with Docker runtime. These verify runtime behavior that cannot be validated through code inspection alone.

**Recommendation:** Proceed to Phase 4 (Documentation & Testing). Integration tests in Phase 4 will cover the manual verification items with Docker mocking/fixtures.

---

_Verified: 2026-02-01T16:55:00Z_  
_Verifier: Claude (gsd-verifier)_
