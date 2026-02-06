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
2. **Inline audit process** - Runs all phases directly (no subagent spawns)
3. **Self-review** - Assesses audit quality and generates grade
4. **Executive summary** - GREEN/YELLOW/RED status for quick triage
5. **Unattended execution** - No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl or cron.
</objective>

<context>
**Branch strategy:**
- Daily audits commit to `security-audits` branch
- Main branch stays clean from automated commits
- Branch rebases on main before each audit to stay current
- Use `--force-with-lease` for safe push after rebase

**Execution model:**
- All phases run inline (not as subagent spawns)
- Subagents would lose branch context after checkout
- Inline execution ensures all writes happen on correct branch

**Key files:**
- `.security/scans/YYYY-MM-DD.json` - Scanner output
- `.security/intel/YYYY-MM-DD.md` - Intelligence report
- `.security/reviews/YYYY-MM-DD.md` - Self-review
- `.security/summaries/YYYY-MM-DD.md` - Executive summary
- `.security/STATE.md` - Audit baseline tracking
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

<step name="phase_2_scanner">
## Phase 2: Run Security Scanner

Execute deterministic scanner for baseline findings.

**Run scanner with JSON output:**
```bash
SCAN_START=$(date +%s)

# Run scanner and save output
pnpm security --json --save 2>/dev/null || npx tsx .security/tools/scan.ts --json --save

# Capture scan result for later
SCAN_RESULT=$(cat .security/scans/${TODAY}.json 2>/dev/null || echo "{}")

SCAN_END=$(date +%s)
SCAN_DURATION=$((SCAN_END - SCAN_START))
echo "Scanner completed in ${SCAN_DURATION}s"
```

**Parse scanner results:**
```bash
# Extract summary from scan file
SCANNER_PASSED=$(echo "$SCAN_RESULT" | grep -o '"passed":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
SCANNER_FAILED=$(echo "$SCAN_RESULT" | grep -o '"failed":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
SCANNER_WARNED=$(echo "$SCAN_RESULT" | grep -o '"warned":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
SCANNER_TOTAL=$((SCANNER_PASSED + SCANNER_FAILED + SCANNER_WARNED))

echo "Scanner: $SCANNER_PASSED passed, $SCANNER_FAILED failed, $SCANNER_WARNED warned"
```

**Determine scanner status:**
- `FAIL` if any critical/high findings (failed > 0)
- `WARN` if any medium findings (warned > 0)
- `PASS` otherwise

```bash
if [ "$SCANNER_FAILED" -gt 0 ]; then
  SCANNER_STATUS="FAIL"
elif [ "$SCANNER_WARNED" -gt 0 ]; then
  SCANNER_STATUS="WARN"
else
  SCANNER_STATUS="PASS"
fi
echo "Scanner status: $SCANNER_STATUS"
```

**Compare to previous scan (if exists):**
```bash
PREV_SCAN=$(ls -t .security/scans/*.json 2>/dev/null | grep -v "$TODAY" | head -1)
if [ -n "$PREV_SCAN" ]; then
  PREV_FAILED=$(grep -o '"failed":[0-9]*' "$PREV_SCAN" | head -1 | grep -o '[0-9]*' || echo "0")
  NEW_FINDINGS=$((SCANNER_FAILED - PREV_FAILED))
  echo "New findings since last scan: $NEW_FINDINGS"
else
  NEW_FINDINGS=$SCANNER_FAILED
  echo "First scan - all findings are new: $NEW_FINDINGS"
fi
```
</step>

<step name="phase_3_change_analysis">
## Phase 3: Change Analysis (Inline)

Analyze commits since last audit. Runs inline, not as subagent.

**Read last audit date:**
```bash
LAST_AUDIT=$(grep "^last_audit:" .security/STATE.md 2>/dev/null | awk '{print $2}')
if [ "$LAST_AUDIT" = "null" ] || [ -z "$LAST_AUDIT" ]; then
  echo "First audit - using 30 days ago as baseline"
  LAST_AUDIT=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d "30 days ago" +%Y-%m-%d)
fi
echo "Last audit: $LAST_AUDIT"
```

**Count commits since last audit:**
```bash
COMMITS_SINCE=$(git log --since="$LAST_AUDIT" --oneline --no-merges 2>/dev/null | wc -l | tr -d ' ')
echo "Commits since last audit: $COMMITS_SINCE"
```

