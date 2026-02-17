---
name: security-audit-daily
description: Automated daily security audit with branch isolation and executive summary
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
Meta-orchestrator for fully automated daily security audits with branch isolation.

This command wraps the full security audit workflow with:
1. **Branch management** - Commits to `security-audits` branch, keeping main clean
2. **Full audit execution** - Delegates to security-auditor subagent
3. **Self-review** - Delegates to security-reviewer subagent
4. **Executive summary** - GREEN/YELLOW/RED status for quick triage
5. **Unattended execution** - No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl or cron.
</objective>

<context>
**Why we use subagents (CRITICAL for reliable execution):**

This is a meta-orchestrator that coordinates multiple long-running tasks. We use Task tool
with subagents instead of Skill tool for Phases 2 and 3 because:

1. **Context preservation** - When using Skill tool, the orchestrator "forgets" its state
   after the nested skill completes. This caused phases 4-6 to never execute.
2. **Independent execution** - Task tool spawns separate subagents that run independently
   while the orchestrator maintains its own context and state.
3. **Reliable continuation** - After each subagent returns, the orchestrator reliably
   proceeds to the next phase without state loss.
4. **Long-running tasks** - Security audit and review are long-running operations that
   should be delegated rather than inlined.

**Rule:** Orchestrators must preserve their own context. Delegate long-running work to
subagents via Task tool, not Skill tool.

**Branch strategy:**
- Daily audits commit to `security-audits` branch
- Main branch stays clean from automated commits
- Branch rebases on main before each audit to stay current
- Use `--force-with-lease` for safe push after rebase

**Execution model:**
- Phases 0, 1, 4, 5, 6 are orchestrator-level operations (branch mgmt, summary, commit)
- Phase 2 delegates to `security-auditor` subagent for deep analysis
- Phase 3 delegates to `security-reviewer` subagent for quality assessment
- This orchestrator stays on security-audits branch throughout
- All file writes happen on the correct branch automatically


**CRITICAL — Secret Handling:**
Subagents MUST NEVER include actual secret values (API keys, tokens, passwords) in
any report, commit message, or output file. When reporting findings about secrets,
use [REDACTED] placeholders. Audit reports are committed to git and pushed to GitHub —
including real secrets in reports would leak them.

**CRITICAL — Branch Discipline:**
Only this orchestrator manages branches. Subagents must NOT create branches or run
git checkout. They work on whatever branch they find themselves on.
**Key outputs:**
- `.security/scans/YYYY-MM-DD.json` - Scanner output (from security-auditor)
- `.security/intel/YYYY-MM-DD.md` - Intelligence report (from security-auditor)
- `.security/reviews/YYYY-MM-DD.md` - Self-review (from security-reviewer)
- `.security/summaries/YYYY-MM-DD.md` - Executive summary (this orchestrator)
- `.security/STATE.md` - Audit baseline tracking (updated by subagents)
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
  echo "The audit will commit to the security-audits branch."
  exit 1
fi
echo "Working tree clean"
```

**Save original branch:**
```bash
ORIGINAL_BRANCH=$(git branch --show-current)
echo "Original branch: $ORIGINAL_BRANCH"
```

Store `$ORIGINAL_BRANCH` for restoration in Phase 6.

**Set today's date:**
```bash
TODAY=$(date +%Y-%m-%d)
echo "Audit date: $TODAY"
```

**Pre-flight complete:** Working tree clean, original branch saved.
</step>

<step name="phase_1_branch_setup">
## Phase 1: Branch Setup

Switch to security-audits branch for all audit work.

**Create or switch to security-audits branch:**
```bash
# Create branch if it doesn't exist, or switch to it
git checkout -B security-audits
echo "On branch: $(git branch --show-current)"
```

**Rebase on main to stay current:**
```bash
# Quiet rebase, handle conflicts gracefully
if git rebase main --quiet 2>/dev/null; then
  echo "Rebased on main successfully"
else
  echo "WARN: Rebase had conflicts, continuing on current state"
  git rebase --abort 2>/dev/null || true
