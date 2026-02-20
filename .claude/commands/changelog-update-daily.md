---
name: changelog-update-daily
description: Automated daily What's New page update with commit analysis and PR creation
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
Meta-orchestrator for fully automated daily What's New page updates.

This command wraps the full changelog update workflow with:
1. **State tracking** -- Reads last checked commit, processes only new commits
2. **Change detection** -- Identifies new commits and npm package releases
3. **Changelog analysis** -- Delegates to analyzer subagent to identify changelog-worthy items
4. **Changelog writing** -- Delegates to writer subagent to add entries to the What's New page
5. **PR workflow** -- Creates branch and pushes for human review
6. **Unattended execution** -- No user prompts or manual steps required

**Intended use:** Scheduled daily execution via herdctl at 4am UTC, or manual invocation.
</objective>

<context>
**Why we use subagents (CRITICAL for reliable execution):**

This is a meta-orchestrator that coordinates multiple phases. We use Task tool
with subagents instead of Skill tool for Phases 2 and 3 because:

1. **Context preservation** -- When using Skill tool, the orchestrator "forgets" its state
   after the nested skill completes. This caused phases to never execute in the security agent.
2. **Independent execution** -- Task tool spawns separate subagents that run independently
   while the orchestrator maintains its own context and state.
3. **Reliable continuation** -- After each subagent returns, the orchestrator reliably
   proceeds to the next phase without state loss.
4. **Long-running tasks** -- Commit analysis and changelog writing are long-running
   operations that should be delegated rather than inlined.

**Rule:** Orchestrators must preserve their own context. Delegate long-running work to
subagents via Task tool, not Skill tool.

**Branch strategy:**
- Each update that produces new entries creates a fresh branch: `changelog/auto-update-YYYY-MM-DD`
- If no changelog-worthy changes are found, no branch is created
- The orchestrator manages all branch operations; subagents must NOT create branches
- If a branch with today's date already exists, append a counter: `changelog/auto-update-YYYY-MM-DD-2`

**Sensitivity calibration (MORE SELECTIVE than docs-audit):**
This agent should be HIGHLY selective. The What's New page is a product changelog for
people evaluating or using herdctl -- not a developer commit log. Only genuinely
interesting user-facing changes belong here. When in doubt, leave it out.

SKIP these (no changelog entry needed):
- "chore: version packages" commits (automated version bumps)
- Test-only changes (files only in `__tests__/`)
- CI/CD pipeline changes (`.github/workflows/`)
- Internal refactors that don't change user-facing behavior
- Dependency bumps (unless they change user-facing behavior)
- Code style/formatting changes (Biome, ESLint, Prettier)
- Documentation-only changes (docs site updates, README tweaks)
- Changeset files (`.changeset/*.md`)
- Minor bug fixes that most users would never encounter
- State file updates from other agents

INCLUDE these (changelog entry warranted):
- New user-facing features (CLI commands, config options, integrations)
- New packages added to the monorepo
- Bug fixes that users would actually notice or that fix broken behavior
- Breaking changes (always include, clearly marked)
- New integrations or connector features (Discord, Slack, web dashboard)
- Significant performance improvements
- New APIs that library users (`@herdctl/core`) would use
- Major architectural changes that affect how users deploy or configure herdctl

**Tone and style for changelog entries:**
- Write for users and evaluators, not developers
- Use clear, benefit-oriented language ("You can now..." or "Agents now support...")
- Group related changes into a single entry (a feature + its follow-up fixes = one entry)
- Include version numbers when a package release is involved
- Keep each entry to 1-3 sentences
- Use present tense for capabilities ("supports", "enables", not "supported", "enabled")

**Package CHANGELOG.md locations:**
- `packages/core/CHANGELOG.md` -- @herdctl/core
- `packages/cli/CHANGELOG.md` -- herdctl CLI
- `packages/web/CHANGELOG.md` -- @herdctl/web dashboard
- `packages/chat/CHANGELOG.md` -- @herdctl/chat shared infrastructure
- `packages/discord/CHANGELOG.md` -- @herdctl/discord connector
- `packages/slack/CHANGELOG.md` -- @herdctl/slack connector

