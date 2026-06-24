# AutoCLAUDE — Automated CLAUDE.md Maintenance

This document defines the process for auditing and maintaining CLAUDE.md files across the herdctl repository. It works in conjunction with the gold standard defined in `canon/claude-md-gold-standard.md`.

## Overview

AutoCLAUDE is a repeatable audit process that measures the repository's CLAUDE.md files against the gold standard and produces a structured report of findings. It does not fix issues — audit and remediation are separate steps.

## Audit Dimensions

The audit checks six dimensions, ordered from mechanical (deterministic) to judgmental (requires reading code and applying reasoning).

### 1. Inventory

Compare the gold standard's file inventory table against what actually exists in the repository.

- **Missing files**: listed in the inventory but absent from the repo.
- **Unexpected files**: CLAUDE.md files that exist but aren't listed in the inventory. These aren't necessarily wrong — they may be new files that the inventory table needs updating for.
- **Stale inventory entries**: listed in the inventory but the directory they describe no longer exists.

### 2. Size compliance

Check each file's line count against the target range for its level:

| Level | Target range | Flag threshold |
|-------|-------------|----------------|
| Root CLAUDE.md | 80–150 lines | Over 150 |
| Package-level | 30–60 lines | Over 60 |
| Module-level | 15–30 lines | Over 30 |
| `.claude/rules/` files | ~30 lines each | Over 50 |

Files under the minimum aren't flagged — a short file that covers everything it needs to is fine.

### 3. Style compliance

Flag specific lines that are phrased descriptively when they should be imperative. Research shows imperative instructions ("Use X", "Never do Y") achieve 94% compliance from Claude, while descriptive phrasing ("The project uses X") achieves only 73% — a 21-point gap for the same instruction.

**What to check**: Convention and instruction lines — any line whose purpose is to direct Claude's behavior.

**What to skip**: Overview paragraphs (naturally descriptive — they explain what a package *is*), code blocks, structure tables, and file path listings.

**Patterns that indicate descriptive-when-it-should-be-imperative**:
- "The project uses..." / "We use..."
- "This package has..." / "This module contains..."
- "X is used for..." / "Y is handled by..."
- "Components accept..." (should be "Pass X to components" or "Inject X via...")
- Any sentence describing current state that could instead be an instruction

Each flagged line should include the line number, the current text, and a suggested imperative rewrite.

### 4. Content compliance

Check that each file follows the "what goes in each level" rules from the gold standard:

- **Root CLAUDE.md**: Must include project overview, repo structure, dev commands, shared code conventions, quality gates. Must not include package-specific conventions or reference material.
- **Package-level**: Must include package purpose, unique conventions, package-specific commands if different from root. Must not repeat root content or include content that applies equally to sibling packages.
- **Module-level**: Must include module purpose, key types, non-obvious patterns. Must not repeat parent or root content.
- **`.claude/rules/` files**: Each file should cover one topic. Must not duplicate CLAUDE.md content.

**Parent duplication check**: For each non-root CLAUDE.md, compare its content against its parent CLAUDE.md and the root. Flag any instruction or convention that is already stated at a higher level — it's inherited automatically and the duplicate wastes context.

### 5. Staleness

For every file path, function name, type name, directory name, or module name referenced in a CLAUDE.md file, verify it still exists in the codebase.

- File paths: glob/stat to confirm existence.
- Function/type names: grep the codebase for the identifier.
- Directory references in structure tables: confirm the directory exists and still serves the described purpose.

Each stale reference should include the CLAUDE.md file, line number, the referenced entity, and whether it was renamed, moved, or deleted.

This is the highest-value check for ongoing maintenance — stale instructions cause Claude to confidently follow wrong guidance.

### 6. Coverage gaps

For directories that don't have a CLAUDE.md, apply the three-question test from the gold standard:

1. **Different technology stack** — does the directory use a framework, language, or tooling that differs from the parent CLAUDE.md?
2. **Conventions that contradict or specialize the parent** — does the directory have its own error handling, logging, testing, or architectural patterns?
3. **Repeated Claude mistakes** — is this a directory where Claude consistently gets things wrong?

