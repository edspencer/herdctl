/**
 * SDK Runtime implementation
 *
 * Wraps the Claude Agent SDK behind the RuntimeInterface, providing
 * a unified execution interface for the SDK backend.
 *
 * This adapter delegates to the SDK's query() function and converts
 * agent configuration to SDK options using the existing toSDKOptions adapter.
 */

import {
  type BackgroundTaskSummary,
  createSdkMcpServer,
  query,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildLifecycleHooks, tapLifecycleStream } from "../../session/session-hooks.js";
import type { SessionLifecycleSignal } from "../../session/types.js";
import { isTerminalMessage } from "../message-processor.js";
import { toSDKOptions } from "../sdk-adapter.js";
import type { InjectedMcpServerDef, SDKMessage } from "../types.js";
import { withClaudeConfigDir } from "./claude-config-dir.js";
import { defaultClaudeHome } from "./cli-session-path.js";
import type { RuntimeExecuteOptions, RuntimeInterface, RuntimeSession } from "./interface.js";
import { MessageQueue } from "./message-queue.js";

/**
 * Ceiling for holding a one-shot `execute()` run's terminal message while a
 * `run_in_background` Agent-tool subagent it spawned is still live (issue #458).
 * Mirrors `claude -p`'s own `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (default
 * 10 min since Claude Code 2.1.182; `0` disables the wait) — the SDK runtime
 * gets the same background-subagent grace the CLI runtime already gets.
 */
const DEFAULT_BG_WAIT_CEILING_MS = 10 * 60_000;
function bgWaitCeilingMs(): number {
  const raw = process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS;
  if (raw === undefined || raw === "") return DEFAULT_BG_WAIT_CEILING_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BG_WAIT_CEILING_MS;
}

/** Sentinel distinguishing "the ceiling timer won the race" from a real message. */
const BG_WAIT_TIMED_OUT = Symbol("bg-wait-timed-out");

/**
 * Build a streaming-input user message from plain text.
 *
 * The SDK fills in the real `session_id`, so an empty string is fine here. A
 * leading-slash text (e.g. `"/compact"`) is dispatched by the CLI as a slash
 * command — no special encoding required.
 */
function toUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    session_id: "",
  } as SDKUserMessage;
}

/**
 * Convert a JSON Schema property to a Zod schema.
 *
 * Handles the property types used by injected MCP tools (string, number, boolean).
 * Falls back to z.unknown() for unrecognized types.
 */
function jsonPropertyToZod(prop: Record<string, unknown>, isRequired: boolean) {
  let schema: z.ZodTypeAny;
  const description = prop.description as string | undefined;

  switch (prop.type) {
    case "string":
      schema = description ? z.string().describe(description) : z.string();
      break;
    case "number":
    case "integer":
      schema = description ? z.number().describe(description) : z.number();
      break;
    case "boolean":
      schema = description ? z.boolean().describe(description) : z.boolean();
      break;
    default:
      schema = description ? z.unknown().describe(description) : z.unknown();
  }

  return isRequired ? schema : schema.optional();
}

/**
 * Convert an InjectedMcpServerDef to an in-process SDK MCP server.
 *
 * Uses the Claude Agent SDK's tool() + createSdkMcpServer() to build
 * a real MCP server from the transport-agnostic definition.
 */
function defToSdkMcpServer(def: InjectedMcpServerDef) {
  const sdkTools = def.tools.map((toolDef) => {
    const properties = (toolDef.inputSchema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const requiredFields = (toolDef.inputSchema.required ?? []) as string[];

    // Build Zod shape from JSON Schema properties
    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
      zodShape[key] = jsonPropertyToZod(prop, requiredFields.includes(key));
    }

    // herdctl's McpToolCallResult is structurally an MCP CallToolResult (text
    // content), but the SDK types the content `type` as a literal union and infers
    // the handler's args shape from the zod schema. Cast at this adapter boundary
    // rather than leaking the SDK's MCP types into the transport-agnostic
    // InjectedMcpToolDef. The instantiation expression pins the same `Schema` the
    // call infers from `zodShape`, so the cast target matches the expected param.
    const handler = toolDef.handler as unknown as Parameters<
      typeof tool<Record<string, z.ZodTypeAny>>
    >[3];
    return tool(toolDef.name, toolDef.description, zodShape, handler);
  });

  return createSdkMcpServer({
    name: def.name,
    version: def.version,
    tools: sdkTools,
  });
}

