---
name: security-audit
description: Run comprehensive incremental security audit with conditional subagent delegation
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
Run an incremental security audit that delegates deep analysis to specialized subagents.

This orchestrator coordinates:
1. **scan.ts** - Deterministic vulnerability scanning (npm-audit, docker-config, etc.)
2. **change-analyzer** - Categorizes code changes since last audit
3. **hot-spot-verifier** - Verifies security properties of critical files (conditional)
4. **question-investigator** - Researches open security questions (conditional)

Output artifacts:
- `.security/intel/YYYY-MM-DD.md` - Intelligence report with aggregated findings
- `.security/intel/FINDINGS-INDEX.md` - Updated with new/resolved findings
- `.security/CODEBASE-UNDERSTANDING.md` - Updated question statuses
- `.security/STATE.md` - Updated frontmatter with audit date

Use this command for:
- Daily security audits (automated or manual)
- Post-PR security review
- Incremental security assessment
- Tracking security posture over time
</objective>

<security_rules>
## CRITICAL: Secret Handling in Reports

**NEVER include actual secret values in any output file, report, or commit.** This includes:
- API keys, tokens, passwords, credentials
- OAuth tokens, bot tokens, PATs
- Any value from .env files or environment variables

When documenting a finding about exposed secrets:
- Reference the FILE and LINE where the secret was found
- Describe the TYPE of secret (e.g. "Discord bot token", "GitHub PAT")
- Show only a REDACTED preview: `DISCORD_BOT_TOKEN=[REDACTED]`
- NEVER copy the actual value into the report

This rule exists because audit reports are committed to git and pushed to GitHub.
Including real secrets in reports would leak them — the exact problem being reported.

## CRITICAL: Branch Discipline

**Do NOT create new branches or switch branches during an audit.** The orchestrator
(/security-audit-daily) manages branch state. If you are running as a subagent,
you are already on the correct branch. Stay on whatever branch you find yourself on.
Do NOT follow the project CLAUDE.md instruction to create feature branches — that
rule applies to development work, not automated security audits.
</security_rules>

<context>
**When to run this command:**
- Daily as part of development workflow
- After merging significant changes
- When security review is needed
- Before releases or deployments

**State tracking:**
Audit baseline is tracked in `.security/STATE.md` frontmatter:
- `last_audit: YYYY-MM-DD` - Date of last audit
- `commits_since_audit: N` - Commits since last audit
- `open_findings: N` - Active security findings
- `open_questions: N` - Unresolved security questions

**Context management:**
Target: <20% context usage by staying in orchestrator role:
- Only read STATE.md, HOT-SPOTS.md, CODEBASE-UNDERSTANDING.md for routing decisions
- Never read source files directly (delegate to subagents)
- Agent results are already structured and bounded
- Summary pattern: counts and status tables, not full details
</context>

<process>

<step name="phase_1_scanner">
## Phase 1: Scanner Phase (~2 seconds)

Run the deterministic security scanner for baseline findings.

```bash
# Run scanner with JSON output and save to file
pnpm security --json --save 2>/dev/null || npx tsx .security/tools/scan.ts --json --save

# If the command doesn't support --save, run and capture output manually
SCAN_RESULT=$(pnpm security --json 2>/dev/null || npx tsx .security/tools/scan.ts --json)
echo "$SCAN_RESULT"
```

**Parse JSON output for:**
- Total findings count per check (npm-audit, docker-config, etc.)
- Severity breakdown (Critical, High, Medium, Low)
- Any new findings compared to previous scan

**Store scanner results:**
- Save to `.security/scans/YYYY-MM-DD.json` (if not already saved by --save flag)
- Record summary for aggregation in Phase 4:
  - Check statuses (PASS/FAIL/WARN)
  - Finding counts per severity
  - Runtime duration

**Compare to previous scan:**
```bash
# Get most recent previous scan
PREV_SCAN=$(ls -t .security/scans/*.json 2>/dev/null | head -2 | tail -1)
if [ -n "$PREV_SCAN" ]; then
  echo "Previous scan: $PREV_SCAN"
  # Compare finding counts
fi
```

**Scanner results feed into:**
- Intelligence report (Phase 4)
- FINDINGS-INDEX.md updates (Phase 5)
</step>

