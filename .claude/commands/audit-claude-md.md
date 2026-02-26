---
name: audit-claude-md
description: Audit all CLAUDE.md files against the gold standard and produce a gap report
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

<objective>
Orchestrator for auditing CLAUDE.md files across the repository against the gold standard defined in `canon/claude-md-gold-standard.md`.

This command:
1. **Discovers** all CLAUDE.md and .claude/rules/ files in the repo
2. **Launches parallel sub-agents** to audit six dimensions: inventory, size, style, content, staleness, and coverage
3. **Assembles** a structured gap report from all agent outputs
4. **Writes** the report to `.reports/claude/YYYY-MM-DD-audit.md`

This is an audit-only process. It does not fix issues — remediation is a separate step.

**Process design:** See `canon/autoclaude.md` for the full audit architecture and rationale.
**Gold standard:** See `canon/claude-md-gold-standard.md` for what files are measured against.
</objective>

<context>
**Architecture:** This orchestrator launches four specialized sub-agents via Task tool:

1. **inventory-size-auditor** — Compares discovered files against the gold standard inventory table. Checks line counts against target ranges. Fast, mechanical check.

2. **style-content-auditor** — Launched once per CLAUDE.md file, in parallel. Checks each file for descriptive language that should be imperative, and verifies content is appropriate for its level. Reads parent files to detect duplication.

3. **staleness-auditor** — Launched once per CLAUDE.md file, in parallel. Verifies every file path, function name, type name, and module name referenced in each file still exists in the codebase.

4. **coverage-gap-auditor** — Examines directories without CLAUDE.md files and applies the three-question test to determine if one should exist.

**Why sub-agents:** Each file audit is independent and benefits from its own context. The orchestrator stays lightweight — it discovers files, dispatches agents, and assembles results.

**Rule:** Use Task tool for all sub-agents, not Skill tool. This preserves orchestrator context across phases.
</context>

<process>

<step name="phase_0_setup">
## Phase 0: Setup

Set the date and ensure the report directory exists.

```bash
TODAY=$(date +%Y-%m-%d)
mkdir -p .reports/claude
echo "Audit date: $TODAY"
```

Read the gold standard to extract the inventory table:
```
Read canon/claude-md-gold-standard.md
```

Discover all CLAUDE.md files (excluding node_modules and test fixtures):
```bash
find . -name "CLAUDE.md" -not -path "*/node_modules/*" -not -path "*/__tests__/*" -not -path "*/fixtures/*" | sort
```

Discover all rules files:
```bash
ls .claude/rules/*.md 2>/dev/null
```

Store the file lists — these are passed to sub-agents.
</step>

<step name="phase_1_inventory_and_size">
## Phase 1: Inventory and Size (Agent 1)

Spawn the inventory-size-auditor sub-agent.

```
Use Task tool with:
- subagent_type: "general-purpose"
- run_in_background: false
- prompt: Include the full text of .claude/agents/claude-md/inventory-size-auditor.md
         as instructions, followed by:
         - The gold standard inventory table (from Phase 0)
         - The discovered CLAUDE.md file list
         - The discovered rules file list
```

Store the agent's findings for the final report.
</step>

<step name="phase_2_style_content">
## Phase 2: Style and Content (Agent 2, per-file, parallel)

For each CLAUDE.md file discovered in Phase 0, spawn a style-content-auditor sub-agent. Launch all agents in a single message for parallel execution.

Each agent receives:
- The instructions from `.claude/agents/claude-md/style-content-auditor.md`
- The file path to audit
- Its level: `root` (CLAUDE.md), `package` (packages/*/CLAUDE.md), `module` (deeper), or `rules` (.claude/rules/)
- The path to its parent CLAUDE.md (if any) — for duplication checking
- The root CLAUDE.md path

**Parallel launch:** Send all Task tool calls in a single message. Each file is independent.

Also audit each `.claude/rules/*.md` file the same way, with level set to `rules`.

Store all agents' findings for the final report.
</step>

<step name="phase_3_staleness">
## Phase 3: Staleness (Agent 3, per-file, parallel)

For each CLAUDE.md file AND each .claude/rules/*.md file, spawn a staleness-auditor sub-agent. Launch all agents in a single message for parallel execution.

Each agent receives:
- The instructions from `.claude/agents/claude-md/staleness-auditor.md`
- The file path to audit

**Parallel launch:** Send all Task tool calls in a single message. Each file is independent.

Store all agents' findings for the final report.
</step>

<step name="phase_4_coverage">
## Phase 4: Coverage Gaps (Agent 4)

Spawn the coverage-gap-auditor sub-agent.

```
Use Task tool with:
- subagent_type: "general-purpose"
- run_in_background: false
- prompt: Include the full text of .claude/agents/claude-md/coverage-gap-auditor.md
         as instructions, followed by:
         - The list of existing CLAUDE.md file locations
         - The repository root path
```

Store the agent's findings for the final report.
</step>

<step name="phase_5_assemble_report">
## Phase 5: Assemble Report

Combine all agent outputs into a single report. Write to `.reports/claude/{TODAY}-audit.md`.

Use the following template, filling in results from each agent:

```markdown
# CLAUDE.md Audit Report
Generated: {TODAY}
Measured against: canon/claude-md-gold-standard.md
Process: canon/autoclaude.md

## Summary

| Dimension | Status | Issues |
|-----------|--------|--------|
| Inventory | [✅ / ⚠️] | N discrepancies |
| Size | [✅ / ⚠️] | N violations |
| Style | [✅ / ⚠️] | N descriptive lines |
| Content | [✅ / ⚠️] | N issues |
| Staleness | [✅ / ⚠️] | N stale references |
| Coverage | [✅ / ⚠️] | N gaps |

**Total issues: N**

## Inventory (Agent 1)

{Paste inventory findings from Phase 1}

## Size Compliance (Agent 1)

{Paste size findings from Phase 1}

## Per-File Findings

### {file path}

**Style:**
{Paste style findings from Phase 2 for this file}

**Content:**
{Paste content findings from Phase 2 for this file}

**Staleness:**
{Paste staleness findings from Phase 3 for this file}

---

{Repeat for each file}

## Coverage Gaps (Agent 4)

{Paste coverage findings from Phase 4}

## Remediation Checklist

{Compile a numbered checklist of all issues found, ordered by severity:
1. Stale references (highest priority — actively misleading)
2. Content violations (duplicated content, wrong-level content)
3. Style issues (descriptive lines with suggested rewrites)
4. Size violations
5. Coverage gaps (lowest priority — suggestions, not problems)}
```

Print a summary to stdout after writing the report:

```
==========================================
  CLAUDE.md AUDIT COMPLETE
==========================================

Date:            {TODAY}
Files audited:   {N}
Total issues:    {N}

Breakdown:
  Inventory:     {N issues}
  Size:          {N issues}
  Style:         {N descriptive lines}
  Content:       {N issues}
  Staleness:     {N stale refs}
  Coverage:      {N gaps}

Report: .reports/claude/{TODAY}-audit.md
==========================================
```
</step>

</process>

<success_criteria>
- [ ] Gold standard read and inventory table extracted
- [ ] All CLAUDE.md and rules files discovered
- [ ] Agent 1 (inventory + size) completed
- [ ] Agent 2 (style + content) launched for each file, all completed
- [ ] Agent 3 (staleness) launched for each file, all completed
- [ ] Agent 4 (coverage gaps) completed
- [ ] Report written to .reports/claude/{TODAY}-audit.md
- [ ] Summary printed to stdout
- [ ] Remediation checklist compiled in priority order
</success_criteria>
