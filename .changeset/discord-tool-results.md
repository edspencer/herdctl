---
"@herdctl/core": minor
"@herdctl/discord": minor
---

Show tool results, system status, errors, and result summaries as Discord embeds

Previously, when Claude used tools like Bash during a Discord conversation, only text responses were shown - tool outputs were silently dropped. Now tool results appear as compact Discord embeds with:

- Tool name and emoji (Bash, Read, Write, Edit, Grep, Glob, WebSearch, etc.)
- Input summary (the command, file path, or search pattern)
- Duration of the tool call
- Output length and truncated result in a code block
- Color coding: blurple for success, red for errors

Additional SDK message types are now surfaced in Discord:

- System status messages (e.g., "Compacting context...") shown as gray embeds
- SDK error messages shown as red error embeds
- Optional result summary embed with duration, turns, cost, and token usage

All output types are configurable via the new `output` block in agent Discord config:

```yaml
chat:
  discord:
    output:
      tool_results: true          # Show tool result embeds (default: true)
      tool_result_max_length: 900 # Max chars in output (default: 900, max: 1000)
      system_status: true         # Show system status embeds (default: true)
      result_summary: false       # Show completion summary (default: false)
      errors: true                # Show error embeds (default: true)
```

The reply function now accepts both plain text and embed payloads, allowing rich message formatting alongside streamed text responses.