**What's New page location:**
- `docs/src/content/docs/reference/whats-new.md` (or wherever it exists in the docs tree)
- New entries go at the TOP (reverse chronological order)
- Never modify or delete existing entries

**Key inputs/outputs:**
- Input: `agents/changelog/state.md` -- persistent state with last checked commit
- Output: `agents/changelog/state.md` -- updated with new last-checked commit and run results
- Output (conditional): `changelog/auto-update-YYYY-MM-DD` branch with updated What's New page, pushed to origin
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
  echo "Please commit or stash changes before running changelog update."
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
echo "Update date: $TODAY"
```

**Read state file:**
Read `agents/changelog/state.md` and extract `last_checked_commit` from the YAML frontmatter.

```bash
LAST_COMMIT=$(sed -n 's/^last_checked_commit: *//p' agents/changelog/state.md | head -1)
echo "Last checked commit: $LAST_COMMIT"
```

If `last_checked_commit` is empty, "not yet run", or the file does not exist, log an error
and exit:
```
ERROR: No last_checked_commit found in agents/changelog/state.md
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

<step name="phase_1_identify_changes">
## Phase 1: Identify New Commits and Releases

Find all commits on main since the last checked commit, and check for new package releases.

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
4. No state change is needed -- `last_checked_commit` is already current.

**Get the diff summary for the subagent:**
If there are commits, also run:
```bash
git diff --stat $LAST_COMMIT..origin/main
```
This gives the subagent a high-level view of what changed across all commits.

**Check for new package versions:**
Also gather version info from package CHANGELOG.md files for the subagent:
```bash
echo "=== Recent package versions ==="
for pkg in core cli web chat discord slack; do
  echo "--- packages/$pkg/CHANGELOG.md (first 5 lines) ---"
  head -5 packages/$pkg/CHANGELOG.md 2>/dev/null || echo "(no CHANGELOG.md)"
done
```

This tells the subagent what version numbers to reference in changelog entries.
</step>

<step name="phase_2_analyze_changes">
## Phase 2: Analyze Changes for Changelog Entries (via Subagent)

Delegate change analysis to a dedicated subagent using Task tool.

**IMPORTANT:** Use Task tool, NOT Skill tool. This ensures the orchestrator maintains
its context and can reliably continue to subsequent phases.

**Spawn analyzer subagent:**
Use the Task tool with `run_in_background: false` and the following prompt
(substitute the actual commit range values):

