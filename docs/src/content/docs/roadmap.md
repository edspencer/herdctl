---
title: Roadmap
description: Recently shipped work, known open work, and future direction for herdctl
---

This page summarizes what has shipped recently, what is known open work, and the longer-term direction for herdctl. Forward-looking items may change as the project evolves. For the full history of shipped features, see [What's New](/whats-new/).

## Recently Shipped

The library surface has grown substantially through the `@herdctl/core` 5.13–5.18 releases:

- **Streaming chat sessions** — `FleetManager.openChatSession()` returns a live multi-turn `RuntimeSession` with `send()`, `interrupt()`, `listCommands()`, and `setModel()` (core 5.14.0). See [Sessions](/concepts/sessions/).
- **Real job cancellation** — `cancelJob()` actually interrupts the running agent process instead of only rewriting the job's status file (core 5.14.1).
- **Session forking** — `trigger('agent', undefined, { fork: sessionId })` branches an existing conversation into an independent child session (core 5.15.0).
- **Slash command discovery** — `listAgentCommands()` returns an agent's available slash commands in one call (core 5.16.0).
- **Claude Agent SDK 0.3 + Zod 4** — upgraded to the SDK line that runs the native Claude Code binary with the current agentic toolset (core 5.17.0).
- **Session reaper and durable wakes** — managed sessions are reaped when idle, and in-session `ScheduleWakeup`/`CronCreate` timers are captured and re-fired through the fleet scheduler, giving agents real cross-turn autonomy (core 5.18.0).
- **Agent distribution** — `herdctl agent add <source>` installs agents from GitHub repositories or local paths, with `herdctl.json` metadata (core 5.6.0).
- **Persistent agent memory** — the `context.md` pattern for memory that survives across jobs is documented in the [Persistent Memory Guide](/guides/persistent-memory/) and used by the bundled examples.

## Known Open Work

Tracked in the [issue tracker](https://github.com/edspencer/herdctl/issues):

- **Event gaps for manual triggers** — `job:created` is emitted only after a manually triggered job finishes, and `job:output` is never emitted for manual `trigger()` runs (only scheduled runs). Use the `onMessage`/`onJobCreated` callbacks in the meantime. [#328](https://github.com/edspencer/herdctl/issues/328)
- **Declared-but-unemitted events** — `agent:started` and `agent:stopped` are declared and documented but never fired. [#323](https://github.com/edspencer/herdctl/issues/323)
- **`denied_tools` on the SDK runtime** — silently ignored due to a `deniedTools` vs `disallowedTools` mismatch. [#322](https://github.com/edspencer/herdctl/issues/322)
- **Fleet-level chat config** — accepted by the schema but unused at runtime. [#329](https://github.com/edspencer/herdctl/issues/329)
- **Default toolset** — provide a first-class default/standard toolset and clarify headless `allowed_tools` semantics. [#281](https://github.com/edspencer/herdctl/issues/281)
- **Per-agent chat verbosity** — verbosity control across Discord, Slack, and Web frontends. [#181](https://github.com/edspencer/herdctl/issues/181)
- **Session attribution** — assign unattributed Claude Code sessions to agents. [#143](https://github.com/edspencer/herdctl/issues/143)
- **File transfer** — inbound file/image transfer from Discord and Slack to agents ([#59](https://github.com/edspencer/herdctl/issues/59)) and agent-to-Discord file sending ([#55](https://github.com/edspencer/herdctl/issues/55)).
- **MCP bridge auth** — per-request bearer token authentication for the MCP HTTP bridge. [#54](https://github.com/edspencer/herdctl/issues/54)

## Longer-Term Direction

These are ideas under consideration, not committed work:

- **Dynamic scheduling for jobs** — let scheduled agents request their own next run time via an injected MCP tool. Session-based agents already get this through durable wakes (`ScheduleWakeup`); config-defined job schedules are still static.
- **Agent-to-agent communication** — injected MCP tools for agents to delegate tasks to and share results with other agents in their fleet.
- **Pluggable chat connectors** — allow anyone to write their own chat integration without changes to herdctl itself, building on the shared `@herdctl/chat` layer.
- **Agent marketplace** — a place to publish and discover reusable agent definitions, building on the shipped `herdctl agent add` distribution system.
