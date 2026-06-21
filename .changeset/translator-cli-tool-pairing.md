---
"@herdctl/chat": patch
---

Fix `SDKMessageTranslator` losing tool-call pairing on the CLI runtime.

On the CLI runtime, a user/tool_result message carries its result twice: as an
id-less top-level `tool_use_result` field AND as a nested
`message.content[]` `tool_result` block that DOES carry the `tool_use_id` and
`is_error`. The translator paired tool calls via core's `extractToolResults`,
which short-circuits on the top-level field and returns the id-less result — so
calls couldn't be matched back to their `tool_use` and rendered as a generic
`toolName: "Tool"` with no `inputSummary` or `durationMs`.

The translator now prefers the nested id-bearing `tool_result` blocks: when a
message has both shapes, it strips the id-less top-level field (on a shallow
clone — the SDK's object is never mutated) so extraction uses the nested,
id-bearing branch and restores correct name / input summary / duration / error
pairing. Messages that only carry a top-level `tool_use_result` (the SDK-runtime
shape) are unchanged.

This lets downstream apps (e.g. paddock) drop their `normalizeForTranslator()`
workaround.
