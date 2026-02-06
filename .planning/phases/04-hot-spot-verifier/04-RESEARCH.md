# Phase 4: Hot-Spot Verifier - Research

**Researched:** 2026-02-05
**Domain:** Security regression verification for critical code paths
**Confidence:** HIGH

## Summary

This phase creates the `hot-spot-verifier` agent that verifies security properties of critical files from HOT-SPOTS.md have not regressed. Unlike the mapper agents (which produce comprehensive documentation), this is an **investigator agent** that produces verification reports with pass/fail status.

The agent reads HOT-SPOTS.md to understand which files are critical and what to check for each. It then verifies those security properties still hold and returns structured findings to the orchestrator. The `/security-audit` command will spawn this agent when critical files have been modified since the last audit.

**Primary recommendation:** Create a hot-spot-verifier agent that follows the existing mapper agent pattern structure but with verification-focused output (pass/fail per hot spot with findings).

## Standard Stack

This phase does not introduce new libraries. It uses the existing agent definition pattern.

### Core

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| Agent definition pattern | `.claude/agents/security/*.md` | YAML frontmatter + XML sections | Established in Phase 2, verified working |
| HOT-SPOTS.md format | `.security/HOT-SPOTS.md` | Input data source | Already exists, 122 lines, well-structured |
| State tracking | `.security/STATE.md` | Audit position tracking | Established in Phase 1 |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| Git operations | Detect file changes | When determining which hot spots need verification |
| Grep/Read tools | Inspect file contents | For each verification check |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pass/fail per file | Severity-based scoring | Pass/fail is simpler and aligns with HOT-SPOTS.md checklist format |
| Agent writes report file | Agent returns to orchestrator | Orchestrator needs findings to aggregate - return structure better here |

## Architecture Patterns

### Agent Definition Structure

Follow the exact pattern from existing mapper agents:

```
.claude/agents/security/hot-spot-verifier.md
├── YAML frontmatter (name, description, tools, model, color)
├── <role> - Verification purpose, inputs, outputs
├── <why_this_matters> - How output is consumed
├── <philosophy> - Verification principles
├── <process> - Step-by-step verification workflow
├── <templates> - Verification report format
├── <exploration_commands> - Commands to verify each hot spot type
├── <forbidden_files> - Same secret protections as mappers
├── <critical_rules> - Verification-specific constraints
└── <success_criteria> - What constitutes successful verification
```

### Recommended Output Structure

The agent returns structured verification results (not a written document):

```markdown
## Verification Report

**Date:** YYYY-MM-DD
**Hot spots checked:** N of M
**Result:** PASS | FAIL | WARN

### Critical Hot Spots

#### container-manager.ts: PASS
- [x] Capability drops intact (CapDrop: ["ALL"])
- [x] no-new-privileges present
- [ ] **FINDING:** hostConfigOverride has no validation (accepted risk)

#### container-runner.ts: WARN
- [x] Shell escaping function exists
- [ ] **FINDING:** Shell escaping incomplete (#009 - known tech debt)

[... more hot spots ...]

### Summary
- Critical hot spots: N/M passed
- High-risk hot spots: N/M passed (checked because modified)
- New findings: K
- Regressions detected: J
```

### Verification vs Mapping Pattern

| Aspect | Mapper Agents | Hot-Spot Verifier |
|--------|---------------|-------------------|
| Purpose | Comprehensive analysis | Targeted verification |
| Output | Writes to file | Returns to orchestrator |
| Scope | Entire domain | Specific files from list |
| Result type | Documentation | Pass/fail + findings |
| Invocation | /security-map-codebase | /security-audit (conditional) |

### Anti-Patterns to Avoid

