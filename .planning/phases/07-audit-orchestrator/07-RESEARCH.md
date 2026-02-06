# Phase 7: Audit Orchestrator - Research

**Researched:** 2026-02-05
**Domain:** Security audit orchestration with conditional agent spawning
**Confidence:** HIGH

## Summary

Phase 7 creates the `/security-audit` orchestrator command that performs comprehensive incremental security audits. The orchestrator coordinates multiple investigation agents (hot-spot-verifier, question-investigator, change-analyzer) based on what has changed since the last audit, while staying under 20% context usage by delegating depth to subagents.

The key insight is that this orchestrator follows a fundamentally different pattern from `/security-map-codebase`: instead of always spawning all agents in parallel, it conditionally spawns only the agents needed based on detected changes, open questions, and hot spot modifications. Results are aggregated into a daily intelligence report.

**Primary recommendation:** Follow a phased execution model: (1) run scan.ts first for deterministic findings, (2) run change-analyzer to identify what needs investigation, (3) conditionally spawn hot-spot-verifier and question-investigator based on change-analyzer results, (4) aggregate all results into intelligence report.

## Standard Stack

The orchestrator uses existing infrastructure with no new dependencies.

### Core

| Component | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| scan.ts | `.security/tools/scan.ts` | Deterministic security scanner | Existing tool, runs npm-audit, docker-config, etc. |
| STATE.md | `.security/STATE.md` | Audit baseline and tracking | Contains last_audit date, open findings/questions counts |
| HOT-SPOTS.md | `.security/HOT-SPOTS.md` | Critical file registry | Defines which files need verification |
| CODEBASE-UNDERSTANDING.md | `.security/CODEBASE-UNDERSTANDING.md` | Open questions registry | Contains Open Security Questions table |
| FINDINGS-INDEX.md | `.security/intel/FINDINGS-INDEX.md` | Master findings tracker | Updated with new/resolved findings |

### Subagents

| Agent | Location | When to Spawn | Returns |
|-------|----------|---------------|---------|
| change-analyzer | `.claude/agents/security/change-analyzer.md` | When commits_since_audit > 0 | Categorized changes + spawn recommendations |
| hot-spot-verifier | `.claude/agents/security/hot-spot-verifier.md` | When change-analyzer finds hot spot touches | PASS/FAIL/WARN verification report |
| question-investigator | `.claude/agents/security/question-investigator.md` | When open questions exist (especially High priority) | Investigation findings with status updates |

### Supporting

| Tool | Purpose | When to Use |
|------|---------|-------------|
| Task tool | Agent spawning | All subagent invocations |
| Bash | Git commands, scan.ts execution | Change detection, scanner invocation |
| Write/Edit | Document updates | STATE.md, FINDINGS-INDEX.md, intelligence report |
| Read | Context loading | STATE.md, HOT-SPOTS.md, CODEBASE-UNDERSTANDING.md |

## Architecture Patterns

### Recommended Orchestrator Flow

```
/security-audit invoked
        │
        ▼
Phase 1: SCANNER PHASE (~2 seconds)
        ├── Run: pnpm security --json --save
        ├── Parse: JSON output for new findings
        └── Store: Baseline comparison with previous scan
        │
        ▼
Phase 2: CHANGE DETECTION PHASE
        ├── Read: STATE.md frontmatter (last_audit date)
        ├── If commits_since_audit > 0:
        │   └── Spawn: change-analyzer agent
        │       ├── Returns: Categorized changes
        │       └── Returns: Spawn recommendations
        └── If no commits: Skip to Phase 4
        │
        ▼
Phase 3: INVESTIGATION PHASE (conditional, parallel)
        ├── If change-analyzer recommends VERIFY:
        │   └── Spawn: hot-spot-verifier with touched files
        ├── If open High priority questions exist:
        │   └── Spawn: question-investigator with 1-2 questions
        └── Wait for all to complete
        │
        ▼
Phase 4: AGGREGATION PHASE
        ├── Collect: All agent results
        ├── Merge: Scanner findings + agent findings
        ├── Compare: To previous audit (detect new/resolved)
        └── Classify: Critical/High/Medium/Low
        │
        ▼
Phase 5: DOCUMENTATION PHASE
        ├── Write: .security/intel/YYYY-MM-DD.md (intelligence report)
        ├── Update: FINDINGS-INDEX.md (new/resolved findings)
        ├── Update: CODEBASE-UNDERSTANDING.md (question status)
        ├── Update: STATE.md frontmatter
        └── Commit: All changes
```

