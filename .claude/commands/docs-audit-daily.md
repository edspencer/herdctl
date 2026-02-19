---
name: docs-audit-daily
description: Automated daily documentation audit with gap detection and PR creation
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
Meta-orchestrator for fully automated daily documentation audits.

This command wraps the full docs audit workflow with:
1. **State tracking** — Reads last checked commit, processes only new commits
2. **Commit analysis** — Delegates to analyzer subagent to identify documentation gaps
3. **Documentation creation** — Delegates to writer subagent if gaps found
4. **PR workflow** — Creates branch and pushes for human review
5. **Unattended execution** — No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl at 3am UTC, or manual invocation.
</objective>

<context>
**Why we use subagents (CRITICAL for reliable execution):**

This is a meta-orchestrator that coordinates multiple phases. We use Task tool
with subagents instead of Skill tool for Phases 2 and 3 because:

1. **Context preservation** — When using Skill tool, the orchestrator "forgets" its state
   after the nested skill completes. This caused phases to never execute in the security agent.
2. **Independent execution** — Task tool spawns separate subagents that run independently
   while the orchestrator maintains its own context and state.
3. **Reliable continuation** — After each subagent returns, the orchestrator reliably
   proceeds to the next phase without state loss.
4. **Long-running tasks** — Commit analysis and documentation writing are long-running
   operations that should be delegated rather than inlined.

**Rule:** Orchestrators must preserve their own context. Delegate long-running work to
subagents via Task tool, not Skill tool.

**Branch strategy:**
- Each audit that finds gaps creates a fresh branch: `docs/auto-update-YYYY-MM-DD`
- If no gaps are found, no branch is created
- The orchestrator manages all branch operations; subagents must NOT create branches
- If a branch with today's date already exists, append a counter: `docs/auto-update-YYYY-MM-DD-2`

**Sensitivity calibration:**
This agent should focus on documentation gaps that are really important or moderately
important. It should NOT be nitpicky about:
- Internal refactors that don't change public behavior
- Test-only changes
- CI/CD pipeline changes
- Dependency bumps (unless they change APIs)
- Version package commits
- Code style/formatting changes

It SHOULD flag missing documentation for:
- New user-facing features (CLI commands, config options, API methods)
- Changed behavior that existing docs describe incorrectly
- New packages or integrations
- New concepts or architectural changes
- Breaking changes to configuration schema
- New guides or tutorials that would help users

**Documentation site structure:**
The docs live at `docs/src/content/docs/` in Astro/Starlight format. Key sections:
- `getting-started/` — Installation and quickstart
- `concepts/` — Core concepts (agents, jobs, schedules, etc.)
- `configuration/` — YAML configuration reference
- `guides/` — How-to guides and recipes
- `integrations/` — Discord, Slack, web dashboard
- `library-reference/` — TypeScript API docs
- `internals/` — Architecture details
- `cli-reference/` — CLI command reference

**Key inputs/outputs:**
- Input: `agents/docs/state.md` — persistent state with last checked commit
- Output: `agents/docs/state.md` — updated with new last-checked commit and run results
- Output (conditional): `docs/auto-update-YYYY-MM-DD` branch with new/updated docs, pushed to origin
</context>

<process>

<step name="phase_0_preflight">
## Phase 0: Pre-flight Checks

Verify clean working state and load persistent state.

