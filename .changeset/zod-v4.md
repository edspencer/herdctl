---
"@herdctl/core": minor
"@herdctl/chat": patch
---

Upgrade `zod` from `^3.22.0` to `^4.0.0` in `@herdctl/core` and `@herdctl/chat`.

This clears the peer-dependency mismatch introduced by
`@anthropic-ai/claude-agent-sdk@0.3.x`, which peer-depends on `zod@^4` (the SDK's
in-process MCP `tool()` schemas). Core and chat now resolve a single `zod@4`.

**Behavior-preserving.** zod v4 changed `.default()` to short-circuit: a
`z.object({...}).default({})` whose fields carry their own defaults now yields a
bare `{}` at runtime instead of the fully-defaulted object (v3 re-ran the value
through the schema). The three affected config sites — `work_source.labels`,
`work_source.auth`, and Discord `output` — were switched to zod v4's
`.prefault({})`, which restores the v3 semantics (an omitted block is still run
through the schema so nested field defaults are applied). Existing schema tests
that assert those omitted-block defaults continue to pass. All other `.default()`
sites use scalar/array defaults, which are unaffected.

Also updated the in-process MCP tool adapter's `tool()` handler cast to match
v4's stricter argument-shape inference.

No `@herdctl/core` or `@herdctl/chat` public API changes. Note that the exported
Zod schema objects are now v4 schemas; consumers composing them with their own
Zod instance should be on `zod@4`.
