---
"@herdctl/core": minor
---

Surface in-flight (unpaired) tool calls when rehydrating a transcript. `parseSessionMessages` now emits a `tool_use` block that has no matching `tool_result` yet as a `role:"tool"` message in a pending state (`ChatToolCall.pending: true`, empty output, no duration), and upgrades that same message in place — preserving its `uuid` and chronological position — when the `tool_result` later arrives. Previously an in-flight tool call was stashed and never emitted, so a running tool (e.g. a foreground `Agent`/Task sub-agent) vanished from the reconstructed history on page refresh (#399). Adds the optional `pending?: boolean` discriminator to the `ChatToolCall` interface so consumers can render a running spinner.