**Check for uncommitted changes:**
```bash
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "ERROR: Uncommitted changes detected"
  git status --short
  echo ""
  echo "Please commit or stash changes before running docs audit."
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

**Read state file:**
Read `agents/docs/state.md` and extract `last_checked_commit` from the YAML frontmatter.

```bash
LAST_COMMIT=$(sed -n 's/^last_checked_commit: *//p' agents/docs/state.md | head -1)
echo "Last checked commit: $LAST_COMMIT"
```

If `last_checked_commit` is empty, "not yet run", or the file does not exist, log an error
and exit:
```
ERROR: No last_checked_commit found in agents/docs/state.md
Please seed the state file with an initial commit SHA.
```
Do not attempt to analyze the entire history.

**Fetch latest and check out main:**
```bash
git fetch origin main --quiet
git checkout main --quiet
git pull origin main --quiet
echo "On main at $(git rev-parse --short HEAD)"
```

This ensures we're reading the latest state.md and creating branches from up-to-date main.

**Pre-flight complete:** Working tree clean, original branch saved, on main with latest.
</step>

<step name="phase_1_identify_commits">
## Phase 1: Identify New Commits

Find all commits on main since the last checked commit.

**Get new commits:**
```bash
NEW_COMMITS=$(git log --oneline $LAST_COMMIT..origin/main)
COMMIT_COUNT=$(git log --oneline $LAST_COMMIT..origin/main | wc -l | tr -d ' ')
LATEST_COMMIT=$(git rev-parse --short origin/main)
echo "New commits since $LAST_COMMIT: $COMMIT_COUNT"
echo "$NEW_COMMITS"
```

**Early exit if no new commits:**
If `$COMMIT_COUNT` is 0:
1. Print: "No new commits since last check. Exiting."
2. Skip directly to Phase 5 (restore branch).
3. Do NOT create any branches, spawn subagents, or update state.
4. No state change is needed — `last_checked_commit` is already current.

**Get the diff summary for the subagent:**
If there are commits, also run:
```bash
git diff --stat $LAST_COMMIT..origin/main
```
This gives the subagent a high-level view of what changed across all commits.
</step>

<step name="phase_2_analyze_commits">
## Phase 2: Analyze Commits for Documentation Gaps (via Subagent)

Delegate commit analysis to a dedicated subagent using Task tool.

**IMPORTANT:** Use Task tool, NOT Skill tool. This ensures the orchestrator maintains
its context and can reliably continue to subsequent phases.

**Spawn analyzer subagent:**
Use the Task tool with `run_in_background: false` and the following prompt
(substitute the actual commit range values):

```
You are a documentation gap analyzer for the herdctl project — a TypeScript system
for managing fleets of Claude Code agents.

## Your Task

Analyze the following commits to determine if any documentation updates are missing.
Focus on gaps that are REALLY IMPORTANT or MODERATELY IMPORTANT. Do NOT flag trivial
or nitpicky issues.

## Commit Range

Commits to analyze: {LAST_COMMIT}..{LATEST_COMMIT} ({COMMIT_COUNT} commits)

## Instructions

1. Read the commit list:
   git log --oneline {LAST_COMMIT}..origin/main

2. For each commit (or group of related commits), check what changed:
   git show --stat <commit-sha>
   For commits that look like they might need docs, read the actual diff:
   git show <commit-sha>

3. For each commit, determine the documentation impact:

   SKIP these (no docs needed):
   - "chore: version packages" commits
   - Test-only changes (files only in __tests__/)
   - CI/CD changes (.github/workflows/)
   - Internal refactors that don't change public API or behavior
   - Dependency bumps (unless they change user-facing behavior)
   - Code style/formatting changes

   FLAG these (docs likely needed):
   - New CLI commands or flags
   - New configuration options in agent.yaml or herdctl.yaml
   - New packages added to the monorepo
   - New integrations (Discord, Slack, web features)
   - Changed behavior described in existing docs
   - New concepts or architectural changes
   - API changes in @herdctl/core that library users would see

4. For each gap found, check if documentation ALREADY EXISTS:
   - Search docs/src/content/docs/ for relevant content
   - Read existing pages that might already cover the change
   - Only flag as a gap if the docs are genuinely missing or wrong

5. Read the existing documentation structure:
   find docs/src/content/docs/ -name "*.md" -o -name "*.mdx" | sort

## Output Format

Return your analysis as a structured report:

# Documentation Gap Analysis

## Summary
- Commits analyzed: N
- Commits skipped (no docs needed): N
- Documentation gaps found: N

## Gaps Found

### Gap 1: [Title]
- Commit(s): <sha> <message>
- What changed: <description of the code change>
- What's missing: <what documentation should exist>
- Suggested location: <which doc file to update or create>
- Priority: High / Medium

### Gap 2: [Title]
...

## Commits Skipped (No Docs Needed)
- <sha> <message> — <reason skipped>

