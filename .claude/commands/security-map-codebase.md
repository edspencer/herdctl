---
name: security-map-codebase
description: Spawn 4 parallel security mapper agents to analyze codebase security
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
Analyze codebase security using 4 parallel mapper agents.

Each mapper agent explores a security domain and writes documents directly to `.security/codebase-map/`. The orchestrator only receives confirmations to minimize context usage.

Output: 4 security analysis documents in `.security/codebase-map/`:
- ATTACK-SURFACE.md - Entry points, trust boundaries, defenses
- DATA-FLOWS.md - Source-to-sink data flows, validation gaps
- SECURITY-CONTROLS.md - Defense inventory with coverage and gaps
- THREAT-VECTORS.md - herdctl-specific threats with residual risk ratings
</objective>

<context>
**When to run this command:**
- After significant code changes (new features, refactors)
- When security mapping is stale (>=7 days OR >=15 commits since last mapping)
- Before security audits to ensure up-to-date codebase understanding
- When onboarding to understand security posture

**What agents produce:**
Each agent writes directly to disk and returns only confirmation. This keeps orchestrator context clean and enables thorough analysis documents.

**State tracking:**
Mapping date is tracked in `.security/STATE.md` frontmatter:
- `last_mapping: YYYY-MM-DD` - Date of last mapping
- `commits_since_mapping: N` - Commits since last mapping
</context>

<process>

<step name="check_staleness">
Check if mapping is needed based on staleness thresholds.

```bash
# Read last mapping from STATE.md frontmatter
LAST_MAPPING=$(grep "^last_mapping:" .security/STATE.md 2>/dev/null | awk '{print $2}')

# Check if never mapped
if [ "$LAST_MAPPING" = "null" ] || [ -z "$LAST_MAPPING" ]; then
  echo "MAPPING_NEEDED: Never mapped"
  MAPPING_NEEDED=true
else
  # macOS-compatible date calculation
  if [[ "$OSTYPE" == "darwin"* ]]; then
    LAST_TS=$(date -j -f "%Y-%m-%d" "$LAST_MAPPING" +%s 2>/dev/null || echo 0)
  else
    LAST_TS=$(date -d "$LAST_MAPPING" +%s 2>/dev/null || echo 0)
  fi
  NOW_TS=$(date +%s)
  DAYS_SINCE=$(( ($NOW_TS - $LAST_TS) / 86400 ))

  # Count commits since last mapping
  COMMITS_SINCE=$(git log --since="$LAST_MAPPING" --oneline 2>/dev/null | wc -l | tr -d ' ')

  # Stale thresholds: 7 days OR 15 commits
  if [ "$DAYS_SINCE" -ge 7 ] || [ "$COMMITS_SINCE" -ge 15 ]; then
    echo "MAPPING_NEEDED: ${DAYS_SINCE} days, ${COMMITS_SINCE} commits since last mapping"
    MAPPING_NEEDED=true
  else
    echo "MAPPING_CURRENT: ${DAYS_SINCE} days, ${COMMITS_SINCE} commits since last mapping"
    echo ""
    echo "Mapping is current. To force remapping, delete last_mapping from .security/STATE.md"
    MAPPING_NEEDED=false
  fi
fi
```

**If mapping is not needed:**
Report status and exit. User can force remapping by setting `last_mapping: null` in STATE.md.

**If mapping is needed:**
Continue to next step.
</step>

<step name="resolve_model">
Resolve model from config profile for agent spawning.

```bash
MODEL_PROFILE=$(cat .planning/config.json 2>/dev/null | grep -o '"model_profile"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' || echo "balanced")
echo "Model profile: $MODEL_PROFILE"
```

**Model lookup table for security mappers:**

| Profile | Model |
|---------|-------|
| quality | sonnet |
| balanced | haiku |
| budget | haiku |

Store resolved model for agent spawning.
</step>

<step name="create_output_directory">
Create output directory for mapping documents.

```bash
mkdir -p .security/codebase-map
```

This must run BEFORE spawning agents or they will fail with ENOENT errors.
</step>

<step name="spawn_mapper_agents">
Spawn 4 parallel mapper agents using Task tool with `run_in_background: true`.

**Agent 1: Attack Surface Mapper**

Use Task tool with:
- subagent_type: "attack-surface-mapper"
- model: "{resolved_model}"
- run_in_background: true
- description: "Map codebase attack surface"

Prompt:
```
You are the attack-surface-mapper agent.

Map all entry points, APIs, and trust boundaries in the herdctl codebase.

Write your analysis to `.security/codebase-map/ATTACK-SURFACE.md` using the template in your agent definition.

Return confirmation only (file path and line count), not document contents.
```

**Agent 2: Data Flow Tracer**

Use Task tool with:
- subagent_type: "data-flow-tracer"
- model: "{resolved_model}"
- run_in_background: true
- description: "Trace security data flows"

Prompt:
```
You are the data-flow-tracer agent.

Trace how user-controlled data flows from entry points to sensitive operations in the herdctl codebase.

Write your analysis to `.security/codebase-map/DATA-FLOWS.md` using the template in your agent definition.

Return confirmation only (file path and line count), not document contents.
```

**Agent 3: Security Controls Mapper**