<step name="phase_2_change_detection">
## Phase 2: Change Detection Phase

Detect changes since last audit and spawn change-analyzer if needed.

**Read audit baseline:**
```bash
# Read last audit date from STATE.md frontmatter
LAST_AUDIT=$(grep "^last_audit:" .security/STATE.md 2>/dev/null | awk '{print $2}')
echo "Last audit: $LAST_AUDIT"

# Handle first audit scenario
if [ "$LAST_AUDIT" = "null" ] || [ -z "$LAST_AUDIT" ]; then
  echo "First audit - using 30 days ago as baseline"
  LAST_AUDIT=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d "30 days ago" +%Y-%m-%d)
fi
```

**Count commits since last audit:**
```bash
# Count commits since last audit
COMMITS_SINCE=$(git log --since="$LAST_AUDIT" --oneline --no-merges 2>/dev/null | wc -l | tr -d ' ')
echo "Commits since last audit: $COMMITS_SINCE"
```

**Conditional spawning decision:**

IF `COMMITS_SINCE > 0`:
- Spawn change-analyzer agent (run_in_background: false - need results for routing)
- Wait for results before proceeding

IF `COMMITS_SINCE == 0`:
- Skip change analysis
- Note "No changes since last audit" in report
- Proceed directly to Phase 4 (aggregation)

**Spawning change-analyzer:**

Use Task tool with:
- subagent_type: "change-analyzer"
- model: "{resolved_model}" (see model resolution below)
- run_in_background: false
- description: "Analyze changes since last audit"

Prompt for change-analyzer:
```
You are the change-analyzer agent.

Analyze commits since the last audit date: {LAST_AUDIT}

Instructions:
1. Read last_audit from .security/STATE.md frontmatter
2. Use git log --since to find commits in the range
3. Categorize changes by security relevance (5 categories)
4. Cross-reference changed files against .security/HOT-SPOTS.md
5. Return structured assessment with spawn recommendations

Return your results directly - do NOT write to files.

Expected output format:
- Categorized changes (Hot Spot, Entry Point, Pattern, Adjacent, Non-Security)
- Spawn recommendations (VERIFY, INVESTIGATE, REVIEW, NOTE, NONE)
- Overall risk level (HIGH, MEDIUM, LOW, NONE)
```

**Model resolution:**
```bash
MODEL_PROFILE=$(cat .planning/config.json 2>/dev/null | grep -o '"model_profile"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' || echo "balanced")
echo "Model profile: $MODEL_PROFILE"

# Model lookup for investigators:
# quality -> sonnet
# balanced -> haiku
# budget -> haiku
```

**Parse change-analyzer results:**
After change-analyzer returns, extract:
1. **VERIFY recommendation:** List of hot spot files that need verification
2. **INVESTIGATE recommendation:** Security patterns that need investigation
3. **Overall risk level:** HIGH/MEDIUM/LOW/NONE
4. **Category counts:** For reporting

Store these for use in Phase 3 spawn decisions.
</step>

<step name="phase_3_investigation">
## Phase 3: Investigation Phase (conditional, parallel)

Based on change-analyzer results and open questions, conditionally spawn investigation agents.

**Decision point 1: Hot-spot-verifier**

IF change-analyzer recommends "VERIFY" (Category 1 hot spot touches found):
- Extract the list of touched hot spot files from change-analyzer results
- Spawn hot-spot-verifier with that file list

Use Task tool with:
- subagent_type: "hot-spot-verifier"
- model: "{resolved_model}"
- run_in_background: true (can run in parallel with question-investigator)
- description: "Verify security properties of modified hot spots"

Prompt for hot-spot-verifier:
```
You are the hot-spot-verifier agent.

Verify security properties for these modified hot spot files:
{list of files from change-analyzer}

Instructions:
1. For each file, run the verification checks from .security/HOT-SPOTS.md
2. Report PASS/FAIL/WARN status per file
3. Distinguish new findings from accepted risks (cross-reference STATE.md)

Return your verification report directly - do NOT write to files.

Expected output:
- Per-file PASS/FAIL/WARN status with line numbers
- Evidence for any failures
- Overall result: PASS/FAIL/WARN
```