/**
 * SDK runtime configuration options
 */
export interface SDKRuntimeOptions {
  /**
   * Claude home directory the SDK's Claude Code process should use.
   *
   * Defaults to {@link defaultClaudeHome} (`~/.claude`). Pass the home the
   * embedding app resolved (e.g. `FleetManager.getClaudeHomePath()`) so the
   * transcripts the SDK reads and appends live in the same tree session
   * discovery and adoption list from — otherwise an adopted session cannot be
   * resumed at all, because the SDK looks for its transcript under `~/.claude`
   * and finds nothing (herdctl#423).
   *
   * The SDK has no `claudeHome` option; it resolves its home from the
   * `CLAUDE_CONFIG_DIR` environment variable, so this is applied by injecting
   * that variable into the SDK's per-query `env` (never into `process.env` —
   * see {@link withClaudeConfigDir}).
   */
  claudeHomePath?: string;
}

/**
 * SDK runtime implementation
 *
 * This runtime uses the Claude Agent SDK to execute agents. It wraps the SDK's
 * query() function and provides the standard RuntimeInterface.
 *
 * The SDKRuntime is the default runtime when no runtime type is specified in
 * agent configuration.
 *
 * @example
 * ```typescript
 * const runtime = new SDKRuntime();
 * const messages = runtime.execute({
 *   prompt: "Fix the bug in auth.ts",
 *   agent: resolvedAgent,
 * });
 *
 * for await (const message of messages) {
 *   console.log(message.type, message.content);
 * }
 * ```
 */
export class SDKRuntime implements RuntimeInterface {
  /** Resolved Claude home; `~/.claude` unless the caller supplied one (#423). */
  private claudeHomePath: string;

  constructor(options?: SDKRuntimeOptions) {
    this.claudeHomePath = options?.claudeHomePath ?? defaultClaudeHome();
  }

  /**
   * The Claude home this runtime points the SDK's Claude Code process at.
   * Exposed for tests and for embedders asserting the home actually threaded
   * through.
   */
  getClaudeHomePath(): string {
    return this.claudeHomePath;
  }