## Commits Already Documented
- <sha> <message> — <where docs exist>

If no gaps are found, return:

# Documentation Gap Analysis

## Summary
- Commits analyzed: N
- Commits skipped (no docs needed): N
- Documentation gaps found: 0

## No Gaps Found
All analyzed commits either don't need documentation updates or are already covered
by existing docs.

IMPORTANT RULES:
(1) Do NOT create branches or run git checkout — stay on the current branch.
(2) Do NOT modify any files — this is analysis only.
(3) Be honest — if you're unsure whether something needs docs, flag it as Medium
    priority with a note explaining your uncertainty.
```

**Capture the analysis result.**
After the subagent completes, extract:
- Total gaps found (count)
- The list of gaps with their details
- Whether any are High priority

Store the gap count and the full gap report text.

**Decision point:**
- If gaps found is 0: Skip Phase 3 entirely. Proceed to Phase 4 (state update).
- If gaps found > 0: Proceed to Phase 3 (create documentation).
</step>

<step name="phase_3_create_documentation">
## Phase 3: Create Documentation (via Subagent, only if gaps found)

**SKIP this phase entirely if no gaps were found in Phase 2.**

**Create documentation branch:**
```bash
BRANCH_NAME="docs/auto-update-${TODAY}"

# Check if branch already exists
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

**Spawn writer subagent:**
Use the Task tool with `run_in_background: false` and the following prompt
(substitute the actual gap report from Phase 2):

```
You are a documentation writer for the herdctl project. Your job is to write or
update documentation pages to fill identified gaps.

## Documentation Gaps to Address

{INSERT THE FULL GAP REPORT FROM PHASE 2}

## Instructions

1. For each gap, read the existing documentation in the suggested location
   (or nearby files) to understand the writing style and conventions.

2. Read the relevant source code to understand what to document:
   - packages/core/src/ for core library features
   - packages/cli/src/ for CLI commands
   - packages/web/src/ for web dashboard features
   - Check the relevant package's README or existing docs

3. Write or update the documentation:
   - Match the existing style of nearby documentation pages
   - Use Astro/Starlight frontmatter format (title, description)
   - Include code examples where appropriate
   - Keep explanations clear and concise
   - Add cross-references to related pages

4. If creating a NEW page, check whether the directory has autogenerate
   configured in docs/astro.config.mjs before trying to add sidebar entries.

## Style Guidelines

- Use markdown headers (##, ###) for structure
- Include YAML/TypeScript code blocks with syntax highlighting
- Use tables for configuration reference
- Add links to related pages where appropriate
- Keep pages focused — one concept per page
- Follow the pattern of existing pages in the same directory

## Output

After writing all documentation, report:

# Documentation Updates
## Files Created
- path/to/new-file.md — description
## Files Updated
- path/to/existing-file.md — what changed
## Summary
Brief description of all changes made

IMPORTANT RULES:
(1) Do NOT create branches or run git checkout — stay on the current branch.
(2) Do NOT commit changes — the orchestrator handles commits.
(3) Only write documentation files in docs/src/content/docs/ and potentially
    docs/astro.config.mjs.
(4) Do NOT modify source code files.
(5) Match the quality and style of existing documentation.
```

**After subagent completes, verify branch:**
```bash
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH_NAME" ]; then
  echo "WARN: Subagent switched to branch $CURRENT_BRANCH, restoring $BRANCH_NAME"
  git checkout "$BRANCH_NAME" --quiet
fi
echo "Verified on branch: $(git branch --show-current)"
```

**Stage and commit documentation changes:**
```bash
git add docs/src/content/docs/
git add docs/astro.config.mjs

STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "WARN: No documentation files were changed by subagent"
  git checkout "$ORIGINAL_BRANCH" --quiet
  git branch -D "$BRANCH_NAME"
  BRANCH_NAME=""
else
  echo "Files to commit:"
  echo "$STAGED"

  git commit -m "docs: auto-update documentation for recent changes

Addresses N documentation gap(s) identified by automated audit.

Commits analyzed: $LAST_COMMIT..$LATEST_COMMIT ($COMMIT_COUNT commits)
Gaps found: N
Audit date: $TODAY

Co-Authored-By: Claude <noreply@anthropic.com>
"
fi
```