**Decision point 2: Question-investigator**

IF open High priority questions exist in CODEBASE-UNDERSTANDING.md:
```bash
# Check for High priority open questions
grep -E "\| (High|Medium) \| Open\|Partial \|" .security/CODEBASE-UNDERSTANDING.md
```

IF found:
- Select the highest priority Open question (High > Medium, Open > Partial)
- Spawn question-investigator with that question

Use Task tool with:
- subagent_type: "question-investigator"
- model: "{resolved_model}"
- run_in_background: true (can run in parallel with hot-spot-verifier)
- description: "Investigate security question"

Prompt for question-investigator:
```
You are the question-investigator agent.

Investigate the following security question from CODEBASE-UNDERSTANDING.md:

**Q{ID}:** {question text}
**Priority:** {priority}
**Current Status:** {status}
**Notes:** {existing notes}

Instructions:
1. Read the Notes column to understand prior investigation work
2. Research the question using grep, file reading, code tracing
3. Gather evidence with file:line references
4. Recommend status update: Answered, Partial, or Blocked

Return your findings directly - do NOT write to files.

Expected output:
- Finding (2-5 sentences with clear answer)
- Evidence (file:line references)
- Status recommendation with reasoning
- Suggested Notes column update
```

**Waiting for agents:**
If either or both agents were spawned:
- Wait for all spawned agents to complete before proceeding to Phase 4
- Collect their structured result reports

**If no agents spawned:**
- Note "No investigation agents needed" in report
- Proceed to Phase 4
</step>

<step name="phase_4_aggregation">
## Phase 4: Aggregation Phase

Collect all results and determine overall audit status.

**Collect results from all sources:**

1. **Scanner results (from Phase 1):**
   - Check statuses (npm-audit, docker-config, etc.)
   - Finding counts per severity
   - Runtime duration

2. **Change analysis (from Phase 2, if run):**
   - Category counts (Hot Spot, Entry Point, Pattern, Adjacent, Non-Security)
   - Risk level (HIGH/MEDIUM/LOW/NONE)
   - Key files identified

3. **Verification results (from Phase 3, if run):**
   - Per-file PASS/FAIL/WARN status
   - Any new findings
   - Overall verification result

4. **Investigation results (from Phase 3, if run):**
   - Question investigated
   - Finding and evidence
   - Status recommendation

**Determine overall audit result:**

```
OVERALL_RESULT = PASS | WARN | FAIL

Determination logic:

FAIL if ANY of:
- Scanner found new High/Critical severity findings
- Hot-spot-verifier reported FAIL on any critical hot spot
- New unaccepted security findings discovered

WARN if ANY of:
- Scanner found new Medium severity findings
- Hot-spot-verifier reported WARN (accepted risks present)
- Open High priority questions remain unresolved
- Change-analyzer reported MEDIUM risk level

PASS if ALL of:
- No new High/Critical findings from scanner
- Hot-spot-verifier passed (or not needed)
- No new security findings
- Change-analyzer reported LOW/NONE risk level (or not needed)
```

**Build aggregated summary:**
```markdown
## Audit Summary

**Date:** YYYY-MM-DD
**Overall Result:** {PASS | WARN | FAIL}
**Duration:** {total time}

### Scanner
- Status: {PASS | WARN | FAIL}
- Findings: {count} ({severity breakdown})

### Changes
- Commits analyzed: {N}
- Risk level: {HIGH | MEDIUM | LOW | NONE}
- Hot spot touches: {count}

### Verification (if run)
- Result: {PASS | WARN | FAIL}
- Critical: {count} passed, {count} failed
- High-Risk: {count} passed, {count} failed

### Investigation (if run)
- Questions investigated: {N}
- Status changes: {list}
```
</step>

<step name="phase_5_documentation">
## Phase 5: Documentation Phase

Update all living documents and commit changes.

**5.1: Write intelligence report**

Create `.security/intel/YYYY-MM-DD.md` using the template:

```markdown
# Security Intelligence Report - {DATE}

**Review Type**: Incremental (Automated)
**Triggered By**: /security-audit command
**Branch**: {branch name from git}
**Overall Result**: {PASS | WARN | FAIL}

---

## Executive Summary

{2-3 sentences: What's the security posture? Any urgent issues? Key changes?}

---

## Scanner Results

**Status**: {PASS | WARN | FAIL}
**Duration**: {N}ms

| Check | Status | Findings |
|-------|--------|----------|
| npm-audit | {status} | {count} |
| docker-config | {status} | {count} |
| path-patterns | {status} | {count} |
| secrets-check | {status} | {count} |
| eval-patterns | {status} | {count} |
| shell-injection | {status} | {count} |

**New findings this audit**: {count}
**Resolved since last audit**: {count}

---

## Change Analysis

{If change-analyzer ran:}

**Commits since last audit**: {N}
**Risk Level**: {HIGH | MEDIUM | LOW | NONE}

### Security-Relevant Changes

| Category | Count | Key Files | Action |
|----------|-------|-----------|--------|
| Hot spot touches | {N} | {files} | Verified |
| New entry points | {N} | {files} | Flagged for review |
| Security patterns | {N} | {files} | Investigated |
| Security-adjacent | {N} | - | Noted |

**Non-security changes**: {count} (docs, tests, config)

{If change-analyzer did not run:}

No commits since last audit.

---

## Verification Results

{If hot-spot-verifier ran:}

**Overall**: {PASS | WARN | FAIL}

| Hot Spot | Level | Status | Notes |
|----------|-------|--------|-------|
| container-manager.ts | Critical | {status} | {notes} |
| container-runner.ts | Critical | {status} | {notes} |
| schema.ts | Critical | {status} | {notes} |
| path-safety.ts | Critical | {status} | {notes} |
| interpolate.ts | Critical | {status} | {notes} |
| shell.ts | Critical | {status} | {notes} |

**Failures**: {count}
**Accepted risks (WARN)**: {count}

{If hot-spot-verifier did not run:}

Hot spot verification not required (no hot spots modified).

---

## Investigation Results

{If question-investigator ran:}

### Q{ID}: {question text}

**Status**: {Answered | Partial | Blocked}

**Finding**: {summary from investigator}

**Evidence**:
{evidence from investigator}

**Notes update**: {suggested notes}

{If question-investigator did not run:}

No questions investigated this audit.

---

## Document Updates

- **FINDINGS-INDEX.md**: {new findings added}, {findings resolved}
- **CODEBASE-UNDERSTANDING.md**: {question status updates}
- **STATE.md**: last_audit updated to {today}

---

## Session Statistics

- Scanner runtime: {N}ms
- Change-analyzer spawned: {yes/no}
- Hot-spot-verifier spawned: {yes/no}
- Question-investigator spawned: {yes/no}
- Total duration: {time}
- Commits analyzed: {N}
- Questions investigated: {N}
```

**Keep intelligence report under 500 lines.**

**5.2: Update FINDINGS-INDEX.md**

For new findings from scanner:
1. Generate fresh finding IDs (increment from highest existing)
2. Add to Active Findings table with:
   - ID, Severity, Description, Location, First Found date

For resolved findings:
1. Find findings no longer present in scanner results
2. Move to Resolved Findings section with Resolution date

```bash
# Get highest existing finding ID
HIGHEST_ID=$(grep -oE "^| [0-9]+" .security/intel/FINDINGS-INDEX.md | tail -1 | tr -d '| ')
NEXT_ID=$((HIGHEST_ID + 1))
```

**5.3: Update CODEBASE-UNDERSTANDING.md (if question-investigator ran)**

Based on investigator's recommendation:
- Update question status (Open -> Answered, Open -> Partial, etc.)
- Add findings to Notes column
- Update Last Updated date

Use Edit tool to update the specific question row.

**5.4: Update STATE.md frontmatter**

```bash
TODAY=$(date +%Y-%m-%d)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Update frontmatter
sed -i '' "s/^last_updated:.*/last_updated: $NOW/" .security/STATE.md
sed -i '' "s/^last_audit:.*/last_audit: $TODAY/" .security/STATE.md
sed -i '' "s/^commits_since_audit:.*/commits_since_audit: 0/" .security/STATE.md

# Update counts from actual data
OPEN_FINDINGS=$(grep -c "^\| [0-9]" .security/intel/FINDINGS-INDEX.md 2>/dev/null | head -1 || echo "0")
OPEN_QUESTIONS=$(grep -c "| Open\|Partial |" .security/CODEBASE-UNDERSTANDING.md 2>/dev/null || echo "0")
sed -i '' "s/^open_findings:.*/open_findings: $OPEN_FINDINGS/" .security/STATE.md
sed -i '' "s/^open_questions:.*/open_questions: $OPEN_QUESTIONS/" .security/STATE.md
```