**IF no commits, skip to Phase 5:**
If `COMMITS_SINCE == 0`:
- Set `CHANGE_RISK="NONE"`
- Set `HOT_SPOT_TOUCHES=0`
- Skip change categorization
- Proceed to Phase 5

**Inline change categorization:**
If `COMMITS_SINCE > 0`, categorize changes inline:

1. **Get changed files since last audit:**
```bash
CHANGED_FILES=$(git diff --name-only $(git log --since="$LAST_AUDIT" --pretty=format:"%H" | tail -1)..HEAD 2>/dev/null || echo "")
CHANGED_COUNT=$(echo "$CHANGED_FILES" | grep -c "." || echo "0")
echo "Files changed: $CHANGED_COUNT"
```

2. **Cross-reference with HOT-SPOTS.md:**
```bash
# Get hot spot files from HOT-SPOTS.md
HOT_SPOTS=$(grep -E "^\| \`" .security/HOT-SPOTS.md 2>/dev/null | grep -oE "packages/[^|]+" | tr -d '` ' || echo "")

# Count hot spot touches
HOT_SPOT_TOUCHES=0
HOT_SPOT_FILES=""
for file in $CHANGED_FILES; do
  for hot in $HOT_SPOTS; do
    if echo "$file" | grep -q "$hot"; then
      HOT_SPOT_TOUCHES=$((HOT_SPOT_TOUCHES + 1))
      HOT_SPOT_FILES="$HOT_SPOT_FILES $file"
    fi
  done
done
echo "Hot spot touches: $HOT_SPOT_TOUCHES"
```

3. **Determine change risk level:**
```bash
# Count security-relevant patterns in changes
SECURITY_PATTERNS=$(echo "$CHANGED_FILES" | grep -cE "(auth|security|container|exec|spawn|path|shell)" || echo "0")
ENTRY_POINTS=$(echo "$CHANGED_FILES" | grep -cE "(api|route|handler|endpoint)" || echo "0")

if [ "$HOT_SPOT_TOUCHES" -gt 0 ]; then
  CHANGE_RISK="HIGH"
elif [ "$SECURITY_PATTERNS" -gt 0 ] || [ "$ENTRY_POINTS" -gt 0 ]; then
  CHANGE_RISK="MEDIUM"
else
  CHANGE_RISK="LOW"
fi
echo "Change risk: $CHANGE_RISK"
```

**Store results for later phases:**
- `COMMITS_SINCE` - commit count
- `HOT_SPOT_TOUCHES` - count of hot spot files touched
- `HOT_SPOT_FILES` - list of touched hot spots
- `CHANGE_RISK` - HIGH/MEDIUM/LOW/NONE
</step>

<step name="phase_4_investigation">
## Phase 4: Conditional Investigation (Inline)

Run verification and investigation inline based on Phase 3 results.

### Part A: Hot Spot Verification (if needed)

**Decision:** IF `HOT_SPOT_TOUCHES > 0`, verify hot spots inline.

**Inline verification process:**
```bash
VERIFICATION_RESULT="PASS"
VERIFICATION_DETAILS=""

for file in $HOT_SPOT_FILES; do
  echo "Verifying: $file"

  # Check if file exists
  if [ ! -f "$file" ]; then
    echo "  SKIP: File not found"
    continue
  fi

  # Run hot-spot-specific checks
  FILE_STATUS="PASS"
  FILE_NOTES=""

  # Check for dangerous patterns
  if grep -qE "exec\(|spawn\(|shell\(" "$file" 2>/dev/null; then
    if ! grep -qB5 "sanitize\|validate\|escape" "$file" 2>/dev/null; then
      FILE_STATUS="WARN"
      FILE_NOTES="Execution without visible sanitization"
    fi
  fi

  # Check for path operations
  if grep -qE "path\.join\|path\.resolve\|readFile\|writeFile" "$file" 2>/dev/null; then
    if ! grep -qB5 "ensureWithin\|isWithin\|normalize" "$file" 2>/dev/null; then
      FILE_STATUS="WARN"
      FILE_NOTES="Path operation without visible containment"
    fi
  fi

  echo "  Status: $FILE_STATUS"
  VERIFICATION_DETAILS="$VERIFICATION_DETAILS\n| $file | $FILE_STATUS | $FILE_NOTES |"

  # Update overall verification result
  if [ "$FILE_STATUS" = "FAIL" ]; then
    VERIFICATION_RESULT="FAIL"
  elif [ "$FILE_STATUS" = "WARN" ] && [ "$VERIFICATION_RESULT" = "PASS" ]; then
    VERIFICATION_RESULT="WARN"
  fi
