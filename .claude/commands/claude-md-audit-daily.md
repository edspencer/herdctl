---
name: claude-md-audit-daily
description: Automated daily CLAUDE.md audit with branch isolation and PR creation for new issues
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Edit
  - Task
---

<objective>
Meta-orchestrator for fully automated daily CLAUDE.md audits.

This command wraps the `/audit-claude-md` workflow with:
1. **Branch management** — Commits to a `claude-md/audit-YYYY-MM-DD` branch, keeping main clean
2. **Full audit execution** — Delegates to a sub-agent that runs `/audit-claude-md`
3. **Regression detection** — Compares new report against the previous baseline
4. **PR workflow** — Creates a PR only when new issues are detected
5. **Unattended execution** — No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl or cron.
</objective>

<context>
**Why we use subagents (CRITICAL for reliable execution):**

This is a meta-orchestrator that coordinates multiple phases. We use Task tool
with subagents instead of Skill tool for Phase 2 because:

1. **Context preservation** — When using Skill tool, the orchestrator "forgets" its state
   after the nested skill completes. This caused phases to never execute in the security agent.
2. **Independent execution** — Task tool spawns separate subagents that run independently
   while the orchestrator maintains its own context and state.
3. **Reliable continuation** — After each subagent returns, the orchestrator reliably
   proceeds to the next phase without state loss.

**Rule:** Orchestrators must preserve their own context. Delegate long-running work to
subagents via Task tool, not Skill tool.

**Branch strategy:**
- Each audit creates a fresh branch: `claude-md/audit-YYYY-MM-DD`
- If no new issues are found, the branch is deleted (no PR)
- If the branch already exists from an earlier run today, append a counter

**Key inputs/outputs:**
- Input: Previous audit report in `.reports/claude/` (most recent `*-audit.md`)
- Output: New audit report at `.reports/claude/YYYY-MM-DD-audit.md`
- Output (conditional): PR branch with the new report if issues increased
</context>

<process>

<step name="phase_0_preflight">
## Phase 0: Pre-flight Checks

Verify clean working state before audit execution.

**Check for uncommitted changes:**
```bash
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "ERROR: Uncommitted changes detected"
  git status --short
  echo ""
  echo "Please commit or stash changes before running daily audit."
  exit 1
fi
echo "Working tree clean"
```

**Save original branch:**
```bash
ORIGINAL_BRANCH=$(git branch --show-current)
echo "Original branch: $ORIGINAL_BRANCH"
```

Store `$ORIGINAL_BRANCH` for restoration in Phase 5.

**Set today's date:**
```bash
TODAY=$(date +%Y-%m-%d)
echo "Audit date: $TODAY"
```

**Fetch latest main:**
```bash
git fetch origin main --quiet
echo "Fetched latest main"
```

**Identify the previous baseline report:**
```bash
PREVIOUS_REPORT=$(ls -1 .reports/claude/*-audit.md 2>/dev/null | sort | tail -1)
if [ -n "$PREVIOUS_REPORT" ]; then
  PREVIOUS_TOTAL=$(grep "Total issues:" "$PREVIOUS_REPORT" | grep -oE "[0-9]+" | head -1)
  echo "Previous report: $PREVIOUS_REPORT (${PREVIOUS_TOTAL:-0} issues)"
else
  PREVIOUS_TOTAL=0
  echo "No previous report found — first run"
fi
```

**Pre-flight complete:** Working tree clean, original branch saved, baseline identified.
</step>

<step name="phase_1_branch_setup">
## Phase 1: Branch Setup

Create a working branch for the audit.

**Create audit branch from latest main:**
```bash
BRANCH_NAME="claude-md/audit-${TODAY}"

# Handle duplicate branch names from earlier runs today
if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
  COUNTER=2
  while git rev-parse --verify "${BRANCH_NAME}-${COUNTER}" >/dev/null 2>&1; do
    COUNTER=$((COUNTER + 1))
  done
  BRANCH_NAME="${BRANCH_NAME}-${COUNTER}"
fi

git checkout -b "$BRANCH_NAME" origin/main
echo "Created branch: $BRANCH_NAME"
```

**Branch setup complete:** Now on audit branch, based on latest main.
</step>

<step name="phase_2_run_audit">
## Phase 2: Run Full CLAUDE.md Audit (via Sub-agent)

Delegate the audit to a dedicated sub-agent using Task tool.

**IMPORTANT:** Use Task tool, NOT Skill tool. This ensures the orchestrator maintains
its context and can reliably continue to subsequent phases.

