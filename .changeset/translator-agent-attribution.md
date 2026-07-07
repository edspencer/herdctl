---
"@herdctl/chat": minor
---

The SDK message translator now preserves agent attribution so consumers can
separate the main agent from `Task`-spawned subagents into per-agent lanes.

Every emitted event carries the originating agent's `parent_tool_use_id`
(`null` = main agent, else the spawning `Task` tool_use id):

- `onText(text, attribution)` and `onBoundary(attribution)` receive an
  `AgentAttribution` argument.
- `TranslatedToolCall` gains a `parentToolUseId` field (attributed to the agent
  that issued the tool_use, falling back to the result message's own attribution).

New `AgentAttribution` type and `getAgentAttribution(message)` helper are exported
from `@herdctl/chat`. The change is additive — existing handlers that ignore the
new argument/field keep working unchanged.
