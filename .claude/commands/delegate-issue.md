---
name: delegate-issue
description: Delegate a single GitHub issue to an autonomous Claude Code worker that clones the repo, fixes it, and opens a PR
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

<objective>
Delegate a single GitHub issue to an autonomous Claude Code worker.

Given one issue number:
1. Fetch the issue details from GitHub and validate it's open
2. Clone the repo into `~/Code/herdctl-issues/issue-<N>/`
3. Create a fix branch and install dependencies
4. Launch a `claude -p` worker in the clone to fix the issue and open a PR
5. Monitor the worker until it finishes
6. Report the result

The worker runs as an independent `claude -p` process with full autonomy.
</objective>

<context>
**Invocation:**
```
/delegate-issue 165
```

Pass a single GitHub issue number as the argument.

**For multiple issues:** Don't use this skill directly for multiple issues. Instead, tell your Claude Code session to launch multiple Task agents (or background processes), each running `/delegate-issue <N>` for one issue. The orchestrator handles parallelism, not this skill.

**Prerequisites:**
- `gh` CLI authenticated with access to edspencer/herdctl
- `git` configured with SSH access to push branches
- `claude` CLI installed and authenticated
- `pnpm` available globally

**Output directory:** `~/Code/herdctl-issues/`
The clone lives at `~/Code/herdctl-issues/issue-<N>/`.

**Cleanup:** After the PR is merged, delete the clone manually:
```bash
rm -rf ~/Code/herdctl-issues/issue-<N>
```
</context>

<process>

<step name="parse_argument">
Extract the issue number from the command arguments.

**Validation:**
- The argument must be a single positive integer
- If no argument or an invalid argument is provided, report an error and stop
</step>

<step name="fetch_issue">
Fetch the issue details from GitHub:

```bash
gh issue view <N> --repo edspencer/herdctl --json number,title,body,labels,state
```

**Validation:**
- The issue must exist (gh returns 0)
- The issue must be in "OPEN" state
- If not found or not open, report the error and stop

Store the issue number, title, and body for the worker prompt.
</step>

<step name="clone_and_setup">
Clone the repo and set up the working environment.

```bash
mkdir -p ~/Code/herdctl-issues
git clone git@github.com:edspencer/herdctl.git ~/Code/herdctl-issues/issue-<N>
cd ~/Code/herdctl-issues/issue-<N>
git checkout -b fix/issue-<N>
pnpm install
```

If the clone directory already exists, report the conflict and stop. Do not overwrite an existing clone.
</step>

<step name="launch_worker">
Launch a Claude Code worker in the clone directory using Bash tool with `run_in_background: true`.

Construct the worker prompt by filling in the `<worker_prompt_template>` below with the issue's number, title, and body.

Write the filled prompt to a file in the clone, then launch via stdin to avoid shell escaping issues:

```bash
cd ~/Code/herdctl-issues/issue-<N> && \
cat worker-prompt.txt | claude -p - \
  --dangerously-skip-permissions \
  --model claude-opus-4-20250514 \
  2>&1 | tee ~/Code/herdctl-issues/issue-<N>/claude-worker.log
```

**Record the background task ID** returned by the Bash tool. You need it for monitoring.

Report to the user:
```
## Worker Launched

Issue: #<N> — <title>
Clone: ~/Code/herdctl-issues/issue-<N>/
Task ID: <id>

Monitoring progress... (checking every 60 seconds)
```
</step>

<step name="monitor_worker">
Poll the worker's status once per minute until it finishes.

**Loop:**
1. Wait 60 seconds using `sleep 60` in a Bash call
2. Check status using all three methods in parallel:

**a. Check if the background task is still running:**
Use `TaskOutput` with `block: false` on the recorded task ID.

**b. Parse the worker's JSONL session file for progress:**
The worker's session is stored at:
```
~/.claude/projects/-Users-ed-Code-herdctl-issues-issue-<N>/
```

Find the `.jsonl` file and parse it:

```bash
JSONL_FILE=$(ls -t ~/.claude/projects/-Users-ed-Code-herdctl-issues-issue-<N>/*.jsonl 2>/dev/null | head -1)
if [ -n "$JSONL_FILE" ]; then
  cat "$JSONL_FILE" | python3 -c "
import sys, json
tool_calls = []
last_message = ''
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'text' and block['text'].strip():
                    last_message = block['text'].strip()[:150]
                elif block.get('type') == 'tool_use':
                    name = block.get('name', '')
                    inp = block.get('input', {})
                    if name == 'Bash':
                        tool_calls.append(f'Bash: {inp.get(\"description\", inp.get(\"command\", \"\")[:60])}')
                    elif name in ('Read', 'Edit', 'Write'):
                        tool_calls.append(f'{name}: {inp.get(\"file_path\", \"\").split(\"/\")[-1]}')
                    elif name == 'Grep':
                        tool_calls.append(f'Grep: \"{inp.get(\"pattern\", \"\")}\"')
                    else:
                        tool_calls.append(name)
    except: pass
print(f'Tool calls: {len(tool_calls)}')
if tool_calls:
    print(f'Last tool: {tool_calls[-1]}')
if last_message:
    print(f'Status: {last_message}')
"
fi
```