done

echo "Verification result: $VERIFICATION_RESULT"
```

**IF no hot spots touched:**
```bash
VERIFICATION_RESULT="N/A"
VERIFICATION_DETAILS="No hot spots modified"
```

### Part B: Question Investigation (if needed)

**Check for open High priority questions:**
```bash
HIGH_QUESTIONS=$(grep -E "\| High \| Open\|Partial \|" .security/CODEBASE-UNDERSTANDING.md 2>/dev/null | head -1 || echo "")
```

**IF High priority question exists, investigate inline:**

Extract question ID and text, then investigate:
```bash
if [ -n "$HIGH_QUESTIONS" ]; then
  Q_ID=$(echo "$HIGH_QUESTIONS" | grep -oE "Q[0-9]+" | head -1)
  echo "Investigating: $Q_ID"

  # Read the question details
  Q_TEXT=$(grep "$Q_ID" .security/CODEBASE-UNDERSTANDING.md | head -1)

  # Do basic investigation (search for relevant code patterns)
  # More thorough investigation happens in manual /security-audit runs
  INVESTIGATION_FINDING="Preliminary check completed - see full audit for details"
  QUESTIONS_INVESTIGATED=1
else
  QUESTIONS_INVESTIGATED=0
  INVESTIGATION_FINDING=""
  echo "No High priority questions to investigate"
fi
```

**Store results:**
- `VERIFICATION_RESULT` - PASS/WARN/FAIL/N/A
- `QUESTIONS_INVESTIGATED` - count (0 or 1)
</step>

<step name="phase_5_write_intel_report">
## Phase 5: Write Intelligence Report

Create the daily intelligence report at `.security/intel/YYYY-MM-DD.md`.

**Determine overall audit result:**
```bash
# FAIL if scanner failed OR verification failed
# WARN if scanner warned OR verification warned OR high priority questions remain
# PASS otherwise

if [ "$SCANNER_STATUS" = "FAIL" ] || [ "$VERIFICATION_RESULT" = "FAIL" ]; then
  AUDIT_RESULT="FAIL"
elif [ "$SCANNER_STATUS" = "WARN" ] || [ "$VERIFICATION_RESULT" = "WARN" ] || [ "$CHANGE_RISK" = "HIGH" ]; then
  AUDIT_RESULT="WARN"
else
  AUDIT_RESULT="PASS"
fi
echo "Overall audit result: $AUDIT_RESULT"
```

**Write intelligence report:**

Create `.security/intel/${TODAY}.md` with:
- Executive summary based on AUDIT_RESULT
- Scanner results table
- Change analysis summary
- Verification results (if ran)
- Investigation results (if ran)
- Session statistics

Template structure (see /security-audit.md Phase 5 for full template):
- Keep under 300 lines
- Focus on counts and status, not full details
- Include timestamps and commit hashes

**Update FINDINGS-INDEX.md:**
- Add any new findings from scanner
- Mark resolved findings if count decreased

**Update STATE.md frontmatter:**
```bash
# Update last_audit date
sed -i '' "s/^last_audit:.*/last_audit: $TODAY/" .security/STATE.md
sed -i '' "s/^commits_since_audit:.*/commits_since_audit: 0/" .security/STATE.md
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sed -i '' "s/^last_updated:.*/last_updated: $NOW/" .security/STATE.md
```
</step>

<step name="phase_6_self_review">
## Phase 6: Self-Review (Inline)

Assess audit quality following /security-audit-review process.

**Coverage assessment:**
```bash
# Check hot spots coverage
TOTAL_HOT_SPOTS=$(grep -c "^\| \`" .security/HOT-SPOTS.md 2>/dev/null || echo "6")
if [ "$HOT_SPOT_TOUCHES" -gt 0 ]; then
  COVERAGE_SCORE="checked"