### Context Management Strategy

**Target: <20% context usage by orchestrator**

| What Orchestrator Does | What Subagents Do |
|-----------------------|-------------------|
| Decides which agents to spawn | Deep code analysis |
| Collects structured results | File reading and grep execution |
| Aggregates into report | Verification logic |
| Updates living documents | Evidence gathering |
| Commits changes | Investigation reasoning |

**Key pattern:** Subagents return structured reports, not raw findings. Orchestrator never reads source files directly (except STATE.md, HOT-SPOTS.md, CODEBASE-UNDERSTANDING.md for routing decisions).

### Conditional Spawning Logic

```markdown
## Spawning Decision Tree

1. **Always run:**
   - scan.ts (deterministic, fast)

2. **If commits since last audit > 0:**
   - Spawn change-analyzer
   - Use its recommendations for next steps

3. **If change-analyzer says VERIFY (Category 1 hot spot touches):**
   - Spawn hot-spot-verifier with: list of touched hot spots

4. **If open questions exist with High priority:**
   - Spawn question-investigator with: highest priority question

5. **If change-analyzer says INVESTIGATE (Category 3 patterns):**
   - Either add new question to CODEBASE-UNDERSTANDING.md
   - Or spawn question-investigator for immediate investigation
```

### Pattern: Mapper vs Investigator Orchestrators

| Aspect | /security-map-codebase | /security-audit (this phase) |
|--------|------------------------|------------------------------|
| Agent spawning | Always all 4, parallel | Conditional, based on changes |
| Agent output | Write to files | Return to orchestrator |
| Orchestrator role | Verification only | Aggregation + updates |
| Context usage | Minimal (confirmations) | Moderate (structured results) |
| Frequency | On staleness (7d/15c) | Daily or on-demand |

### Agent Result Formats

**change-analyzer returns:**
```markdown
## Change Analysis Results

**Commits analyzed:** N
**Risk Level:** HIGH | MEDIUM | LOW | NONE

### Recommendations Summary

1. **VERIFY:** Spawn hot-spot-verifier
   - Files: [list]

2. **INVESTIGATE:** Patterns need analysis
   - Patterns: [list]
```

**hot-spot-verifier returns:**
```markdown
## Verification Report

**Result:** PASS | FAIL | WARN

### Critical Hot Spots
#### container-manager.ts: PASS
- [x] CapDrop includes ALL (line 47)

### Summary
| Category | Checked | Passed | Failed | Warnings |
```

**question-investigator returns:**
```markdown
## Question Investigation Results

### Q2: [question text]
**Status recommendation:** Answered | Partial | Blocked
**Finding:** [answer]
**Evidence:** [file:line references]
```

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scanning for vulnerabilities | Custom grep patterns | scan.ts with checkNpmAudit, etc. | Already handles npm-audit, docker-config, 6 checks |
| Change detection | Manual git parsing | change-analyzer agent | Returns categorized, actionable recommendations |
| Hot spot verification | Inline grep in orchestrator | hot-spot-verifier agent | Has verification logic, handles accepted risks |
| Question investigation | Quick grep in orchestrator | question-investigator agent | Has evidence-gathering protocol, status tracking |

**Key insight:** The orchestrator's job is to coordinate, not to investigate. Every investigation should be delegated to a specialized agent.

## Common Pitfalls

### Pitfall 1: Context Explosion from File Reading

**What goes wrong:** Orchestrator reads source files to "verify" findings, blowing up context.

**Why it happens:** Natural instinct to double-check agent results.

**How to avoid:** Trust agent reports. Orchestrator only reads:
- STATE.md (for routing decisions)
- HOT-SPOTS.md (for spawn conditions)
- CODEBASE-UNDERSTANDING.md (for question selection)
- Agent result reports (structured, bounded)

**Warning signs:** Orchestrator using Read tool on `packages/` files.