Use Task tool with:
- subagent_type: "security-controls-mapper"
- model: "{resolved_model}"
- run_in_background: true
- description: "Inventory security controls"

Prompt:
```
You are the security-controls-mapper agent.

Inventory all security controls and defenses in the herdctl codebase, documenting coverage and gaps.

Write your analysis to `.security/codebase-map/SECURITY-CONTROLS.md` using the template in your agent definition.

Return confirmation only (file path and line count), not document contents.
```

**Agent 4: Threat Vector Analyzer**

Use Task tool with:
- subagent_type: "threat-vector-analyzer"
- model: "{resolved_model}"
- run_in_background: true
- description: "Analyze threat vectors"

Prompt:
```
You are the threat-vector-analyzer agent.

Identify attack patterns specifically relevant to herdctl, assessing them against actual controls.

Write your analysis to `.security/codebase-map/THREAT-VECTORS.md` using the template in your agent definition.

Return confirmation only (file path and line count), not document contents.
```

All 4 agents run in parallel. Wait for all to complete before proceeding.
</step>

<step name="verify_output">
Verify all 4 mapping documents were created with substantial content.

```bash
# Check all 4 files exist
EXPECTED_FILES=(
  ".security/codebase-map/ATTACK-SURFACE.md"
  ".security/codebase-map/DATA-FLOWS.md"
  ".security/codebase-map/SECURITY-CONTROLS.md"
  ".security/codebase-map/THREAT-VECTORS.md"
)

MISSING=()
for f in "${EXPECTED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    MISSING+=("$f")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Missing files: ${MISSING[*]}"
  echo "Agent execution may have failed. Check agent output for errors."
  exit 1
fi

# Show line counts (should be >50 each)
echo "Document line counts:"
wc -l .security/codebase-map/*.md

# Verify minimum content
for f in "${EXPECTED_FILES[@]}"; do
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -lt 50 ]; then
    echo "WARNING: $f has only $lines lines (expected >50)"
  fi
done

echo ""
echo "All 4 mapping documents created successfully."
```

**If verification fails:**
- Check agent error messages
- Verify agent definitions exist in `.claude/agents/security/`
- Debug specific agent failures

**If verification passes:**
Continue to update STATE.md.
</step>

<step name="update_state">
Update `.security/STATE.md` frontmatter with new mapping date.

```bash
TODAY=$(date +%Y-%m-%d)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Update frontmatter fields
sed -i '' "s/^last_mapping:.*/last_mapping: $TODAY/" .security/STATE.md
sed -i '' "s/^last_updated:.*/last_updated: $NOW/" .security/STATE.md
sed -i '' "s/^commits_since_mapping:.*/commits_since_mapping: 0/" .security/STATE.md
```

Also update the Coverage Status table in STATE.md:

Use Edit tool to update each coverage area:
- Attack surface: Set to today's date, 0 commits, "Current"
- Data flows: Set to today's date, 0 commits, "Current"
- Security controls: Set to today's date, 0 commits, "Current"
- Threat vectors: Set to today's date, 0 commits, "Current"
</step>

<step name="commit_results">
Commit the mapping documents and state update.

Check planning config for commit behavior:
```bash
COMMIT_DOCS=$(cat .planning/config.json 2>/dev/null | grep -o '"commit_docs"[[:space:]]*:[[:space:]]*[^,}]*' | grep -o 'true\|false' || echo "true")
```

**If commit_docs is true (default):**

```bash
git add .security/codebase-map/ATTACK-SURFACE.md
git add .security/codebase-map/DATA-FLOWS.md
git add .security/codebase-map/SECURITY-CONTROLS.md
git add .security/codebase-map/THREAT-VECTORS.md
git add .security/STATE.md

git commit -m "security: update codebase security mapping

- Attack surface: entry points and trust boundaries
- Data flows: source-to-sink analysis
- Security controls: defense inventory
- Threat vectors: herdctl-specific threats

Generated by /security-map-codebase
"
```

**If commit_docs is false:**
Skip commit, report that files exist locally but won't be committed.
</step>

<step name="report_completion">
Report mapping completion with summary.

```
## Security Mapping Complete

**Documents created:**
- `.security/codebase-map/ATTACK-SURFACE.md` (N lines)
- `.security/codebase-map/DATA-FLOWS.md` (N lines)
- `.security/codebase-map/SECURITY-CONTROLS.md` (N lines)
- `.security/codebase-map/THREAT-VECTORS.md` (N lines)

**State updated:**
- `last_mapping: YYYY-MM-DD`
- `commits_since_mapping: 0`

**Next steps:**
- Run `/security-audit` for incremental security review
- Review threat vectors for accepted risks
- Check security controls for gaps
```
</step>

</process>

<success_criteria>
- [ ] Staleness check correctly identifies when mapping is needed
- [ ] All 4 mapper agents spawned in parallel
- [ ] Each agent writes directly to `.security/codebase-map/`
- [ ] All 4 documents exist with substantial content (>50 lines each)
- [ ] `.security/STATE.md` frontmatter updated with new mapping date
- [ ] Coverage Status table updated for all 4 mapping areas
- [ ] Changes committed (if commit_docs=true)
- [ ] Completion report with line counts shown
</success_criteria>