- **Re-mapping instead of verifying:** Don't re-analyze the entire attack surface. Check specific properties.
- **Missing context:** Always include the "What to Check" from HOT-SPOTS.md in verification.
- **Binary pass/fail without detail:** Include evidence for both passes and failures.
- **Ignoring accepted risks:** Note accepted risks but don't fail on them.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Change detection | Custom diffing | `git diff --name-only` since last audit | Git tracks changes accurately |
| Hot spot list | Hardcoded in agent | Parse HOT-SPOTS.md dynamically | Single source of truth |
| Pattern matching | Custom regex | grep with patterns from HOT-SPOTS.md | Patterns already defined |

**Key insight:** HOT-SPOTS.md already has the "What to Check" column for each file. The agent should use these directly rather than inventing its own checks.

## Common Pitfalls

### Pitfall 1: Verifying All Hot Spots Every Time

**What goes wrong:** Agent checks all 12+ files even when only 1 changed, wasting context.
**Why it happens:** Not using git to detect which files changed.
**How to avoid:** Accept a list of modified files from orchestrator, or check git diff internally.
**Warning signs:** Agent taking too long, checking files that haven't changed.

### Pitfall 2: Too Verbose on Passes

**What goes wrong:** Agent produces huge output documenting every successful check.
**Why it happens:** Following mapper pattern of comprehensive documentation.
**How to avoid:** For passes, just confirm. For failures, include full detail.
**Warning signs:** Report is mostly green checkmarks with no findings.

### Pitfall 3: Missing the "What to Check" Context

**What goes wrong:** Agent verifies file exists but not security properties.
**Why it happens:** Not reading HOT-SPOTS.md carefully.
**How to avoid:** Parse the "What to Check" column and verify those specific properties.
**Warning signs:** Verification passes but actual security controls are broken.

### Pitfall 4: Conflating Accepted Risks with Failures

**What goes wrong:** Agent reports FAIL for documented accepted risks.
**Why it happens:** Not distinguishing between new findings and known accepted risks.
**How to avoid:** Cross-reference STATE.md Recent Decisions for accepted risks.
**Warning signs:** Same "findings" reported every audit.

## Code Examples

### Parsing HOT-SPOTS.md Table

The agent needs to parse the markdown tables in HOT-SPOTS.md:

```markdown
## Critical Hot Spots (Always Check)

| File | Why Critical | What to Check |
|------|--------------|---------------|
| `packages/core/src/runner/runtime/container-manager.ts` | Docker security hardening, hostConfigOverride | Capability drops intact, no new bypass paths |
```