### Pitfall 2: Always Spawning All Agents

**What goes wrong:** Every audit spawns all 3 investigation agents regardless of need.

**Why it happens:** Simpler to implement, "just in case" mentality.

**How to avoid:**
- change-analyzer first, follow its recommendations
- Only spawn hot-spot-verifier if hot spots were touched
- Only spawn question-investigator if High priority questions open

**Warning signs:** Audits taking long time on unchanged codebases.

### Pitfall 3: Orchestrator Writing Investigation Details

**What goes wrong:** Intelligence report contains full file diffs, all grep output.

**Why it happens:** Trying to be "complete".

**How to avoid:** Summary pattern:
- Scanner: count + severity breakdown
- Change analysis: category counts + key files only
- Verification: pass/fail status table
- Investigation: answer + evidence (already summarized by agent)

**Warning signs:** Intelligence reports >500 lines.

### Pitfall 4: Not Updating STATE.md Frontmatter

**What goes wrong:** Next audit doesn't know when last audit ran.

**Why it happens:** Forgot the update step, or error during commit.

**How to avoid:** Explicit step after all documentation updates:
```bash
TODAY=$(date +%Y-%m-%d)
sed -i '' "s/^last_audit:.*/last_audit: $TODAY/" .security/STATE.md
sed -i '' "s/^commits_since_audit:.*/commits_since_audit: 0/" .security/STATE.md
```

**Warning signs:** Every audit thinks it's the first audit.

### Pitfall 5: Sequential Agent Execution

**What goes wrong:** change-analyzer, then hot-spot-verifier, then question-investigator - total time is sum of all.

**Why it happens:** Easier to implement sequentially.

**How to avoid:** After change-analyzer returns, spawn remaining agents in parallel if needed:
```
change-analyzer (sequential, needed for routing)
        ▼
hot-spot-verifier + question-investigator (parallel if both needed)
```

**Warning signs:** Audit time is 3x single agent time.

## Code Examples

### Spawning Subagents (from security-map-codebase.md)

```markdown
**Agent spawning with Task tool:**

Use Task tool with:
- subagent_type: "change-analyzer"
- model: "{resolved_model}"
- run_in_background: false  # Need results for routing
- description: "Analyze changes since last audit"

Prompt:
```
You are the change-analyzer agent.

Analyze commits since last audit date: {LAST_AUDIT}

Return your assessment with:
- Categorized changes (5 categories)
- Spawn recommendations (VERIFY/INVESTIGATE/NOTE/NONE)
- Overall risk level

Do NOT write to files - return results directly.
```
```

### Conditional Spawning Pattern

```markdown
**After receiving change-analyzer results:**

Parse the recommendations:

1. If "VERIFY" recommendation present:
   - Extract file list from change-analyzer results
   - Spawn hot-spot-verifier with file list

2. If "INVESTIGATE" recommendation present:
   - Read CODEBASE-UNDERSTANDING.md
   - Find highest priority open question
   - Spawn question-investigator with that question

Spawn both in parallel using run_in_background: true, then wait for completion.
```

### STATE.md Frontmatter Update

```bash
# At end of successful audit
TODAY=$(date +%Y-%m-%d)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Update frontmatter
sed -i '' "s/^last_updated:.*/last_updated: $NOW/" .security/STATE.md
sed -i '' "s/^last_audit:.*/last_audit: $TODAY/" .security/STATE.md
sed -i '' "s/^commits_since_audit:.*/commits_since_audit: 0/" .security/STATE.md

# Update counts from actual data
OPEN_FINDINGS=$(grep -c "^\| [0-9]" .security/intel/FINDINGS-INDEX.md | head -1 || echo "0")
OPEN_QUESTIONS=$(grep -c "| Open\|Partial |" .security/CODEBASE-UNDERSTANDING.md || echo "0")
sed -i '' "s/^open_findings:.*/open_findings: $OPEN_FINDINGS/" .security/STATE.md
sed -i '' "s/^open_questions:.*/open_questions: $OPEN_QUESTIONS/" .security/STATE.md
```

### Intelligence Report Template