**Spawn audit sub-agent:**
```
Use the Task tool with:
- subagent_type: "general-purpose"
- run_in_background: false
- prompt: "IMPORTANT RULES:
    (1) Do NOT create branches or run git checkout — stay on the current branch.
    (2) Do NOT commit any changes — the orchestrator handles commits.

    Run the /audit-claude-md command. Execute a full CLAUDE.md audit:
    1. Read the gold standard from canon/claude-md-gold-standard.md
    2. Discover all CLAUDE.md files and .claude/rules/*.md files
    3. Launch the 4 audit sub-agents (inventory+size, style+content, staleness, coverage)
    4. Assemble the full report
    5. Write the report to .reports/claude/{TODAY}-audit.md

    When complete, report back with:
    - Total issues found (number)
    - Breakdown by dimension (inventory, size, style, content, staleness, coverage)
    - The full remediation checklist"
```

**Capture the audit result.**
After the sub-agent completes, extract:
- Total issues found
- Per-dimension breakdown

**Re-verify branch after sub-agent completes:**
```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH_NAME" ]; then
  echo "WARN: Sub-agent switched to branch $CURRENT_BRANCH, restoring $BRANCH_NAME"
  git checkout "$BRANCH_NAME" --quiet
fi
echo "Verified on branch: $(git branch --show-current)"
```
</step>

<step name="phase_3_compare_baseline">
## Phase 3: Compare Against Baseline

Determine whether the audit found new issues compared to the previous report.

**Read the new report:**
```bash
NEW_REPORT=".reports/claude/${TODAY}-audit.md"
if [ ! -f "$NEW_REPORT" ]; then
  echo "ERROR: Audit report not found at $NEW_REPORT"
  echo "Sub-agent may have failed. Proceeding to cleanup."
  NEW_TOTAL="ERROR"
else
  NEW_TOTAL=$(grep "Total issues:" "$NEW_REPORT" | grep -oE "[0-9]+" | head -1)
  echo "New report: $NEW_REPORT (${NEW_TOTAL:-0} issues)"
fi
```

**Decision logic:**
```
If NEW_TOTAL is "ERROR":
  STATUS="ERROR"
  ACTION="error"
  → Skip Phase 4, proceed to Phase 5 cleanup

If NEW_TOTAL > PREVIOUS_TOTAL:
  STATUS="REGRESSION"
  ACTION="create-pr"
  → New issues found, create a PR for visibility

If NEW_TOTAL == PREVIOUS_TOTAL:
  STATUS="STABLE"
  ACTION="commit-only"
  → No change, commit report to branch but no PR needed

If NEW_TOTAL < PREVIOUS_TOTAL:
  STATUS="IMPROVED"
  ACTION="commit-only"
  → Issues decreased (someone fixed things), commit report as new baseline

If NEW_TOTAL == 0:
  STATUS="CLEAN"
  ACTION="commit-only"
  → Perfect score, commit report as new baseline
```

Store STATUS and ACTION for the next phase.
</step>

<step name="phase_4_commit_and_pr">
## Phase 4: Commit and Optionally Create PR

**Stage and commit the audit report:**
```bash
git add .reports/claude/${TODAY}-audit.md

STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "No new report to commit"
else
  git commit -m "audit: CLAUDE.md daily audit ${TODAY}

Status: ${STATUS}
Issues: ${NEW_TOTAL} (previous: ${PREVIOUS_TOTAL})

Generated by /claude-md-audit-daily

Co-Authored-By: Claude <noreply@anthropic.com>
"
  echo "Committed audit report"
fi
```

**Push branch:**
```bash
git push -u origin "$BRANCH_NAME"
echo "Pushed branch $BRANCH_NAME"
```

**Create PR only if regression detected:**
If ACTION is "create-pr":
```bash
ISSUE_DELTA=$((NEW_TOTAL - PREVIOUS_TOTAL))
gh pr create \
  --title "audit: CLAUDE.md regression detected ($TODAY) — $NEW_TOTAL issues (+$ISSUE_DELTA)" \
  --body "$(cat <<'PREOF'
## CLAUDE.md Audit Regression

The daily CLAUDE.md audit found **more issues than the previous baseline**.

| Metric | Previous | Current | Delta |
|--------|----------|---------|-------|
| Total Issues | ${PREVIOUS_TOTAL} | ${NEW_TOTAL} | +${ISSUE_DELTA} |

### What This Means

New CLAUDE.md quality issues were introduced since the last audit. Review the
audit report at `.reports/claude/${TODAY}-audit.md` for the full remediation
checklist.

### Next Steps

1. Review the remediation checklist in the audit report
2. Fix the new issues (or confirm they are acceptable)
3. Merge this PR to update the baseline

---

*Generated by `/claude-md-audit-daily` on ${TODAY}*
PREOF
)" \
  --base main
echo "PR created for regression"
```

