# Programmatic agent management, convenience session access, and a reusable SDK message translator

> Branch: `feat/programmatic-agents` (based on `main`)
> Packages: `@herdctl/core` (minor), `@herdctl/chat` (minor)

## Motivation

[paddock](https://github.com/edspencer/paddock) is a project-first app built on
`@herdctl/core` (it wraps `FleetManager` to model projects as agents and chats
as sessions). While integrating against the public `@herdctl/core@5.10.x`
package, paddock identified three gaps where the public API forced it to
reimplement or work around herdctl internals. Each gap had a working app-layer
workaround, but each coupled paddock to herdctl's on-disk config format or
duplicated herdctl's message-handling. This PR closes all three. None of the
changes alter existing behavior — they are purely additive.

The gaps (from paddock's `docs/INTEGRATION.md`):

1. **No programmatic agent registration.** Adding an agent at runtime required
   writing a per-agent YAML file, regenerating `herdctl.yaml`, and calling
   `reload()` — coupling paddock to herdctl's on-disk config layout and forcing
   a full config re-read on every project create.
2. **No first-class session list on `FleetManager`.** Listing an agent's chats
   meant instantiating `SessionDiscoveryService` separately and passing each
   agent's `{ name, workingDirectory, dockerEnabled }` by hand — duplicating the
   slug→dir mapping and risking cwd/agent mismatch.
3. **No reusable SDKMessage → chat-event translation.** The logic that turns the
   `trigger({ onMessage })` stream into text deltas + paired tool calls lives in
   `@herdctl/web`'s `WebChatManager` (tangled with the dashboard) and was
   reimplemented in paddock's `ws.ts`.

## What changed

### `@herdctl/core` — `FleetManager` programmatic agent management

New module `packages/core/src/fleet-manager/agent-management.ts` (`AgentManagement`),
following the existing composed-module pattern (`ConfigReload`, `StatusQueries`,
…) and wired into `FleetManager`:

- `addAgent(agent, options?)` validates the config against `AgentConfigSchema`,
  merges fleet `defaults` (unless disabled), normalizes a relative
  `working_directory` to an absolute path, appends it to the in-memory
  `ResolvedConfig.agents`, pushes the new list to the scheduler via
  `scheduler.setAgents(...)`, and emits `config:reloaded`. The agent is
  immediately triggerable and visible in `getFleetStatus()` / `getAgentInfo()`.
- `removeAgent(name)` removes an agent by qualified or local name and updates the
  scheduler the same way. Running jobs are unaffected.

This reuses exactly the plumbing `reload()` already uses (config + scheduler +
`config:reloaded` event), so the new agents behave identically to file-loaded
ones — just without the file round-trip.

### `@herdctl/core` — `FleetManager` convenience session access

- `getAgentSessions(name, options?)` and `getAgentSessionMessages(name,
  sessionId)` look up the agent in the loaded config, derive its
  `working_directory` (via the existing `resolveWorkingDirectory` helper) and
  Docker mode (`docker.enabled`), and delegate to a lazily-created, internally
  cached `SessionDiscoveryService`. Consumers no longer map slug→dir by hand.

### `@herdctl/chat` — transport-agnostic SDK message translator

New module `packages/chat/src/sdk-message-translator.ts`:

- `SDKMessageTranslator` is a stateful translator: feed each `SDKMessage` into
  `.handle(m)` and it emits assistant **text deltas** (`onText`), **boundaries**
  between assistant turns (`onBoundary`), and **paired tool calls**
  (`onToolCall`) — a `tool_use` matched to its later `tool_result`, enriched
  with an input summary (`getToolInputSummary`) and a wall-clock duration. The
  clock is injectable for deterministic tests; `toolResults: false` suppresses
  `onToolCall` while keeping boundaries correct.
- `createSDKMessageHandler(handlers, options?)` returns a ready-to-use
  `onMessage` callback bound to a fresh translator.

This extracts the translation that `@herdctl/web`'s `WebChatManager` performs
inline (duplicated between `sendMessage` and `sendAdhocMessage`) into one reusable
helper. It is built on existing `@herdctl/chat` primitives (`extractMessageContent`,
`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`).

### `@herdctl/core` — fix: CLI session discovery for dotted working directories

paddock found that listing an agent's chats returned nothing when the agent's
working directory contained a `.` (dot). Claude Code encodes a cwd into its
transcript directory under `~/.claude/projects/<encoded>/`, and herdctl's
`encodePathForCli` (in `packages/core/src/runner/runtime/cli-session-path.ts`)
did not match that encoding for `.` (or `_`, `@`, etc.) — it only replaced path
separators.

The exact Claude Code rule was confirmed **empirically**:

- Real directories under `~/.claude/projects/` match the slash-only mapping
  (`/Users/ed/herds/personal/homelab` ⇄ `-Users-ed-herds-personal-homelab`).
- Claude Code's bundled encoder is `H.replace(/[^a-zA-Z0-9]/g, "-")` followed by
  a 200-char truncate-and-hash fallback (the `Aj`/`ex` functions).
- A live Claude run in `/tmp/cc-enc-test/with.dot` created the directory
  `~/.claude/projects/-private-tmp-cc-enc-test-with-dot` — the dot in `with.dot`
  became `-with-dot`, exactly as the rule predicts (and `/tmp` was resolved via
  `realpath` to `/private/tmp` first).

`encodePathForCli` now replaces every non-`[A-Za-z0-9]` character with a hyphen
and applies the same 200-char truncate + stable-hash fallback, so dotted /
underscored / special-char working directories resolve to the correct transcript
directory. The existing encode → decode → re-encode round-trip in
`getAllSessions` is preserved (both `.` and `/` map to `-`, and the display
decoder maps `-` → `/`, re-encoding to the same directory name).

### `@herdctl/core` — fix: per-trigger working-directory override

Today an agent's `working_directory` is fixed at registration, so paddock must
register one agent per project — and now one *sweeper* agent per project too. A
per-trigger override lets a **single** agent be triggered against different
working directories per call.

`TriggerOptions` gains an optional `workingDirectory?: string`:

```ts
interface TriggerOptions {
  // ...existing fields...
  /** Override the agent's configured working directory for this trigger only. */
  workingDirectory?: string;
}
```

- Absolute paths are used as-is; relative paths resolve against `process.cwd()`.
- When omitted, behavior is **identical** to today (the agent's configured
  `working_directory` is used).
- Validated to be a non-empty string; an empty/blank override throws.

It is threaded through the full trigger path by building an "effective agent" —
a shallow clone of the resolved agent with its `working_directory` replaced — at
a single chokepoint in `FleetManager.trigger` → `JobControl.trigger`. Because
every cwd-dependent consumer reads `agent.working_directory`, the override
automatically reaches all of them:

- `RuntimeFactory.create(effectiveAgent, …)` and the CLI runtime's process cwd
  (and its `getCliSessionDir(cwd)` / `getCliSessionFile(cwd, …)` session lookup);
- `toSDKOptions(effectiveAgent)` → the SDK runtime's `cwd`;
- the Docker path — `buildContainerMounts(effectiveAgent, …)` mounts the override
  directory at `/workspace` (the container-internal cwd stays `/workspace`, and
  Docker sessions remain flat in `.herdctl/docker-sessions/`);
- session/transcript resolution and session-staleness validation in
  `JobExecutor`, plus the `after_run` hook cwd.

The original config object is never mutated, so concurrent/subsequent triggers of
the same agent are unaffected.

**How paddock collapses N sweeper agents into one.** Instead of registering a
sweeper agent per project, register a single sweeper and trigger it per project:

```ts
// Before: one sweeper agent per project (N registrations).
// After: one sweeper agent, triggered against each project directory.
for (const project of projects) {
  await fleet.trigger("sweeper", undefined, {
    prompt: "Sweep this project",
    workingDirectory: project.dir,   // absolute path
  });
}
```

**Honest limitation — session continuity across cwds.** Sessions are keyed by
working directory (Claude Code stores transcripts under the encoded cwd).
`fleet.getAgentSessions(name)` / `getAgentSessionMessages(name, …)` derive the
directory from the agent's *configured* `working_directory`, so they will **not**
surface sessions created under a different override cwd. When you use overrides,
list/read those sessions by scanning the override directory (e.g. the
directory-grouped `getAllSessions` view), and pass `resume` explicitly for
continuity — the per-trigger resume + override together resolve the right
transcript directory. This is documented on `TriggerOptions.workingDirectory` and
`FleetManager.getAgentSessions`.

## New public API signatures

```ts
// @herdctl/core — FleetManager
interface AddAgentOptions {
  baseDir?: string;        // resolve relative working_directory (default: config dir / cwd)
  mergeDefaults?: boolean; // merge fleet defaults (default: true)
  replace?: boolean;       // overwrite an existing agent (default: false)
}

class FleetManager {
  addAgent(
    agent: AgentConfig | (Record<string, unknown> & { name: string }),
    options?: AddAgentOptions,
  ): Promise<AgentInfo>;

  removeAgent(name: string): Promise<boolean>;

  getAgentSessions(
    name: string,
    options?: { limit?: number },
  ): Promise<DiscoveredSession[]>;

  getAgentSessionMessages(name: string, sessionId: string): Promise<ChatMessage[]>;
}

// @herdctl/core — TriggerOptions gains a per-trigger working-directory override
interface TriggerOptions {
  // ...existing fields...
  /**
   * Override the agent's configured working directory for this trigger only.
   * Absolute paths are used as-is; relative paths resolve against process.cwd().
   * Omitted => identical to today (uses the agent's configured working_directory).
   */
  workingDirectory?: string;
}

// Also exported from @herdctl/core:
export { AgentManagement, type AddAgentOptions };
```

```ts
// @herdctl/chat
interface TranslatedToolCall {
  toolName: string;
  inputSummary?: string;
  output: string;
  isError: boolean;
  durationMs?: number;
  toolUseId?: string;
}

interface SDKMessageHandlers {
  onText?: (text: string) => void | Promise<void>;
  onBoundary?: () => void | Promise<void>;
  onToolCall?: (toolCall: TranslatedToolCall) => void | Promise<void>;
}

interface SDKMessageTranslatorOptions {
  toolResults?: boolean;  // default true
  now?: () => number;     // default Date.now
}

class SDKMessageTranslator {
  constructor(handlers: SDKMessageHandlers, options?: SDKMessageTranslatorOptions);
  handle(message: SDKMessage): Promise<void>;
  reset(): void;
}

function createSDKMessageHandler(
  handlers: SDKMessageHandlers,
  options?: SDKMessageTranslatorOptions,
): (message: SDKMessage) => Promise<void>;
```

### How paddock adopts this

```ts
// Replace write-yaml + reload() with one call:
await fleet.addAgent({
  name: `keeper-${slug}`,
  working_directory: projectDir,   // absolute
  runtime: "cli",
  permission_mode: "acceptEdits",
});

// List a project's chats without a hand-rolled SessionDiscoveryService:
const chats = await fleet.getAgentSessions(`keeper-${slug}`, { limit: 50 });
const messages = await fleet.getAgentSessionMessages(`keeper-${slug}`, sessionId);

// Drop the hand-rolled ws.ts translation:
await fleet.trigger(`keeper-${slug}`, undefined, {
  prompt,
  resume: sessionId ?? null,
  onMessage: createSDKMessageHandler({
    onText: (t) => ws.send({ type: "chat:response", text: t }),
    onToolCall: (c) => ws.send({ type: "chat:tool_call", ...c }),
    onBoundary: () => ws.send({ type: "chat:boundary" }),
  }),
});
```

(paddock's remaining wishlist item — a streaming trigger handle / async iterator —
is intentionally out of scope here; `onJobCreated` + `cancelJob` already cover
cancellation.)

## Tests

- `packages/core/src/fleet-manager/__tests__/agent-management.test.ts` — 22 tests
  covering add/remove (status visibility, triggerability, `config:reloaded`
  emission, defaults merge + opt-out, relative-path resolution against config
  dir and explicit `baseDir`, duplicate/replace, invalid config, pre-init state
  error) and session access (cwd/docker derivation, docker agents, missing
  working dir, message read, `AgentNotFoundError`, programmatically-added agents).
  Mocks `SessionDiscoveryService` to assert the derived inputs without touching
  `~/.claude`.
- `packages/chat/src/__tests__/sdk-message-translator.test.ts` — 13 tests
  covering text deltas, ignoring non-assistant/user messages, boundaries
  (including the no-boundary-after-tool-result case), tool pairing with
  name/input-summary/duration, error results, the orphan-result fallback,
  `toolResults: false`, async backpressure ordering, `reset()`, and the
  `createSDKMessageHandler` factory.
- `packages/core/src/runner/runtime/__tests__/cli-session-path.test.ts` —
  extended for the encoding fix: single/multiple/leading dots, dotfile-style
  relative segments, underscores, other special chars (`@`, `+`, `~`, space),
  the real `~/.claude/projects` names, the 200-char truncation+hash path, the
  exact-200 boundary, and the updated Windows/drive-colon cases. A comment notes
  the cases align herdctl with Claude Code's actual encoding.
- `packages/core/src/fleet-manager/__tests__/trigger.test.ts` — 7 tests for the
  working-directory override: runs in the override cwd, omitted → unchanged, an
  agent with no configured working dir runs against an override, relative
  override resolves against `process.cwd()`, empty-string override is rejected,
  and the override does not mutate the shared agent config (a later un-overridden
  trigger falls back to the configured dir).
- `packages/core/src/runner/runtime/__tests__/cli-runtime.test.ts` — asserts the
  CLI runtime spawns in the agent's (effective) `working_directory` and resolves
  its session directory from it, proving session lookup follows the effective cwd.
- `packages/core/src/runner/runtime/__tests__/docker-security.test.ts` — adds
  daemon-free `buildContainerMounts` tests proving an overridden
  `working_directory` is mounted at `/workspace` (and a different override mounts
  a different host dir, while the container session mount path is unchanged).

### Results

- `pnpm build` — all 7 tasks succeed.
- `pnpm typecheck` — all 11 tasks succeed.
- `pnpm test` — all 6 packages pass (core 3141, chat 256, web 157, slack 350,
  discord 342, cli 202).
- Coverage of new code (above the per-package thresholds):
  - `agent-management.ts`: 90.9% statements / 92.3% functions / 77.1% branches.
  - `sdk-message-translator.ts`: 97.4% statements / 100% functions / 84.4% branches.
  - `cli-session-path.ts` encoding (incl. truncate+hash) and the
    `applyWorkingDirectoryOverride` chokepoint are exercised by the new
    session-path and trigger tests; the core package stays above its 74/75/65
    thresholds.
- `biome check` — clean on all new/modified files.
- Changeset: `.changeset/programmatic-agents-and-sessions.md` (`@herdctl/core`
  minor, `@herdctl/chat` minor; dependents patch-bumped automatically).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