The audit can assess questions 1 and 2 mechanically (check for distinct `package.json`, different frameworks in imports, unique patterns). Question 3 requires human input or historical data from past sessions.

Flag directories that clearly meet criteria 1 or 2 as "consider adding a CLAUDE.md" with reasoning.

## Architecture

The audit runs as an orchestrator that launches parallel sub-agents, each responsible for specific dimensions. This keeps each agent's context small and focused.

```
Orchestrator
├── Read gold standard (canon/claude-md-gold-standard.md)
├── Discover all CLAUDE.md files and .claude/rules/*.md files
│
├── Agent 1: Inventory + Size (dimensions 1–2)
│   Input: gold standard inventory table, discovered file list
│   Output: missing/unexpected files, size violations
│
├── Agent 2: Style + Content (dimensions 3–4)
│   Launched per-file in parallel
│   Input: one CLAUDE.md + its parent (if any) + gold standard rules
│   Output: descriptive-line flags with rewrites, content violations
│
├── Agent 3: Staleness (dimension 5)
│   Launched per-file in parallel
│   Input: one CLAUDE.md file
│   Checks: grep/glob every referenced entity
│   Output: stale references with line numbers
│
└── Agent 4: Coverage gaps (dimension 6)
    Input: repo directory tree, existing CLAUDE.md locations, gold standard criteria
    Output: directories that may warrant a CLAUDE.md, with reasoning
│
└── Assemble report from all agent outputs
```

Agents 2 and 3 are parallelized per-file — each file's audit is independent.

## Report Format

Reports are written to `.reports/claude/` with date-stamped filenames: `.reports/claude/YYYY-MM-DD-audit.md`.

```markdown
# CLAUDE.md Audit Report
Generated: YYYY-MM-DD
Measured against: canon/claude-md-gold-standard.md

## Summary
- Files audited: N
- Issues found: N (N critical, N warnings)
- Missing files: N
- Stale references: N
- Coverage gaps: N directories

## Inventory
[Missing files, unexpected files, inventory discrepancies]

## Per-File Findings

### <file path>
- **Size**: N lines [✅ | ⚠️ over target of N]
- **Style**: [✅ | ⚠️ N lines use descriptive language]
  - Line N: "The project uses X" → rewrite: "Use X for..."
- **Content**: [✅ | ⚠️ description of issues]
  - Line N: duplicates root CLAUDE.md line M
- **Staleness**: [✅ | ⚠️ N stale references]
  - Line N: references `path/to/thing` — not found in codebase

[... repeated for each file ...]

## Coverage Gaps
- `path/to/directory/` — [reasoning from three-question test]

## Remediation Checklist
1. [ ] file: description of what to fix
2. [ ] file: description of what to fix
[... ordered by severity ...]
```

## Daily Scheduled Mode

When run as a daily scheduled agent (phase 4), the audit optimizes by:

1. Reading the git log since the last audit run.
2. Identifying directories with commits since last run.
3. Running the full inventory and size checks (cheap, always worth doing).
4. Running staleness, style, and content checks only on CLAUDE.md files in or above changed directories.
5. Running coverage gap analysis only on changed directories.
6. If the gold standard itself changed since last run, performing a full audit.

The daily agent compares its report against the previous report in `.reports/claude/` and opens a PR only if new issues are found. The PR includes the diff between reports and the remediation checklist.

## Relationship to Other Steps

| Step | Status | Description |
|------|--------|-------------|
| 1. Gold standard | ✅ Done | `canon/claude-md-gold-standard.md` |
| 2. Audit process | ✅ This document | Repeatable audit producing gap reports |
| 3. One-time alignment | ✅ Done | All 19 issues fixed, baseline at 0 issues |
| 4. Daily scheduled agent | ✅ Done | `.claude/commands/claude-md-audit-daily.md` |