If ACTION is "commit-only":
```
echo "No regression detected — branch pushed as baseline update"
echo "Status: $STATUS (${NEW_TOTAL} issues, previous: ${PREVIOUS_TOTAL})"
```

**Handle push failures gracefully:**
If push fails, log warning but don't fail the workflow. Changes are committed locally.
</step>

<step name="phase_5_cleanup">
## Phase 5: Restore Original Branch and Summary

**Always restore original branch, even on failure:**
```bash
git checkout "$ORIGINAL_BRANCH" --quiet
echo "Returned to branch: $ORIGINAL_BRANCH"
```

**Clean up branch if no PR was created and no changes were committed:**
If ACTION is "error" and no commits were made on the branch:
```bash
git branch -D "$BRANCH_NAME" 2>/dev/null
echo "Cleaned up empty branch $BRANCH_NAME"
```

**Final status report:**
```
==========================================
  DAILY CLAUDE.md AUDIT COMPLETE
==========================================

Date:           {TODAY}
Status:         {CLEAN | STABLE | IMPROVED | REGRESSION | ERROR}
Issues:         {NEW_TOTAL} (previous: {PREVIOUS_TOTAL})
Action:         {commit-only | create-pr | error}

{If REGRESSION:}
PR Created:     Yes — review needed
Delta:          +{ISSUE_DELTA} new issues

{If IMPROVED:}
Delta:          -{improvement} issues fixed since last audit

Report:         .reports/claude/{TODAY}-audit.md
Branch:         {BRANCH_NAME}
Current branch: {ORIGINAL_BRANCH}
==========================================
```
</step>

</process>

<edge_cases>

### Uncommitted Changes
If `git diff-index --quiet HEAD --` fails (uncommitted changes exist):
- Print clear error message with `git status --short`
- Exit immediately without modifying anything

### First Run (No Previous Report)
If no `*-audit.md` files exist in `.reports/claude/`:
- Set PREVIOUS_TOTAL to 0
- Any issues found will be treated as a regression (creates PR)
- This is correct behavior — the first run establishes the baseline

### Branch Already Exists
If `claude-md/audit-YYYY-MM-DD` already exists (from an earlier run today):
- Append counter: `claude-md/audit-YYYY-MM-DD-2`, `-3`, etc.

### Audit Sub-agent Fails
If the Phase 2 sub-agent fails or times out:
- Set STATUS to "ERROR"
- Skip PR creation
- Delete the empty branch
- Print error in final summary

### Push Fails
If `git push` fails:
- Log warning with the error
- Note that changes are committed locally
- Provide manual push command

### Zero Issues (Clean Bill of Health)
If NEW_TOTAL is 0:
- STATUS is "CLEAN"
- Commit the clean report as the new baseline
- No PR needed — everything is fine

</edge_cases>

<success_criteria>
Checklist for complete daily CLAUDE.md audit:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved
- [ ] Previous baseline report identified (or noted as first run)

**Branch Setup (Phase 1)**
- [ ] Audit branch created from latest main

**Audit (Phase 2)**
- [ ] Task tool spawned audit sub-agent
- [ ] Sub-agent completed and wrote report
- [ ] Branch verified after sub-agent return

**Comparison (Phase 3)**
- [ ] New report issue count extracted
- [ ] Compared against previous baseline
- [ ] STATUS and ACTION determined

**Commit/PR (Phase 4)**
- [ ] Report committed to audit branch
- [ ] Branch pushed to origin
- [ ] PR created if regression detected

**Cleanup (Phase 5)**
- [ ] Returned to original branch
- [ ] Final status printed
</success_criteria>

<unattended_execution>
This command is designed for unattended daily execution.

**No user prompts:**
- All decisions are automated based on data
- Edge cases are handled gracefully
- Failures are logged but don't block completion

**Scheduling (herdctl):**
```yaml
schedules:
  daily:
    type: cron
    expression: "0 4 * * *"
    prompt: "Run /claude-md-audit-daily"
```

**Manual invocation:**
```bash
claude "/claude-md-audit-daily"
```

**Output handling:**
- Report is written to `.reports/claude/YYYY-MM-DD-audit.md`
- PR created only when issues regress (not for stable or improved states)
- Final status report is printed for logging
- Non-zero exit only on pre-flight failure (uncommitted changes)
</unattended_execution>
