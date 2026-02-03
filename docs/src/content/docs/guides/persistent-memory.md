---
title: Persistent Memory
description: Give agents memory that persists across runs
---

By default, each agent job starts fresh with no memory of previous runs. This guide shows how to give agents persistent memory using a context file pattern.

## The Problem

Without persistent memory, agents:
- Can't track progress over time
- Repeat the same work each run
- Can't learn from previous results
- Have no historical context

## The Solution

Agents can maintain a **context file** (typically `context.md`) that persists between runs:

1. At job start: Read the context file
2. During execution: Use context to inform decisions
3. At job end: Update the context file with results

## Basic Implementation

### Agent Configuration

```yaml
name: my-agent
description: An agent with persistent memory

system_prompt: |
  ## Context Management

  You maintain a `context.md` file in the current directory.

  At the START of each run:
  1. Read context.md to understand your configuration and history
  2. If context.md doesn't exist, create it with sensible defaults

  At the END of each run:
  1. Update context.md with the results of this run
  2. Include timestamp and relevant data

allowed_tools:
  - Read
  - Write
  - Edit
  # Add other tools your agent needs
```

### Context File Structure

A well-structured context file might look like:

```markdown
# Agent Context

## Configuration
- **Target**: Office chairs under $200
- **Retailers**: Staples, IKEA
- **Check Frequency**: Every 4 hours

## Current Status
- **Last Check**: 2024-01-15 09:00 UTC
- **Status**: Monitoring
- **Active Alerts**: None

## History
| Date | Event | Notes |
|------|-------|-------|
| 2024-01-15 | Price check | Staples $159, IKEA $299 |
| 2024-01-14 | Price check | Staples $179, IKEA $299 |
| 2024-01-13 | Started | Initial configuration |
```

## Managing History Growth

Without limits, history can grow indefinitely. Instruct your agent to maintain a bounded history:

```yaml
system_prompt: |
  ## Context Management

  When updating context.md:
  - Keep only the last 10 history entries
  - Delete older entries to prevent file growth
  - Always include the most recent result
```

Example bounded history section:

```markdown
## Recent History (Last 10 Checks)
| Date | Staples Price | IKEA Price | Notes |
|------|---------------|------------|-------|
| 2024-01-15 09:00 | $159.99 | $299.99 | Below target! |
| 2024-01-15 05:00 | $159.99 | $299.99 | |
| 2024-01-14 21:00 | $179.99 | $299.99 | |
...
```

## Advanced Patterns

### Structured JSON Context

For more complex state, use JSON:

```yaml
system_prompt: |
  You maintain state in `context.json`. Example structure:
  ```json
  {
    "config": {
      "target": "office chair",
      "maxPrice": 200
    },
    "lastCheck": "2024-01-15T09:00:00Z",
    "history": [
      {"date": "2024-01-15", "price": 159.99, "retailer": "Staples"}
    ]
  }
  ```

  Keep history array to last 10 entries.
```

### Separate Files for Different Purposes

For complex agents, use multiple files:

```yaml
system_prompt: |
  You maintain several files:
  - `config.json` - User preferences (rarely changes)
  - `state.json` - Current monitoring state
  - `history.jsonl` - Append-only log of events

  Read all at start. Update state.json and history.jsonl at end.
```

### Conditional Context Updates

Only update context when meaningful changes occur:

```yaml
system_prompt: |
  Update context.md only when:
  - Price changes from previous check
  - New alert condition is triggered
  - Configuration changes

  If no changes, just update the "Last Check" timestamp.
```

## Example: Hurricane Watcher

The [hurricane-watcher example](/guides/examples/#hurricane-watcher) demonstrates this pattern:

```yaml
name: hurricane-watcher
description: Monitors hurricane activity

system_prompt: |
  You maintain a `context.md` file to remember state between runs.

  ## Context File Structure

  ```markdown
  # Hurricane Watcher Context

  ## Configuration
  - **Monitoring Location**: [city, state/country]
  - **Check Frequency**: [how often you expect to run]
  - **Alert Threshold**: [threat level that triggers concern]

  ## Current Status
  - **Last Check**: [timestamp]
  - **Current Threat Level**: [NONE/LOW/MODERATE/HIGH/EXTREME]
  - **Active Storms**: [count and names if any]

  ## Recent History
  | Date | Threat Level | Notable Events |
  |------|--------------|----------------|
  | ... | ... | ... |
  ```

  Keep history to last 10 entries.

allowed_tools:
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Edit
```

## Excluding Context from Git

Add runtime context files to `.gitignore`:

```bash
# .gitignore
context.md
context.json
state.json
*.jsonl
metadata.json
```

This keeps your repository clean while allowing local state persistence.

## Combining with Metadata

Use context for long-term memory and [metadata](/concepts/hooks/#agent-metadata) for hook triggers:

```yaml
metadata_file: metadata.json

system_prompt: |
  ## Files You Maintain

  1. **context.md** - Long-term memory and history
  2. **metadata.json** - Current run results for notifications

  At the end of each run:
  1. Update context.md with results and history
  2. Write metadata.json for conditional hooks:
     ```json
     {
       "shouldNotify": true,
       "summary": "Price dropped to $159"
     }
     ```

hooks:
  after_run:
    - type: discord
      when: "metadata.shouldNotify"
      channel_id: "..."
      bot_token_env: DISCORD_BOT_TOKEN
```

## Best Practices

### DO

- **Use markdown for human-readable context** - Easy to review and debug
- **Bound history growth** - Prevent unlimited file growth
- **Include timestamps** - Know when data was recorded
- **Structure consistently** - Make it easy for the agent to parse
- **Exclude from git** - Keep runtime state out of version control

### DON'T

- **Store secrets in context** - Use environment variables instead
- **Allow unlimited growth** - Agent will eventually hit context limits
- **Rely on complex parsing** - Keep format simple and predictable
- **Mix config and state** - Separate what changes from what doesn't

## Troubleshooting

### Context file keeps growing

Add explicit instructions to limit history:

```yaml
system_prompt: |
  IMPORTANT: Keep the history section to exactly 10 entries.
  Delete the oldest entries when adding new ones.
```

### Agent doesn't read context

Ensure Read tool is allowed:

```yaml
allowed_tools:
  - Read  # Required for reading context
  - Write
  - Edit
```

### Agent creates inconsistent format

Provide explicit examples in your system prompt:

```yaml
system_prompt: |
  Your context.md MUST follow this exact format:
  ```markdown
  # Context

  ## Status
  - Last Check: [ISO timestamp]
  - Result: [one-line summary]

  ## History
  | Date | Result |
  |------|--------|
  | [date] | [result] |
  ```
```

## Related Pages

- [Agent Configuration](/configuration/agent-config/) — Full configuration reference
- [Hooks](/concepts/hooks/) — Combine with metadata for conditional actions
- [Example Projects](/guides/examples/) — Working examples with persistent memory
