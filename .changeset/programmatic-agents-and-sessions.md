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
- `deleteSession(name, sessionId)` resolves the agent's working dir + Docker
  mode from config, computes the CLI (or Docker) transcript file with the same
  encoder Claude Code uses, deletes it, invalidates the session-discovery cache,
  and returns whether a file was removed. The `sessionId` is validated (only
  `[A-Za-z0-9-]`) to reject path traversal before any filesystem access. Throws
  `InvalidStateError` before init and `AgentNotFoundError` for unknown agents,
  matching the other session helpers.
- `setSessionName(name, sessionId, customName)` sets (or, when passed `null` or
  an empty/whitespace string, clears) a session's custom display name via the
  fleet's shared `SessionMetadataStore` — the same store session discovery reads
  — so a subsequent `getAgentSessions` reflects the new `customName` immediately.
  Same init / agent-not-found error behavior as the other session helpers.

**`@herdctl/core` — new public exports:**

- `getCliSessionFile`, `getCliSessionDir`, `encodePathForCli` (and the Docker
  equivalents `getDockerSessionFile` / `getDockerSessionDir`) are now exported
  from the package root, so consumers can compute a session's transcript path
  without deep-importing `dist/runner/runtime/cli-session-path.js`.
- `SessionMetadataStore` is exported from the package root (it was already
  re-exported from the state module; this keeps the surface explicit for
  callers managing custom session names directly).
- `SessionDiscoveryService` accepts an optional shared `sessionMetadataStore`
  (and exposes `getSessionMetadataStore()`) so writers and the discovery reader
  can share one in-memory cache. Omitting it preserves the previous behavior.

**`@herdctl/core` — fixes:**

- **Throw the documented `InvalidStateError` (not `AgentNotFoundError`) when
  `getAgentSessions` / `getAgentSessionMessages` are called before
  `initialize()`.** The session helpers previously fell through to an agent
  lookup against a null config, masking the real cause. They now guard on
  initialization state first, matching their JSDoc.
- **Use a typed error for an invalid per-trigger `workingDirectory` override.**
  The override validation now throws `InvalidWorkingDirectoryOverrideError`
  (extending `FleetManagerError`, code `INVALID_WORKING_DIRECTORY_OVERRIDE`)
  instead of a raw `Error`, per the repo's typed-error guideline. The actionable
  message is unchanged.

- **Fix CLI session discovery for working directories with dots (and other
  non-alphanumerics).** `encodePathForCli` now matches Claude Code's actual
  cwd → transcript-directory encoding: it replaces every non-`[A-Za-z0-9]`
  character (path separators, `.`, `_`, `@`, etc.) with a hyphen, and applies
  Claude Code's 200-char truncate-and-hash fallback. Previously only path
  separators were replaced, so an agent whose `working_directory` contained a
  `.` resolved to the wrong `~/.claude/projects/<encoded>` directory and
  session discovery silently returned nothing.
- **Add a per-trigger working-directory override.** `TriggerOptions` gains an
  optional `workingDirectory` so a single agent can be triggered against
  different directories per call (e.g. one "sweeper" agent run across many
  project directories) instead of registering one agent per directory. When
  omitted, behavior is unchanged. The override flows into the process cwd / SDK
  `cwd` / Docker workspace mount, and session/transcript resolution for the job
  uses the effective (overridden) working directory. Absolute paths are used
  as-is; relative paths resolve against `process.cwd()`. Sessions remain keyed
  by cwd, so agent-level `getAgentSessions` (which uses the *configured*
  `working_directory`) won't surface sessions created under a different
  override directory — callers list those by scanning the override directory.

**`@herdctl/chat` — SDK message translation:**

- `SDKMessageTranslator` and the `createSDKMessageHandler` factory provide a
  transport-agnostic translation of the `SDKMessage` stream from
  `trigger({ onMessage })` into chat-UI events: assistant text deltas,
  boundaries between assistant turns, and paired tool calls (a `tool_use`
  matched to its `tool_result`, enriched with an input summary and wall-clock
  duration). This extracts logic previously reimplemented per connector.

All additions are backward compatible; no existing behavior changes.
