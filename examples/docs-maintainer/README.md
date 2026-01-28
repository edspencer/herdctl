# Docs Maintainer Example

**The first real-world deployed use case for herdctl** - this example shows herdctl maintaining its own LLM-friendly documentation.

## What This Does

This fleet runs an agent that:

1. **Wakes up every 12 hours** on a schedule
2. **Checks for new commits** on the main branch since its last run
3. **Analyzes the commits** to see if documentation was affected
4. **Regenerates llms.txt files** if docs changed
5. **Creates a PR** with the updates

This is a perfect example of autonomous agent work - the agent monitors for changes, makes intelligent decisions about what needs updating, and creates PRs for human review.

## Files

```
docs-maintainer/
├── herdctl.yaml              # Fleet configuration
├── agents/
│   └── llms-txt-updater.yaml # Agent that maintains llms.txt
├── context.md                # State tracking (last processed commit)
└── README.md                 # This file
```

## Quick Start

### Prerequisites

- GitHub CLI (`gh`) authenticated
- Git configured with push access to the repository
- Claude Code CLI installed and authenticated

### Running the Fleet

```bash
cd examples/docs-maintainer

# Start the fleet (agent will check every 12 hours)
herdctl start

# Or trigger manually to test
herdctl trigger llms-txt-updater
```

### Manual Trigger

To force an immediate check:

```bash
herdctl trigger llms-txt-updater --prompt "Check for doc updates and regenerate llms.txt if needed"
```

## How It Works

### 1. Commit Tracking

The agent reads `context.md` to find the last commit SHA it processed. It then fetches new commits:

```bash
git fetch origin main
git log --oneline <last-sha>..origin/main
```

### 2. Change Detection

For each new commit, it checks which files changed:

```bash
git diff --name-only <old-sha>..<new-sha>
```

It looks for changes in:
- `docs/src/content/docs/**/*.md` - Direct documentation changes
- `docs/astro.config.mjs` - Navigation/sidebar changes
- `packages/*/src/**/*.ts` - API changes
- `packages/cli/**/*.ts` - CLI changes

### 3. Regeneration

If docs need updating, the agent:
1. Reads the current documentation structure from `astro.config.mjs`
2. Scans all doc pages in `docs/src/content/docs/`
3. Synthesizes the content into `llms.txt` (condensed) and `llms-full.txt` (complete)
4. Uses the `/update-llms-txt` slash command process

### 4. PR Creation

The agent creates a feature branch, commits changes, and opens a PR:

```bash
git checkout -b docs/update-llms-txt-20250127-120000
git add docs/public/llms.txt docs/public/llms-full.txt
git commit -m "docs: update llms.txt files"
git push -u origin HEAD
gh pr create --title "docs: update llms.txt files" --body "..."
```

### 5. State Persistence

After each run, the agent updates `context.md` with:
- The latest commit SHA processed
- Timestamp of the run
- Whether it updated or skipped
- A history of recent runs

## The Slash Command

This example uses the `/update-llms-txt` custom slash command defined in `.claude/commands/update-llms-txt.md`. The command provides detailed instructions for regenerating the llms.txt files.

You can also use this command manually:

```bash
cd /path/to/herdctl
claude "/update-llms-txt"
```

## What Are llms.txt Files?

The `llms.txt` format is an emerging standard for LLM-friendly documentation. Instead of forcing AI assistants to scrape and parse HTML documentation, `llms.txt` provides a condensed, machine-readable summary.

herdctl maintains two files:

| File | Purpose | Size |
|------|---------|------|
| `docs/public/llms.txt` | Condensed overview | ~3-5KB |
| `docs/public/llms-full.txt` | Complete reference | ~10-20KB |

When users ask Claude Code (or similar AI assistants) for help with herdctl, the AI can fetch these files to quickly understand the project without parsing the entire documentation site.

## Customization

### Change Check Frequency

Edit `agents/llms-txt-updater.yaml`:

```yaml
schedules:
  check-docs:
    type: interval
    interval: 6h  # Check every 6 hours instead
```

### Add Notifications

Add a hook to get notified when PRs are created:

```yaml
hooks:
  after_run:
    - type: shell
      command: |
        if [ -f metadata.json ]; then
          # Send notification via your preferred method
          curl -X POST https://your-webhook.com/notify \
            -d @metadata.json
        fi
```

### Track Different Branches

Modify the system prompt to track a different branch:

```yaml
system_prompt: |
  ...
  git fetch origin develop  # Track develop instead of main
  git log --oneline <last-sha>..origin/develop
  ...
```

## Why This Matters

This example demonstrates several key herdctl capabilities:

1. **Scheduled Autonomous Work** - The agent runs on its own schedule
2. **Stateful Operation** - Tracks what it has already processed
3. **Intelligent Decision Making** - Analyzes commits to decide if action is needed
4. **Git/GitHub Integration** - Creates branches and PRs automatically
5. **Self-Maintenance** - herdctl literally maintains its own documentation

It's a practical, real-world use case that runs in production on the herdctl repository itself.
