---
phase: 03-docker-integration
plan: 01
title: Docker Configuration Schema Extension
subsystem: configuration
tags: [docker, schema, validation, typescript]
requires: [02-03]
provides:
  - Extended DockerSchema with full Docker options
  - TypeScript types for Docker configuration
  - Utility functions for config parsing and resolution
affects: [03-02]
tech-stack:
  added: []
  patterns:
    - Zod schema validation with refinements
    - Type-safe configuration resolution
    - Memory/volume string parsing utilities
key-files:
  created:
    - packages/core/src/runner/runtime/docker-config.ts
  modified:
    - packages/core/src/config/schema.ts
    - packages/core/src/runner/runtime/index.ts
    - packages/core/src/config/__tests__/merge.test.ts
    - packages/core/src/state/index.ts
    - packages/core/src/runner/job-executor.ts
decisions:
  - Use Zod refinements for complex validation (memory format, volume format, user format)
  - Default to bridge networking for full network access
  - Default to 2GB memory limit for containers
  - Support both 'image' and deprecated 'base_image' fields for backwards compatibility
  - UID:GID defaults to host user for file permission alignment
metrics:
  duration: 4 minutes
  completed: 2026-02-01
---

# Phase 03 Plan 01: Docker Configuration Schema Extension Summary

**One-liner:** Extended DockerSchema with network modes, resource limits, security options, and created typed configuration utilities with parsing and validation.

## What Was Built

Extended the Docker configuration schema to support full container lifecycle, resource management, and security options. Created comprehensive TypeScript types and utility functions for config resolution and validation.

### Key Components

1. **Extended DockerSchema** (packages/core/src/config/schema.ts)
   - Added network mode support (none, bridge, host)
   - Added ephemeral container option (fresh vs persistent)
   - Added memory limit with string format validation
   - Added CPU shares for resource allocation
   - Added user mapping (UID:GID) for security
   - Added max_containers for cleanup management
   - Added volumes array for additional mounts
   - Added workspace_mode for read-only workspace option
   - Implemented Zod refinements for format validation

2. **Docker Config Types** (packages/core/src/runner/runtime/docker-config.ts)
   - DockerConfig interface with resolved configuration
   - PathMapping interface for volume mounts
   - NetworkMode and VolumeMode type aliases
   - parseMemoryToBytes() for "2g", "512m" format parsing
   - parseVolumeMount() for "host:container:mode" format parsing
   - getHostUser() for UID:GID retrieval
   - resolveDockerConfig() to apply defaults and parse config
   - Constants: DEFAULT_DOCKER_IMAGE, DEFAULT_MEMORY_LIMIT, DEFAULT_MAX_CONTAINERS

3. **Runtime Module Exports** (packages/core/src/runner/runtime/index.ts)
   - Exported all docker-config types and functions
   - Made utilities available for ContainerRunner (Plan 02)

### Schema Features

**Network Isolation:**
```yaml
docker:
  network: bridge  # or "none", "host"
```

**Resource Limits:**
```yaml
docker:
  memory: 2g
  cpu_shares: 512
```

**Security:**
```yaml
docker:
  user: "1000:1000"  # Run as specific UID:GID
```

**Lifecycle:**
```yaml
docker:
  ephemeral: false      # Reuse container across jobs
  max_containers: 5     # Keep last 5 containers per agent
```

**Volume Mounts:**
```yaml
docker:
  volumes:
    - "/host/data:/container/data:ro"
    - "/host/cache:/container/cache:rw"
  workspace_mode: rw  # or "ro"
```

## Deviations from Plan

### Auto-fixed Issues (Deviation Rule 3 - Blocking)

**1. Missing state module exports**
- **Found during:** Task 1 - attempting to commit
- **Issue:** job-executor.ts imports validateSession and isSessionExpiredError but they weren't exported from state/index.ts
- **Fix:** Added exports to state/index.ts
- **Files modified:** packages/core/src/state/index.ts
- **Commit:** c827a28 (included with Task 1)

**2. Wrong field name in system message**
- **Found during:** Task 1 - attempting to commit
- **Issue:** job-executor.ts used 'message' field for system messages, but schema requires 'content'
- **Fix:** Changed `message:` to `content:` in job-executor.ts line 218
- **Files modified:** packages/core/src/runner/job-executor.ts
- **Commit:** c827a28 (included with Task 1)

**3. Test fixtures missing new required fields**
- **Found during:** Task 1 - TypeScript compilation
- **Issue:** merge.test.ts had Docker config objects missing new fields with defaults (ephemeral, network, memory, max_containers, workspace_mode)
- **Fix:** Updated test fixtures to include all required fields with proper defaults
- **Files modified:** packages/core/src/config/__tests__/merge.test.ts
- **Commit:** c827a28 (included with Task 1)

**4. Schedule schema missing resume_session**
- **Found during:** Task 1 - TypeScript compilation
- **Issue:** Test fixture for schedule missing resume_session field (added as default in ScheduleSchema)
- **Fix:** Added resume_session: true to test schedule fixture
- **Files modified:** packages/core/src/config/__tests__/merge.test.ts
- **Commit:** c827a28 (included with Task 1)

## Commits

All commits created during plan execution:

| Commit | Type | Description | Files |
|--------|------|-------------|-------|
| c827a28 | feat | Extended DockerSchema with full options + blocker fixes | schema.ts, merge.test.ts, state/index.ts, job-executor.ts |
| a6882ae | feat | Created docker-config types and utilities | docker-config.ts |
| c156b74 | feat | Exported docker-config from runtime module | runtime/index.ts |

## Verification Results

**Success Criteria Met:**

✅ DockerSchema validates all docker options with clear error messages
- Memory format validation: requires pattern like "2g", "512m", "1024k"
- Volume format validation: requires "host:container" or "host:container:ro|rw"
- User format validation: requires "UID" or "UID:GID"

✅ Agent config accepts all new docker fields
- enabled, ephemeral, image, network, memory, cpu_shares, user, max_containers, volumes, workspace_mode

✅ TypeScript types exist for Docker configuration
- DockerConfig, PathMapping, NetworkMode, VolumeMode

✅ Utility functions work correctly
- parseMemoryToBytes("2g") = 2147483648 bytes
- parseVolumeMount("/host:/container:ro") = {hostPath, containerPath, mode: "ro"}
- getHostUser() returns current process UID:GID
- resolveDockerConfig() applies defaults and parses config

✅ All new code compiles
- Production code compiles successfully (skipLibCheck to avoid pre-existing test errors)
- Exports verified via runtime import test

**Test Status:**

⚠️ Pre-existing test failures remain from Phase 2 RuntimeInterface refactoring (job-executor.test.ts, schedule-runner.test.ts using deprecated SDKQueryFunction). These are documented in STATE.md as expected and will be addressed in future plan.

**Build Status:**

✅ docker-config.ts compiles without errors
✅ Exports work correctly (verified via node import test)
⚠️ Full build fails due to pre-existing test errors (not introduced by this plan)

## Next Phase Readiness

**Ready for Plan 03-02 (Container Runtime Implementation):**
- ✅ DockerConfig interface defined
- ✅ resolveDockerConfig() available for config resolution
- ✅ parseMemoryToBytes() available for memory conversion
- ✅ parseVolumeMount() available for volume parsing
- ✅ getHostUser() available for user mapping
- ✅ All types exported from runtime module

**Blockers:** None

**Concerns:** None

**Recommendations:**
1. Plan 03-02 can proceed to implement ContainerRunner using these types
2. Consider adding unit tests for docker-config utilities in future plan
3. Address pre-existing test failures in separate test-fix plan (outside phase scope)
