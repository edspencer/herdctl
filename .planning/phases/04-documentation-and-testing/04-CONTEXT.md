# Phase 4: Documentation & Testing - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete production-ready documentation and comprehensive test coverage for the runtime abstraction system (SDK/CLI runtimes + Docker integration). This phase delivers documentation users can read to understand and configure the system, plus tests that validate all runtime implementations and configurations work correctly.

</domain>

<decisions>
## Implementation Decisions

### Testing Strategy
- **Balanced approach**: 85% unit test coverage plus key integration tests for critical paths (SDK runtime, CLI runtime, Docker execution)
- **CLI runtime testing**: Unit tests use mocks for fast feedback, integration tests spawn real `claude` commands (gated on CLI availability)
- **Docker testing**: Auto-skip Docker integration tests if Docker daemon not running (developer-friendly for local work)
- **Security validation**: Tests inspect actual containers via Docker API to verify CAP_DROP, user ID, read-only mounts, and other security hardening

### Example Configurations
- **Use case focus**: Mixed fleet scenario showing some agents with SDK runtime (cost-optimized), some with CLI runtime (more control), some containerized (security isolation)
- **Detail level**: Both minimal templates for quick reference AND full working examples for common scenarios
- **Anti-patterns**: Include commented examples of wrong configs with explanations of why they fail or are insecure
- **Location**: Runnable config files in `examples/` directory that documentation references and embeds

### Claude's Discretion
- Specific documentation structure and navigation
- Exact troubleshooting guide content and depth
- Test data generation approaches
- Choice of testing utilities and helpers

</decisions>

<specifics>
## Specific Ideas

- Integration tests should validate the full path: config → RuntimeFactory → execution → output
- Docker security tests verify not just config generation but actual container state (inspect running containers)
- Examples should be copy-pastable and runnable without modification (use realistic but generic prompts)
- Anti-pattern examples help users avoid common pitfalls like missing auth mounts, wrong volume paths, insufficient memory limits

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 04-documentation-and-testing*
*Context gathered: 2026-02-01*