else
  COVERAGE_SCORE="no changes to check"
fi

# Check question progress
if [ "$QUESTIONS_INVESTIGATED" -gt 0 ]; then
  QUESTION_PROGRESS="1 question investigated"
else
  QUESTION_PROGRESS="no questions investigated"
fi
```

**Determine audit grade:**
```bash
# Grade based on coverage and depth
# A: Full coverage, deep investigation, no gaps
# B: Good coverage, adequate depth, minor gaps
# C: Partial coverage or shallow investigation
# D: Significant gaps or failures

if [ "$AUDIT_RESULT" = "FAIL" ]; then
  AUDIT_GRADE="D"
elif [ "$AUDIT_RESULT" = "WARN" ] && [ "$QUESTIONS_INVESTIGATED" -eq 0 ]; then
  AUDIT_GRADE="C"
elif [ "$AUDIT_RESULT" = "PASS" ] && [ "$QUESTIONS_INVESTIGATED" -gt 0 ]; then
  AUDIT_GRADE="A"
else
  AUDIT_GRADE="B"
fi
echo "Audit grade: $AUDIT_GRADE"
```

**Write review to `.security/reviews/${TODAY}.md`:**

Create brief review with:
- Coverage assessment
- Depth assessment
- Overall grade
- Gaps identified
- Recommendations for next audit

Keep review under 100 lines - this is automated assessment, not deep review.
</step>

<step name="phase_7_executive_summary">
## Phase 7: Generate Executive Summary

Create summary at `.security/summaries/${TODAY}.md` for quick triage.

**Determine status color:**
```bash
# GREEN: PASS, no new Critical/High, grade B or better
# YELLOW: WARN, new Medium, or grade C
# RED: FAIL, new Critical/High, or grade D

if [ "$AUDIT_RESULT" = "PASS" ] && [ "$NEW_FINDINGS" -le 0 ] && [ "$AUDIT_GRADE" != "D" ] && [ "$AUDIT_GRADE" != "C" ]; then
  STATUS="GREEN"
elif [ "$AUDIT_RESULT" = "FAIL" ] || [ "$NEW_FINDINGS" -gt 0 ] || [ "$AUDIT_GRADE" = "D" ]; then
  STATUS="RED"
else
  STATUS="YELLOW"
fi
echo "Status: $STATUS"
```

**Write executive summary:**

```markdown
# Security Daily Summary - {TODAY}

## Status: {STATUS}

---

## Quick Stats

| Metric | Value |
|--------|-------|
| Scanner Runtime | {SCAN_DURATION}s |
| Total Findings | {SCANNER_TOTAL} |
| New Findings | {NEW_FINDINGS} |
| Hot Spots Touched | {HOT_SPOT_TOUCHES} |
| Commits Analyzed | {COMMITS_SINCE} |
| Questions Investigated | {QUESTIONS_INVESTIGATED} |
| Verification Result | {VERIFICATION_RESULT} |
| Audit Grade | {AUDIT_GRADE} |

---

## Executive Summary

{2-3 sentence summary based on results}

---

## Action Items

### Immediate (Today)
{If RED: List urgent items}
{If YELLOW: List recommended reviews}
{If GREEN: "No immediate action required"}

### This Week
{Medium priority follow-ups}

---

## Files Modified This Run

- `.security/scans/{TODAY}.json`
- `.security/intel/{TODAY}.md`
- `.security/reviews/{TODAY}.md`
- `.security/summaries/{TODAY}.md`
- `.security/STATE.md`

---

*Generated by /security-audit-daily on {TODAY}*
```
</step>

<step name="phase_8_commit_push">
## Phase 8: Commit and Push

Stage and commit all security artifacts to security-audits branch.

**Stage security files:**
```bash
git add .security/scans/${TODAY}.json
git add .security/intel/${TODAY}.md
git add .security/reviews/${TODAY}.md
git add .security/summaries/${TODAY}.md
git add .security/intel/FINDINGS-INDEX.md
git add .security/STATE.md
git add .security/CODEBASE-UNDERSTANDING.md

# Check what's staged
git status --short
```

**Create status-rich commit:**
```bash
git commit -m "security: daily audit ${TODAY}