```
You are a changelog analyzer for the herdctl project -- a TypeScript system
for managing fleets of Claude Code agents.

## Your Task

Analyze the following commits to determine which ones deserve entries on the
user-facing "What's New" changelog page. Be HIGHLY SELECTIVE. This is a product
changelog for users and evaluators, not a developer commit log.

## Commit Range

Commits to analyze: {LAST_COMMIT}..{LATEST_COMMIT} ({COMMIT_COUNT} commits)

## Instructions

1. Read the commit list:
   git log --oneline {LAST_COMMIT}..origin/main

2. For each commit (or group of related commits), check what changed:
   git show --stat <commit-sha>
   For commits that look potentially interesting, read the actual diff:
   git show <commit-sha>

3. For each commit, determine if it deserves a changelog entry:

   SKIP these (no entry needed):
   - "chore: version packages" commits (automated version bumps)
   - Test-only changes (files only in __tests__/)
   - CI/CD changes (.github/workflows/)
   - Internal refactors that don't change user-facing behavior
   - Dependency bumps (unless they change user-facing behavior)
   - Code style/formatting changes
   - Documentation-only changes
   - Changeset files (.changeset/*.md)
   - Minor bug fixes most users would never encounter
   - State file updates from agents

   INCLUDE these (entry warranted):
   - New user-facing features (CLI commands, config options, integrations)
   - New packages added to the monorepo
   - Bug fixes users would actually notice
   - Breaking changes (ALWAYS include)
   - New integrations or connector features
   - Significant performance improvements
   - New APIs for library users
   - Major architectural changes affecting deployment/configuration

4. Check the package CHANGELOG.md files for version context:
   Read the top of each packages/*/CHANGELOG.md to see what versions were released
   and what the changeset descriptions say. Use these version numbers in your entries.

5. Group related changes: If a feature was introduced in one commit and then fixed
   or refined in subsequent commits, treat them as ONE changelog entry, not multiple.

## Output Format

Return your analysis as a structured report:

# Changelog Analysis

## Summary
- Commits analyzed: N
- Commits skipped (not changelog-worthy): N
- Changelog entries to add: N

## Entries to Add

### Entry 1: [Title for the What's New page]
- Date: YYYY-MM-DD (use the commit date)
- Commit(s): <sha> <message>, <sha> <message>
- Version(s): @herdctl/core vX.Y.Z, herdctl vX.Y.Z (if applicable)
- Description: 1-3 sentences written in user-facing product changelog style.
  Write for someone evaluating or using herdctl, not for developers.
  Use present tense. Focus on what users can now do, not implementation details.

### Entry 2: [Title]
...

## Commits Skipped
- <sha> <message> -- <reason skipped>

If no entries are warranted, return:

# Changelog Analysis

## Summary
- Commits analyzed: N
- Commits skipped (not changelog-worthy): N
- Changelog entries to add: 0

## No Entries Warranted
All analyzed commits are either automated version bumps, internal changes,
or minor fixes that don't warrant user-facing changelog entries.

## Commits Skipped
- <sha> <message> -- <reason skipped>

IMPORTANT RULES:
(1) Do NOT create branches or run git checkout -- stay on the current branch.
(2) Do NOT modify any files -- this is analysis only.
(3) Be HIGHLY SELECTIVE. When in doubt, skip it. The changelog should be useful
    to someone evaluating herdctl, not comprehensive for developers.
(4) Group related commits into single entries. Don't create separate entries for
    a feature and its immediate follow-up fixes.
(5) Write descriptions in user-facing product language, not developer jargon.
```

**Capture the analysis result.**
After the subagent completes, extract:
- Total entries to add (count)
- The list of entries with their details
- Whether any involve breaking changes

Store the entry count and the full analysis report text.

**Decision point:**
- If entries to add is 0: Skip Phase 3 entirely. Proceed to Phase 4 (state update).
- If entries to add > 0: Proceed to Phase 3 (write changelog entries).
</step>

<step name="phase_3_update_changelog">
## Phase 3: Update What's New Page (via Subagent, only if entries found)

**SKIP this phase entirely if no entries were identified in Phase 2.**

**Create changelog branch:**
```bash
BRANCH_NAME="changelog/auto-update-${TODAY}"

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

**Locate the What's New page:**
```bash
find docs/src/content/docs/ -name "whats-new*" -o -name "changelog*" -o -name "whats_new*" | head -5
```

If the page does not exist yet, note this -- the writer subagent will need to know.

**Spawn writer subagent:**
Use the Task tool with `run_in_background: false` and the following prompt
(substitute the actual entries from Phase 2):

```
You are a changelog writer for the herdctl project. Your job is to add new
entries to the What's New documentation page.

## Entries to Add

{INSERT THE ENTRIES FROM THE PHASE 2 ANALYSIS REPORT}

## Instructions

1. Find and read the existing What's New page:
   Look for files matching: docs/src/content/docs/**/whats-new*
   If found, read the entire file to understand the existing format and style.

2. Add new entries at the TOP of the page content (after the frontmatter),
   in reverse chronological order (newest first). Each entry should follow
   this format (match the existing style on the page if one exists):

   ### Title of Change
   **Date** | version info if applicable

   1-3 sentence description of what changed, written for users.

3. Style rules:
   - Match the existing entry format on the page exactly
   - Use present tense ("Agents now support..." not "Added support for...")
   - Focus on user benefits, not implementation details
   - Include version numbers when a package release was involved
   - Keep entries concise: 1-3 sentences each
   - Group related changes under a single heading
   - Use ### for entry headings (not ## or ####)

4. DO NOT modify or reorder existing entries. Only add new ones at the top.

5. DO NOT modify any other files. Only touch the What's New page.

## Output

After writing the entries, report:

# Changelog Updates
## Entries Added
- [Entry title] -- brief description
## File Modified
- path/to/whats-new.md

