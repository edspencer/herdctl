---
"@herdctl/core": minor
"@herdctl/chat": minor
---

Add programmatic agent management, convenience session access, and a reusable SDK message translator.

Motivated by apps built on top of herdctl (e.g. paddock) that manage agents in
memory rather than on disk.

**`@herdctl/core` — `FleetManager`:**

- `addAgent(agent, options?)` / `removeAgent(name)` register and unregister an
  agent at runtime without hand-writing YAML and calling `reload()`. The agent
  config is validated, merged with fleet `defaults`, normalized (relative
  `working_directory` resolved to an absolute path), wired into the scheduler,
  and surfaced in fleet status — so it is immediately triggerable. A
  `config:reloaded` event is emitted describing the change. `addAgent` supports
  `{ baseDir, mergeDefaults, replace }`.
- `getAgentSessions(name, options?)` and `getAgentSessionMessages(name,
  sessionId)` derive the agent's working directory and Docker mode from the
  loaded config and wrap `SessionDiscoveryService`, so consumers no longer map
  agent slug → working directory by hand.

**`@herdctl/chat` — SDK message translation:**

- `SDKMessageTranslator` and the `createSDKMessageHandler` factory provide a
  transport-agnostic translation of the `SDKMessage` stream from
  `trigger({ onMessage })` into chat-UI events: assistant text deltas,
  boundaries between assistant turns, and paired tool calls (a `tool_use`
  matched to its `tool_result`, enriched with an input summary and wall-clock
  duration). This extracts logic previously reimplemented per connector.

All additions are backward compatible; no existing behavior changes.
