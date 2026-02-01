# Requirements: herdctl Runtime & Docker

**Defined:** 2026-01-31
**Core Value:** Autonomous Claude Code agents with full capabilities: if Claude Code can do it manually, herdctl agents can do it automatically.

## v1 Requirements

Requirements for milestone v1.0: Runtime abstraction and Docker containerization.

### Runtime Abstraction (10 requirements)

- [x] **RUNTIME-01**: Define RuntimeInterface with execute() method returning AsyncIterable<SDKMessage>
- [x] **RUNTIME-02**: Implement SDKRuntime adapter wrapping existing SDK integration
- [x] **RUNTIME-03**: Implement CLIRuntime with file watching and session parsing
- [x] **RUNTIME-04**: Create RuntimeFactory for runtime selection based on config
- [x] **RUNTIME-05**: CLI runtime spawns claude command via execa
- [x] **RUNTIME-06**: CLI runtime watches session files via chokidar with debouncing
- [x] **RUNTIME-07**: CLI runtime parses JSONL session format to SDK messages
- [x] **RUNTIME-08**: Agent configuration supports runtime field (sdk|cli)
- [x] **RUNTIME-09**: JobExecutor refactored to use RuntimeInterface instead of direct SDK calls
- [x] **RUNTIME-10**: Remove old SDK adapter code entirely (no backwards compatibility needed)

### Docker Integration (11 requirements)

- [ ] **DOCKER-01**: Implement ContainerRunner decorator wrapping RuntimeInterface
- [ ] **DOCKER-02**: Docker containers support configurable workspace mount mode (read-write or read-only)
- [ ] **DOCKER-03**: Docker auth is configurable (mount auth files, use API key env var, or other methods)
- [ ] **DOCKER-04**: Docker sessions stored in .herdctl/docker-sessions/ separate from host
- [ ] **DOCKER-05**: Docker containers support network isolation (none/bridge/host)
- [ ] **DOCKER-06**: Docker containers enforce memory limits (default 2g)
- [ ] **DOCKER-07**: Docker containers support optional CPU limits
- [ ] **DOCKER-08**: Docker containers support custom volume mounts
- [ ] **DOCKER-09**: Docker containers auto-cleanup with --rm flag
- [ ] **DOCKER-10**: Docker containers run as non-root user for security
- [ ] **DOCKER-11**: Agent configuration supports docker field with options (auth method, mount modes, etc)

### Configuration Schema (6 requirements)

- [ ] **CONFIG-01**: AgentConfigSchema includes runtime field (sdk|cli)
- [ ] **CONFIG-02**: AgentConfigSchema includes docker field with sub-options
- [ ] **CONFIG-03**: Docker config validates network isolation modes
- [ ] **CONFIG-04**: Docker config validates resource limit formats
- [ ] **CONFIG-05**: Docker config validates volume mount syntax
- [ ] **CONFIG-06**: Config validation provides clear error messages

### Documentation (8 requirements)

- [ ] **DOCS-01**: Document when to use SDK runtime vs CLI runtime
- [ ] **DOCS-02**: Document Docker security model and isolation guarantees
- [ ] **DOCS-03**: Provide example config for cost-optimized setup (CLI + Docker)
- [ ] **DOCS-04**: Provide example config for development setup (SDK, no Docker)
- [ ] **DOCS-05**: Provide example config for production setup (SDK + Docker)
- [ ] **DOCS-06**: Provide example config for mixed fleet
- [ ] **DOCS-07**: Document troubleshooting for path resolution issues
- [ ] **DOCS-08**: Document troubleshooting for Docker container issues

### Testing (10 requirements)

