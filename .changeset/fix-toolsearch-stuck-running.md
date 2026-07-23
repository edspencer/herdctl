---
"@herdctl/core": patch
---

Fix `ToolSearch` tool calls rendering as perpetually RUNNING when a transcript is rehydrated (#410)

`ToolSearch`'s `tool_result.content` is an array of `{ type: "tool_reference", tool_name }` blocks (the deferred-tool schemas it loads) — it carries no text and no image blocks. `extractToolResults`/`extractToolResultContent` only harvested `text` and `image` blocks, so such a result collected empty `text`/`images` and was silently dropped by the `if (text.length > 0 || images.length > 0)` guard. A dropped result never pairs with its pending `tool_use`, so the in-flight (#399) row it should upgrade stayed pending forever — the `ToolSearch` card showed RUNNING indefinitely, arbitrarily deep in old transcripts.

`collectContentBlocks` now recognizes `tool_reference` blocks and returns the referenced tool names; the array-content call sites render them into a one-line summary (`Loaded N tool schemas: …`) so the completed card shows what was loaded. The guard is also hardened: **a result carrying a valid `tool_use_id` is never discarded**, even when it has no text or images — that id is what the pairing depends on. Purely internal to transcript parsing; no API surface changes.
