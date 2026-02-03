---
"@herdctl/core": minor
---

Add runtime context tracking to sessions

Sessions now track the runtime configuration (SDK vs CLI, Docker vs native) they were created with. This prevents session resume errors when switching between runtime modes.

**Session Schema Updates**:
- Added `runtime_type` field (defaults to "sdk" for legacy sessions)
- Added `docker_enabled` field (defaults to false for legacy sessions)

**Validation**:
- Sessions are automatically invalidated when runtime context changes
- Prevents "conversation not found" errors when switching Docker mode
- Clear error messages explain why sessions were cleared

**Migration**:
- Legacy sessions automatically get default values via Zod schema
- No manual migration needed - sessions self-heal on first use
- Context mismatches trigger automatic session cleanup

This ensures sessions remain valid only for the runtime configuration they were created with, preventing confusion when enabling/disabling Docker or switching between SDK and CLI runtimes.