- [ ] **TEST-01**: Unit tests for RuntimeInterface implementations
- [ ] **TEST-02**: Unit tests for RuntimeFactory selection logic
- [ ] **TEST-03**: Unit tests for CLIRuntime file watching
- [ ] **TEST-04**: Unit tests for session file parsing
- [ ] **TEST-05**: Integration tests for SDK runtime execution
- [ ] **TEST-06**: Integration tests for CLI runtime execution
- [ ] **TEST-07**: Integration tests for Docker container execution
- [ ] **TEST-08**: Integration tests for Docker with SDK runtime
- [ ] **TEST-09**: Integration tests for Docker with CLI runtime
- [ ] **TEST-10**: Tests for path translation correctness

## v2 Requirements

Deferred to future milestones.

### Advanced Features

- **FUTURE-01**: Automatic runtime selection based on agent config inspection
- **FUTURE-02**: Runtime-specific pricing visibility in CLI output
- **FUTURE-03**: Container pooling/reuse for persistent sessions
- **FUTURE-04**: Pre-built herdctl/agent Docker image
- **FUTURE-05**: MicroVM isolation for maximum security
- **FUTURE-06**: Multi-orchestrator support (Podman, containerd)

## Out of Scope

| Feature | Reason |
|---------|--------|
| SDK runtime with Docker stdin/stdout protocol | CLI-based Docker execution sufficient for v1; stdin/stdout adds complexity without clear MVP benefit |
| Kubernetes orchestration | Single-process model doesn't require Kubernetes; Docker sufficient for isolation |
| Dynamic runtime switching mid-job | Agent runtime fixed at config time prevents nondeterministic behavior |
| Session migration between Docker and host | Path incompatibility makes this unsafe; Docker sessions stay in Docker |
| Automatic Docker daemon configuration | Requires sudo; document manual setup instead |
| Container escape detection | Complex monitoring not needed for MVP; focus on prevention via security flags |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RUNTIME-01 | Phase 1 | Complete |
| RUNTIME-02 | Phase 1 | Complete |
| RUNTIME-04 | Phase 1 | Complete |
| RUNTIME-09 | Phase 1 | Complete |
| RUNTIME-10 | Phase 1 | Complete |
| RUNTIME-03 | Phase 2 | Complete |
| RUNTIME-05 | Phase 2 | Complete |
| RUNTIME-06 | Phase 2 | Complete |
| RUNTIME-07 | Phase 2 | Complete |
| RUNTIME-08 | Phase 2 | Complete |
| DOCKER-01 | Phase 3 | Pending |
| DOCKER-02 | Phase 3 | Pending |
| DOCKER-03 | Phase 3 | Pending |
| DOCKER-04 | Phase 3 | Pending |
| DOCKER-05 | Phase 3 | Pending |
| DOCKER-06 | Phase 3 | Pending |
| DOCKER-07 | Phase 3 | Pending |
| DOCKER-08 | Phase 3 | Pending |
| DOCKER-09 | Phase 3 | Pending |
| DOCKER-10 | Phase 3 | Pending |
| DOCKER-11 | Phase 3 | Pending |
| CONFIG-01 | Phase 3 | Pending |
| CONFIG-02 | Phase 3 | Pending |
| CONFIG-03 | Phase 3 | Pending |
| CONFIG-04 | Phase 3 | Pending |
| CONFIG-05 | Phase 3 | Pending |
| CONFIG-06 | Phase 3 | Pending |
| DOCS-01 | Phase 4 | Pending |
| DOCS-02 | Phase 4 | Pending |
| DOCS-03 | Phase 4 | Pending |
| DOCS-04 | Phase 4 | Pending |
| DOCS-05 | Phase 4 | Pending |
| DOCS-06 | Phase 4 | Pending |
| DOCS-07 | Phase 4 | Pending |
| DOCS-08 | Phase 4 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 4 | Pending |
| TEST-06 | Phase 4 | Pending |
| TEST-07 | Phase 4 | Pending |
| TEST-08 | Phase 4 | Pending |
| TEST-09 | Phase 4 | Pending |
| TEST-10 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 45
- Unmapped: 0 ✓

---
*Requirements defined: 2026-01-31*
*Last updated: 2026-01-31 after roadmap creation*