Extraction approach:
```bash
# Extract critical hot spot file paths
grep -A100 "## Critical Hot Spots" .security/HOT-SPOTS.md | \
  grep "^\|" | grep "packages/" | \
  sed 's/.*`\([^`]*\)`.*/\1/'
```

### Verification Check Examples

For `container-manager.ts` - verify Docker security defaults:
```bash
# Check CapDrop is still ALL
grep -n "CapDrop.*ALL" packages/core/src/runner/runtime/container-manager.ts

# Check no-new-privileges
grep -n "no-new-privileges" packages/core/src/runner/runtime/container-manager.ts

# Check for new bypass patterns
grep -n "hostConfigOverride\|Privileged" packages/core/src/runner/runtime/container-manager.ts
```

For `schema.ts` - verify validation patterns:
```bash
# Check AGENT_NAME_PATTERN still restrictive
grep -n "AGENT_NAME_PATTERN" packages/core/src/config/schema.ts

# Check .strict() on agent config
grep -n "AgentConfigSchema.*strict" packages/core/src/config/schema.ts
```

For `path-safety.ts` - verify traversal defense:
```bash
# Check SAFE_IDENTIFIER_PATTERN exists
grep -n "SAFE_IDENTIFIER_PATTERN" packages/core/src/state/utils/path-safety.ts

# Check buildSafeFilePath still validates
grep -A10 "buildSafeFilePath" packages/core/src/state/utils/path-safety.ts | grep "isValidIdentifier"
```

### Detecting Modified Files

```bash
# Get last audit date from STATE.md
LAST_AUDIT=$(grep "^last_audit:" .security/STATE.md | awk '{print $2}')

# Get files modified since last audit
git diff --name-only $(git log -1 --until="$LAST_AUDIT" --format=%H)..HEAD

# Filter to hot spot files only
git diff --name-only ... | grep -f <(cat .security/HOT-SPOTS.md | grep '`packages/' | sed 's/.*`\([^`]*\)`.*/\1/')
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual HOT-SPOTS checklist | Automated verification | This phase | Consistent, thorough verification |
| Verify all hot spots | Only verify changed files | This phase | Faster audits, focused investigation |

**Deprecated/outdated:**
- None - this is new capability

## Open Questions

Things that couldn't be fully resolved:

1. **Should the agent also update HOT-SPOTS.md?**
   - What we know: The "Notes for Maintainers" section says to add new hot spots when found
   - What's unclear: Should this agent do it, or just recommend?
   - Recommendation: Agent recommends additions, orchestrator decides whether to add

2. **How to handle new files that should be hot spots?**
   - What we know: Agent might discover new security-critical code
   - What's unclear: How to surface this without scope creep
   - Recommendation: Include "Suggested Hot Spots" section in report for human review

## Integration with /security-audit

The existing `/security-audit` command (in `.claude/commands/security-audit.md`) needs to:

1. **Detect when to spawn:** Check git diff for hot spot files since last audit
2. **Prepare agent input:** List of modified hot spot files + full HOT-SPOTS.md context
3. **Aggregate results:** Include verification results in intelligence report

Spawning pattern (from security-map-codebase):
```
Use Task tool with:
- subagent_type: "hot-spot-verifier"
- model: "{resolved_model}"
- run_in_background: true (if other investigation agents also spawning)
- description: "Verify critical hot spots"
```

## Sources

### Primary (HIGH confidence)

- `.security/HOT-SPOTS.md` - Authoritative list of hot spots and what to check (122 lines, reviewed)
- `.claude/agents/security/attack-surface-mapper.md` - Reference agent pattern (409 lines, reviewed)
- `.claude/agents/security/security-controls-mapper.md` - Reference agent pattern (344 lines, reviewed)
- `.security/GSD-SECURITY-SYSTEM-SPEC.md` - Original specification for investigator agents (704 lines, reviewed)
- `.planning/phases/02-mapper-agent-definitions/02-01-PLAN.md` - Plan format reference (252 lines, reviewed)

### Secondary (MEDIUM confidence)

- `.security/STATE.md` - Current audit state tracking format (190 lines, reviewed)
- `.security/CODEBASE-UNDERSTANDING.md` - Accepted risks context (280 lines, reviewed)
- `.claude/commands/security-audit.md` - Current audit command structure (310 lines, reviewed)

### Tertiary (LOW confidence)

- None - all findings from codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using established patterns from Phase 2
- Architecture: HIGH - Clear investigator vs mapper distinction in spec
- Pitfalls: MEDIUM - Based on reasoning about potential issues

**Research date:** 2026-02-05
**Valid until:** 2026-02-19 (14 days - pattern is stable)

---

## Appendix: HOT-SPOTS.md Structure Reference

The agent must parse these sections from HOT-SPOTS.md:

### Critical Hot Spots (Always Check)
- 6 files with "Why Critical" and "What to Check" columns
- Must be verified every audit

### High-Risk Hot Spots (Check If Changed)
- 7 files with "Why High-Risk" and "What to Check" columns
- Only verify if modified since last audit

### Entry Points (Review for New Attack Surface)
- 5 entry points with "Input Source", "Trust Level", "Key Defenses" columns
- Cross-reference with ATTACK-SURFACE.md mapping

### Patterns to Grep For
- 5 bash commands for finding dangerous patterns
- Agent should run these and flag new matches

### Audit Checklist
- Structured checklist format with checkboxes
- Agent output should align with this format
