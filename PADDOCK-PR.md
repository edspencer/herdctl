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

### Results

- `pnpm build` — all 7 tasks succeed.
- `pnpm typecheck` — all 11 tasks succeed.
- `pnpm test` — all 6 packages pass (core 3122, chat 256, web 157, slack 350,
  discord 342, cli 202).
- Coverage of new code (above the per-package thresholds):
  - `agent-management.ts`: 90.9% statements / 92.3% functions / 77.1% branches.
  - `sdk-message-translator.ts`: 97.4% statements / 100% functions / 84.4% branches.
- `biome check` — clean on all new/modified files.
- Changeset: `.changeset/programmatic-agents-and-sessions.md` (`@herdctl/core`
  minor, `@herdctl/chat` minor; dependents patch-bumped automatically).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