**Push branch (if changes were committed):**
```bash
if [ -n "$BRANCH_NAME" ]; then
  git push -u origin "$BRANCH_NAME"
  echo "Pushed branch $BRANCH_NAME"
fi
```

**Create pull request (if changes were pushed):**
```bash
if [ -n "$BRANCH_NAME" ]; then
  gh pr create \
    --title "docs: auto-update documentation ($TODAY)" \
    --body "Automated documentation audit found N gap(s) across M commits.

## Gaps Addressed
{List gaps from Phase 2 analysis}

Generated by docs-audit-daily" \
    --base main
  echo "PR created"
fi
```
</step>

<step name="phase_4_update_state">
## Phase 4: Update State

Update `agents/docs/state.md` with results from this run.

**Always execute this phase**, even if no gaps were found or Phase 2 was skipped.

**IMPORTANT:** Never commit directly to main. The state update goes on the same PR
branch as the documentation changes. If no branch was created yet (because no gaps
were found), create one now for the state-only update.

**Ensure we're on a PR branch:**
```bash
if [ -z "$BRANCH_NAME" ]; then
  # No branch was created in Phase 3 (no gaps found or phase skipped).
  # Create one now for the state update.
  BRANCH_NAME="docs/auto-update-${TODAY}"

  if git rev-parse --verify "$BRANCH_NAME" >/dev/null 2>&1; then
    COUNTER=2
    while git rev-parse --verify "${BRANCH_NAME}-${COUNTER}" >/dev/null 2>&1; do
      COUNTER=$((COUNTER + 1))
    done
    BRANCH_NAME="${BRANCH_NAME}-${COUNTER}"
  fi

  git checkout -b "$BRANCH_NAME" origin/main
  echo "Created branch for state update: $BRANCH_NAME"
else
  echo "On existing branch: $(git branch --show-current)"
fi
```

**Update state.md:**
Use the Write or Edit tool to update the YAML frontmatter:
- `last_checked_commit`: the latest commit SHA on main that was analyzed (or current value if no new commits)
- `last_run`: current ISO timestamp
- `docs_gaps_found`: count from this run (0 if no gaps or no new commits)
- `branches_created`: append the branch name if one was created
- `status`: `completed` (or `error` if a subagent failed)

**Update the Current Position table** with the new values.

**Add a Run History entry** to the table:
```
| YYYY-MM-DD | N commits | N gaps | action | branch-name |
```

Where action is one of:
- `no-new-commits` — No commits since last check
- `no-gaps` — Commits analyzed, no documentation gaps found
- `created-branch` — Gaps found and branch created with docs and PR
- `gaps-found-no-changes` — Gaps found but subagent produced no file changes

**Commit state update:**
```bash
git add agents/docs/state.md
git commit -m "docs: update audit state ($TODAY)

Co-Authored-By: Claude <noreply@anthropic.com>"
echo "State committed on branch $BRANCH_NAME"
```

**Push and create PR (if not already done in Phase 3):**
If Phase 3 already pushed the branch and created a PR, the state commit just needs
to be pushed to the existing branch:
```bash
git push origin "$BRANCH_NAME"
```

If Phase 3 was skipped (no gaps), this is a state-only branch that still needs a PR:
```bash
git push -u origin "$BRANCH_NAME"
gh pr create \
  --title "docs: update audit state ($TODAY)" \
  --body "State-only update: $COMMIT_COUNT commits analyzed, no documentation gaps found.

Generated by docs-audit-daily" \
  --base main
```
</step>

<step name="phase_5_cleanup_and_summary">
## Phase 5: Cleanup and Final Summary

Restore original branch and print results.

**Ensure we're on the original branch:**
```bash
git checkout "$ORIGINAL_BRANCH" --quiet
echo "Returned to branch: $ORIGINAL_BRANCH"
```