IMPORTANT RULES:
(1) Do NOT create branches or run git checkout -- stay on the current branch.
(2) Do NOT commit changes -- the orchestrator handles commits.
(3) Only modify the What's New documentation page. Do NOT touch other files.
(4) Preserve ALL existing content. Only add new entries at the top.
(5) Match the existing page style exactly.
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

**Stage and commit changelog changes:**
```bash
git add docs/src/content/docs/

STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo "WARN: No changelog files were changed by subagent"
  git checkout main --quiet
  git branch -D "$BRANCH_NAME"
  BRANCH_NAME=""
else
  echo "Files to commit:"
  echo "$STAGED"

  ENTRY_COUNT=N  # substitute actual count from Phase 2

  git commit -m "docs: add $ENTRY_COUNT changelog entry/entries to What's New page

Adds new entries to the What's New page based on recent changes.

Commits analyzed: $LAST_COMMIT..$LATEST_COMMIT ($COMMIT_COUNT commits)
Entries added: $ENTRY_COUNT
Update date: $TODAY

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
    --title "docs: update What's New page ($TODAY)" \
    --body "Automated changelog update added $ENTRY_COUNT new entry/entries.

## Entries Added
{List entries from Phase 2 analysis}

## Commits Analyzed
$COMMIT_COUNT commits from $LAST_COMMIT to $LATEST_COMMIT

Generated by changelog-update-daily" \
    --base main
  echo "PR created"
fi
```
</step>

<step name="phase_4_update_state">
## Phase 4: Update State

Update `agents/changelog/state.md` with results from this run.

**Always execute this phase**, even if no entries were found or Phase 3 was skipped.

**IMPORTANT:** Never commit directly to main. The state update goes on the same PR
branch as the changelog changes. If no branch was created yet (because no entries
were found), create one now for the state-only update.

**Ensure we're on a PR branch:**
```bash
if [ -z "$BRANCH_NAME" ]; then
  # No branch was created in Phase 3 (no entries found or phase skipped).
  # Create one now for the state update.
  BRANCH_NAME="changelog/auto-update-${TODAY}"

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
- `entries_added`: count from this run (0 if no entries or no new commits)
- `branches_created`: append the branch name if one was created
- `status`: `completed` (or `error` if a subagent failed)

**Update the Current Position table** with the new values.

**Add a Run History entry** to the table:
```
| YYYY-MM-DD | N commits | N entries | action | branch-name |
```

Where action is one of:
- `no-new-commits` -- No commits since last check
- `no-entries` -- Commits analyzed, no changelog-worthy changes found
- `created-branch` -- Entries found and branch created with updates and PR
- `entries-found-no-changes` -- Entries identified but subagent produced no file changes

**Commit state update:**
```bash
git add agents/changelog/state.md
git commit -m "docs: update changelog agent state ($TODAY)

Co-Authored-By: Claude <noreply@anthropic.com>"
echo "State committed on branch $BRANCH_NAME"
```

**Push and create PR (if not already done in Phase 3):**
If Phase 3 already pushed the branch and created a PR, the state commit just needs
to be pushed to the existing branch:
```bash
git push origin "$BRANCH_NAME"
```

If Phase 3 was skipped (no entries), this is a state-only branch that still needs a PR:
```bash
git push -u origin "$BRANCH_NAME"
gh pr create \
  --title "docs: update changelog agent state ($TODAY)" \
  --body "State-only update: $COMMIT_COUNT commits analyzed, no changelog-worthy changes found.

Generated by changelog-update-daily" \
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
  DAILY CHANGELOG UPDATE COMPLETE
==========================================

Date:           {TODAY}
Commits:        {COMMIT_COUNT} new since {LAST_COMMIT}
Entries Added:  {ENTRY_COUNT}
Action:         {no-new-commits | no-entries | created-branch | error}

{If branch created:}
Branch:         {BRANCH_NAME}

State:          agents/changelog/state.md updated
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
- User must commit or stash before running changelog update

### First Run (State File Exists with Seed Commit)
Normal operation. The seed commit in state.md provides the starting point.
`git log <seed>..origin/main` returns all commits since the seed.

