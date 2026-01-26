---
"@herdctl/core": minor
---

Add default_prompt agent config and getJobFinalOutput API

- Add `default_prompt` field to agent config schema for sensible defaults when triggering without --prompt
- Add `getJobFinalOutput(jobId)` method to FleetManager for retrieving agent's final response from JSONL
- Pass `maxTurns` option through to Claude SDK to limit agent turns
- Change SDK `settingSources` to empty by default - autonomous agents should not load Claude Code project settings (CLAUDE.md)
- Log hook output to console for visibility when shell hooks produce output