  /**
   * Execute an agent using the Claude Agent SDK
   *
   * Converts agent configuration to SDK options and delegates to the SDK's
   * query() function. Yields each message from the SDK stream.
   *
   * @param options - Execution options including prompt, agent, and session info
   * @returns AsyncIterable of SDK messages
   */
  async *execute(options: RuntimeExecuteOptions): AsyncIterable<SDKMessage> {
    const sdkOptions = this.buildSdkOptions(options);

    // issue #458: a one-shot string-prompt `query()` ends its own generator the
    // moment the top-level turn's terminal message arrives — abandoning any
    // `run_in_background` Agent-tool subagent that hasn't finished yet, because
    // JobExecutor's `for await` loop breaks on that same terminal message
    // (nothing left to consult it wants to keep the query alive for). Fixed by
    // borrowing openSession()'s streaming-input + lifecycle-hook wiring: a
    // queue-backed prompt keeps the underlying query open, the Stop/
    // background_tasks_changed hooks report whether background work is still
    // live, and the terminal message is held back (up to bgWaitCeilingMs, the
    // same grace `claude -p` gives via `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`)
    // until it drains — instead of tearing the session down out from under it.
    // Updated two ways: synchronously in this loop below (from the same
    // `background_tasks_changed` stream message `tapLifecycleStream` reacts
    // to — inspected directly here, not via its `sink`, which fires on a
    // deferred microtask and would race the very message that triggered it),
    // and from the Stop hook's authoritative end-of-turn snapshot via
    // `onLifecycleSignal` below (fine to be async there — nothing in this
    // loop is waiting on that same tick).
    let liveBackgroundTasks: BackgroundTaskSummary[] = [];
    const trackBackgroundTasks = (signal: SessionLifecycleSignal) => {
      // `activity` and `cron_deleted` carry no task snapshot (always `[]`,
      // see SessionLifecycleSignal's own doc) — only `turn_end` and
      // `background_tasks_changed` are authoritative. Taking every signal
      // here would let an `activity` signal (fired on the next assistant
      // message) wipe a real pending-task count to `[]` and release a held
      // terminal early.
      // `hasSnapshot === false` means a `turn_end` fired without the CLI's
      // background_tasks envelope (see SessionLifecycleSignal.hasSnapshot) —
      // `signal.backgroundTasks` is then just an empty stand-in, not "drained
      // to empty". Keep whatever we already tracked instead of clobbering it,
      // which previously released a held terminal (and its live background
      // subagent got killed) mid-wait. See edspencer/herdctl#459 follow-up.
      if (
        (signal.kind === "turn_end" || signal.kind === "background_tasks_changed") &&
        signal.hasSnapshot !== false
      ) {
        liveBackgroundTasks = signal.backgroundTasks;
      }
    };
    // Compose: this internal bg-wait tracker runs first and synchronously (the
    // anchor decision above depends on it), then the caller's own
    // `onLifecycleSignal` consumer (e.g. `SessionLifecycleManager.trackJob`,
    // vulpes-pack#148) rides along on the same signals. A throwing/rejecting
    // consumer must never break this message loop or release a held terminal
    // early, so both failure shapes are swallowed here.
    const onLifecycleSignal = (signal: SessionLifecycleSignal) => {
      trackBackgroundTasks(signal);
      try {
        const consumerResult = options.onLifecycleSignal?.(signal);
        if (consumerResult && typeof consumerResult.catch === "function") {
          void consumerResult.catch(() => {
            // Swallow — a consumer sink must not break the message loop.
          });
        }
      } catch {
        // Swallow — a consumer sink must not break the message loop.
      }
    };
    sdkOptions.hooks = {
      ...(sdkOptions.hooks ?? {}),
      ...buildLifecycleHooks(onLifecycleSignal),
    };

    const input = new MessageQueue<SDKUserMessage>();
    if (options.prompt) {
      input.push(toUserMessage(options.prompt));
    }

    // Thread the AbortController through so teardown has a lever beyond the
    // generator's own `return()` (mirrors the original one-shot call).
    const abortController = options.abortController ?? new AbortController();
    const q = query({
      prompt: input as AsyncIterable<SDKUserMessage>,
      options: {
        ...(sdkOptions as Record<string, unknown>),
        abortController,
      },
    });
    const messages = tapLifecycleStream(
      q as unknown as AsyncIterable<SDKMessage>,
      onLifecycleSignal,
    );
    const iterator = messages[Symbol.asyncIterator]();

    const ceilingMs = bgWaitCeilingMs();
    let pendingTerminal: SDKMessage | undefined;
    // Armed once, on the first message we hold back — a single deadline for
    // the whole wait, not reset per message.
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
    let ceilingPromise: Promise<typeof BG_WAIT_TIMED_OUT> | undefined;
    const armCeiling = (): Promise<typeof BG_WAIT_TIMED_OUT> => {
      if (!ceilingPromise) {
        ceilingPromise = new Promise((resolve) => {
          ceilingTimer = setTimeout(() => resolve(BG_WAIT_TIMED_OUT), ceilingMs);
          ceilingTimer.unref?.();
        });
      }
      return ceilingPromise;
    };

    try {
      while (true) {
        const nextResult = pendingTerminal
          ? await Promise.race([iterator.next(), armCeiling()])
          : await iterator.next();

        if (nextResult === BG_WAIT_TIMED_OUT) break; // ceiling hit; yield the held terminal below
        if (nextResult.done) break;

        const message = nextResult.value;
        // Read synchronously off the raw message, ahead of (and independent
        // from) tapLifecycleStream's own deferred `sink` call for the same
        // message — see the comment on `liveBackgroundTasks` above.
        if (
          message &&
          (message as { type?: string }).type === "system" &&
          (message as { subtype?: string }).subtype === "background_tasks_changed"
        ) {
          liveBackgroundTasks =
            ((message as { tasks?: BackgroundTaskSummary[] }).tasks as BackgroundTaskSummary[]) ??
            [];
        }

        if (isTerminalMessage(message)) {
          // Supersedes any terminal already held — e.g. a re-invocation turn
          // (the background task's own completion) produces a newer one.
          pendingTerminal = message;
        } else {
          // Always forwarded, including while a terminal is held: a
          // re-invocation's own content (assistant/tool messages) must reach
          // the consumer, not just its eventual terminal.
          yield message;
        }

        if (pendingTerminal) {
          // ceilingMs === 0 mirrors `-p`'s "0 = don't wait" — stop holding
          // immediately rather than arming a zero-length timer.
          if (liveBackgroundTasks.length === 0 || ceilingMs === 0) break;
          // else: keep looping, still holding.
        }
      }

      // Inside the same try/finally as the loop above (not after it): a
      // `yield` suspends the generator, and if the consumer aborts iteration
      // right here (breaks its `for await`, calls `.return()`) without this
      // being in the try, the `finally` below — and therefore input.end()/
      // q.return() — would never run, leaking the query.
      if (pendingTerminal) yield pendingTerminal;
    } finally {
      if (ceilingTimer) clearTimeout(ceilingTimer);
      input.end();
      try {
        await q.return(undefined);
      } catch {
        // Already closed / never started — nothing to clean up.
      }
    }
  }