fi
```

**Branch setup complete:** Now on security-audits branch, rebased on main.
</step>

<step name="phase_2_run_security_audit">
## Phase 2: Run Full Security Audit (via Subagent)

Delegate the security audit to a dedicated subagent using Task tool.

**IMPORTANT:** Use Task tool, NOT Skill tool. This ensures the orchestrator maintains
its context and can reliably continue to subsequent phases.

**Spawn security-auditor subagent:**
```
Use the Task tool with:
- subagent_type: "security-auditor"
- run_in_background: false (we need results before proceeding)
- prompt: "IMPORTANT RULES: (1) NEVER include actual secret values in reports — use [REDACTED] placeholders. (2) Do NOT create branches or run git checkout — stay on the current branch.

    Run the /security-audit command. Execute a full incremental security audit:
    1. Run the security scanner (scan.ts)
    2. Spawn change-analyzer to categorize commits since last audit
    3. Conditionally spawn hot-spot-verifier if critical files changed
    4. Conditionally spawn question-investigator if high-priority questions exist
    5. Aggregate all results
    6. Write intelligence report to .security/intel/{TODAY}.md
    7. Update FINDINGS-INDEX.md, CODEBASE-UNDERSTANDING.md, STATE.md
    8. Commit changes if configured

    When complete, report back with:
    - Overall result: PASS / WARN / FAIL
    - Scanner findings count
    - Commits analyzed count
    - Hot spots verified count
    - Questions investigated count
    - Any new findings summary"
```

**Capture the audit result:**
After the subagent completes, extract key metrics from its response:
- Overall result: PASS / WARN / FAIL
- Scanner findings count
- Commits analyzed
- Hot spots verified (count)
- Questions investigated (count)
- Any new findings

Store these for the executive summary in Phase 4.

**Wait for subagent completion before proceeding to Phase 3.**

**Re-verify branch after subagent completes:**
Subagents may inadvertently switch branches. Always re-verify and restore:
```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "security-audits" ]; then
  echo "WARN: Subagent switched to branch $CURRENT_BRANCH, restoring security-audits"
  git checkout security-audits --quiet
fi
echo "Verified on branch: $(git branch --show-current)"
```
</step>

<step name="phase_3_run_security_review">
## Phase 3: Run Security Audit Review (via Subagent)

Delegate the security review to a dedicated subagent using Task tool.

**IMPORTANT:** Use Task tool, NOT Skill tool. This ensures the orchestrator maintains
its context and can reliably continue to subsequent phases.

**Spawn security-reviewer subagent:**
```
Use the Task tool with:
- subagent_type: "security-reviewer"
- run_in_background: false (we need results before proceeding)
- prompt: "IMPORTANT RULES: (1) NEVER include actual secret values in reports — use [REDACTED] placeholders. (2) Do NOT create branches or run git checkout — stay on the current branch.

    Run the /security-audit-review command. Assess today's audit quality and apply improvements:
    1. Read the intelligence report just created at .security/intel/{TODAY}.md
    2. Assess coverage against HOT-SPOTS.md (were all hot spots checked?)
    3. Assess progress on open questions
    4. Evaluate investigation depth
    5. Identify gaps and missed opportunities
    6. Write review to .security/reviews/{TODAY}.md
    7. Apply confident improvements:
       - Update HOT-SPOTS.md if new critical areas found
       - Add new questions to CODEBASE-UNDERSTANDING.md
       - Propose updates to /security-audit.md if needed

    When complete, report back with:
    - Overall grade: A / B / C / D
    - Coverage rating
    - Depth rating
    - Gaps identified count
    - Improvements applied count and what was changed"
```

**Capture the review result:**
After the subagent completes, extract:
- Overall grade: A / B / C / D
- Coverage rating
- Depth rating
- Gaps identified (count)
- Improvements applied (count)

Store these for the executive summary.

**This is the self-improvement loop:** The review can modify the audit command itself, making future audits better.

**Wait for subagent completion before proceeding to Phase 4.**

**Re-verify branch after subagent completes:**
```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "security-audits" ]; then
  echo "WARN: Subagent switched to branch $CURRENT_BRANCH, restoring security-audits"
  git checkout security-audits --quiet
fi
echo "Verified on branch: $(git branch --show-current)"
```
</step>

<step name="phase_4_executive_summary">
## Phase 4: Generate Executive Summary

Create a summary at `.security/summaries/{TODAY}.md` for quick triage.

**Read results from the audit and review:**
```bash
# Get audit result from today's intel report
AUDIT_RESULT=$(grep "Overall Result" .security/intel/${TODAY}.md 2>/dev/null | head -1 | awk -F': ' '{print $2}' || echo "UNKNOWN")

