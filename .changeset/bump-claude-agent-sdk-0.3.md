---
"@herdctl/core": minor
---

Bump `@anthropic-ai/claude-agent-sdk` from `^0.1.0` (resolved 0.1.77) to
`^0.3.0` (resolves 0.3.205).

The pinned `^0.1.0` range could not cross a `0.x` minor, freezing herdctl on a
stale SDK line whose bundled JS harness lacks the current agentic toolset
(`ScheduleWakeup`, `ToolSearch`, `Cron*`, `Monitor`, …). `0.3.x` drops the
bundled harness and instead extracts/runs the native Claude Code binary, which
carries those tools — unblocking cross-turn autonomy (e.g. a persistent
`openSession()` agent scheduling `ScheduleWakeup` and being re-invoked when it
fires).

Adapts the SDK adapter surface to the 0.3.x types:

- `Query.interrupt()` now resolves to an optional interrupt-receipt object
  instead of `void`; the streaming `RuntimeSession.interrupt()` awaits and
  discards it to keep its fire-and-forget `Promise<void>` contract.
- The SDK's `tool()` handler return type now uses a literal-typed MCP
  `CallToolResult`; the injected-MCP adapter casts `InjectedMcpToolDef.handler`
  at that boundary so the transport-agnostic tool definition stays SDK-free.

No `@herdctl/core` public API changes. `query()`, `createSdkMcpServer()`,
`tool()`, streaming-input `AsyncIterable<SDKUserMessage>`, and the `Query`
control methods (`interrupt`, `supportedCommands`, `setModel`) all remain
compatible. Note: the SDK peer-depends on `zod@^4`, while core stays on
`zod@^3`; the schemas passed to `tool()` remain structurally compatible and
typecheck/build/tests are green.
