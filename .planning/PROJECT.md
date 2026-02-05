# GSD-Style Security Audit System for herdctl

## What This Is

A comprehensive security intelligence system for the herdctl codebase that operates like a "full-time security researcher" — maintaining deep persistent understanding of security posture, running daily incremental audits that build on previous knowledge, and using subagent orchestration to avoid context degradation during deep investigations.

## Core Value

**Continuous, intelligent security oversight that improves over time.** Each audit builds on accumulated knowledge rather than starting fresh, with subagent delegation enabling deep investigations without sacrificing orchestrator context.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] STATE.md for persistent security audit state and session continuity
- [ ] 4 parallel security mapper agents (attack-surface, data-flow, security-controls, threat-vectors)
- [ ] hot-spot-verifier agent for critical file verification
- [ ] question-investigator agent for researching open questions
- [ ] change-analyzer agent for security review of recent commits
- [ ] /security-map-codebase command for full codebase security mapping
- [ ] /security-audit command with subagent orchestration
- [ ] /security-audit-daily command with dedicated branch commits
- [ ] Minimal orchestrator context usage (<20%)
- [ ] Agent definitions in .claude/agents/security/

### Out of Scope

- /security-deep-dive command — defer to future milestone
- finding-investigator agent — defer to future milestone
- Rewriting existing scan.ts scanner — works well as-is
- GUI/dashboard for security findings — CLI-first
- Integration with external security tools — self-contained system

## Context

This is an enhancement to the existing herdctl security infrastructure:

**Existing assets to preserve:**
- `.security/tools/scan.ts` — deterministic scanner (6 checks, JSON output, works well)
- `.security/HOT-SPOTS.md` — critical files checklist
- `.security/CODEBASE-UNDERSTANDING.md` — evolving knowledge + open questions
- `.security/intel/FINDINGS-INDEX.md` — master findings tracker

**Existing commands to refactor:**
- `.claude/commands/security-audit.md` — update to orchestrator pattern
- `.claude/commands/security-audit-review.md` — may spawn review agent
- `.claude/commands/security-audit-daily.md` — becomes meta-orchestrator

**herdctl codebase structure:**
- TypeScript monorepo with packages/core/, packages/cli/
- Security-critical areas: config/, runner/, state/, hooks/
- Uses Zod for schema validation, execa for process spawning
- Docker containerization with hardening options

## Constraints

- **Pattern**: Must follow GSD patterns — subagent delegation, persistent state files, structured documentation, orchestrator-based coordination
- **Context budget**: Orchestrators must stay under 20% context utilization; delegate depth to subagents
- **Compatibility**: Must work with existing security scanner and file structure
- **Location**: Agent definitions in `.claude/agents/security/`
- **Commits**: Daily automation commits to `security/daily-audits` branch

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Skip /security-deep-dive for v1 | Focus on daily workflow first | — Pending |
| Keep existing scan.ts | Works well, no need to rewrite | — Pending |
| Agents in .claude/agents/security/ | Keep with other agent definitions | — Pending |
| Dedicated branch for daily commits | Isolate automated commits from main work | — Pending |
| 7 agents total (4 mappers + 3 investigators) | Full system coverage without deep-dive | — Pending |

---
*Last updated: 2026-02-05 after initialization*
