# Roadmap: GSD-Style Security Audit System

## Overview

This roadmap delivers a comprehensive security intelligence system for herdctl that operates like a "full-time security researcher." Starting with persistent state infrastructure, we build four parallel codebase mapper agents, three investigation agents, and orchestrator commands that coordinate them. Each phase delivers a complete, verifiable capability - from state tracking through daily automated audits with dedicated branch commits.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: State Infrastructure** - Persistent STATE.md for audit memory and session continuity
- [x] **Phase 2: Mapper Agent Definitions** - Four parallel security mapper agents
- [x] **Phase 3: Mapping Orchestrator** - /security-map-codebase command with output handling
- [ ] **Phase 4: Hot-Spot Verifier** - Agent for critical file verification
- [ ] **Phase 5: Question Investigator** - Agent for researching open questions
- [ ] **Phase 6: Change Analyzer** - Agent for security-focused commit review
- [ ] **Phase 7: Audit Orchestrator** - /security-audit command with subagent spawning
- [ ] **Phase 8: Daily Automation** - /security-audit-daily meta-orchestrator with branch commits

## Phase Details

### Phase 1: State Infrastructure
**Goal**: Security audits have persistent memory that tracks position, coverage, investigations, and session continuity
**Depends on**: Nothing (first phase)
**Requirements**: STATE-01, STATE-02, STATE-03, STATE-04, STATE-05
**Success Criteria** (what must be TRUE):
  1. STATE.md exists with Current Position section showing last mapping date, last audit date, and counts
  2. STATE.md includes Coverage Status table showing areas with last-checked dates and staleness indicators
  3. STATE.md includes Active Investigations section tracking in-progress findings and questions
  4. STATE.md includes Accumulated Context section with recent decisions, known gaps, and session continuity
  5. Running an audit automatically updates STATE.md with new position data
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md - Create STATE.md with persistent audit memory (Current Position, Coverage Status, Active Investigations, Accumulated Context, Update Protocol)

### Phase 2: Mapper Agent Definitions
**Goal**: Four specialized agents exist that can analyze the codebase for attack surface, data flows, security controls, and threat vectors
**Depends on**: Phase 1
**Requirements**: MAP-01, MAP-02, MAP-03, MAP-04
**Success Criteria** (what must be TRUE):
  1. attack-surface-mapper agent definition exists and can identify entry points, APIs, and trust boundaries
  2. data-flow-tracer agent definition exists and can trace user input to sensitive operations
  3. security-controls-mapper agent definition exists and can document validation, auth, and defenses
  4. threat-vector-analyzer agent definition exists and can identify codebase-specific attack patterns
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md - Create attack-surface-mapper and data-flow-tracer agent definitions (input-focused mappers)
- [x] 02-02-PLAN.md - Create security-controls-mapper and threat-vector-analyzer agent definitions (defense/risk-focused mappers)

### Phase 3: Mapping Orchestrator
**Goal**: User can run /security-map-codebase to spawn parallel mappers and generate comprehensive security documentation
**Depends on**: Phase 2
**Requirements**: CMD-01, MAP-05, MAP-06
**Success Criteria** (what must be TRUE):
  1. /security-map-codebase command exists and spawns 4 mapper agents in parallel
  2. Mapper agents write directly to .security/codebase-map/ directory
  3. Command auto-triggers when 15+ commits OR 7+ days since last mapping
  4. All four mapping documents contain substantial security analysis with file paths
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md - Create /security-map-codebase orchestrator and run initial mapping

### Phase 4: Hot-Spot Verifier
**Goal**: Critical security files from HOT-SPOTS.md can be automatically verified for regressions
**Depends on**: Phase 3
**Requirements**: INV-01, CMD-03
**Success Criteria** (what must be TRUE):
  1. hot-spot-verifier agent definition exists and reads HOT-SPOTS.md
  2. Agent verifies security properties of each critical file still hold
  3. /security-audit spawns hot-spot-verifier when critical files have been modified
  4. Agent returns verification report with pass/fail status and any findings
**Plans**: 1 plan

Plans:
- [ ] 04-01-PLAN.md - Create hot-spot-verifier agent definition (verification-focused investigator)

### Phase 5: Question Investigator
**Goal**: Open security questions from CODEBASE-UNDERSTANDING.md can be systematically researched
**Depends on**: Phase 4
**Requirements**: INV-02, CMD-04
**Success Criteria** (what must be TRUE):
  1. question-investigator agent definition exists and reads Open Questions from CODEBASE-UNDERSTANDING.md
  2. Agent deeply researches assigned questions and returns findings with evidence
  3. /security-audit spawns question-investigator when open questions exist
  4. Agent recommends question status updates (Answered, Partial, Blocked)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Change Analyzer
**Goal**: Recent code changes can be automatically analyzed for security implications
**Depends on**: Phase 5
**Requirements**: INV-03, CMD-05
**Success Criteria** (what must be TRUE):
  1. change-analyzer agent definition exists and reads git log since last audit
  2. Agent identifies security-relevant changes (hot spot touches, new entry points)
  3. /security-audit spawns change-analyzer when commits exist since last audit
  4. Agent returns security assessment with recommendations for investigation
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

### Phase 7: Audit Orchestrator
**Goal**: User can run /security-audit to perform comprehensive incremental audits with automatic subagent delegation
**Depends on**: Phase 6
**Requirements**: CMD-02, INT-01, INT-02, INT-04
**Success Criteria** (what must be TRUE):
  1. /security-audit command exists with conditional spawning of investigation agents
  2. Orchestrator stays under 20% context usage, delegating depth to subagents
  3. Existing scan.ts scanner runs as first phase and results are integrated
  4. FINDINGS-INDEX.md and CODEBASE-UNDERSTANDING.md are updated after each audit
  5. Intelligence report written to .security/intel/YYYY-MM-DD.md
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Daily Automation
**Goal**: Security audits can run fully automated on a schedule with results committed to dedicated branch
**Depends on**: Phase 7
**Requirements**: CMD-06, CMD-07, INT-03
**Success Criteria** (what must be TRUE):
  1. /security-audit-daily meta-orchestrator exists and sequences audit + review
  2. Results are committed to security-audits branch (not main)
  3. All agent definitions live in .claude/agents/security/ directory
  4. System can run unattended end-to-end with actionable executive summary
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. State Infrastructure | 1/1 | Complete | 2026-02-05 |
| 2. Mapper Agent Definitions | 2/2 | Complete | 2026-02-05 |
| 3. Mapping Orchestrator | 1/1 | Complete | 2026-02-06 |
| 4. Hot-Spot Verifier | 0/1 | Planned | - |
| 5. Question Investigator | 0/? | Not started | - |
| 6. Change Analyzer | 0/? | Not started | - |
| 7. Audit Orchestrator | 0/? | Not started | - |
| 8. Daily Automation | 0/? | Not started | - |
