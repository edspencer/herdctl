---
phase: 06-change-analyzer
plan: 01
subsystem: security
tags: [git, change-analysis, security-audit, agent-definition, investigator]

# Dependency graph
requires:
  - phase: 01-state-infrastructure
    provides: STATE.md with last_audit frontmatter
  - phase: 04-hot-spot-verifier
    provides: Investigator agent pattern (return to orchestrator)
  - phase: 05-question-investigator
    provides: Investigation strategy patterns
provides:
  - change-analyzer agent definition (.claude/agents/security/change-analyzer.md)
  - 5-category change classification system
  - Git-based audit range analysis
  - Cross-reference with HOT-SPOTS.md
  - Recommendations for follow-up agents
affects: [07-security-orchestrator, security-audit-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Investigator agent pattern (return results to orchestrator)"
    - "5-category security change classification"
    - "Git --since for audit range filtering"
    - "Cross-reference changed files against HOT-SPOTS.md"
    - "Pattern detection in git diff output"

key-files:
  created:
    - .claude/agents/security/change-analyzer.md
  modified: []

key-decisions:
  - "5 categories: Hot Spot Touches, New Entry Points, Security Patterns, Security-Adjacent, Non-Security"
  - "Category order matters: first match wins (hot spots checked before patterns)"
  - "Filter non-production first (docs, tests, tooling get summary count only)"
  - "Return-to-orchestrator pattern (agent does not write documents)"
  - "Risk level: HIGH (critical hot spots or patterns), MEDIUM (high-risk or entry points), LOW (adjacent), NONE (non-security)"

patterns-established:
  - "Change analysis triage before deep investigation"
  - "Git diff pattern detection for security-relevant code"
  - "Cross-reference changed files against hot spots list"

# Metrics
duration: 5min
completed: 2026-02-06
---

# Phase 6 Plan 1: Change Analyzer Summary

**Security change analyzer agent with git-based change triage and 5-category classification**

## Performance

- **Duration:** 5 min 30 sec
- **Started:** 2026-02-06T01:55:53Z
- **Completed:** 2026-02-06T02:01:23Z
- **Tasks:** 2
- **Files created:** 1

## Accomplishments

- Created change-analyzer agent definition (1146 lines)
- Implemented 5-category change classification system for security triage
- Added git commands for audit range analysis (--since, --name-status)
- Integrated with STATE.md (last_audit) and HOT-SPOTS.md (cross-reference)
- Defined pattern detection for security-relevant code changes
- Established return-to-orchestrator output format with recommendations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create change-analyzer agent definition** - `045cba3` (feat)
2. **Task 2: Verify STATE.md and HOT-SPOTS.md integration** - verification only, no changes

**Plan metadata:** Pending final commit

## Files Created/Modified

- `.claude/agents/security/change-analyzer.md` - Security change analyzer agent (1146 lines)
  - YAML frontmatter with name, description, tools, model, color
  - 12 XML sections following investigator pattern
  - 5 change categories with detection methods and actions
  - Git commands for listing commits and changed files
  - Pattern detection for security-relevant code changes
  - Hot spot cross-reference with HOT-SPOTS.md
  - Return-to-orchestrator output format

## Decisions Made

1. **5-category classification system** - Provides clear triage for change analysis:
   - Category 1: Hot Spot Touches (cross-reference with HOT-SPOTS.md)
   - Category 2: New Entry Points (new files, exports, commands)
   - Category 3: Security Pattern Changes (risky patterns from diff)
   - Category 4: Security-Adjacent (auth, config, error handling)
   - Category 5: Non-Security (docs, tests, tooling - summary only)

2. **Filter non-production first** - Category 5 gets filtered early to avoid wasting analysis time on docs/tests/tooling.

3. **First-match-wins ordering** - Categories applied in order; a file matching Category 1 (hot spot) doesn't also get flagged as Category 3 (pattern).

4. **Risk level mapping** - Clear mapping from categories to risk assessment:
   - HIGH: Critical hot spots OR security patterns found
   - MEDIUM: High-risk hot spots OR new entry points
   - LOW: Only security-adjacent changes
   - NONE: Only non-security changes

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 7 (Security Orchestrator):**
- All 3 investigator agents complete: hot-spot-verifier, question-investigator, change-analyzer
- All 4 mapper agents complete from Phase 2
- STATE.md and HOT-SPOTS.md integration verified
- Return-to-orchestrator pattern established for all investigators

**Prerequisites complete:**
- STATE.md provides last_audit baseline for change analysis
- HOT-SPOTS.md provides critical file list for cross-reference
- Agent definitions ready for orchestrator to spawn

## Self-Check: PASSED

All files and commits verified:
- `.claude/agents/security/change-analyzer.md` exists (1146 lines)
- Commit `045cba3` exists in git log

---
*Phase: 06-change-analyzer*
*Completed: 2026-02-06*