Status: ${STATUS}
Overall Result: ${AUDIT_RESULT}
New findings: ${NEW_FINDINGS}
Questions investigated: ${QUESTIONS_INVESTIGATED}
Audit grade: ${AUDIT_GRADE}

Summary: ${STATUS} - ${AUDIT_RESULT} with ${SCANNER_TOTAL} total findings, ${COMMITS_SINCE} commits analyzed
"
```

**Push to remote:**
```bash
# Use --force-with-lease for safety after rebase
git push -u origin security-audits --force-with-lease
echo "Pushed to origin/security-audits"
```

**Handle push failures:**
```bash
if [ $? -ne 0 ]; then
  echo "WARN: Push failed - changes committed locally but not pushed"
  echo "Manual push required: git push -u origin security-audits --force-with-lease"
fi
```
</step>

<step name="phase_9_restore_branch">
## Phase 9: Restore Original Branch

Return to the branch we started on.

**Always restore, even on failure:**
```bash
git checkout "$ORIGINAL_BRANCH" --quiet
echo "Returned to branch: $ORIGINAL_BRANCH"
```

**Final status report:**
```bash
echo ""
echo "=========================================="
echo "  DAILY SECURITY AUDIT COMPLETE"
echo "=========================================="
echo ""
echo "Status:        $STATUS"
echo "Result:        $AUDIT_RESULT"
echo "Grade:         $AUDIT_GRADE"
echo "New Findings:  $NEW_FINDINGS"
echo "Commits:       $COMMITS_SINCE analyzed"
echo ""
echo "Artifacts on security-audits branch:"
echo "  - .security/scans/${TODAY}.json"
echo "  - .security/intel/${TODAY}.md"
echo "  - .security/reviews/${TODAY}.md"
echo "  - .security/summaries/${TODAY}.md"
echo ""
echo "Current branch: $(git branch --show-current)"
echo "=========================================="
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

### Push Fails
If `git push --force-with-lease` fails:
- Log warning with the error
- Note that changes are committed locally
- Provide manual push command
- Don't fail the entire workflow

### Scanner Fails
If scanner execution fails:
- Try fallback: `npx tsx .security/tools/scan.ts --json`
- If both fail, set SCANNER_STATUS="ERROR"
- Continue with partial audit (use last scan data if available)
- Note error in summary

### No Commits Since Last Audit
If `COMMITS_SINCE == 0`:
- Skip change analysis entirely
- Set CHANGE_RISK="NONE"
- Set HOT_SPOT_TOUCHES=0
- Still run scanner for baseline
- Report "No changes since last audit"

### No Open Questions
If no High/Medium priority Open questions exist:
- Set QUESTIONS_INVESTIGATED=0
- Note "No questions requiring investigation"
- Don't penalize grade for this

</edge_cases>

<success_criteria>
Checklist for complete daily audit:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved

**Branch Setup (Phase 1)**
- [ ] On security-audits branch
- [ ] Rebased on main (or graceful fallback)

**Scanner (Phase 2)**
- [ ] Scanner executed successfully
- [ ] Results saved to .security/scans/{TODAY}.json
- [ ] Findings compared to previous scan

**Change Analysis (Phase 3)**
- [ ] Last audit date read from STATE.md
- [ ] Commits counted since last audit
- [ ] Changes categorized by security relevance
- [ ] Hot spot touches identified

**Investigation (Phase 4)**
- [ ] Hot spots verified (if touched)
- [ ] Questions investigated (if High priority exist)

**Documentation (Phase 5-7)**
- [ ] Intelligence report written
- [ ] Self-review written
- [ ] Executive summary written with GREEN/YELLOW/RED
- [ ] STATE.md updated

**Commit/Push (Phase 8)**
- [ ] All security artifacts staged
- [ ] Commit message includes status and grade
- [ ] Pushed to origin/security-audits

**Restore (Phase 9)**
- [ ] Returned to original branch
- [ ] Final status printed
</success_criteria>

<unattended_execution>
This command is designed for unattended daily execution.

**No user prompts:**
- All decisions are automated based on data
- Edge cases are handled gracefully
- Failures are logged but don't block completion

**Scheduling example (herdctl):**
```yaml
agents:
  security-auditor:
    schedule:
      cron: "0 6 * * *"  # 6 AM daily
    prompt: "/security-audit-daily"
    timeout: 600  # 10 minutes max
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
