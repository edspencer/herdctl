# @herdctl/core

## 5.22.2

### Patch Changes

- [#389](https://github.com/edspencer/herdctl/pull/389) [`78a0540`](https://github.com/edspencer/herdctl/commit/78a0540f4f0ba11d75fcfe10755f5bd4d02802cc) Thanks [@edspencer](https://github.com/edspencer)! - Bump `@anthropic-ai/claude-agent-sdk` from 0.3.205 to 0.3.215 (latest 0.3.x). No API changes; picks up upstream native-binary fixes within the 0.3 line.

## 5.22.1

### Patch Changes

- [#391](https://github.com/edspencer/herdctl/pull/391) [`15c20be`](https://github.com/edspencer/herdctl/commit/15c20beabb185658d1e082e3f94e10428f4af17b) Thanks [@edspencer](https://github.com/edspencer)! - Re-establish injected MCP servers on session wake-fired turns (#390).

  Under session drive-mode, in-process `injectedMcpServers` were dropped on every
  wake-driven turn (`ScheduleWakeup` / `/loop` / `CronCreate` re-fires): the reaper
  closes the idle session and the wake registry re-opens it without the in-process
  servers, so the resumed subprocess still lists the injected `mcp__…__*` patterns
  in `--allowedTools` but has no server behind them — the tools vanish from the
  model's catalog for the whole autonomous stretch (durably so across restarts).

  - **@herdctl/core:** add an optional `resolveInjectedMcpServers(entry)` factory to
    `SessionLifecycleManagerOptions` (and a `setResolveInjectedMcpServers` setter on
    both `SessionLifecycleManager` and `FleetManager`). When registered, the wake
    `fire()` path consults it and threads the resolved servers into the resumed
    session via a new optional `injectedMcpServers` field on
    `SessionWakeChatOptions`. Injection _policy_ stays in the consumer; herdctl owns
    the _wiring_. Fully backward-compatible — with no resolver registered, wakes fire
    with no injection exactly as before, and a throwing resolver is logged and
    degrades to no-injection rather than wedging the wake.

  - **@herdctl/core (secondary):** stop `allowedTools` from accumulating duplicate
    `mcp__…__*` wildcards across turns. `toSDKOptions` now copies the agent's
    `allowed_tools` array instead of aliasing it, and the SDK runtime de-dupes
    injected tool patterns before appending them.

## 5.22.0

### Minor Changes

- [#383](https://github.com/edspencer/herdctl/pull/383) [`ba61918`](https://github.com/edspencer/herdctl/commit/ba619187f320464e34840c829ce58757ba8eed54) Thanks [@edspencer](https://github.com/edspencer)! - Stream partial assistant-text deltas on the SDK runtime.

  - **@herdctl/core:** add an opt-in `includePartialMessages` flag on
    `ChatSessionOptions` / `RuntimeExecuteOptions` (and `SDKQueryOptions`), threaded
    from `openChatSession` down to the SDK `query()`. When set, the SDK emits
    `stream_event` / `text_delta` chunks so callers can stream assistant text
    token-by-token. Default off — batch/one-shot and non-opting session callers are
    unchanged.
  - **@herdctl/chat:** `SDKMessageTranslator` now handles `stream_event` messages,
    emitting incremental `onText(delta)` calls for `content_block_delta` /
    `text_delta` events, and suppresses the terminal whole-`assistant` text re-emit
    when its text already streamed as deltas (the `onText` contract stays "deltas,
    in order"). Boundary and tool-call semantics are preserved; the partials-off
    path is byte-for-byte unchanged (one `onText` per assistant content block).

## 5.21.0

### Minor Changes

- [#379](https://github.com/edspencer/herdctl/pull/379) [`247d452`](https://github.com/edspencer/herdctl/commit/247d452d3363615694bec0cc8776b64c53624c64) Thanks [@edspencer](https://github.com/edspencer)! - Scheduler: host-execution seam + runtime schedule mutation (additive, backward-compatible)

  Make the scheduler embeddable so a host can own execution and mutate schedules at
  runtime. Existing headless fleets are unchanged — every new capability is opt-in.

  - **Host-execution seam (#375):** `FleetManager.setScheduleTriggerHandler(handler)`
    mirrors `setSessionWakeHandler`. When set, a fired schedule routes to the host
    handler (which can resume/stream the turn on its own hub) instead of the built-in
    headless `ScheduleExecutor`; when unset, schedules run headless exactly as before.
    Cron/interval timing is untouched. Every scheduler-fired trigger — including a
    forced immediate fire — funnels through this seam.
  - **Relative-wake timezone hardening (#311):** `resolveSystemTimeZone()` centralizes
    the host-timezone lookup used by `calculateNextCronTrigger`/
    `calculatePreviousCronTrigger`, falling back to `UTC` when an ICU-less runtime
    reports no timezone (which could otherwise revive the 24h-idle bug).
  - **Runtime schedule mutation (#376):** `FleetManager.setAgentSchedule(agent, name,
schedule)` and `removeAgentSchedule(agent, name)` add/remove a single schedule on a
    registered agent without a whole-agent `addAgent(replace)`. `setAgentSchedule` also
    normalizes a lingering persisted `disabled` status to `idle` (via the new
    `armScheduleState` helper) so a set-after-disable is actually eligible to fire.
    Removal prunes persisted state via the new `deleteScheduleState` helper.
  - **Concurrency-safe mutation:** schedule-state read-modify-writes are now serialized
    per state file (no lost sibling updates); a removed schedule with an in-flight run is
    tombstoned so that run's trailing write can't resurrect deleted state; and the
    in-flight run's running-set entry is retained (only warn-once bookkeeping is cleared)
    so a same-name re-add can't start a second concurrent execution. The tombstone is
    coordinated with the active execution generation so it is neither left set nor cleared
    too early: `setAgents` lifts it for a re-armed schedule **only when no run for that key
    is in flight** — so `reload()` / `addAgent({replace})` / `setAgentSchedule` re-arm a
    removed name cleanly (no runaway per-tick firing from a stuck tombstone) while a still
    in-flight removed generation's trailing `next_run_at`/`last_error` write stays
    suppressed (can't contaminate the freshly re-added schedule); the tombstone is then
    lifted by that run's own `executeJob` finally on completion, or immediately by the
    remover when no run is in flight. `removeAgentSchedule` is in-memory-only (like
    `addAgent`/`removeAgent`): it does not rewrite `herdctl.yaml`, so a later `reload()`
    legitimately brings the schedule back.
  - **Mutation gate:** a new `allowScheduleMutation` FleetManager option (default
    `false`) gates the two mutation methods; when disabled they throw the new
    `ScheduleMutationDisabledError`. Enable/disable of existing schedules stays ungated.

- [#380](https://github.com/edspencer/herdctl/pull/380) [`822fdfb`](https://github.com/edspencer/herdctl/commit/822fdfbd0c049886217021b07a1e9070b9bf6b29) Thanks [@edspencer](https://github.com/edspencer)! - Add `spawned` trigger type (#377)

  Extend `TriggerTypeSchema` with an explicit `spawned` value so a host (e.g. paddock)
  can persist run provenance for agent-spawned jobs as a first-class enum rather than
  inferring it. Additive and backward-compatible — existing headless fleets are
  unchanged.

  - **core:** `spawned` added to `TriggerTypeSchema` (and therefore the `TriggerType`
    type). `schedule` already covers scheduled runs, so no separate `scheduled` value
    is introduced.
  - **web:** the job-history trigger-type icon/label map renders `spawned` with a
    `Bot` icon labelled "Spawned".

  Supports paddock#267 (provenance badges).

## 5.20.1

### Patch Changes

- [#369](https://github.com/edspencer/herdctl/pull/369) [`0b68b14`](https://github.com/edspencer/herdctl/commit/0b68b1412e0c70005149e09851934073de68f17f) Thanks [@edspencer](https://github.com/edspencer)! - fix(session): don't reap a managed session out from under a background task's re-invocation

  In session drive-mode, when an asynchronous background task (a `run_in_background`
  Bash/Agent/Monitor) completed, the reaper closed the session synchronously on the
  `background_tasks_changed → empty` signal — before the SDK's re-invocation turn (which
  delivers the completed task's result) could produce output. The keeper appeared to
  "stop" the instant its background work finished, never consuming the result (#368).
  This is the asynchronous counterpart of #366/#367 (which covered only the synchronous
  `SubagentStop` path).

  The empty-task-set signal now arms a short grace reap instead of reaping immediately: a
  following `activity` signal (the re-invocation) cancels it, while a genuine
  fire-and-forget completion still reaps once the window elapses — so no session is leaked.
  Grace defaults to 15s and is configurable via `SessionReaperOptions.reinvocationGraceMs`.

## 5.20.0

### Minor Changes

- [#364](https://github.com/edspencer/herdctl/pull/364) [`a495bb0`](https://github.com/edspencer/herdctl/commit/a495bb0fde1ee9b45aa08806c3b43ac42b1501db) Thanks [@edspencer](https://github.com/edspencer)! - Parser: recognise harness-injected `<task-notification>` transcript entries (#363). The Claude Code harness writes a `<task-notification>` block (emitted whenever a background Task/Agent stops or completes) as a synthetic `type:"user"` line stamped `origin:{kind:"task-notification"}`. Unlike skill/hook context it is **not** flagged `isMeta:true`, so it previously slipped past the parser's synthetic-content guards and was surfaced to every consumer as if the human had typed the raw XML.

  - `ChatMessage` now carries an optional `origin?: { kind: string }`. `parseSessionMessages` **keeps** task-notification user lines (a chat UI may render their `<summary>` as a subtle status line) but tags them with `origin` so consumers can classify them structurally instead of sniffing `content`.
  - `extractSessionMetadata` now **drops** task-notifications (like `isMeta` lines) so they no longer inflate `messageCount`, seed the first-message preview, or drag the session's timestamp bounds.
  - `extractFirstMessagePreview` gained the `isMeta` + task-notification guards it was missing entirely, so a synthetic leading line can never seed a chat's preview.

### Patch Changes

- [#367](https://github.com/edspencer/herdctl/pull/367) [`2fea23e`](https://github.com/edspencer/herdctl/commit/2fea23e934679d19189a473c23bc77a6c59bb33a) Thanks [@edspencer](https://github.com/edspencer)! - fix(session): a synchronous subagent finishing no longer reaps the parent session

  `buildLifecycleHooks` mapped both `Stop` and `SubagentStop` to a `turn_end`
  lifecycle signal. `SubagentStop` fires when a _synchronous_ subagent (a
  `Task`/`Agent` tool call) completes mid-parent-turn, so the session reaper —
  which reaps on any `turn_end` that has no live background work — closed the
  streaming session out from under the still-live parent turn. A keeper driving a
  managed session (`openChatSession({ manageLifecycle: true })`, i.e. Paddock's
  session drive-mode) then appeared to "stop" the instant a synchronous subagent
  returned, never consuming its result. Only the main-agent `Stop` is a
  reap-eligible turn boundary now; subagent-registered background tasks and crons
  still surface via the `background_tasks_changed` stream and the parent `Stop`.

## 5.19.2

### Patch Changes

- [#361](https://github.com/edspencer/herdctl/pull/361) [`a8939f0`](https://github.com/edspencer/herdctl/commit/a8939f07f631940c439b5717246cf98a719899d4) Thanks [@edspencer](https://github.com/edspencer)! - fix(core): resolve a fresh CLI session by set difference, not mtime, so co-located agents can't steal each other's session id

  `waitForNewSessionFile` resolved a freshly-spawned `resume:null` (or forked) CLI
  turn by picking the newest `.jsonl` whose `mtime > startTime` in the agent's
  session directory. When two agents **share a working directory** — hence the same
  `~/.claude/projects/<encoded-cwd>/` session dir — a concurrently _streaming_
  session from the other agent also has `mtime > startTime`, and can be newer than
  the file the CLI just created. The new turn was then mis-resolved to the **other
  agent's** session id and its job record written with that foreign `session_id`.
  Because job attribution is last-writer-wins per `session_id`, the victim session
  flipped to the wrong agent and vanished from its owner's chat list until a later,
  correctly-attributed turn (so it was intermittent). Observed live on Paddock,
  whose per-project keeper and sweeper share the project directory as cwd.

  Fix: snapshot the set of `.jsonl` filenames _before_ spawning the CLI
  (`snapshotSessionFiles`) and identify the new session by **set difference** — the
  file whose _name_ is new since the snapshot — which a co-located agent's
  pre-existing (merely-appended-to) file can never be, regardless of mtime. The
  mtime heuristic is retained only as a post-deadline fallback (with a warning) for
  genuinely degenerate cases where no new-named file ever appears.

## 5.19.1

### Patch Changes

- [#353](https://github.com/edspencer/herdctl/pull/353) [`44000f2`](https://github.com/edspencer/herdctl/commit/44000f2aa4ebb8b4c2caaed73e8d8d9c9c14d2ad) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): negative-cache resolveAutoName/resolvePreview so warm listings skip transcript re-scans

  `SessionDiscoveryService.resolveAutoName` (and `resolvePreview`) only wrote to the
  mtime-keyed metadata cache when a value was _found_. A transcript with no
  `type:"summary"` entry cached nothing, so the next `getAgentSessions` re-scanned it
  from scratch via `extractLastSummary` — a full O(filesize) stream of a multi-MB
  file. CLI keeper sessions essentially never carry a summary, so the autoName cache
  was 0%-effective (measured 0/298 sessions cached) and a fully-warm project switch
  still spent ~580ms re-streaming every attributed transcript.

  Both resolvers now record the mtime even for an empty result (mirroring
  `resolveSidechain`), so a validated _negative_ result is remembered and unchanged
  sessions are never re-scanned. Warm project-switch enrichment drops from ~580ms to
  tens of ms. `autoName`/`preview` may now be absent while `autoNameMtime`/
  `previewMtime` are set — presence of the mtime, not the value, is what makes the
  cache authoritative.

- [#356](https://github.com/edspencer/herdctl/pull/356) [`7e1012d`](https://github.com/edspencer/herdctl/commit/7e1012dacb77bc6dd04536e999a091eb5c505dc2) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): stop duplicating tool output in the parsed message payload

  `parseSessionMessages` stored each tool result's (often large) output **twice** —
  once as the message's top-level `content` and again as `toolCall.output` — so both
  copies were serialized into the `/messages` payload, roughly doubling tool-output
  bytes on the wire for tool-heavy chats.

  Consumers (the web dashboard, Paddock's chat UI, the sweep summary) render tool
  messages exclusively from `toolCall.output`; the top-level `content` copy for a
  tool message was never read. `content` is now left empty (`""`) for tool messages,
  keeping the single copy on `toolCall.output`. Smaller payloads and less client-side
  `JSON.parse` for chats dominated by large tool results.

- [#355](https://github.com/edspencer/herdctl/pull/355) [`e09bafd`](https://github.com/edspencer/herdctl/commit/e09bafd15f2d410287f61b3420fb592fcb4b4db3) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): mtime-cache parsed transcript messages so repeat chat opens skip a full re-parse

  `SessionDiscoveryService.getSessionMessages` delegated straight to
  `parseSessionMessages` with no memo, so opening/refreshing a chat re-parsed the
  entire JSONL every time — measured ~114ms of synchronous `JSON.parse`-per-line for
  an ~8MB / 500K-token / 1107-message transcript, recomputed on every open and
  stalling the event loop on the constrained host. Its siblings `getSessionUsage`
  and `getSessionMetadata` were already mtime-cached; messages were the outlier.

  Added a small mtime-keyed, LRU-bounded in-memory cache (keyed on the transcript
  file path + its current mtime). A transcript is immutable except when a new turn
  appends (which bumps mtime), so an exact-mtime match serves the parsed array with
  no re-parse; a bumped mtime invalidates the entry. Repeat opens of an unchanged
  chat drop from ~114ms to ~0.

## 5.19.0

### Minor Changes

- [#320](https://github.com/edspencer/herdctl/pull/320) [`2d222e8`](https://github.com/edspencer/herdctl/commit/2d222e8d0bc505e55a02b6836ba96378eb774940) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): cache derived per-session facts (isSidechain, usage) in the session metadata store

  Session discovery re-derived two facts from every transcript on each listing: the
  sidechain flag (`getAgentSessions` opened the first JSONL line of **every**
  session, every call) and the context-window usage (`getSessionUsage` streamed the
  whole transcript). Both are now memoized in `SessionMetadataStore` keyed on the
  transcript's mtime — the same mtime-invalidated pattern already used for
  `preview`/`autoName` — so an unchanged session is never re-read.

  - New `SessionMetadataEntry` fields: `isSidechain`/`isSidechainMtime` and
    `usage`/`usageMtime`, with `getSidechain`/`batchSetSidechains` and
    `getUsage`/`setUsage` on the store.
  - `getSessionUsage` gains optional `agentName` (enables the persistent cache) and
    `mtime` (skips a `stat` when the caller already knows it). `FleetManager.getAgentSessionUsage`
    passes the agent name, so callers get durable, restart-surviving usage caching
    for free.

  Measured on a real 289-transcript project (after a simulated restart): bulk usage
  reads dropped from ~600 ms to ~2 ms, and `getAgentSessions` from ~1.29 s to ~0.91 s
  (the remainder is the attribution-index rebuild, addressed separately).

- [#344](https://github.com/edspencer/herdctl/pull/344) [`d01b388`](https://github.com/edspencer/herdctl/commit/d01b3882d06a21810ba16eaafc787356f7bbab1f) Thanks [@edspencer](https://github.com/edspencer)! - Deprecate the never-used fleet-level `chat` config block (edspencer/herdctl#329).

  - The fleet-level `chat: { discord: { enabled, token_env } }` block was accepted by `FleetConfigSchema` but was never read at runtime — chat is configured per-agent under each agent's `chat` key. Loading a fleet config that still has a top-level `chat` block now logs a deprecation warning and strips the key before strict parsing, so the config continues to load.
  - `FleetConfigSchema` no longer has a `chat` field, and the `ChatSchema` / `DiscordChatSchema` schemas (along with the `Chat` / `DiscordChat` types) have been removed from `@herdctl/core`'s public exports. Per-agent chat config (`AgentChatSchema`, `AgentChatDiscordSchema`, `AgentChatSlackSchema`, etc.) is unaffected.
  - Fed directly through the lower-level `parseFleetConfig`/`FleetConfigSchema` (which has no backward-compat handling), a fleet-level `chat` key is now rejected as an unrecognized key — only the higher-level config loader (`loadConfig`/`safeLoadConfig`) warns and strips it, mirroring how the existing `workspace` → `working_directory` deprecation is handled.

- [#348](https://github.com/edspencer/herdctl/pull/348) [`1571325`](https://github.com/edspencer/herdctl/commit/15713256986e5eac99a26a429c3261c5be183eb4) Thanks [@edspencer](https://github.com/edspencer)! - Fix job lifecycle event ordering and add `job:output` on manual triggers (#328)

  `job:created` is now emitted the moment the job record is created (status
  `pending`), before any `job:output` and before the run completes — on both the
  manual `trigger()` path and the scheduled path. Previously it was emitted only
  _after_ `JobExecutor.execute()` resolved, so consumers saw `job:created` fire
  after the job had already run (and, on the scheduled path, after its own
  `job:output` events).

  Manual `trigger()` now also emits `job:output` events as the agent streams,
  matching the scheduled path. Previously manual triggers emitted zero
  `job:output`.

  This aligns the observable event stream with the documented contract
  ("`job:created` … status will be 'pending' at this point") and restores the
  `created → output → completed` ordering. The SDK-message → `job:output` payload
  mapping is now shared between both paths, so payloads are identical. This is a
  public event-contract change, hence the minor bump.

- [#330](https://github.com/edspencer/herdctl/pull/330) [`2da4b33`](https://github.com/edspencer/herdctl/commit/2da4b33fcfd0ccb7f010eb603479175c63589816) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): make the attribution index incremental

  Building the session attribution index read and YAML-parsed **every** job record
  in `.herdctl/jobs/` on each build. For a long-running fleet that accumulates
  thousands of jobs, that re-parse (repeated every time the per-listing attribution
  cache expires) is the dominant cost of listing sessions.

  Job records are effectively immutable except for a small tail — a job gains its
  `session_id` and a terminal status when it finishes — so a new `AttributionIndexBuilder`
  keeps a per-file cache keyed on mtime and re-parses only files that are new or
  whose mtime changed. Each rebuild becomes O(jobs) cheap `stat`s plus O(changed)
  parses instead of O(jobs) reads+parses. `SessionDiscoveryService` holds one
  builder for its lifetime, so post-TTL refreshes are cheap. The standalone
  `buildAttributionIndex` (full build) is unchanged for one-shot callers.

  Measured on a real ~600-job state dir: a warm rebuild (nothing changed) dropped
  from ~350 ms to ~10 ms.

- [#343](https://github.com/edspencer/herdctl/pull/343) [`8fec611`](https://github.com/edspencer/herdctl/commit/8fec6113a01c07162d4e87ed852460850434a44c) Thanks [@edspencer](https://github.com/edspencer)! - Emit `agent:started` / `agent:stopped` lifecycle events and remove the never-emitted `schedule:skipped` event (edspencer/herdctl#323).

  - `agent:started` is now emitted for each configured agent when `FleetManager.start()` completes, and when an agent is registered at runtime via `addAgent()`.
  - `agent:stopped` is now emitted for each agent during `FleetManager.stop()` (reason `"shutdown"`), and when an agent is unregistered via `removeAgent()` (reason `"removed"`). Both events were previously declared and documented but never fired.
  - The `schedule:skipped` event has been removed from the FleetManager public event surface (`FleetManagerEventMap`), along with the `ScheduleSkippedPayload` type and the `emitScheduleSkipped` helper. It was never emitted, nothing subscribed to it, and its declared reason enum did not match the scheduler's actual skip reasons. The separate `JobQueue` class's own `schedule:skipped` event is unaffected.

### Patch Changes

- [#342](https://github.com/edspencer/herdctl/pull/342) [`d09833d`](https://github.com/edspencer/herdctl/commit/d09833dee9c22c2d8add651c980243d9599c71b9) Thanks [@edspencer](https://github.com/edspencer)! - Export `InvalidWorkingDirectoryOverrideError` and `isInvalidWorkingDirectoryOverrideError` from `@herdctl/core` (edspencer/herdctl#325).

- [#347](https://github.com/edspencer/herdctl/pull/347) [`18834f8`](https://github.com/edspencer/herdctl/commit/18834f8dac900eea3b1f8810cfa6d04453e3de32) Thanks [@edspencer](https://github.com/edspencer)! - fix(core): inject refreshed OAuth credentials into reused persistent containers

  Docker credentials were only ever applied to a container's env at creation
  time. For persistent agents (`docker.ephemeral: false`) the same container is
  reused across executions, so a token refreshed by `buildContainerEnv()` never
  reached the already-running container — on token-expiry retry the `docker exec`
  still inherited the stale creation-time token and the agent looped on expired
  credentials. Each execution now re-injects the current credential env
  (`CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_REFRESH_TOKEN` / `CLAUDE_EXPIRES_AT` /
  `ANTHROPIC_API_KEY`) into every exec (SDK `exec` `Env`, CLI `docker exec -e`
  args), so reused persistent containers always run with fresh credentials.
  Ephemeral containers were unaffected. Fixes edspencer/herdctl#327.

- [#321](https://github.com/edspencer/herdctl/pull/321) [`d7589df`](https://github.com/edspencer/herdctl/commit/d7589dfd97819c84933b8502ca18ce5810bd1c69) Thanks [@edspencer](https://github.com/edspencer)! - perf(state): enrich sessions with bounded concurrency in getAgentSessions

  `getAgentSessions` enriched each session one at a time in a sequential
  `for … await` loop, so its latency grew linearly with the session count even
  though the per-session work (reading a transcript head for the sidechain check,
  plus any uncached name/preview) is independent and I/O-bound. It now runs that
  work through a bounded-concurrency map (cap 16), overlapping the I/O while
  capping open file descriptors. Results are collected in input order, so the
  mtime-descending sort is unchanged. Adds a small, tested `mapWithConcurrency`
  helper.

- [#340](https://github.com/edspencer/herdctl/pull/340) [`38a408d`](https://github.com/edspencer/herdctl/commit/38a408d5d7b29c13863a79aa60370487bc37ffe3) Thanks [@edspencer](https://github.com/edspencer)! - Fix `denied_tools` being silently ignored on `runtime: sdk` agents (edspencer/herdctl#322).

  The SDK adapter passed an agent's `denied_tools` to the Claude Agent SDK as `deniedTools`, but the SDK's actual option is named `disallowedTools`. Because the options object is spread into `query()` untyped, the misspelled key was silently dropped — so tools listed in `denied_tools` remained fully available to SDK-runtime agents. The CLI runtime was unaffected (it already passes `--disallowedTools`).

  `toSDKOptions` now emits `disallowedTools`, and `SDKQueryOptions` declares the correctly named field so the compiler catches any future drift.

- [#349](https://github.com/edspencer/herdctl/pull/349) [`f915f65`](https://github.com/edspencer/herdctl/commit/f915f656d973ebd17457c005476d519103f2b192) Thanks [@edspencer](https://github.com/edspencer)! - fix(core): shutdown bulk-cancel now actually cancels in-flight jobs

  `FleetManager.stop({ cancelOnTimeout: true })` was a guaranteed no-op: on a
  shutdown timeout it read jobs from a `current_job` fleet-state field that nothing
  ever wrote, so no jobs were ever cancelled. Manual and scheduled jobs that stalled
  shutdown kept running.

  In-flight jobs are now tracked in a single shared AbortController registry that
  both manual triggers (`JobControl.trigger`) and scheduled jobs
  (`ScheduleExecutor`) register into. Shutdown bulk-cancel iterates that registry and
  genuinely aborts each live run (killing the CLI subprocess / aborting the SDK
  query). The registry is keyed by job id, so it is concurrency-safe under
  `instances.max_concurrent > 1`. This is an internal, non-breaking change.

  Refs edspencer/herdctl#324.

## 5.18.2

### Patch Changes

- [#316](https://github.com/edspencer/herdctl/pull/316) [`f5846ef`](https://github.com/edspencer/herdctl/commit/f5846efac8848408c0cc7a5f0848985838ecd66b) Thanks [@edspencer](https://github.com/edspencer)! - Fix session `ScheduleWakeup` resolving ~24h late when the host timezone is behind UTC (edspencer/herdctl#311).

  The SDK/native harness serializes a relative one-shot `ScheduleWakeup` (and `CronCreate` schedules) as a wall-clock cron expression in the **host's local timezone** — e.g. a "+60s" wake at 19:08 local becomes `"10 19 * * *"`. The session reaper's default wake resolver, however, resolved that cron in **UTC**. On a host behind UTC, the local wall-clock minute/hour has often already passed in UTC, so `nextRunAt` rolled to _tomorrow_ and the wake sat idle for ~24h instead of firing in a minute.

  `SessionLifecycleManager`'s default `resolveNextRun` now resolves session-cron schedules in the host's system timezone (via `calculateNextCronTrigger`), matching both the timezone the harness serialized them in and how the rest of the scheduler (`scheduler.ts`, `schedule-runner.ts`) already resolves fleet crons. Consumers that inject a custom `resolveNextRun` are unaffected.

## 5.18.1

### Patch Changes

- [#313](https://github.com/edspencer/herdctl/pull/313) [`5ac866c`](https://github.com/edspencer/herdctl/commit/5ac866c0397626cea742451b4672820b78118f33) Thanks [@edspencer](https://github.com/edspencer)! - Surface a stable per-message id on `ChatMessage` from `parseSessionMessages` (edspencer/herdctl#312).

  Each source JSONL transcript entry carries a stable `uuid` (assigned when the line is written, append-only, and preserved across a fork), but the parser previously dropped it — leaving consumers with no reload-stable identifier for a rendered message. `ChatMessage` now exposes an optional `uuid`:

  - Populated from each entry's `uuid` for user and assistant messages.
  - For a paired tool message (a `tool_use` in an assistant entry collapsed with its following `tool_result`), the id is the **originating `tool_use` entry's** `uuid`, so it stays deterministic even when several `tool_result`s share a single user line. An orphan `tool_result` with no matching `tool_use` falls back to its own line's `uuid`.
  - Additive and optional — `undefined` when the source line has no `uuid` — so existing consumers are unaffected.

  This unblocks keying per-message UI state (collapse/height/pin state, deep-linking) on an identifier that survives reloads.

## 5.18.0

### Minor Changes

- [#309](https://github.com/edspencer/herdctl/pull/309) [`fef994a`](https://github.com/edspencer/herdctl/commit/fef994a036e0a38f5680818aba8db2dbe93d5043) Thanks [@edspencer](https://github.com/edspencer)! - Wire the session reaper + wake registry into the fleet end-to-end (part 2 of edspencer/herdctl#307).

  Builds on the `session/` mechanism to make idle-session reaping and wake re-triggering actually run inside a `FleetManager`:

  - **`SessionLifecycleManager`** — assembles the `WakeRegistry` + `SessionReaper` + persistence + cron resolution + the resume-and-inject fire path into one facade. Firing a due wake resumes its session via `openChatSession({ resume, prompt, manageLifecycle: true })` and either hands the live session to a registered consumer or drains it headlessly so recurring wakeups keep firing.
  - **`FleetManager`** now constructs a `SessionLifecycleManager` and passes `onTick: () => dispatchDue()` to the `Scheduler`, so due wakes fire on the existing scheduler loop. New surface: `getSessionLifecycle()` and `setSessionWakeHandler()` (the consumer hook for delivering woken turns onto a hub/attribution path).
  - **`ChatSessionOptions.manageLifecycle`** — opt a streaming session into herdctl-managed lifecycle. `JobControl.openChatSession` wires the session's `onLifecycleSignal` to the reaper (`manage()`), so the session is reaped when it goes idle and its `session_crons` are captured for re-triggering.

  Behavior is unchanged unless a caller opts in via `manageLifecycle` (or a consumer registers a wake handler): existing `openChatSession` callers keep owning `close()`.

- [#308](https://github.com/edspencer/herdctl/pull/308) [`59abd83`](https://github.com/edspencer/herdctl/commit/59abd83445ccf9221e11493d01d3a96aef086d81) Thanks [@edspencer](https://github.com/edspencer)! - Add streaming-session lifecycle management: a session reaper and a wake registry (part 1 of edspencer/herdctl#307).

  Long-lived chat sessions (`openChatSession` / `SDKRuntime.openSession`) now have the building blocks to be reaped the instant they go idle — rather than accumulating warm native `claude` processes at ~300 MB each — and to have their timer-class wakeups (`ScheduleWakeup` / `CronCreate`) re-triggered through herdctl's own scheduler after the reap.

  New, additive surface under `@herdctl/core`:

  - **`session/` module** — `decideReap` (the one-rule reap policy), `reconcileSessionWakes` + the wake-store helpers (reconcile SDK `session_crons` by id into durable wake entries with an absolute `nextRunAt`, one-shot vs recurring semantics, 7-day recurring expiry), `WakeRegistry` (async-locked, concurrency-limited, deadlock-free due-firing that skips still-live sessions), `SessionReaper` (drives reap vs keep-alive from turn-end / `background_tasks_changed` / activity signals), `buildLifecycleHooks` / `tapLifecycleStream`, and `FleetStateWakePersistence`.
  - **`SDKRuntime.openSession`** now installs `Stop`/`SubagentStop` lifecycle hooks and taps the message stream when a new `onLifecycleSignal` execute-option is provided, and threads an `AbortController` into the query for clean teardown.
  - **`Scheduler`** gains an `onTick` option so wake firing reuses the existing scheduler loop instead of a second timer.
  - Fleet state gains an optional `session_wakes` slice.

  No behavior changes to existing paths: sessions are only managed when a caller opts in via `onLifecycleSignal`, and the reaper/registry are not yet wired into `FleetManager.openChatSession` (that end-to-end wiring + consumer surface is part 2).

## 5.17.0

### Minor Changes

- [#304](https://github.com/edspencer/herdctl/pull/304) [`4eec7f3`](https://github.com/edspencer/herdctl/commit/4eec7f300248ce07ee5ce75dca92e06cf3dbce28) Thanks [@edspencer](https://github.com/edspencer)! - Bump `@anthropic-ai/claude-agent-sdk` from `^0.1.0` (resolved 0.1.77) to
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

- [#305](https://github.com/edspencer/herdctl/pull/305) [`1262b8e`](https://github.com/edspencer/herdctl/commit/1262b8e4619a5eb479bba788d209a64143e3f61f) Thanks [@edspencer](https://github.com/edspencer)! - Upgrade `zod` from `^3.22.0` to `^4.0.0` in `@herdctl/core` and `@herdctl/chat`.

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

  Note on the public surface: both packages re-export Zod schema **objects** from
  their entry points (`@herdctl/core`: config/state schemas like `FleetConfigSchema`
  and `AgentConfigSchema`; `@herdctl/chat`: `ChannelSessionSchema`,
  `ChatSessionStateSchema`). Those objects are now Zod v4 instances. The inferred
  (`z.infer`) types are structurally unchanged, so most consumers are unaffected;
  only code that composes the exported schema objects with its **own** Zod instance
  at runtime (`.extend`/`.merge`, `instanceof`, cross-instance parsing) needs to be
  on `zod@^4`.

## 5.16.0

### Minor Changes

- [#301](https://github.com/edspencer/herdctl/pull/301) [`1395fb2`](https://github.com/edspencer/herdctl/commit/1395fb2f1de4c5a153f5498b96d06994fdf80376) Thanks [@edspencer](https://github.com/edspencer)! - Add `FleetManager.listAgentCommands(agentName, options?)` — a one-shot way to
  read the slash commands available to an agent for populating a command palette /
  autocomplete, without hand-managing a live streaming session.

  Internally it opens a chat session, reads its command list, and **always closes
  the session** (in a `finally`, even if the listing throws), so consumers never
  have to guard the underlying `claude` subprocess lifecycle themselves:

  - Returns the full `SlashCommand[]` — `{ name, description, argumentHint }` per
    command (built-ins + project `.claude/commands` + MCP-provided commands) for
    the resolved session's cwd/config.
  - Accepts the same `ChatSessionOptions` as `openChatSession` (notably
    `workingDirectory` and `injectedMcpServers`) so the list reflects the intended
    project context.
  - Works for `cli`-runtime agents (the session runs on the SDK runtime
    regardless of the agent's configured runtime) and surfaces
    `StreamingSessionUnsupportedError` unchanged for Docker-wrapped agents.

  Each call spawns and tears down a `claude` subprocess (~seconds); the list is
  essentially static per project, so callers that query it repeatedly should
  cache the result.

  Also re-exports the `SlashCommand` type from `@herdctl/core`, so consumers can
  `import type { SlashCommand } from "@herdctl/core"` instead of reaching into the
  Claude Agent SDK directly.

## 5.15.2

### Patch Changes

- [#296](https://github.com/edspencer/herdctl/pull/296) [`7176078`](https://github.com/edspencer/herdctl/commit/717607897feb0f8ac6b9a2cda6bc276660964e30) Thanks [@edspencer](https://github.com/edspencer)! - `extractSessionMetadata` now skips Claude Code's injected `isMeta:true` user
  lines (a skill's SKILL.md, slash-command output, hook output). Previously these
  inflated `messageCount` and — when one led the transcript — could seed
  `firstMessagePreview`, `gitBranch`/`version`, and the timestamp bounds from
  injected content rather than the real first user message. This completes the
  `isMeta` handling started for `parseSessionMessages`, so history rendering and
  session metadata now agree.

## 5.15.1

### Patch Changes

- [#294](https://github.com/edspencer/herdctl/pull/294) [`b17798b`](https://github.com/edspencer/herdctl/commit/b17798b4e3ef2735b566c5b087b880221fb2970c) Thanks [@edspencer](https://github.com/edspencer)! - Filter out the Claude Code CLI's synthetic placeholder assistant turns (model
  `"<synthetic>"`, e.g. "No response requested.") so they no longer leak into chat
  output. After a `/compact`, the CLI injects a continuation summary and emits a
  synthetic assistant turn as a placeholder, which previously rendered as a real
  assistant message at the head of the next turn.

  - `@herdctl/chat`: the live SDK-message translator now skips synthetic assistant
    messages (no text, no turn boundary). Exposes `isSyntheticMessage` /
    `SYNTHETIC_MODEL` from `message-extraction`.
  - `@herdctl/core`: the JSONL history parser drops synthetic assistant lines, so
    reopening a compacted chat no longer shows the placeholder bubble.

## 5.15.0

### Minor Changes

- [#291](https://github.com/edspencer/herdctl/pull/291) [`c36f366`](https://github.com/edspencer/herdctl/commit/c36f366f96c294285a08888fd1e6ee25a87a437f) Thanks [@edspencer](https://github.com/edspencer)! - Add session forking to `trigger()`. Passing `fork: <sourceSessionId>` in `TriggerOptions`
  runs a turn that resumes the source session's transcript as context but writes all new
  turns to a brand-new session id (via Claude Code's `--fork-session`), leaving the source
  untouched — letting a caller branch an existing conversation into independent children.

  The runner already understood `RunnerOptions.fork`, but nothing on the public API passed
  it, and the CLI runtime mis-handled it: it appended `--fork-session` yet still watched the
  _resumed source_ file, so it reported the parent's session id and missed the child's turns.
  Now `trigger()`/`JobExecutor` thread `fork` (and optional `forkedFrom` lineage) through,
  seed the resume target from the fork source (skipping agent-level session fallback), and the
  CLI runtime waits for the newly-created fork file and reports its id — matching the SDK
  runtime. Forks retry as a plain fresh session if the source is gone.

## 5.14.1

### Patch Changes

- [#289](https://github.com/edspencer/herdctl/pull/289) [`02fff61`](https://github.com/edspencer/herdctl/commit/02fff61c36ac0e2ad58a73aab2ece0b3335fdcf8) Thanks [@edspencer](https://github.com/edspencer)! - Fix `cancelJob` so it actually interrupts a running job. Previously cancelling only
  rewrote the job's status file to `cancelled` while the agent process kept running to
  completion. `trigger()` now creates an `AbortController` per run and registers it by
  job id; `cancelJob` aborts it, killing the CLI subprocess (or aborting the SDK query).
  Aborted runs are finalized as `cancelled` rather than `failed`, and the SDK runtime now
  honors `abortController` for one-shot execution.

## 5.14.0

### Minor Changes

- [#286](https://github.com/edspencer/herdctl/pull/286) [`02c493f`](https://github.com/edspencer/herdctl/commit/02c493fed5b132b845949ee42ccf76c7240ea228) Thanks [@edspencer](https://github.com/edspencer)! - Add streaming chat sessions (`FleetManager.openChatSession`) for interactive, multi-turn control over a live agent query.

  Until now every turn ran as a one-shot `query()` with a string prompt, which cannot use the SDK's control requests (they are "only supported when streaming input/output is used"). The new `SDKRuntime.openSession()` drives the SDK's streaming-input mode instead, keeping one query open across turns and retaining the `Query` handle. This exposes a `RuntimeSession` with:

  - `send(text)` — send a follow-up user turn; a leading-slash text (e.g. `/compact`, `/clear`) is dispatched by the CLI as a slash command (commands are just user messages — there is no separate "run command" call),
  - `interrupt()` — stop the current turn without closing the session,
  - `listCommands()` — enumerate available slash commands for a command palette,
  - `setModel(model)` — switch models mid-session,
  - `close()` — end the input stream and shut the query down.

  `FleetManager.openChatSession(agentName, options)` resolves the agent with the same working-directory-override and session-resume semantics as `trigger()` and returns the session. Additive and backward-compatible: the one-shot `execute()`/`trigger()` path is unchanged. Streaming sessions always run on the SDK runtime (the only streaming-capable one) regardless of the agent's configured `runtime` — a `cli`-configured agent works fine (same `CLAUDE_CODE_OAUTH_TOKEN` auth, shared on-disk session store), so a session resumes a CLI-created conversation cleanly; only Docker-wrapped agents are unsupported and throw the new `StreamingSessionUnsupportedError`. Also exports a small `MessageQueue` helper (pushable `AsyncIterable`) used to feed the streaming input.

## 5.13.2

### Patch Changes

- [#284](https://github.com/edspencer/herdctl/pull/284) [`1bde4aa`](https://github.com/edspencer/herdctl/commit/1bde4aa38040eaedb646216c6f653542d0d4e67c) Thanks [@edspencer](https://github.com/edspencer)! - Session-history parsing (`parseSessionMessages`) now skips Claude Code's injected `isMeta:true` user lines — a skill's `SKILL.md`, slash-command output, hook output — instead of surfacing them as ordinary user messages. Previously a skill's `SKILL.md` was emitted as a plain user message, so downstream chat UIs rendered it as a giant, out-of-order user bubble. Genuine tool results are unaffected (the guard only applies to the plain-text user branch).

## 5.13.1

### Patch Changes

- [#266](https://github.com/edspencer/herdctl/pull/266) [`637cf10`](https://github.com/edspencer/herdctl/commit/637cf10a50a81c07bb2c14ab38277afe6eb34fc1) Thanks [@edspencer](https://github.com/edspencer)! - Lock in the correct `--mcp-config` JSON shape for the CLI runtime (issue #182).

  The Claude CLI validates `--mcp-config` against a schema that requires a top-level `mcpServers` record (the same shape as `.mcp.json`). The pre-fix flat form `{"<name>":{...}}` fails validation with `mcpServers: Invalid input: expected record, received undefined`, and the headless process hangs until the job times out instead of surfacing an error.

  The CLI runtime already emits the wrapped `{"mcpServers":{...}}` form; this change adds regression tests asserting that emitted shape so it can't silently revert to the flat form.

- [#265](https://github.com/edspencer/herdctl/pull/265) [`9e0b6fc`](https://github.com/edspencer/herdctl/commit/9e0b6fcea7ed4ee3949e8dcfeff04de223a6c029) Thanks [@edspencer](https://github.com/edspencer)! - Fix lossy `encodedPath` collisions in session discovery (#148)

  `encodePathForCli` maps every non-alphanumeric character to `-`, so different
  working directories like `/a/b-c`, `/a-b/c`, and `/a/b/c` all encode to the same
  `~/.claude/projects/-a-b-c` transcript directory. This is required to stay
  byte-compatible with Claude Code (which collides them the exact same way, so the
  encoding cannot be made reversible without pointing at a non-existent
  directory), but it meant sessions from two colliding directories could be
  cross-attributed during discovery.

  Session discovery now disambiguates colliding directories by reading each
  transcript's authoritative `cwd` field (Claude Code records the real working
  directory inside every session's JSONL). New helpers `readSessionCwd` and
  `sessionBelongsToWorkingDirectory` are exported from `@herdctl/core`, and
  `getAllSessions` only consults them when an actual collision is detected, so the
  common (unique-path) case pays no extra cost.

  Also fixes `@herdctl/web`'s `chat.ts`, which derived `encodedPath` with a
  slashes-only replacement (`workingDirectory.replace(/[/\\]/g, "-")`) that never
  matched core's `DirectoryGroup.encodedPath` for any path containing a dot,
  underscore, or other non-alphanumeric character; it now uses the shared
  `encodePathForCli` encoder.

- [#264](https://github.com/edspencer/herdctl/pull/264) [`5349bd4`](https://github.com/edspencer/herdctl/commit/5349bd4856ce1f7245a0703cd51eb8222c8f9229) Thanks [@edspencer](https://github.com/edspencer)! - Fix same-process cross-agent session resume and resume-after-cwd-change (issues #263, #126).

  The job executor's resume gate (`JobExecutor.execute`, step 3.5) only honored a caller-provided `resume` session ID when the agent already had a _matching agent-level session pointer_ on disk (`.herdctl/sessions/<agent>.json`). When an agent was asked to resume a session it had never owned — e.g. adopting a session another agent created in the same process (#263) — the explicit `resume` was silently dropped and the runtime forked a brand-new session, losing all prior context. A process restart appeared to "fix" it; nothing at runtime did.

  This change makes the executor adopt an explicit caller-provided session when the agent has _never_ owned an agent-level session (distinguished from the expired-and-cleared case via a non-timeout pointer read), persisting an agent-level pointer so future runs and restarts treat the session as owned. For the native CLI runtime it only adopts when the transcript actually exists in the agent's working directory (Claude Code keys session storage by spawn cwd); SDK/Docker runtimes adopt directly.

  It also adds a post-loop session-not-found retry: the CLI runtime _yields_ a terminal error (rather than throwing) when `claude --resume` can't find a session — e.g. after a `working_directory` change relocates the transcript — so the existing catch-block retry never ran. The yielded-error path now clears the stale pointer and retries once with a fresh session, mirroring the thrown-error recovery.

## 5.13.0

### Minor Changes

- [#261](https://github.com/edspencer/herdctl/pull/261) [`177f224`](https://github.com/edspencer/herdctl/commit/177f2244effb052a9af3a150ee435ad6d36cc3e5) Thanks [@edspencer](https://github.com/edspencer)! - Fix dropped assistant answers when reloading a chat, and expose per-session usage.

  - **Bugfix (`parseSessionMessages`).** An assistant turn that uses extended
    thinking is written by Claude Code as several JSONL lines sharing one
    `message.id` — a `thinking` block line (which carries no text) followed by the
    `text` block line. The previous dedup marked the `message.id` as "seen" on the
    thinking line, so the following text line was discarded as a duplicate and the
    assistant's actual answer disappeared when a session was reloaded from history
    (most visibly: the final turn of any thinking-enabled conversation). Dedup now
    keys on whether text has actually been emitted for an ID, so no-text lines
    (thinking / tool_use) no longer suppress the real answer. Tool-use pairing and
    text dedup of genuinely duplicated lines are unchanged.

  - **New: `FleetManager.getAgentSessionUsage(name, sessionId)`** wraps
    `SessionDiscoveryService.getSessionUsage`, returning the most recent
    context-window fill level (last assistant turn's input + cache tokens) and turn
    count for a session — so a UI can show "context used" for a chat opened from
    history, before any new turn streams a fresh `usage`.

## 5.12.0

### Minor Changes

- [#260](https://github.com/edspencer/herdctl/pull/260) [`49f9d4c`](https://github.com/edspencer/herdctl/commit/49f9d4c6d12196fcc3956d2a2e166c13159c4733) Thanks [@edspencer](https://github.com/edspencer)! - Make session discovery reflect newly-created sessions immediately, and add a way to force-refresh.

  `SessionDiscoveryService` caches each working directory's discovered session
  list for the cache TTL (default ~30s). Previously a brand-new session transcript
  file appearing in `~/.claude/projects/<encoded-cwd>/` could stay invisible to
  `getAgentSessions` for up to the full TTL, with no way to invalidate the internal
  discovery service that `FleetManager` owns.

  Two changes fix this:

  - **mtime-aware cache (auto-invalidation).** The directory listing cache now
    records the transcript directory's own mtime when an entry is built. Before
    serving a cached listing it cheaply `stat`s the directory and rebuilds the
    entry when the mtime moved — adding or removing a session file bumps the
    directory mtime, so a newly-created session appears immediately without callers
    doing anything. The TTL remains as a secondary bound (and still covers appends
    to an existing transcript, which do not bump the directory mtime). The
    "don't cache a missing directory" behavior is preserved, and a transiently
    unreadable directory falls back to the TTL rather than dropping the cache.

  - **Explicit invalidation.** New public `FleetManager.invalidateSessions(name)`
    resolves the agent's working directory from config and clears that directory's
    cached listing (and the shared attribution index) on the internal discovery
    service, so the next `getAgentSessions` rebuilds from disk. It throws
    `InvalidStateError` before `initialize()` and `AgentNotFoundError` for unknown
    agents, matching the other session methods. Backed by a new
    `SessionDiscoveryService.invalidateWorkingDirectory(workingDirectory, options?)`
    primitive. This lets callers force a fresh listing regardless of mtime
    granularity (e.g. after each chat turn).

## 5.11.0

### Minor Changes

- [#256](https://github.com/edspencer/herdctl/pull/256) [`7956804`](https://github.com/edspencer/herdctl/commit/795680412b48dadd4ba25ed0355f33fa12d37e9f) Thanks [@edspencer](https://github.com/edspencer)! - Add programmatic agent management, convenience session access, and a reusable SDK message translator.

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
    by cwd, so agent-level `getAgentSessions` (which uses the _configured_
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

## 5.10.1

### Patch Changes

- [#210](https://github.com/edspencer/herdctl/pull/210) [`31c675c`](https://github.com/edspencer/herdctl/commit/31c675cbd3cc73c039abe083aa8314dee266acf9) Thanks [@mblua](https://github.com/mblua)! - Fix path traversal check to use platform-specific path separator for Windows compatibility

## 5.10.0

### Minor Changes

- [#194](https://github.com/edspencer/herdctl/pull/194) [`3f947a0`](https://github.com/edspencer/herdctl/commit/3f947a01ed797170c88064cc7e60ec0d9741f74a) Thanks [@oheckmann74](https://github.com/oheckmann74)! - Add injected MCP server support to CLI runtime via HTTP bridges

  CLI runtime now supports `injectedMcpServers` (e.g., file sender for Discord/Slack uploads).
  Previously only SDK and Docker runtimes handled injected MCP servers — CLI silently ignored them.

  The fix reuses existing `mcp-http-bridge.ts` infrastructure: starts HTTP bridges on localhost
  for each injected server and passes them via `--mcp-config` as HTTP-type MCP servers.

- [#194](https://github.com/edspencer/herdctl/pull/194) [`3f947a0`](https://github.com/edspencer/herdctl/commit/3f947a01ed797170c88064cc7e60ec0d9741f74a) Thanks [@oheckmann74](https://github.com/oheckmann74)! - feat(discord): support file attachments (images, PDFs, text/code files) in Discord messages

  When users upload files alongside a Discord message, the connector now detects and processes them:

  - Text/code files are downloaded and inlined directly into the agent's prompt
  - Images and PDFs are saved to the agent's working directory with a file path reference so the agent can use its Read tool to view them
  - Configurable via `chat.discord.attachments` with options for file size limits, allowed types, and automatic cleanup

## 5.9.0

### Minor Changes

- [#189](https://github.com/edspencer/herdctl/pull/189) [`7a75d61`](https://github.com/edspencer/herdctl/commit/7a75d617c7dfd515409e3cf41cf3da92176c7f45) Thanks [@edspencer](https://github.com/edspencer)! - Add `tools` config field for tool availability restriction (whitelist). Unlike `allowed_tools` which only controls permission prompts, `tools` restricts which built-in tools are available to the agent entirely.

### Patch Changes

- [#186](https://github.com/edspencer/herdctl/pull/186) [`62a938d`](https://github.com/edspencer/herdctl/commit/62a938d2177433d8a2b2b6b404a62f1775171c20) Thanks [@edspencer](https://github.com/edspencer)! - fix: discover Docker agent sessions from .herdctl/docker-sessions/

  Docker agents store session JSONL files in `.herdctl/docker-sessions/` on the
  host (the container's `~/.claude/projects/` is ephemeral and gone after exit).
  `SessionDiscoveryService` only scanned `~/.claude/projects/`, so Docker agent
  sessions were invisible in the UI despite existing on disk.

  Now `getAgentSessions()` scans the docker-sessions directory when
  `dockerEnabled` is true. `getAllSessions()` also includes Docker session groups
  so they appear in the All Chats view. Session message/metadata/usage retrieval
  methods accept an optional `{ dockerEnabled }` option to resolve the correct
  file path.

- [#191](https://github.com/edspencer/herdctl/pull/191) [`6e8d143`](https://github.com/edspencer/herdctl/commit/6e8d1438569fff390d44a1dbf79d178d6dca8266) Thanks [@edspencer](https://github.com/edspencer)! - fix: harden session ID path helpers against path traversal

  Add validation to `getDockerSessionFile()` and `getCliSessionFile()` functions in cli-session-path.ts to reject session IDs containing path traversal sequences or invalid characters. Session IDs must now contain only alphanumeric characters and hyphens.

## 5.8.3

### Patch Changes

- [#178](https://github.com/edspencer/herdctl/pull/178) [`ccdda22`](https://github.com/edspencer/herdctl/commit/ccdda2234e22c0275c8d3b27b991eb9a68ee53c8) Thanks [@oheckmann74](https://github.com/oheckmann74)! - Add configurable typing_indicator option for Discord output

  Users can now disable the Discord typing indicator via `output.typing_indicator: false` in their agent's Discord config. This prevents spurious "An unknown error occurred" messages caused by Discord rate-limiting the typing indicator on long-running agent jobs. The default remains `true` to preserve existing behavior.

## 5.8.2

### Patch Changes

- [#171](https://github.com/edspencer/herdctl/pull/171) [`fea713e`](https://github.com/edspencer/herdctl/commit/fea713e8cfaa86ccf6c849a66928dcf2063f6da2) Thanks [@edspencer](https://github.com/edspencer)! - fix: invalidate attribution cache after chat message send

  New web chat sessions were not appearing in the sidebar because the
  SessionDiscoveryService's attribution index (30-second cache TTL) didn't
  include the newly written session attribution. The next getAgentSessions()
  call would filter out the new session since it wasn't yet in the index.

  Added `invalidateAttributionCache()` to SessionDiscoveryService and call
  it from WebChatManager.sendMessage() after writing session attribution.
  This also clears the directory file listing cache for the agent's working
  directory so new JSONL files are picked up immediately.

## 5.8.1

### Patch Changes

- [#156](https://github.com/edspencer/herdctl/pull/156) [`8f06594`](https://github.com/edspencer/herdctl/commit/8f0659459a58d22ef221638589fb7d23c6579a71) Thanks [@edspencer](https://github.com/edspencer)! - Fix "unknown" tool names in chat view when Claude Code writes parallel tool calls as separate JSONL lines with the same message ID

## 5.8.0

### Minor Changes

- [#153](https://github.com/edspencer/herdctl/pull/153) [`487893e`](https://github.com/edspencer/herdctl/commit/487893e512acc56e7de2caf9b44eab5f20f5df64) Thanks [@edspencer](https://github.com/edspencer)! - Start web UI without fleet config for zero-config session browsing. When no herdctl.yaml is found, `herdctl start` now boots the web dashboard in web-only mode instead of exiting with an error, letting users browse Claude Code sessions from ~/.claude/ without any fleet configuration.

## 5.7.1

### Patch Changes

- [#151](https://github.com/edspencer/herdctl/pull/151) [`e7933a5`](https://github.com/edspencer/herdctl/commit/e7933a5a8b63df1805b6d965edbb6b0526a57801) Thanks [@edspencer](https://github.com/edspencer)! - Populate session preview from first user message instead of showing "New conversation"

  Sessions without a custom name or auto-generated summary now display the first user message text (truncated to 100 chars) in the sidebar and All Chats page. Previews are cached in the session metadata store with mtime-based invalidation.

## 5.7.0

### Minor Changes

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Add JSONL session parser for reading Claude Code native session files. Exports `parseSessionMessages()`, `extractSessionMetadata()`, and `extractSessionUsage()` for converting `.jsonl` session files into the `ChatMessage[]` format used by the web frontend.

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Add session attribution module for determining session origins (web, discord, slack, schedule, native) by cross-referencing job metadata and platform session YAML files. Exports `buildAttributionIndex()` which returns an `AttributionIndex` for looking up `SessionAttribution` by session ID.

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Add session discovery service and metadata store for unified Claude Code session enumeration. `SessionDiscoveryService` ties together JSONL parsing, session attribution, and CLI session path utilities into a single cached API for discovering sessions across all project directories. `SessionMetadataStore` provides CRUD operations for custom session names stored in `.herdctl/session-metadata/`.

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Add auto-generated session names extracted from Claude Code JSONL summary field, with caching in SessionMetadataStore

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Only show sessions attributed to the specific agent in Fleet view. When multiple agents share a working directory, each agent's session list now shows only its own herdctl-managed sessions instead of duplicating all sessions across every agent.

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Filter sidechain (sub-agent) sessions from UI session discovery and default `resume_session` to `false`. Sidechain sessions created by Claude Code's Task tool or `--resume` flag are now excluded from the dashboard to reduce noise.

### Patch Changes

- [#144](https://github.com/edspencer/herdctl/pull/144) [`01274a8`](https://github.com/edspencer/herdctl/commit/01274a8dc34bcb0a5b2f2830ab66916c5237f0f9) Thanks [@edspencer](https://github.com/edspencer)! - Move tool-parsing utilities from @herdctl/chat to @herdctl/core for reuse by new session discovery modules. @herdctl/chat re-exports all symbols for backwards compatibility.

## 5.6.0

### Minor Changes

- [#99](https://github.com/edspencer/herdctl/pull/99) [`bd59195`](https://github.com/edspencer/herdctl/commit/bd591953046462c8055a72b3df21f1e880a62607) Thanks [@edspencer](https://github.com/edspencer)! - Add agent distribution system and `herdctl agent` command group

  **@herdctl/core** — New `distribution/` module providing:

  - Source specifier parsing (GitHub URLs, shorthand `owner/repo`, local paths)
  - Repository fetching via `git clone` with ref/tag/branch support
  - Repository validation (agent.yaml structure, security checks)
  - File installation (copy to `./agents/<name>/`, write metadata.json, create workspace)
  - Fleet config updating (add/remove agent references in herdctl.yaml, preserving comments)
  - Agent discovery (scan herdctl.yaml to find installed vs manual agents)
  - Agent info retrieval (detailed agent metadata including env var scanning)
  - Agent removal (delete files + remove fleet config reference)
  - Environment variable scanning (detect required env vars from agent files)
  - Installation metadata tracking (source, version, install timestamp)

  **herdctl CLI** — New commands:

  - `herdctl agent add <source>` — Install an agent from GitHub or local path
  - `herdctl agent list` — List all agents in the fleet (installed + manual)
  - `herdctl agent info <name>` — Show detailed agent information
  - `herdctl agent remove <name>` — Remove an installed agent
  - `herdctl init fleet` — Create herdctl.yaml template (split from `herdctl init`)
  - `herdctl init agent [name]` — Interactive agent configuration wizard

  All agent commands support `--config` to specify a custom herdctl.yaml path. The `add` command supports `--force` for reinstallation and `--dry-run` for previewing changes.

## 5.5.0

### Minor Changes

- [#119](https://github.com/edspencer/herdctl/pull/119) [`d52fa37`](https://github.com/edspencer/herdctl/commit/d52fa37f98df825c75f3d0ba29abbe5b838d2c6e) Thanks [@edspencer](https://github.com/edspencer)! - Add configurable message grouping for web chat

  When a Claude Code agent produces multiple assistant text turns separated by tool calls, the web chat now supports displaying each turn as a separate message bubble ("separate" mode) or merging them into one ("grouped" mode).

  - Add `message_grouping` config option to `WebSchema` (default: "separate")
  - Add `chat:message_boundary` WebSocket message for signaling turn boundaries
  - Add client-side toggle to switch between separate and grouped display modes
  - Persist user preference in localStorage with server config as default
  - Add `GET /api/chat/config` endpoint for client to read server defaults

### Patch Changes

- [#120](https://github.com/edspencer/herdctl/pull/120) [`a0e7ad8`](https://github.com/edspencer/herdctl/commit/a0e7ad8cc8c4aa9a8da46bd0b5ff933e56c5158c) Thanks [@edspencer](https://github.com/edspencer)! - Fix shell escaping in Docker CLI runtime to prevent `$` and backtick characters in prompts from being interpreted by the shell. Previously, prompts containing dollar signs (e.g., "$1234") would have `$1` consumed by shell variable expansion, silently corrupting the prompt sent to the agent.

## 5.4.3

### Patch Changes

- [#114](https://github.com/edspencer/herdctl/pull/114) [`63dc4db`](https://github.com/edspencer/herdctl/commit/63dc4dbc87db064cac20abc1b6ea39b778b92847) Thanks [@edspencer](https://github.com/edspencer)! - Fix agent links to use qualified names for correct navigation

  Jobs now store the agent's qualified name (e.g., `herdctl.engineer`) instead of the local name (`engineer`) in job metadata. The web server also resolves older jobs with local names back to qualified names via a fallback lookup.

  On the client side, all agent link construction is now centralized through path helper functions (`agentPath`, `agentChatPath`, `agentTabPath`) to prevent future inconsistencies.

- [#116](https://github.com/edspencer/herdctl/pull/116) [`979dbf6`](https://github.com/edspencer/herdctl/commit/979dbf68510c237f3ba8ceb24b30f9830f6c3e7b) Thanks [@edspencer](https://github.com/edspencer)! - Rename schedule `expression` field to `cron` and suppress repeated warnings

  The `cron` field is now the canonical name for cron expressions in schedule config (e.g., `cron: "0 9 * * *"`). The old `expression` field is still accepted as a backward-compatible alias.

  Misconfigured schedules now log their warning only once instead of every scheduler tick (~1/second).

## 5.4.2

### Patch Changes

- [#100](https://github.com/edspencer/herdctl/pull/100) [`4d1e4d8`](https://github.com/edspencer/herdctl/commit/4d1e4d8925d04a75f92a64360408d9fead9d3730) Thanks [@edspencer](https://github.com/edspencer)! - Log OAuth token refresh response body on failure for easier diagnosis

## 5.4.1

### Patch Changes

- [#97](https://github.com/edspencer/herdctl/pull/97) [`7c928f6`](https://github.com/edspencer/herdctl/commit/7c928f627de425720a5ebadf88900209043921e4) Thanks [@edspencer](https://github.com/edspencer)! - Add Biome for linting and formatting across all packages

## 5.4.0

### Minor Changes

- [#90](https://github.com/edspencer/herdctl/pull/90) [`12b26af`](https://github.com/edspencer/herdctl/commit/12b26af9dc0b7f39dd38c35cb230ca596725731e) Thanks [@edspencer](https://github.com/edspencer)! - Add tool call/result visibility to Web and Slack connectors

  - Extract shared tool parsing utilities (`extractToolUseBlocks`, `extractToolResults`, `getToolInputSummary`, `TOOL_EMOJIS`) from Discord manager into `@herdctl/chat` for reuse across all connectors
  - Add shared `ChatOutputSchema` to `@herdctl/core` config with `tool_results`, `tool_result_max_length`, `system_status`, and `errors` fields; Discord's `DiscordOutputSchema` now extends it
  - Add `output` config field to `AgentChatSlackSchema` for Slack connector output settings
  - Add `tool_results` boolean to fleet-level `WebSchema` for dashboard-wide tool result visibility
  - Slack connector now displays tool call results (name, input summary, duration, output) when `output.tool_results` is enabled (default: true)
  - Web dashboard now streams tool call results via `chat:tool_call` WebSocket messages and renders them as collapsible inline blocks in chat conversations
  - Refactor Discord manager to import shared utilities from `@herdctl/chat` instead of using private methods

## 5.3.0

### Minor Changes

- [#86](https://github.com/edspencer/herdctl/pull/86) [`0f74b63`](https://github.com/edspencer/herdctl/commit/0f74b63d3943ef8f3428e3ec222b2dac461e50eb) Thanks [@edspencer](https://github.com/edspencer)! - Add fleet composition support. Fleets can now reference sub-fleets via the `fleets` YAML field, enabling "super-fleets" that combine multiple project fleets into a unified system.

  Key features:

  - Recursive fleet loading with cycle detection
  - Agents receive qualified names (e.g., `herdctl.security-auditor`) based on fleet hierarchy
  - Defaults merge across fleet levels with clear priority order
  - Web dashboard groups agents by fleet in the sidebar
  - CLI commands accept qualified names for sub-fleet agents
  - Sub-fleet web configurations are automatically suppressed (single dashboard at root)
  - Chat connectors (Discord, Slack) work with qualified agent names

## 5.2.2

### Patch Changes

- [#77](https://github.com/edspencer/herdctl/pull/77) [`04afb3b`](https://github.com/edspencer/herdctl/commit/04afb3bd0b918413351a2e3c88009d803948ddfa) Thanks [@edspencer](https://github.com/edspencer)! - Fix inconsistent Date usage in scheduler that caused flaky cron tests

## 5.2.1

### Patch Changes

- [#75](https://github.com/edspencer/herdctl/pull/75) [`11ec259`](https://github.com/edspencer/herdctl/commit/11ec2593986e0f33a7e69ca4f7d56946c03197c5) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for slack, web, and chat packages; update Related Packages in all package READMEs

## 5.2.0

### Minor Changes

- [#72](https://github.com/edspencer/herdctl/pull/72) [`de00c6b`](https://github.com/edspencer/herdctl/commit/de00c6bf971f582703d3720cc2546173e1b074ea) Thanks [@edspencer](https://github.com/edspencer)! - feat(web): Add web dashboard with real-time fleet monitoring, agent chat, schedule management, and job control

  - Fleet dashboard with real-time status updates via WebSocket
  - Agent detail pages with live output streaming and DiceBear avatars
  - Interactive chat with agents using @herdctl/chat
  - Sidebar with agent sections and nested recent chat sessions
  - Schedule overview with trigger, enable, and disable actions
  - Job management with cancel, fork, and CLI command copying
  - Dark/light/system theme toggle in header
  - CLI integration: `--web` and `--web-port` flags on `herdctl start`
  - Error boundaries, loading states, toast notifications
  - Responsive layout with collapsible sidebar

## 5.1.0

### Minor Changes

- [#69](https://github.com/edspencer/herdctl/pull/69) [`5ca33b5`](https://github.com/edspencer/herdctl/commit/5ca33b53141092ca82ec859d59c4b0ea596fc2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add Slack DM support with enabled/allowlist/blocklist (matching Discord).

  - Rename `DiscordDMSchema` to `ChatDMSchema` (shared between platforms)
  - Add `dm` field to `AgentChatSlackSchema` for DM configuration
  - Implement DM detection and filtering in `SlackConnector` (channel IDs starting with `D`)
  - Add `isDM` flag to `SlackMessageEvent` metadata
  - Add `dm_disabled` and `dm_filtered` message ignored reasons

## 5.0.0

### Major Changes

- [#67](https://github.com/edspencer/herdctl/pull/67) [`4919782`](https://github.com/edspencer/herdctl/commit/4919782fca03800b57f5e0f56f5f9e2e1f8f38e7) Thanks [@edspencer](https://github.com/edspencer)! - Extract shared chat infrastructure into @herdctl/chat, move platform managers from core to platform packages.

  - New `@herdctl/chat` package with shared session manager, streaming responder, message splitting, DM filtering, error handling, and status formatting
  - `DiscordManager` moved from `@herdctl/core` to `@herdctl/discord`
  - `SlackManager` moved from `@herdctl/core` to `@herdctl/slack`
  - `FleetManagerContext` now includes `trigger()` method and generic `getChatManager()`/`getChatManagers()`
  - `AgentInfo` uses `chat?: Record<string, AgentChatStatus>` instead of separate `discord?`/`slack?` fields
  - FleetManager dynamically imports platform packages at runtime

## 4.2.0

### Minor Changes

- [#61](https://github.com/edspencer/herdctl/pull/61) [`1e3a570`](https://github.com/edspencer/herdctl/commit/1e3a570cf4e0d3196a05a3fecbbcd39ae0984dcb) Thanks [@edspencer](https://github.com/edspencer)! - feat(slack): align SlackConnector to per-agent model matching Discord

  Restructured the Slack integration from a single shared connector with channel-agent routing to one connector per agent, matching Discord's per-agent architecture.

  - SlackConnector now takes per-agent options (agentName, channels, sessionManager)
  - SlackManager creates Map<string, ISlackConnector> instead of single connector
  - Event payloads (ready, disconnect, error) now include agentName
  - Added getConnectorNames() and getConnectedCount() to SlackManager
  - Removed getChannelAgentMap() from SlackManager

## 4.1.1

### Patch Changes

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Add verbose logging control and colorized output

  - Add `--verbose` / `-v` flag to `herdctl start` to enable debug logging
  - Add `HERDCTL_LOG_LEVEL` environment variable support (debug/info/warn/error)
  - Add colorized log output in `herdctl start` matching the style of `herdctl logs`
  - Refactor CLIRuntime and CLISessionWatcher to use centralized logger
  - Convert Discord and Slack connector loggers to use centralized `createLogger` from core
  - Internal debug logs are now hidden by default, reducing noise significantly
  - Extract shared color utilities for consistent formatting across CLI commands

- [#53](https://github.com/edspencer/herdctl/pull/53) [`fd8f39d`](https://github.com/edspencer/herdctl/commit/fd8f39d8f53e8d70f36d41ccbbf78a34903ce83d) Thanks [@edspencer](https://github.com/edspencer)! - Downgrade verbose startup log messages from info to debug level in FleetManager, DiscordManager, and SlackManager. Only important milestones ("Fleet manager initialized successfully", "Fleet manager started", "Fleet manager stopped") remain at info level. Detailed step-by-step initialization messages are now debug-level, visible only with --verbose or HERDCTL_LOG_LEVEL=debug.

## 4.1.0

### Minor Changes

- [#47](https://github.com/edspencer/herdctl/pull/47) [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1) Thanks [@ikido](https://github.com/ikido)! - feat: add file sending from agents via SDK tool injection (WEA-17)

  Agents can now upload files to the originating Slack thread using the `herdctl_send_file` MCP tool, injected at runtime via the Claude Agent SDK's in-process MCP server support.

  - Core: `createFileSenderMcpServer()` factory creates an in-process MCP server with `herdctl_send_file` tool
  - Core: `injectedMcpServers` field threaded through TriggerOptions → RunnerOptions → RuntimeExecuteOptions → SDKRuntime
  - Core: SDKRuntime merges injected MCP servers with config-declared servers at execution time
  - Slack: `uploadFile()` method on SlackConnector using Slack's `files.uploadV2` API
  - Slack: SlackManager automatically injects file sender MCP server for all agent jobs
  - Path security: tool handler validates file paths stay within the agent's working directory

- [#47](https://github.com/edspencer/herdctl/pull/47) [`0953e36`](https://github.com/edspencer/herdctl/commit/0953e362fcdf3efb389cee6cae43bbafc6b7c1d1) Thanks [@ikido](https://github.com/ikido)! - feat: add Slack integration for agent chat

  Adds `@herdctl/slack` package and integrates it into `@herdctl/core`:

  - New `@herdctl/slack` package with SlackConnector (Bolt/Socket Mode), SessionManager, CommandHandler, error handling, and mrkdwn formatting
  - Config schema: `AgentChatSlackSchema` and `SlackHookConfigSchema` for agent chat and hook configuration
  - Core: `SlackManager` for single-connector-per-workspace lifecycle management with channel-to-agent routing
  - Core: `SlackHookRunner` for posting schedule results to Slack channels
  - Core: FleetManager wiring (initialize/start/stop), status queries, and event types for Slack connector
  - Example: `examples/slack-chat-bot/` with setup instructions

### Patch Changes

- [#51](https://github.com/edspencer/herdctl/pull/51) [`1bb966e`](https://github.com/edspencer/herdctl/commit/1bb966e104c15cadba4554cb24d678fc476c0ac9) Thanks [@edspencer](https://github.com/edspencer)! - Fix symlink bypass in file-sender-mcp path validation, narrow Slack error classification, add missing event types, and correct help text

  - **Security**: Use `realpath()` before path containment check in file-sender-mcp to prevent symlink bypass
  - **Bug fix**: Narrow `classifyError()` token matching from broad `"token"` substring to specific Slack API error codes (`token_revoked`, `token_expired`, `not_authed`)
  - **Types**: Add typed `FleetManagerEventMap` entries for four Slack manager events (`slack:message:handled`, `slack:message:error`, `slack:error`, `slack:session:lifecycle`)
  - **Docs**: Fix help text to reflect channel-based sessions instead of thread-based
  - **Deps**: Add `@herdctl/slack` to CLI dependencies so `npx herdctl start` includes Slack support
  - **Build**: Configure changesets `onlyUpdatePeerDependentsWhenOutOfRange` to prevent unnecessary major version bumps on core when connector packages are updated

## 4.0.0

### Minor Changes

- [#48](https://github.com/edspencer/herdctl/pull/48) [`f4af511`](https://github.com/edspencer/herdctl/commit/f4af511158f02e5f07d6e1c346a6b31bcdcba9b0) Thanks [@edspencer](https://github.com/edspencer)! - Show tool results, system status, errors, and result summaries as Discord embeds

  Previously, when Claude used tools like Bash during a Discord conversation, only text responses were shown - tool outputs were silently dropped. Now tool results appear as compact Discord embeds with:

  - Tool name and emoji (Bash, Read, Write, Edit, Grep, Glob, WebSearch, etc.)
  - Input summary (the command, file path, or search pattern)
  - Duration of the tool call
  - Output length and truncated result in a code block
  - Color coding: blurple for success, red for errors

  Additional SDK message types are now surfaced in Discord:

  - System status messages (e.g., "Compacting context...") shown as gray embeds
  - SDK error messages shown as red error embeds
  - Optional result summary embed with duration, turns, cost, and token usage

  All output types are configurable via the new `output` block in agent Discord config:

  ```yaml
  chat:
    discord:
      output:
        tool_results: true # Show tool result embeds (default: true)
        tool_result_max_length: 900 # Max chars in output (default: 900, max: 1000)
        system_status: true # Show system status embeds (default: true)
        result_summary: false # Show completion summary (default: false)
        errors: true # Show error embeds (default: true)
  ```

  The reply function now accepts both plain text and embed payloads, allowing rich message formatting alongside streamed text responses.

### Patch Changes

- Updated dependencies [[`f4af511`](https://github.com/edspencer/herdctl/commit/f4af511158f02e5f07d6e1c346a6b31bcdcba9b0)]:
  - @herdctl/discord@0.2.0

## 3.0.2

### Patch Changes

- [#44](https://github.com/edspencer/herdctl/pull/44) [`3ff726f`](https://github.com/edspencer/herdctl/commit/3ff726fbe192109d89847b4c0c47b255d1ac82cd) Thanks [@edspencer](https://github.com/edspencer)! - Fix cron schedules never firing after first trigger

  The scheduler's cron check logic incorrectly skipped to the next future occurrence
  when the scheduled time arrived, instead of recognizing it as due. This caused cron
  schedules to never trigger after the initial run because `calculateNextCronTrigger(expression, now)`
  always returns a time in the future.

  The fix simplifies the logic to use `calculateNextCronTrigger(expression, lastRunAt)` directly,
  letting `isScheduleDue()` determine if it's time to trigger. After triggering, `last_run_at`
  updates to the current time, naturally advancing the schedule to the next occurrence.

- Updated dependencies []:
  - @herdctl/discord@0.1.10

## 3.0.1

### Patch Changes

- [#40](https://github.com/edspencer/herdctl/pull/40) [`5cdfe8e`](https://github.com/edspencer/herdctl/commit/5cdfe8ec44dec4d27c78dd0107f14bb1d8b62f29) Thanks [@edspencer](https://github.com/edspencer)! - Add path traversal protection for agent names and state file paths

  Security improvements:

  - Add `buildSafeFilePath` utility that validates identifiers before constructing file paths
  - Add `PathTraversalError` class for clear error reporting when traversal is detected
  - Update session.ts and job-metadata.ts to use safe path construction
  - Add `AGENT_NAME_PATTERN` regex validation in schema.ts to reject invalid agent names at config parsing time
  - Defense-in-depth: validation at both schema level and file path construction

  This prevents attackers from using agent names like `../../../etc/passwd` to read or write files outside the intended state directories.

- Updated dependencies []:
  - @herdctl/discord@0.1.9

## 3.0.0

### Major Changes

- [#38](https://github.com/edspencer/herdctl/pull/38) [`1f0dc9e`](https://github.com/edspencer/herdctl/commit/1f0dc9e655e69bd46d0f7b2e2dece70ce8451459) Thanks [@edspencer](https://github.com/edspencer)! - BREAKING: Flatten permissions config to match Claude Agents SDK

  This is a breaking change that removes the nested `permissions` object in agent and fleet configuration. The old structure:

  ```yaml
  permissions:
    mode: acceptEdits
    allowed_tools:
      - Read
      - Write
    denied_tools:
      - WebSearch
    bash:
      allowed_commands:
        - git
        - npm
      denied_patterns:
        - "rm -rf *"
  ```

  Is now the flat SDK-compatible structure:

  ```yaml
  permission_mode: acceptEdits
  allowed_tools:
    - Read
    - Write
    - "Bash(git *)"
    - "Bash(npm *)"
  denied_tools:
    - WebSearch
    - "Bash(rm -rf *)"
  ```

  **Key changes:**

  - `permissions.mode` → `permission_mode` (top-level)
  - `permissions.allowed_tools` → `allowed_tools` (top-level)
  - `permissions.denied_tools` → `denied_tools` (top-level)
  - `permissions.bash.allowed_commands` → Use `Bash(cmd *)` patterns in `allowed_tools`
  - `permissions.bash.denied_patterns` → Use `Bash(pattern)` patterns in `denied_tools`

  **Why this change:**

  1. Direct 1:1 mapping to Claude Agents SDK options
  2. Familiar to anyone who knows Claude Code CLI or SDK
  3. No magic transformation or hidden behavior
  4. Simpler config parsing and validation

  **Migration:**

  Replace nested `permissions` object with flat fields. Transform bash convenience syntax into standard `Bash()` patterns.

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.8

## 2.1.0

### Minor Changes

- [#36](https://github.com/edspencer/herdctl/pull/36) [`39b1937`](https://github.com/edspencer/herdctl/commit/39b193776e67d5a5d412174d24a560df16c0d46c) Thanks [@edspencer](https://github.com/edspencer)! - Expand Docker configuration with tiered security model and new options.

  ## Security: Tiered Docker Configuration

  Docker options are now split into two schemas based on security risk:

  **Agent-level config** (`herdctl-agent.yml`) - Safe options only:

  - `enabled`, `ephemeral`, `memory`, `cpu_shares`, `cpu_period`, `cpu_quota`
  - `max_containers`, `workspace_mode`, `tmpfs`, `pids_limit`, `labels`

  **Fleet-level config** (`herdctl.yml`) - All options including dangerous ones:

  - All agent-level options, plus:
  - `image`, `network`, `volumes`, `user`, `ports`, `env`
  - `host_config` - Raw dockerode HostConfig passthrough for advanced options

  This prevents agents from granting themselves dangerous capabilities (like `network: "host"` or mounting sensitive volumes) since agent config files live in the agent's working directory.

  ## New Options

  - `ports` - Port bindings in format "hostPort:containerPort" or "containerPort"
  - `tmpfs` - Tmpfs mounts for fast in-memory temp storage
  - `pids_limit` - Maximum number of processes (prevents fork bombs)
  - `labels` - Container labels for organization and filtering
  - `cpu_period` / `cpu_quota` - Hard CPU limits (more precise than cpu_shares)

  ## Fleet-level `host_config` Passthrough

  For advanced users who need dockerode options not in our schema:

  ```yaml
  defaults:
    docker:
      enabled: true
      memory: "2g"
      host_config: # Raw dockerode HostConfig
        ShmSize: 67108864
        Privileged: true # Use with caution!
  ```

  Values in `host_config` override any translated options.

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.7

## 2.0.1

### Patch Changes

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - fix(core): Docker CLI runtime session persistence

  Fixed session resumption for CLI runtime agents running in Docker containers.

  **The bug:** When resuming a session with Docker enabled, the CLI runtime was watching the wrong session file path (`~/.claude/projects/...`) instead of the Docker-mounted session directory (`.herdctl/docker-sessions/`). This caused the session watcher to yield 0 messages, resulting in fallback responses despite Claude correctly remembering conversation context.

  **The fix:**

  1. Updated `validateSessionWithFileCheck` to check Docker session files at `.herdctl/docker-sessions/` when `session.docker_enabled` is true
  2. Updated `CLIRuntime` to use `sessionDirOverride` when resuming sessions, not just when starting new ones

  This ensures both session validation and session file watching use the correct paths for Docker-based CLI runtime execution.

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - Fix job streaming events during schedule execution.

  Added `onJobCreated` callback to `RunnerOptionsWithCallbacks` so the job ID is available before execution starts. Previously, the job ID was only set after `executor.execute()` returned, which meant `job:output` streaming events couldn't be emitted during execution.

  Now the schedule executor receives the job ID via callback as soon as the job is created, enabling real-time streaming of job output events throughout execution.

- [#33](https://github.com/edspencer/herdctl/pull/33) [`b08d770`](https://github.com/edspencer/herdctl/commit/b08d77076584737e9a4198476959510fa60ae356) Thanks [@edspencer](https://github.com/edspencer)! - Fix job summary extraction and improve Discord notification formatting.

  **Summary extraction fix:**
  Previously, the `extractSummary` function captured summaries from short assistant messages (≤500 characters), which meant if an agent sent a short preliminary message ("I'll fetch the weather...") followed by a long final response, the preliminary message would be used as the summary.

  Now the logic tracks the last non-partial assistant message content separately and uses it as the summary, ensuring Discord hooks receive the actual final response.

  **Truncation changes:**

  - Removed truncation from core summary extraction (job-executor, message-processor) - full content is now stored
  - Truncation is now handled solely by downstream consumers at their specific limits

  **Discord notification improvements:**

  - Moved output from embed field (1024 char limit) to embed description (4096 char limit)
  - This allows much longer agent responses to be displayed in Discord notifications
  - Metadata and error fields remain in their own fields with appropriate limits

  This ensures Discord hooks and other consumers receive the full final response from the agent, with each consumer handling truncation at their own appropriate limits.

- Updated dependencies []:
  - @herdctl/discord@0.1.6

## 2.0.0

### Major Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - **BREAKING CHANGE**: Rename `workspace` config field to `working_directory`

  The configuration field `workspace` has been renamed to `working_directory` throughout the codebase for better clarity. This affects:

  - Fleet config: `defaults.workspace` → `defaults.working_directory`
  - Agent config: `workspace` → `working_directory`
  - Fleet config: top-level `workspace` → `working_directory`

  **Backward compatibility**: The old `workspace` field is still supported with automatic migration and deprecation warnings. Configs using `workspace` will continue to work but will emit a warning encouraging migration to `working_directory`.

  **Migration**: Replace all occurrences of `workspace:` with `working_directory:` in your YAML config files.

### Minor Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add Docker container runtime support for agent execution

  Agents can now be executed inside Docker containers instead of directly on the host machine. This provides better isolation, environment control, and resource management.

  **New Configuration**:

  ```yaml
  docker:
    enabled: true
    image: "anthropics/claude-code:latest"
    workspaceMode: "rw" # or "ro" for read-only
    cpus: 2.0
    memory: "2g"
    network: "bridge"
    mounts:
      - hostPath: "/host/path"
        containerPath: "/container/path"
        mode: "rw"
    environment:
      KEY: "value"
  ```

  **Features**:

  - Container-based agent execution with full isolation
  - Ephemeral containers by default (clean state each execution)
  - Configurable resource limits (CPU, memory)
  - Volume mounting for workspace and custom paths
  - Environment variable injection (custom vars + CLAUDE_CODE_OAUTH_TOKEN)
  - Automatic git authentication when GITHUB_TOKEN is provided
  - Network configuration (bridge, host, none)
  - Automatic image pulling and container lifecycle management
  - Proper cleanup on both success and failure
  - Works with both SDK and CLI runtimes

  **Use Cases**:

  - Run agents in isolated environments
  - Control resource usage per agent
  - Ensure consistent execution environments
  - Enhanced security through containerization

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add runtime selection between SDK and CLI for agent execution

  Agents can now choose between two execution runtimes:

  - **SDK Runtime** (default): Uses Claude Agent SDK with standard Claude Code features
  - **CLI Runtime**: Uses `claude-p` CLI invocation to preserve Claude Max tokens

  **New Configuration**:

  ```yaml
  # Agent-level runtime selection
  runtime: sdk  # or "cli"

  # Or with CLI-specific options
  runtime:
    type: cli
    command: claude-p  # Custom CLI command (optional)
  ```

  **SDK Runtime** (Default):

  - Full Claude Agent SDK integration
  - All standard Claude Code features
  - Standard token consumption

  **CLI Runtime**:

  - Invokes `claude -p` directly (or custom Claude CLI fork)
  - Preserves Claude Max tokens instead of consuming API credits
  - Session file watching for message streaming
  - Works with both host and Docker execution

  **Full Configuration Pass-Through**:
  Both runtimes support the complete agent configuration:

  - `model` - Model selection (e.g., claude-sonnet-4-20250514)
  - `system_prompt` - Custom system prompts
  - `permission_mode` - Permission handling (acceptEdits, plan, etc.)
  - `permissions.allowed_tools` / `permissions.denied_tools` - Tool access control
  - `permissions.bash.allowed_commands` / `permissions.bash.denied_patterns` - Bash restrictions
  - `mcp_servers` - MCP server configuration
  - `setting_sources` - Setting source configuration

  **Use Cases**:

  - Preserve Claude Max tokens for long-running agents
  - Use custom Claude CLI forks with modified behavior
  - Switch between SDK and CLI without code changes
  - Test different runtime behaviors

  The runtime architecture is pluggable, making it easy to add additional runtime types in the future.

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Add runtime context tracking to sessions

  Sessions now track the runtime configuration (SDK vs CLI, Docker vs native) they were created with. This prevents session resume errors when switching between runtime modes.

  **Session Schema Updates**:

  - Added `runtime_type` field (defaults to "sdk" for legacy sessions)
  - Added `docker_enabled` field (defaults to false for legacy sessions)

  **Validation**:

  - Sessions are automatically invalidated when runtime context changes
  - Prevents "conversation not found" errors when switching Docker mode
  - Clear error messages explain why sessions were cleared

  **Migration**:

  - Legacy sessions automatically get default values via Zod schema
  - No manual migration needed - sessions self-heal on first use
  - Context mismatches trigger automatic session cleanup

  This ensures sessions remain valid only for the runtime configuration they were created with, preventing confusion when enabling/disabling Docker or switching between SDK and CLI runtimes.

### Patch Changes

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Fix Discord typing indicator to stop immediately when messages are sent

  The typing indicator now stops as soon as the first message is sent, rather than continuing to show "typing..." while messages are being delivered. This provides a more natural chat experience.

  **Improvements**:

  - Stop typing immediately after SDK execution completes
  - Stop typing when the first streamed message is sent
  - Prevent multiple stopTyping calls with state tracking
  - Proper cleanup in finally block for error cases
  - Removed verbose debug logging for cleaner output

- [#31](https://github.com/edspencer/herdctl/pull/31) [`ebd3e16`](https://github.com/edspencer/herdctl/commit/ebd3e164149711cff75d52c9a8b0db518fa12d5d) Thanks [@edspencer](https://github.com/edspencer)! - Detect and clear stale sessions when working_directory changes

  Adds automatic detection of working directory changes between sessions. When the `working_directory` changes, Claude Code looks for the session file in a different project directory and fails with ENOENT errors.

  **Behavior**:

  - Session metadata now stores the `working_directory` path
  - On session resume, validates that `working_directory` hasn't changed
  - If changed, logs a warning with old → new paths
  - Automatically clears the stale session
  - Starts fresh session instead of attempting failed resume

  **Example Warning**:

  ```
  Working directory changed from /old/path to /new/path - clearing stale session abc123
  ```

  This prevents confusing "session file not found" errors when users change their agent's `working_directory` configuration.

- Updated dependencies []:
  - @herdctl/discord@0.1.5

## 1.3.1

### Patch Changes

- [#20](https://github.com/edspencer/herdctl/pull/20) [`3816d08`](https://github.com/edspencer/herdctl/commit/3816d08b5a9f2b2c6bccbd55332c8cec0da0c7a6) Thanks [@edspencer](https://github.com/edspencer)! - Fix system prompt not being passed to Claude SDK correctly. Custom system prompts were being ignored because we passed `{ type: 'custom', content: '...' }` but the SDK expects a plain string for custom prompts.

- Updated dependencies []:
  - @herdctl/discord@0.1.4

## 1.3.0

### Minor Changes

- [#17](https://github.com/edspencer/herdctl/pull/17) [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add .env file support for environment variable loading

  The config loader now automatically loads `.env` files from the config directory before interpolating environment variables. This makes it easier to manage environment-specific configuration without setting up shell environment variables.

  Features:

  - Automatically loads `.env` from the same directory as `herdctl.yaml`
  - System environment variables take precedence over `.env` values
  - New `envFile` option in `loadConfig()` to customize behavior:
    - `true` (default): Auto-load `.env` from config directory
    - `false`: Disable `.env` loading
    - `string`: Specify a custom path to the `.env` file

  Example `.env.example` file added to the discord-chat-bot example.

- [#17](https://github.com/edspencer/herdctl/pull/17) [`9fc000c`](https://github.com/edspencer/herdctl/commit/9fc000c9d2275de6df3c2f87fa2242316c15d2eb) Thanks [@edspencer](https://github.com/edspencer)! - Add per-agent config overrides when referencing agents in fleet config

  You can now override any agent configuration field when referencing an agent in your fleet's `herdctl.yaml`:

  ```yaml
  agents:
    - path: ./agents/my-agent.yaml
      overrides:
        schedules:
          check:
            interval: 2h # Override the default interval
        hooks:
          after_run: [] # Disable all hooks for this fleet
  ```

  Overrides are deep-merged after fleet defaults are applied, so you only need to specify the fields you want to change. Arrays are replaced entirely (not merged).

  This enables:

  - Reusing agent configs across fleets with different settings
  - Customizing schedules, hooks, permissions per-fleet
  - Disabling features (like Discord notifications) for specific fleets

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.3

## 1.2.0

### Minor Changes

- [#15](https://github.com/edspencer/herdctl/pull/15) [`5d6d948`](https://github.com/edspencer/herdctl/commit/5d6d9487c67c4178b5806c1f234bfebfa28a7ac3) Thanks [@edspencer](https://github.com/edspencer)! - Add `herdctl sessions` command to discover and resume Claude Code sessions

  When agents run with session persistence enabled, herdctl tracks Claude Code session IDs. This new command makes those sessions discoverable and resumable:

  ```bash
  # List all sessions
  herdctl sessions

  # Output:
  # Sessions (2)
  # ══════════════════════════════════════════════════════════════════════════════════════
  # AGENT               SESSION ID                               LAST ACTIVE   JOBS
  # ─────────────────────────────────────────────────────────────────────────────────────
  # bragdoc-developer   a166a1e4-c89e-41f8-80c8-d73f6cd0d39c     5m ago        19
  # price-checker       b234e5f6-a78b-49c0-d12e-3456789abcde     2h ago        3

  # Resume the most recent session
  herdctl sessions resume

  # Resume a specific session (supports partial ID match)
  herdctl sessions resume a166a1e4
  herdctl sessions resume bragdoc-developer  # or by agent name

  # Show full resume commands
  herdctl sessions --verbose

  # Filter by agent
  herdctl sessions --agent bragdoc-developer

  # JSON output for scripting
  herdctl sessions --json
  ```

  The `resume` command launches Claude Code with `--resume <session-id>` in the agent's configured workspace directory, making it easy to pick up where a Discord bot or scheduled agent left off.

  Also adds `listSessions()` function to `@herdctl/core` for programmatic access.

### Patch Changes

- Updated dependencies []:
  - @herdctl/discord@0.1.2

## 1.1.0

### Minor Changes

- [#14](https://github.com/edspencer/herdctl/pull/14) [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b) Thanks [@edspencer](https://github.com/edspencer)! - Stream Discord messages incrementally instead of batching

  Previously, Discord chat would show "typing" for the entire duration of agent execution, then send all messages at once when complete. This could mean minutes of waiting with no feedback.

  Now messages are streamed incrementally to Discord as the agent generates them:

  - Messages sent at natural paragraph breaks (double newlines)
  - Rate limiting respected (1 second minimum between sends)
  - Large content automatically split at Discord's 2000 character limit
  - Typing indicator continues between message sends

  This provides a much more responsive chat experience, similar to how the CLI streams output.

### Patch Changes

- [#12](https://github.com/edspencer/herdctl/pull/12) [`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b) Thanks [@edspencer](https://github.com/edspencer)! - Add README files for npm package pages

  Each package now has a README that appears on npmjs.com with:

  - Package overview and purpose
  - Installation instructions
  - Quick start examples
  - Links to full documentation at herdctl.dev
  - Related packages

- [#14](https://github.com/edspencer/herdctl/pull/14) [`f24f2b6`](https://github.com/edspencer/herdctl/commit/f24f2b6d6a48be1024d7bda4d3297770d74a172b) Thanks [@edspencer](https://github.com/edspencer)! - Fix project-embedded agents to fully inherit workspace configuration

  Three related changes for agents that point at existing Claude Code projects (the "Software Developer Agent" pattern):

  1. **Working directory**: The `workspace` configuration is now correctly passed to the Claude SDK as the `cwd` option, so agents run in their configured workspace directory instead of wherever herdctl was launched.

  2. **Settings discovery**: When `workspace` is configured, `settingSources` is now set to `["project"]` by default, enabling the agent to discover and use CLAUDE.md, skills, commands, and other Claude Code configuration from the workspace.

  3. **Explicit configuration**: Added `setting_sources` option to agent YAML for explicit control over settings discovery:
     ```yaml
     setting_sources:
       - project # Load from .claude/ in workspace
       - local # Load from user's local Claude config
     ```

  This enables herdctl agents to operate inside existing codebases with full access to project-specific Claude Code configuration - they behave as if you ran `claude` directly in that directory.

- Updated dependencies [[`d763625`](https://github.com/edspencer/herdctl/commit/d7636258d5c7a814fec9a3ad7d419e919df6af9b)]:
  - @herdctl/discord@0.1.1

## 1.0.0

### Minor Changes

- [#10](https://github.com/edspencer/herdctl/pull/10) [`e33ddee`](https://github.com/edspencer/herdctl/commit/e33ddee788daaefa35c242ce1c7673d7883a2be5) Thanks [@edspencer](https://github.com/edspencer)! - Add Claude Agent SDK session resumption for Discord conversation continuity

  - Add `resume` option to `TriggerOptions` to pass session ID for conversation continuity
  - Add `sessionId` and `success` to `TriggerResult` to return job result and SDK session ID
  - Update `JobControl.trigger()` to pass `resume` through and return `success` status
  - Add `setSession()` method to Discord SessionManager for storing SDK session IDs
  - Update `DiscordManager.handleMessage()` to:
    - Get existing session ID before triggering (via `getSession()`)
    - Pass session ID as `resume` option to `trigger()`
    - Only store SDK session ID after **successful** job completion (prevents invalid session accumulation)

  This enables conversation continuity in Discord DMs and channels - Claude will remember
  the context from previous messages in the conversation. Session IDs from failed jobs
  are not stored, preventing the accumulation of invalid session references.

### Patch Changes

- Updated dependencies [[`e33ddee`](https://github.com/edspencer/herdctl/commit/e33ddee788daaefa35c242ce1c7673d7883a2be5)]:
  - @herdctl/discord@0.1.0

## 0.3.0

### Minor Changes

- [#8](https://github.com/edspencer/herdctl/pull/8) [`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41) Thanks [@edspencer](https://github.com/edspencer)! - Add Discord chat integration via DiscordManager module

  - DiscordManager manages lifecycle of Discord connectors per agent
  - Messages routed to FleetManager.trigger() for Claude execution
  - Responses delivered back to Discord channels with automatic splitting
  - Session persistence across restarts via SessionManager
  - New events: discord:message:handled, discord:message:error, discord:error
  - New status queries: getDiscordStatus(), getDiscordConnectorStatus()

### Patch Changes

- Updated dependencies [[`5423647`](https://github.com/edspencer/herdctl/commit/54236477ed55e655c756bb601985d946d7eb4b41)]:
  - @herdctl/discord@0.0.4

## 0.2.0

### Minor Changes

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add default_prompt agent config and getJobFinalOutput API

  - Add `default_prompt` field to agent config schema for sensible defaults when triggering without --prompt
  - Add `getJobFinalOutput(jobId)` method to FleetManager for retrieving agent's final response from JSONL
  - Pass `maxTurns` option through to Claude SDK to limit agent turns
  - Change SDK `settingSources` to empty by default - autonomous agents should not load Claude Code project settings (CLAUDE.md)
  - Log hook output to console for visibility when shell hooks produce output

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add DiscordHookRunner for Discord channel notifications

  - Implement DiscordHookRunner that posts job notifications to Discord channels
  - Uses Discord embeds with appropriate colors (green for success, red for failure, amber for timeout, gray for cancelled)
  - Bot token read from environment variable (configurable via bot_token_env)
  - Output truncated to max 1000 chars in embed
  - Supports filtering notifications by event type via on_events
  - Human-readable duration formatting (ms, seconds, minutes, hours)
  - Includes agent name, job ID, schedule, duration, and error details in embed

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add hooks metadata feature and fix SDK message streaming

  **Hooks Metadata:**

  - Add `when` field for conditional hook execution using dot-notation paths
  - Add `name` field for human-readable hook names in logs
  - Add `metadata_file` agent config for reading agent-provided metadata
  - Include agent metadata in HookContext for conditional execution
  - Display metadata in Discord embed notifications

  **SDK Message Streaming:**

  - Fix content extraction from nested SDK message structure
  - Add support for `stream_event`, `tool_progress`, `auth_status` message types
  - Add `onMessage` callback to `TriggerOptions` for real-time message streaming

  **Output Extraction:**

  - Fix `extractJobOutput` to prefer assistant text over raw tool results
  - Discord notifications now show agent's text summary instead of JSON

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add shell script hook execution after job completion

  - Implement ShellHookRunner that executes shell commands with HookContext JSON on stdin
  - Add HookExecutor to orchestrate hook execution with event filtering and error handling
  - Support `continue_on_error` option (default: true) to control whether hook failures affect job status
  - Support `on_events` filter to run hooks only for specific events (completed, failed, timeout, cancelled)
  - Default timeout of 30 seconds for shell commands
  - Integrate hooks into ScheduleExecutor to run after job completion
  - Add hook configuration schemas to agent config (`hooks.after_run`, `hooks.on_error`)
  - Full test coverage for ShellHookRunner and HookExecutor

- [#6](https://github.com/edspencer/herdctl/pull/6) [`5620ea2`](https://github.com/edspencer/herdctl/commit/5620ea2d35ff274641678f46b22b46d5d2a1cb49) Thanks [@edspencer](https://github.com/edspencer)! - Add WebhookHookRunner for POST/PUT webhook integrations

  - Implement WebhookHookRunner that POSTs HookContext JSON to configured URLs
  - Support custom headers with ${ENV_VAR} substitution for auth tokens
  - Support POST and PUT HTTP methods
  - Default timeout of 10000ms (configurable)
  - HTTP 2xx responses are treated as success, all others as failure
  - HTTP errors are logged but don't fail the job by default (continue_on_error: true)

## 0.1.0

### Minor Changes

- [`b5bb261`](https://github.com/edspencer/herdctl/commit/b5bb261247e65551a15c1fc4451c867b666feefe) Thanks [@edspencer](https://github.com/edspencer)! - Fix trigger command to actually execute jobs

  Previously, `herdctl trigger <agent>` would create a job metadata file but never
  actually run the agent. The job would stay in "pending" status forever.

  Now trigger() uses JobExecutor to:

  - Create the job record
  - Execute the agent via Claude SDK
  - Stream output to job log
  - Update job status on completion

  This is a minor version bump as it adds new behavior (job execution) rather than
  breaking existing APIs. The trigger() method signature is unchanged.

- [#4](https://github.com/edspencer/herdctl/pull/4) [`6eca6b3`](https://github.com/edspencer/herdctl/commit/6eca6b33458f99b2edc43e42a78d88984964b5d8) Thanks [@edspencer](https://github.com/edspencer)! - Add strict schema validation to catch misconfigured agent YAML files

  Agent and fleet configs now reject unknown/misplaced fields instead of silently ignoring them. For example, putting `allowed_tools` at the root level (instead of under `permissions`) now produces a clear error:

  ```
  Agent configuration validation failed in 'agent.yaml':
    - (root): Unrecognized key(s) in object: 'allowed_tools'
  ```

## 0.0.2

### Patch Changes

- [`38d8f12`](https://github.com/edspencer/herdctl/commit/38d8f12c13afbfb974444acf23d82d51d38b0844) Thanks [@edspencer](https://github.com/edspencer)! - Initial changesets setup for automated npm publishing