**Final status report:**
```
==========================================
  DAILY DOCUMENTATION AUDIT COMPLETE
==========================================

Date:           {TODAY}
Commits:        {COMMIT_COUNT} new since {LAST_COMMIT}
Gaps Found:     {GAPS_FOUND}
Action:         {no-new-commits | no-gaps | created-branch | error}

{If branch created:}
Branch:         {BRANCH_NAME}

State:          agents/docs/state.md updated
Last Commit:    {LATEST_COMMIT}

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

### First Run (State File Exists with Seed Commit)
Normal operation. The seed commit in state.md provides the starting point.
`git log <seed>..origin/main` returns all commits since the seed.

### First Run (State File Missing or Corrupt)
If `agents/docs/state.md` does not exist or `last_checked_commit` cannot be parsed:
- Print error: "State file missing or corrupt. Please create agents/docs/state.md with a seed commit."
- Exit without doing anything. Do NOT attempt to analyze the entire git history.
- This protects against accidentally spawning analysis of hundreds of commits.

### No New Commits Since Last Check
If `git log $LAST_COMMIT..origin/main` returns nothing:
- Print: "No new commits since last check."
- Do not update state or create branches — `last_checked_commit` is already current.
- Exit cleanly. This is normal and expected on quiet days.

### All Commits Are Skip-Worthy
If the analyzer subagent finds that every commit falls into the "skip" category
(version packages, tests only, CI changes):
- Report gaps found: 0
- No branch created, no changes
- Update state with the new last_checked_commit so these are not re-analyzed

### Analyzer Subagent Fails
If the Phase 2 subagent fails or times out:
- Skip Phase 3 (do not attempt documentation creation)
- Update state.md with `last_run` timestamp and `status: error`
- Do NOT update `last_checked_commit` — leave it at the previous value so the
  next run re-analyzes these commits
- Print error in final summary

### Writer Subagent Fails or Produces No Changes
If the Phase 3 subagent fails or produces no file changes:
- Delete the empty branch: `git branch -D $BRANCH_NAME`
- Update state.md with gap count and action `gaps-found-no-changes`
- The gaps are recorded in the run history for manual follow-up

### Branch Already Exists
If `docs/auto-update-YYYY-MM-DD` already exists (from a failed earlier run today):
- Append a counter: `docs/auto-update-YYYY-MM-DD-2`, `-3`, etc.

### Push Fails
If `git push` fails:
- Log warning with the error
- Note that changes are committed locally on the branch
- Provide manual push command in the output
- Still update state.md (docs are written, just not pushed)

### Very Large Commit Range (50+)
If more than 50 commits since last check:
- Note the large range in the subagent prompt
- The analyzer should still handle it (it can batch/summarize)
- Update `last_checked_commit` to the latest regardless
- Do not re-analyze old commits on subsequent runs

</edge_cases>

<success_criteria>
Checklist for complete daily documentation audit:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved
- [ ] State file read successfully
- [ ] `last_checked_commit` extracted from frontmatter
- [ ] Remote main fetched

**Identify Commits (Phase 1)**
- [ ] New commits listed (or early exit if none)
- [ ] Commit count and range stored

**Analyze Commits (Phase 2)**
- [ ] Task tool spawned analyzer subagent
- [ ] Subagent returned structured gap report
- [ ] Gap count extracted

**Create Documentation (Phase 3, conditional)**
- [ ] Branch created (only if gaps > 0)
- [ ] Task tool spawned writer subagent
- [ ] Documentation files written
- [ ] Changes committed to branch
- [ ] Branch pushed to origin

**Update State (Phase 4)**
- [ ] state.md frontmatter updated
- [ ] Run history entry added

**Cleanup (Phase 5)**
- [ ] Returned to original branch
- [ ] Final status printed with all metrics
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
    expression: "0 3 * * *"
    prompt: "Run /docs-audit-daily"
```

**Manual invocation:**
```bash
claude "/docs-audit-daily"
```

**Output handling:**
- State is written to agents/docs/state.md
- Documentation changes go to a separate branch for review
- Final status report is printed for logging
- Non-zero exit only on pre-flight failure (uncommitted changes or missing state)
</unattended_execution>