**c. Check for a PR:**
```bash
gh pr list --repo edspencer/herdctl --head fix/issue-<N> --json number,url 2>/dev/null
```

**After each check, report a compact status line:**
```
## Status Check (<X> min elapsed)
Issue #<N>: <tool_count> tool calls | Last: "<last activity>" | PR: <link or "pending">
```

**When the task completes:**
- Read the full `TaskOutput` to get the worker's final summary
- Check the exit code (0 = success)
- Check if a PR was created
- Exit the loop
</step>

<step name="report_result">
Report the final result:

**If successful (exit code 0 and PR exists):**
```
## Issue #<N> Complete

**Result:** Success
**PR:** #<pr_number> <pr_url>
**Worker summary:** <paste the worker's final output>

### Cleanup (after PR is merged)
  rm -rf ~/Code/herdctl-issues/issue-<N>
```

**If failed (non-zero exit code or no PR):**
```
## Issue #<N> Failed

**Result:** Worker exited with code <X> / No PR was created
**Session log:** ~/.claude/projects/-Users-ed-Code-herdctl-issues-issue-<N>/<session-id>.jsonl

Check the session log for details on what went wrong.
```
</step>

</process>

<worker_prompt_template>
You are fixing GitHub issue #{{NUMBER}} for the herdctl project.

**Issue:** {{TITLE}}

**Description:**
{{BODY}}

You are in a fresh clone of the repository on branch `fix/issue-{{NUMBER}}`. Dependencies are already installed.

## Instructions

Follow these steps in order:

### 1. Understand the project
Read the project's CLAUDE.md at the repo root to understand conventions, architecture, and quality gates.

### 2. Explore the relevant code
Search the codebase to understand the code paths related to this issue. Use Glob and Grep to find relevant files, then Read them to understand the implementation.

### 3. Implement the fix
Make the necessary code changes. Keep changes focused and minimal — fix the issue without unnecessary refactoring.

### 4. Run quality gates
Run all three quality checks and fix any failures before proceeding:
```bash
pnpm typecheck
pnpm test
pnpm build
```
If any check fails, fix the issue and re-run until all three pass.

### 5. Create a changeset
If you modified code in any package under `packages/`, you MUST create a changeset file. Determine the correct package name(s) and bump type:
- `patch` for bug fixes
- `minor` for new features
- `major` for breaking changes

Create the changeset file directly:
```bash
cat > .changeset/issue-{{NUMBER}}.md << 'CHANGESET_EOF'
---
"@herdctl/PACKAGE_NAME": patch
---

Brief description of what was fixed
CHANGESET_EOF
```
Replace PACKAGE_NAME with the actual package (core, cli, web, chat, discord, slack) and adjust the bump type.

### 6. Commit
Stage ONLY the files you changed — never use `git add -A` or `git add .`:
```bash
git add <specific files>
```

Commit with a conventional commit message:
```bash
git commit -m "fix: <concise description of the fix>

Fixes #{{NUMBER}}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 7. Push and create PR
Push the branch and create a pull request:
```bash
git push -u origin fix/issue-{{NUMBER}}
```

Then create the PR:
```bash
gh pr create --title "fix: <description> (#{{NUMBER}})" --body "$(cat <<'PR_EOF'
## Summary
<1-3 bullet points describing what was changed and why>

Fixes #{{NUMBER}}

## Test plan
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PR_EOF
)"
```

## Important rules
- NEVER use `git add -A` or `git add .` — stage specific files only
- NEVER skip quality gates — all three must pass before committing
- ALWAYS create a changeset if package code was modified
- Keep changes minimal and focused on the issue
</worker_prompt_template>

<success_criteria>
- [ ] Issue number parsed and validated
- [ ] Issue fetched from GitHub and confirmed open
- [ ] Repo cloned to ~/Code/herdctl-issues/issue-<N>/
- [ ] Fix branch created and dependencies installed
- [ ] Claude Code worker launched in clone with correct prompt
- [ ] Worker monitored every 60 seconds with progress updates
- [ ] Final result reported with PR link (or failure details)
</success_criteria>