# Get review grade from today's review
REVIEW_GRADE=$(grep "Overall Grade" .security/reviews/${TODAY}.md 2>/dev/null | head -1 | awk -F': ' '{print $2}' || echo "UNKNOWN")

# Get scanner findings count
SCANNER_FINDINGS=$(grep -A5 "Scanner Results" .security/intel/${TODAY}.md 2>/dev/null | grep -oE "[0-9]+ findings" | head -1 || echo "0 findings")

# Get commits analyzed
COMMITS_ANALYZED=$(grep "Commits" .security/intel/${TODAY}.md 2>/dev/null | head -1 | grep -oE "[0-9]+" | head -1 || echo "0")

# Get open findings count from STATE.md
OPEN_FINDINGS=$(grep "^open_findings:" .security/STATE.md 2>/dev/null | awk '{print $2}' || echo "0")

# Get open questions count from STATE.md
OPEN_QUESTIONS=$(grep "^open_questions:" .security/STATE.md 2>/dev/null | awk '{print $2}' || echo "0")
```

**Determine status color:**
```
GREEN: PASS result, grade B or better, no new Critical/High findings
YELLOW: WARN result, or grade C, or new Medium findings
RED: FAIL result, or grade D, or new Critical/High findings
```

**Write executive summary:**

Create `.security/summaries/{TODAY}.md`:

```markdown
# Security Daily Summary - {TODAY}

## Status: {GREEN | YELLOW | RED}

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Audit Result | {PASS | WARN | FAIL} |
| Review Grade | {A | B | C | D} |
| Open Findings | {count} |
| Open Questions | {count} |
| Commits Analyzed | {count} |
| Scanner Findings | {count} |

---

## Executive Summary

{2-3 sentence summary based on results}

---

## Action Items

### Immediate (Today)
{If RED: List urgent items from audit/review}
{If YELLOW: List recommended reviews}
{If GREEN: "No immediate action required"}

### This Week
{Medium priority follow-ups from review recommendations}

---

## Audit Details

- **Intelligence Report**: `.security/intel/{TODAY}.md`
- **Review Report**: `.security/reviews/{TODAY}.md`
- **Scan Data**: `.security/scans/{TODAY}.json`

---

## Self-Improvement Applied

{List any changes made by security-reviewer subagent:}
- HOT-SPOTS.md: {changes or "No changes"}
- CODEBASE-UNDERSTANDING.md: {changes or "No changes"}
- security-audit.md: {changes or "No changes"}

---

*Generated by /security-audit-daily on {TODAY}*
```
</step>

<step name="phase_5_commit_push">
## Phase 5: Commit and Push

Stage and commit all security artifacts to security-audits branch.

**Note:** The subagents may have already committed some files. Stage any remaining changes.

**Stage any uncommitted security files:**
```bash
git add .security/summaries/${TODAY}.md
git add .security/reviews/${TODAY}.md
git add .security/intel/${TODAY}.md
git add .security/intel/FINDINGS-INDEX.md
git add .security/scans/${TODAY}.json
git add .security/STATE.md
git add .security/CODEBASE-UNDERSTANDING.md
git add .security/HOT-SPOTS.md
git add .claude/commands/security-audit.md

# Check what's staged
STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "No new changes to commit (subagents already committed)"
else
  echo "Files to commit:"
  echo "$STAGED"
fi
```

**Create status-rich commit (if there are changes):**
```bash
if [ -n "$STAGED" ]; then
  git commit -m "security: daily audit ${TODAY}

Status: ${STATUS}
Audit Result: ${AUDIT_RESULT}
Review Grade: ${REVIEW_GRADE}
Open Findings: ${OPEN_FINDINGS}
Open Questions: ${OPEN_QUESTIONS}

Summary: ${STATUS} - Full audit with review completed
Generated by /security-audit-daily

Co-Authored-By: Claude <noreply@anthropic.com>
"
fi
```

**Push to remote:**
```bash
# Use --force-with-lease for safety after rebase
git push -u origin security-audits --force-with-lease
echo "Pushed to origin/security-audits"
```

**Handle push failures gracefully:**
If push fails, log warning but don't fail the workflow. Changes are committed locally.
</step>

<step name="phase_6_restore_branch">
## Phase 6: Restore Original Branch

Return to the branch we started on.

**Always restore, even on failure:**
```bash
git checkout "$ORIGINAL_BRANCH" --quiet
echo "Returned to branch: $ORIGINAL_BRANCH"
```

**Final status report:**
```
==========================================
  DAILY SECURITY AUDIT COMPLETE
