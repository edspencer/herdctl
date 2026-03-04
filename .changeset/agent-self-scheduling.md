---
"@herdctl/core": minor
---

Add agent self-scheduling via MCP server

Agents can now create, update, and delete their own schedules at runtime through a capability-gated MCP server. Enable with `self_scheduling.enabled: true` in agent config.

- Per-agent YAML store at `.herdctl/dynamic-schedules/<agent>.yaml`
- Standalone `herdctl-scheduler` stdio MCP server with 4 tools (create, list, update, delete)
- Auto-injected when `self_scheduling.enabled` is true — no manual MCP config needed
- Safety: namespace isolation, configurable max schedules, minimum interval enforcement, optional TTL
- Dynamic schedules merged with static in scheduler (static wins on name collision)
- `source: "static" | "dynamic"` tag on ScheduleInfo for fleet operator visibility