**5.5: Commit all changes (if commit_docs=true)**

Check planning config for commit behavior:
```bash
COMMIT_DOCS=$(cat .planning/config.json 2>/dev/null | grep -o '"commit_docs"[[:space:]]*:[[:space:]]*[^,}]*' | grep -o 'true\|false' || echo "true")
```

IF commit_docs is true (default):
```bash
TODAY=$(date +%Y-%m-%d)

git add .security/intel/${TODAY}.md
git add .security/intel/FINDINGS-INDEX.md
git add .security/CODEBASE-UNDERSTANDING.md
git add .security/STATE.md
git add .security/scans/*.json

git commit -m "security: daily audit ${TODAY}

- Scanner: [${SCANNER_STATUS}] (${SCANNER_FINDINGS} findings)
- Changes: ${COMMITS_SINCE} commits analyzed
- Verification: ${VERIFICATION_STATUS:-N/A}
- Questions: ${QUESTIONS_INVESTIGATED:-0} investigated

Generated by /security-audit
"
```

IF commit_docs is false:
- Skip commit
- Report that files were updated but not committed
</step>

<step name="report_completion">
## Report Completion

After all phases complete, report the audit summary.

```markdown
## Security Audit Complete

**Date:** YYYY-MM-DD
**Overall Result:** {PASS | WARN | FAIL}
**Duration:** {time}

### Summary

| Phase | Status | Details |
|-------|--------|---------|
| Scanner | {status} | {findings count} |
| Change Detection | {status} | {commits} commits |
| Verification | {status} | {hot spots checked} |
| Investigation | {status} | {questions investigated} |
| Documentation | {status} | {documents updated} |

### Key Findings

{List any new HIGH/CRITICAL findings}

### Documents Updated

- `.security/intel/{DATE}.md` - Intelligence report
- `.security/intel/FINDINGS-INDEX.md` - {changes}
- `.security/CODEBASE-UNDERSTANDING.md` - {changes}
- `.security/STATE.md` - Updated audit baseline

### Next Steps

{If FAIL: List required actions}
{If WARN: List recommended reviews}
{If PASS: "No immediate action required. Next audit recommended in 7 days or after significant changes."}
```
</step>

</process>

<context_management>
**Target: <20% context usage**

The orchestrator manages context by delegating deep analysis to subagents.

**What the orchestrator DOES read:**
- `.security/STATE.md` - For routing decisions (last_audit, open_findings)
- `.security/HOT-SPOTS.md` - For understanding verification scope (file list only)
- `.security/CODEBASE-UNDERSTANDING.md` - For question selection (Open Questions table only)
- Agent result reports - Structured summaries, not raw findings

**What the orchestrator does NOT read:**
- Source files in `packages/` - Delegated to subagents
- Full file contents of security documents - Only extract relevant sections
- Previous intelligence reports beyond summary - Avoid context bloat

**Summary pattern for reports:**
- Scanner: Count + severity breakdown (not full finding details)
- Change analysis: Category counts + key files only
- Verification: Pass/fail status table (not line-by-line evidence)
- Investigation: Answer + evidence (already summarized by agent)

**If context seems high:**
1. Are you reading source files? Delegate to an agent instead.
2. Are agent results too verbose? They should be structured summaries.
3. Are you including full previous reports? Use only current audit data.
</context_management>

<spawning_patterns>
## Agent Spawning Reference

### change-analyzer

**When:** commits_since_audit > 0
**Required:** run_in_background: false (need results for routing)
**Returns:** Categorized changes, spawn recommendations, risk level

### hot-spot-verifier

**When:** change-analyzer recommends VERIFY (Category 1 hot spot touches)
**Required:** run_in_background: true (can parallel with question-investigator)
**Input:** List of modified hot spot files
**Returns:** PASS/FAIL/WARN per file, overall result