  /**
   * Open a long-lived streaming session backed by the SDK's streaming-input mode.
   *
   * The initial `options.prompt` (if any) is sent as the first turn; further
   * turns are sent via {@link RuntimeSession.send}. Because the input iterable
   * stays open, the returned SDK `Query` handle is retained so its control
   * requests (`interrupt`, `supportedCommands`, `setModel`, `stopTask`) stay
   * available for the life of the session.
   */
  openSession(options: RuntimeExecuteOptions): RuntimeSession {
    const sdkOptions = this.buildSdkOptions(options);

    // Install turn-boundary lifecycle hooks when the caller wants to observe the
    // session's background-work lifecycle (the session-reaper). The Stop hook
    // carries the authoritative session_crons/background_tasks snapshot.
    if (options.onLifecycleSignal) {
      sdkOptions.hooks = {
        ...(sdkOptions.hooks ?? {}),
        ...buildLifecycleHooks(options.onLifecycleSignal),
      };
    }

    // A pushable iterable keeps the query open across turns.
    const input = new MessageQueue<SDKUserMessage>();
    if (options.prompt) {
      input.push(toUserMessage(options.prompt));
    }

    // Thread the AbortController through so teardown has a lever beyond close()
    // (mirrors execute()); create one if the caller didn't supply it.
    const abortController = options.abortController ?? new AbortController();

    const q = query({
      prompt: input as AsyncIterable<SDKUserMessage>,
      options: {
        ...(sdkOptions as Record<string, unknown>),
        abortController,
      },
    });

    // Widen the Query (an AsyncGenerator<SDKMessage>) to herdctl's structural
    // SDKMessage, then tap the stream for mid-turn lifecycle events when needed.
    const rawMessages = q as unknown as AsyncIterable<SDKMessage>;
    const messages = options.onLifecycleSignal
      ? tapLifecycleStream(rawMessages, options.onLifecycleSignal)
      : rawMessages;

    return {
      messages,
      send: async (text: string) => {
        input.push(toUserMessage(text));
      },
      interrupt: async () => {
        // The SDK's interrupt() resolves to an optional interrupt-receipt object
        // (still-queued message uuids); the RuntimeSession contract is fire-and-
        // forget, so discard it to satisfy the Promise<void> return type.
        await q.interrupt();
      },
      listCommands: () => q.supportedCommands(),
      setModel: (model?: string) => q.setModel(model),
      stopTask: (taskId: string) => q.stopTask(taskId),
      close: async () => {
        input.end();
        // Best-effort: tell the SDK generator we're done so it tears down the CLI.
        try {
          await q.return(undefined);
        } catch {
          // Already closed / never started — nothing to clean up.
        }
        // Abort as a backstop in case the generator was already detached and
        // q.return() didn't reach the underlying process.
        if (!abortController.signal.aborted) abortController.abort();
      },
    };
  }