==========================================

Status:        {GREEN | YELLOW | RED}
Audit Result:  {PASS | WARN | FAIL}
Review Grade:  {A | B | C | D}
Open Findings: {count}
Open Questions: {count}

Artifacts on security-audits branch:
  - .security/intel/{TODAY}.md
  - .security/reviews/{TODAY}.md
  - .security/summaries/{TODAY}.md
  - .security/scans/{TODAY}.json

Self-Improvement:
  - {List any files updated by review}

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
- User must commit or stash before running daily audit

### First Run (No security-audits branch)
`git checkout -B security-audits` handles this automatically:
- Creates branch if doesn't exist
- Switches to it if it does exist
- No special handling needed

### Rebase Conflicts
If `git rebase main` has conflicts:
- Abort the rebase with `git rebase --abort`
- Log warning: "Rebase had conflicts, continuing on current state"
- Continue with audit on current branch state
- User can manually rebase later

### security-auditor Subagent Fails
If the audit subagent fails or times out:
- Capture whatever output is available
- Set AUDIT_RESULT="ERROR"
- Still spawn security-reviewer if possible (review can identify issues)
- Include error in executive summary
- Don't fail the entire workflow

### security-reviewer Subagent Fails
If the review subagent fails:
- Set REVIEW_GRADE="ERROR"
- Still write executive summary based on audit results
- Note review failure in summary
- Continue to commit/push phase

### Push Fails
If `git push --force-with-lease` fails:
- Log warning with the error
- Note that changes are committed locally
- Provide manual push command
- Don't fail the entire workflow

### No Changes Since Last Audit
If security-auditor reports no commits since last audit:
- Audit still runs (scanner check)
- Review still runs (verify hot spots periodically)
- Summary notes "No changes since last audit"
- This is normal for a daily audit

</edge_cases>

<success_criteria>
Checklist for complete daily audit:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved

**Branch Setup (Phase 1)**
- [ ] On security-audits branch
- [ ] Rebased on main (or graceful fallback)

**Security Audit (Phase 2)**
- [ ] Task tool spawned security-auditor subagent
- [ ] Subagent completed (PASS/WARN/FAIL)
- [ ] Intelligence report written
- [ ] STATE.md updated

**Security Review (Phase 3)**
- [ ] Task tool spawned security-reviewer subagent
- [ ] Subagent completed (grade assigned)
- [ ] Review report written
- [ ] Improvements applied (if any)

**Executive Summary (Phase 4)**
- [ ] Status determined (GREEN/YELLOW/RED)
- [ ] Summary written to .security/summaries/{TODAY}.md

**Commit/Push (Phase 5)**
- [ ] All security artifacts staged
- [ ] Commit message includes status and grade
- [ ] Pushed to origin/security-audits

**Restore (Phase 6)**
- [ ] Returned to original branch
- [ ] Final status printed
</success_criteria>

<unattended_execution>
This command is designed for unattended daily execution.

**No user prompts:**
- All decisions are automated based on data
- Edge cases are handled gracefully
- Failures are logged but don't block completion

**The self-improvement loop:**
1. `security-auditor` subagent does deep analysis
2. `security-reviewer` subagent evaluates audit quality
3. Review applies improvements to HOT-SPOTS.md, CODEBASE-UNDERSTANDING.md
4. Review can even update /security-audit.md to improve future audits
5. Next daily run uses the improved configuration

**Scheduling example (herdctl):**
```yaml
agents:
  security-auditor:
    schedule:
      cron: "0 6 * * *"  # 6 AM daily
    prompt: "/security-audit-daily"
    timeout: 900  # 15 minutes max (audit + review)
```

**Scheduling example (cron):**
```bash
0 6 * * * cd /path/to/herdctl && claude -p "/security-audit-daily" >> /var/log/security-audit.log 2>&1
```

**Output handling:**
- Summary is written to files, not just stdout
- Final status report is printed for logging
- Non-zero exit only on pre-flight failure (uncommitted changes)
</unattended_execution>