### question-investigator

**When:** High priority Open/Partial questions exist
**Required:** run_in_background: true (can parallel with hot-spot-verifier)
**Input:** One question from Open Security Questions table
**Returns:** Finding, evidence, status recommendation

### Parallel Execution Pattern

```
Phase 1: Scanner (synchronous)
     |
     v
Phase 2: change-analyzer (synchronous - need results for routing)
     |
     v
Phase 3: [hot-spot-verifier] + [question-investigator] (parallel if both needed)
     |
     v
Phase 4: Aggregation (after all agents complete)
     |
     v
Phase 5: Documentation (synchronous)
```
</spawning_patterns>

<edge_cases>

### First Audit (No Previous State)

If STATE.md doesn't have last_audit or it's null:
- Use 30 days ago as baseline
- Note "First audit" in report
- Create initial FINDINGS-INDEX.md entries

### No Commits Since Last Audit

If commits_since_audit == 0:
- Skip change-analyzer
- Skip Phase 3 entirely (no investigation agents)
- Still run scanner for baseline check
- Report "No changes since last audit"

### No Open Questions

If no High/Medium priority Open/Partial questions:
- Skip question-investigator
- Note "No questions requiring investigation" in report

### No Hot Spots Modified

If change-analyzer doesn't recommend VERIFY:
- Skip hot-spot-verifier
- Note "Hot spot verification not required" in report

### Scanner Fails

If pnpm security fails:
- Try fallback: `npx tsx .security/tools/scan.ts --json`
- If both fail, report error and skip to documentation
- Don't fail entire audit for scanner issues

### Agent Timeout

If an agent takes >5 minutes:
- Report partial results if available
- Note timeout in report
- Continue with other phases
</edge_cases>

<success_criteria>
Checklist for complete audit:

**Phase 1: Scanner**
- [ ] scan.ts executed successfully
- [ ] JSON results parsed
- [ ] Findings compared to previous scan

**Phase 2: Change Detection**
- [ ] Last audit date read from STATE.md
- [ ] Commits counted since last audit
- [ ] change-analyzer spawned (if commits > 0)
- [ ] Spawn recommendations extracted

**Phase 3: Investigation**
- [ ] hot-spot-verifier spawned (if VERIFY recommended)
- [ ] question-investigator spawned (if High priority questions open)
- [ ] All spawned agents completed

**Phase 4: Aggregation**
- [ ] All agent results collected
- [ ] Overall audit result determined (PASS/WARN/FAIL)
- [ ] Summary built with counts and status

**Phase 5: Documentation**
- [ ] Intelligence report written to .security/intel/YYYY-MM-DD.md
- [ ] FINDINGS-INDEX.md updated with new/resolved findings
- [ ] CODEBASE-UNDERSTANDING.md updated (if investigator ran)
- [ ] STATE.md frontmatter updated (last_audit, counts)
- [ ] Changes committed (if commit_docs=true)

**Output**
- [ ] Completion report displayed with overall result
- [ ] Next steps provided based on result
</success_criteria>

<key_files>
## Key Files Reference

| File | Purpose | When Read |
|------|---------|-----------|
| `.security/STATE.md` | Audit baseline, open counts | Phase 2 (routing decision) |
| `.security/HOT-SPOTS.md` | Critical file registry | Phase 3 (spawn decision) |
| `.security/CODEBASE-UNDERSTANDING.md` | Open questions table | Phase 3 (spawn decision) |
| `.security/intel/FINDINGS-INDEX.md` | Master findings tracker | Phase 5 (update) |
| `.security/tools/scan.ts` | Deterministic scanner | Phase 1 (execution) |
| `.security/scans/*.json` | Historical scan results | Phase 1 (comparison) |
| `.security/intel/*.md` | Previous intelligence reports | Phase 5 (reference only) |

## Agent Definitions

| Agent | Definition | When Spawned |
|-------|------------|--------------|
| change-analyzer | `.claude/agents/security/change-analyzer.md` | Commits exist since last audit |
| hot-spot-verifier | `.claude/agents/security/hot-spot-verifier.md` | VERIFY recommendation |
| question-investigator | `.claude/agents/security/question-investigator.md` | High priority questions open |
</key_files>