```markdown
# Security Intelligence Report - {DATE}

**Review Type**: Incremental (Automated)
**Triggered By**: /security-audit command
**Branch**: {branch name}

---

## Executive Summary

[2-3 sentences: What's the security posture? Any urgent issues?]

---

## Scanner Results

**Status**: {PASS | WARN | FAIL}
**Duration**: {N}ms

| Check | Status | Findings |
|-------|--------|----------|
| npm-audit | {status} | {count} |
| docker-config | {status} | {count} |
| ... | ... | ... |

---

## Change Analysis

**Commits since last audit**: {N}
**Risk Level**: {HIGH | MEDIUM | LOW | NONE}

{If changes exist:}
### Security-Relevant Changes

| Category | Count | Action Taken |
|----------|-------|--------------|
| Hot spot touches | {N} | Verified by hot-spot-verifier |
| New entry points | {N} | Flagged for review |
| Security patterns | {N} | Investigated |

---

## Verification Results

{If hot-spot-verifier ran:}
**Overall**: {PASS | WARN | FAIL}

| Hot Spot | Status | Notes |
|----------|--------|-------|
| container-manager.ts | PASS | |
| container-runner.ts | WARN | #009 tech debt |
| ... | ... | ... |

---

## Investigation Results

{If question-investigator ran:}
### Q{ID}: {question}
**Status**: {Answered | Partial | Blocked}
**Finding**: {summary}

---

## Updates Made

- FINDINGS-INDEX.md: {new findings added, findings resolved}
- CODEBASE-UNDERSTANDING.md: {question status updates}
- STATE.md: {last_audit updated}

---

## Session Statistics

- Scanner runtime: {N}ms
- Total findings: {N}
- Agents spawned: {list}
- Duration: {total time}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic audit (current security-audit.md) | Phased orchestrator with subagents | This phase | Enables incremental, focused audits |
| Manual hot spot checking | Automated hot-spot-verifier | Phase 4 | Consistent verification |
| Ad-hoc question investigation | Structured question-investigator | Phase 5 | Progress tracking |
| No change detection | change-analyzer before investigation | Phase 6 | Targeted agent spawning |

**Deprecated/outdated:**
- Current `.claude/commands/security-audit.md`: Will be REPLACED by new orchestrator. The current version is a monolithic command that does everything inline without subagents.

## Open Questions

Things that couldn't be fully resolved:

1. **Exact context budget per phase**
   - What we know: Total target is <20% context
   - What's unclear: How to measure in practice
   - Recommendation: Use line counts as proxy (orchestrator <200 lines of logic, agent reports <100 lines each)

2. **Parallel vs sequential agent spawning**
   - What we know: hot-spot-verifier and question-investigator can run in parallel
   - What's unclear: Whether change-analyzer can run in parallel with scan.ts
   - Recommendation: Run change-analyzer after scan.ts (sequential) since scan.ts is fast (~2s) and we might want to cross-reference findings

3. **How many questions to investigate per audit**
   - What we know: High priority questions should be prioritized
   - What's unclear: 1 question per audit or multiple?
   - Recommendation: Start with 1 question per audit to keep audit time reasonable

## Sources

### Primary (HIGH confidence)

- `.claude/commands/security-map-codebase.md` - Working orchestrator pattern with parallel agents
- `.claude/agents/security/hot-spot-verifier.md` - Subagent definition with return format
- `.claude/agents/security/question-investigator.md` - Subagent definition with return format
- `.claude/agents/security/change-analyzer.md` - Subagent definition with return format
- `.security/STATE.md` - Current state tracking with frontmatter format
- `.security/tools/scan.ts` - Existing scanner implementation

### Secondary (MEDIUM confidence)

- `.planning/phases/03-mapping-orchestrator/03-01-PLAN.md` - Similar orchestrator planning pattern
- `.planning/phases/04-hot-spot-verifier/04-01-PLAN.md` - Investigator agent planning pattern

### Tertiary (LOW confidence)

- None - all patterns are from existing project code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components exist in codebase
- Architecture: HIGH - Follows established patterns from Phase 3
- Pitfalls: HIGH - Derived from reading existing orchestrator and agent definitions

**Research date:** 2026-02-05
**Valid until:** 30 days (stable internal patterns)