  /**
   * Build SDK query options from execution options.
   *
   * Shared by {@link execute} and {@link openSession}: applies agent config,
   * a system-prompt append, and any injected in-process MCP servers.
   */
  private buildSdkOptions(options: RuntimeExecuteOptions): ReturnType<typeof toSDKOptions> {
    // Convert agent configuration to SDK options
    const sdkOptions = toSDKOptions(options.agent, {
      resume: options.resume,
      fork: options.fork,
    });

    // Opt in to partial (streaming) assistant messages when the caller requested
    // it. This makes the SDK query() emit `stream_event` / `text_delta` chunks so
    // consumers can stream assistant text token-by-token. Left unset (SDK default:
    // off) for batch/one-shot and non-opting session callers, so their streams
    // still carry only whole `assistant` messages.
    if (options.includePartialMessages) {
      sdkOptions.includePartialMessages = true;
    }

    // Apply system prompt append if provided (e.g., concise mode for chat platforms)
    if (options.systemPromptAppend) {
      const current = sdkOptions.systemPrompt;
      if (typeof current === "string") {
        sdkOptions.systemPrompt = current + "\n\n" + options.systemPromptAppend;
      } else if (current && typeof current === "object" && current.type === "preset") {
        sdkOptions.systemPrompt = {
          ...current,
          append: (current.append ? current.append + "\n\n" : "") + options.systemPromptAppend,
        };
      } else {
        sdkOptions.systemPrompt = {
          type: "preset",
          preset: "claude_code",
          append: options.systemPromptAppend,
        };
      }
    }

    // Convert injected MCP server defs to in-process SDK MCP servers
    if (options.injectedMcpServers && Object.keys(options.injectedMcpServers).length > 0) {
      const configServers = sdkOptions.mcpServers ?? {};
      const injectedServers: Record<string, unknown> = {};

      for (const [name, def] of Object.entries(options.injectedMcpServers)) {
        injectedServers[name] = defToSdkMcpServer(def);
      }

      // SDK accepts both plain configs and McpSdkServerConfigWithInstance objects.
      // The latter contains a live McpServer instance which doesn't match SDKMcpServerConfig.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sdkOptions.mcpServers = { ...configServers, ...injectedServers } as any;

      // Auto-add injected MCP server tool patterns to allowedTools
      // Without this, agents with an allowedTools list can't call injected tools.
      // De-dupe before pushing: `sdkOptions.allowedTools` can be re-derived from
      // the same agent across turns, and blindly pushing would grow the list with
      // duplicate `mcp__…__*` patterns each turn (edspencer/herdctl#390).
      if (sdkOptions.allowedTools?.length) {
        const existing = new Set(sdkOptions.allowedTools);
        for (const name of Object.keys(options.injectedMcpServers)) {
          const pattern = `mcp__${name}__*`;
          if (!existing.has(pattern)) {
            sdkOptions.allowedTools.push(pattern);
            existing.add(pattern);
          }
        }
      }

      // File uploads via MCP tools can take longer than the default 60s timeout.
      // Set a safe default if not already configured by the user.
      if (
        options.injectedMcpServers["herdctl-file-sender"] &&
        !process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT
      ) {
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = "120000";
      }
    }

    // Point the SDK's Claude Code process at the configured Claude home.
    //
    // The SDK resolves its home from `CLAUDE_CONFIG_DIR` (never from anything
    // herdctl passes in options), so without this a non-default `claudeHomePath`
    // splits the world: herdctl adopts and lists transcripts under the
    // configured home while the SDK reads and writes under `~/.claude`.
    //
    // Scoped deliberately to THIS query's `env` rather than `process.env`: the
    // host process runs many concurrent agents, and a global mutation would leak
    // one agent's home into all of them. Applied last so the inherited snapshot
    // includes the `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` bump above, and so it wins
    // over anything earlier in this method. `env` REPLACES the subprocess
    // environment wholesale, hence the spread of the inherited one inside
    // `withClaudeConfigDir`. Returns undefined (leaving plain inheritance) for
    // the default home and when the operator already set the variable.
    const env = withClaudeConfigDir(this.claudeHomePath, sdkOptions.env ?? process.env);
    if (env) {
      sdkOptions.env = env;
    }

    return sdkOptions;
  }
}