### First Run (State File Missing or Corrupt)
If `agents/changelog/state.md` does not exist or `last_checked_commit` cannot be parsed:
- Print error: "State file missing or corrupt. Please create agents/changelog/state.md with a seed commit."
- Exit without doing anything. Do NOT attempt to analyze the entire git history.
- This protects against accidentally spawning analysis of hundreds of commits.

### No New Commits Since Last Check
If `git log $LAST_COMMIT..origin/main` returns nothing:
- Print: "No new commits since last check."
- Do not update state or create branches -- `last_checked_commit` is already current.
- Exit cleanly. This is normal and expected on quiet days.

### All Commits Are Skip-Worthy
If the analyzer subagent finds that every commit falls into the "skip" category
(version packages, tests only, CI changes, docs-only, formatting):
- Report entries to add: 0
- No branch created, no changes
- Update state with the new last_checked_commit so these are not re-analyzed

### What's New Page Does Not Exist Yet
If the writer subagent cannot find the What's New page:
- Log a warning: "What's New page not found. Skipping changelog write."
- Record the entries in the state update for manual follow-up
- Do NOT create the page -- that is handled by a separate process

### Analyzer Subagent Fails
If the Phase 2 subagent fails or times out:
- Skip Phase 3 (do not attempt changelog writing)
- Update state.md with `last_run` timestamp and `status: error`
- Do NOT update `last_checked_commit` -- leave it at the previous value so the
  next run re-analyzes these commits
- Print error in final summary

### Writer Subagent Fails or Produces No Changes
If the Phase 3 subagent fails or produces no file changes:
- Delete the empty branch: `git branch -D $BRANCH_NAME`
- Update state.md with entry count and action `entries-found-no-changes`
- The entries are recorded in the run history for manual follow-up

### Branch Already Exists
If `changelog/auto-update-YYYY-MM-DD` already exists (from a failed earlier run today):
- Append a counter: `changelog/auto-update-YYYY-MM-DD-2`, `-3`, etc.

### Push Fails
If `git push` fails:
- Log warning with the error
- Note that changes are committed locally on the branch
- Provide manual push command in the output
- Still update state.md (entries are written, just not pushed)

### Very Large Commit Range (50+)
If more than 50 commits since last check:
- Note the large range in the subagent prompt
- The analyzer should still handle it (it can batch/summarize)
- Update `last_checked_commit` to the latest regardless
- Do not re-analyze old commits on subsequent runs
- With a large range, the analyzer should be EVEN MORE selective

### Multiple Package Releases in One Range
If several packages were released between checks:
- Each significant release may warrant its own changelog entry
- But group related releases (e.g., a core change + CLI bump) into one entry
- The analyzer subagent handles this grouping

</edge_cases>

<success_criteria>
Checklist for complete daily changelog update:

**Pre-flight (Phase 0)**
- [ ] Working tree is clean
- [ ] Original branch saved
- [ ] State file read successfully
- [ ] `last_checked_commit` extracted from frontmatter
- [ ] Remote main fetched

**Identify Changes (Phase 1)**
- [ ] New commits listed (or early exit if none)
- [ ] Commit count and range stored
- [ ] Package CHANGELOG.md files checked for version context

**Analyze Changes (Phase 2)**
- [ ] Task tool spawned analyzer subagent
- [ ] Subagent returned structured analysis report
- [ ] Entry count extracted

**Update Changelog (Phase 3, conditional)**
- [ ] Branch created (only if entries > 0)
- [ ] Task tool spawned writer subagent
- [ ] New entries added to top of What's New page
- [ ] Existing entries preserved unchanged
- [ ] Changes committed to branch
- [ ] Branch pushed to origin
- [ ] PR created

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
    expression: "0 4 * * *"
    prompt: "Run /changelog-update-daily"
```

**Manual invocation:**
```bash
claude "/changelog-update-daily"
```

**Output handling:**
- State is written to agents/changelog/state.md
- Changelog changes go to a separate branch for review
- Final status report is printed for logging
- Non-zero exit only on pre-flight failure (uncommitted changes or missing state)
</unattended_execution>
