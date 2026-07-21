/**
 * Transport-agnostic SDKMessage → chat-event translation
 *
 * Every chat surface built on herdctl (Discord, Slack, the web dashboard, and
 * downstream apps like paddock) consumes the same stream of `SDKMessage`s from
 * `FleetManager.trigger({ onMessage })` and turns it into the same handful of
 * UI events:
 *   - assistant text deltas,
 *   - a boundary between distinct assistant turns,
 *   - paired tool calls (a `tool_use` matched to its later `tool_result`,
 *     enriched with an input summary and a wall-clock duration).
 *
 * That translation was previously reimplemented per connector (see
 * `@herdctl/web`'s WebChatManager and paddock's `ws.ts`). This module extracts
 * it into one stateful translator so transports only have to supply the
 * destination handlers.
 *
 * @module sdk-message-translator
 */

import {
  type AgentAttribution,
  extractImageBlocks,
  extractMessageContent,
  extractTextDelta,
  getAgentAttribution,
  isSyntheticMessage,
  type SDKMessage,
} from "./message-extraction.js";
import {
  type ExtractedImage,
  extractToolResults,
  extractToolUseBlocks,
  getToolInputSummary,
  type ToolResult,
} from "./tool-parsing.js";

// =============================================================================
// Types
// =============================================================================

/**
 * A paired tool call: a `tool_use` block matched with its `tool_result`.
 */
export interface TranslatedToolCall {
  /** Tool name (e.g. "Bash", "Read"); "Tool" if the pairing could not be resolved */
  toolName: string;
  /** Human-readable summary of the tool input (e.g. the bash command or file path) */
  inputSummary?: string;
  /** Tool output text (may be empty) */
  output: string;
  /**
   * Non-text image blocks the tool returned (e.g. a Playwright
   * `browser_take_screenshot` result), preserved so a consumer can render them
   * inline. Absent when the result carried no image blocks; {@link output}
   * stays populated for text-only consumers.
   */
  images?: ExtractedImage[];
  /** Whether the tool reported an error */
  isError: boolean;
  /** Wall-clock duration between the tool_use and its result, in milliseconds */
  durationMs?: number;
  /** The originating tool_use id, when present */
  toolUseId?: string;
  /**
   * Agent attribution: `null` when the main agent invoked the tool, or the
   * `Task` tool_use id of the subagent that invoked it. Lets consumers group
   * tool calls into per-agent lanes.
   */
  parentToolUseId: string | null;
}

/**
 * An in-flight tool_use, surfaced the moment it appears in an assistant message
 * — before the tool has run or produced any result. Consumers use this to
 * render a pending/"running…" affordance (keyed by {@link toolUseId}) for slow
 * tools, then reconcile it against the eventual {@link TranslatedToolCall} once
 * the tool_result arrives.
 */
export interface TranslatedToolStart {
  /** Tool name (e.g. "Bash", "Read", "Task") */
  toolName: string;
  /** Human-readable summary of the tool input (e.g. the bash command or file path) */
  inputSummary?: string;
  /** The originating tool_use id — the key to reconcile with the later result */
  toolUseId?: string;
  /**
   * Agent attribution: `null` when the main agent invoked the tool, or the
   * `Task` tool_use id of the subagent that invoked it. Mirrors
   * {@link TranslatedToolCall.parentToolUseId}.
   */
  parentToolUseId: string | null;
}

/**
 * Handlers invoked as SDK messages are translated. All are optional and may be
 * async; the translator awaits them in order so transports can apply
 * backpressure (e.g. a slow WebSocket send).
 */
export interface SDKMessageHandlers {
  /**
   * Called with each assistant text delta as it streams in. The second argument
   * carries agent attribution (`parentToolUseId: null` = main agent, else the
   * spawning `Task` tool_use id) so consumers can route text into per-agent
   * lanes. Existing handlers that ignore the second argument keep working.
   */
  onText?: (text: string, attribution: AgentAttribution) => void | Promise<void>;
  /**
   * Called when an assistant message carries non-text `image` content blocks —
   * an image the agent emitted inline (as opposed to one a tool returned, which
   * arrives via {@link onToolCall}'s `images`). Fires once per assistant
   * message that has images, after its text. Optional and backward compatible;
   * consumers that don't render images can ignore it.
   */
  onImages?: (images: ExtractedImage[], attribution: AgentAttribution) => void | Promise<void>;
  /**
   * Called when a new assistant turn begins after a previous one produced text,
   * so transports can split bubbles. A tool-call interruption alone does NOT
   * trigger a boundary — a tool result resets the text run, so the next
   * assistant text simply begins a fresh bubble with no boundary event. The
   * attribution identifies the agent whose turn is beginning.
   */
  onBoundary?: (attribution: AgentAttribution) => void | Promise<void>;
  /**
   * Called as soon as a tool_use block appears in an assistant message —
   * before the tool has run or produced a result. Lets consumers render an
   * in-flight/"running…" affordance for slow tools (especially subagents that
   * run for minutes) keyed by `toolUseId`, then reconcile it with the eventual
   * completion via {@link onToolCall}. Fires regardless of the `toolResults`
   * option; optional and backward compatible.
   */
  onToolStart?: (toolUse: TranslatedToolStart) => void | Promise<void>;
  /** Called once per tool result, paired with its originating tool_use. */
  onToolCall?: (toolCall: TranslatedToolCall) => void | Promise<void>;
}

/**
 * Options for {@link SDKMessageTranslator}.
 */
export interface SDKMessageTranslatorOptions {
  /**
   * Emit tool calls via `onToolCall`. When `false`, tool_use blocks are still
   * tracked (so boundaries stay correct) but no `onToolCall` is fired.
   * Defaults to `true`.
   */
  toolResults?: boolean;
  /**
   * Clock used for duration measurement. Injectable for deterministic tests.
   * Defaults to `Date.now`.
   */
  now?: () => number;
}

// =============================================================================
// Translator
// =============================================================================

interface PendingToolUse {
  name: string;
  input?: unknown;
  startTime: number;
  /** Attribution of the agent that issued this tool_use (main = null). */
  parentToolUseId: string | null;
}

/**
 * Extract tool results from a user message, preferring the id-bearing nested
 * `message.content[]` `tool_result` blocks over core's `extractToolResults`.
 *
 * The CLI runtime surfaces a tool result twice on the same user message:
 *   1. a **top-level `tool_use_result`** (string/object) that carries NO
 *      `tool_use_id`, and
 *   2. a nested `message.content[]` `tool_result` block that DOES carry the
 *      `tool_use_id` (plus `is_error` and string/array content).
 *
 * Core's {@link extractToolResults} short-circuits on the top-level field and
 * returns the id-less result first — so the translator can't pair it back to
 * its `tool_use` and falls back to a generic `toolName: "Tool"` with no input
 * summary or duration.
 *
 * When a user message has BOTH a top-level `tool_use_result` AND nested
 * id-bearing `tool_result` block(s), this helper strips the top-level field
 * (on a shallow clone — the SDK's object is never mutated) so
 * {@link extractToolResults} takes its nested branch and preserves the
 * `tool_use_id` for correct name/summary/duration pairing. Every other shape
 * — including SDK-runtime messages that only carry a top-level
 * `tool_use_result` — is passed to {@link extractToolResults} unchanged, so
 * existing SDK-runtime behavior is preserved.
 */
function extractToolResultsPreferringNested(message: {
  type: string;
  message?: { content?: unknown };
  tool_use_result?: unknown;
}): ToolResult[] {
  const content = (message.message as { content?: unknown } | undefined)?.content;

  if (Array.isArray(content)) {
    const hasNestedToolResult = content.some(
      (block) =>
        block !== null &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type?: unknown }).type === "tool_result",
    );

    // Only prefer the nested path when the message actually carried nested
    // tool_result blocks. When it does, extractToolResults already parses those
    // id-bearing blocks correctly — the bug is only that the top-level
    // `tool_use_result` short-circuit runs *first*, so we strip that field
    // (on a shallow clone; the SDK's object is untouched) and let the core
    // helper take its nested branch. Messages with only a top-level
    // `tool_use_result` (SDK-runtime shape) fall through unchanged below.
    if (hasNestedToolResult && message.tool_use_result !== undefined) {
      const { tool_use_result: _dropped, ...withoutTopLevel } = message;
      return extractToolResults(withoutTopLevel);
    }
  }

  // No nested tool_result blocks: defer to the core helper, which also handles
  // the top-level `tool_use_result` (SDK-runtime) shape.
  return extractToolResults(message);
}

/**
 * Stateful translator from the Claude Agent SDK message stream to chat-UI events.
 *
 * Feed every `SDKMessage` from a trigger's `onMessage` callback into
 * {@link SDKMessageTranslator.handle}; it extracts assistant text, tracks
 * `tool_use` blocks so they can be paired with their later `tool_result`s, and
 * emits boundaries between distinct assistant turns.
 *
 * One instance corresponds to one trigger/turn (it holds per-turn state such as
 * pending tool uses). Create a fresh translator per `trigger()` call.
 *
 * @example
 * ```typescript
 * const translator = new SDKMessageTranslator({
 *   onText: (t) => ws.send({ type: "chat:response", text: t }),
 *   onToolCall: (c) => ws.send({ type: "chat:tool_call", ...c }),
 *   onBoundary: () => ws.send({ type: "chat:boundary" }),
 * });
 *
 * await fleet.trigger("agent", undefined, {
 *   prompt,
 *   onMessage: (m) => translator.handle(m),
 * });
 * ```
 */
export class SDKMessageTranslator {
  private readonly handlers: SDKMessageHandlers;
  private readonly toolResults: boolean;
  private readonly now: () => number;

  /** tool_use id -> pending call awaiting its result */
  private readonly pendingToolUses = new Map<string, PendingToolUse>();
  /** Whether the current assistant turn has already emitted text */
  private hasAssistantText = false;
  /**
   * Whether the current assistant message already streamed its text via partial
   * `stream_event` / `text_delta` chunks. Set as deltas arrive; consumed when the
   * terminal whole `assistant` message lands so its text is NOT re-emitted (the
   * `onText` contract stays "deltas, in order"). Only ever true when the SDK runs
   * with `includePartialMessages`; the whole-message path is untouched otherwise.
   */
  private streamedTextInMessage = false;

  constructor(handlers: SDKMessageHandlers, options?: SDKMessageTranslatorOptions) {
    this.handlers = handlers;
    this.toolResults = options?.toolResults ?? true;
    this.now = options?.now ?? Date.now;
  }

  /**
   * Translate a single SDK message, invoking the configured handlers.
   *
   * Safe to call with any SDK message type — non-assistant/non-user messages
   * (system, result, stream events, etc.) are ignored.
   *
   * @param message - One message from the trigger's `onMessage` stream
   */
  async handle(message: SDKMessage): Promise<void> {
    if (message.type === "stream_event") {
      await this.handleStreamEvent(message);
    } else if (message.type === "assistant") {
      await this.handleAssistant(message);
    } else if (message.type === "user") {
      await this.handleUser(message);
    }
  }

  /**
   * Reset per-turn state. Call between reused turns if you keep one translator
   * across multiple triggers (not required when creating one per trigger).
   */
  reset(): void {
    this.pendingToolUses.clear();
    this.hasAssistantText = false;
    this.streamedTextInMessage = false;
  }

  // ---------------------------------------------------------------------------

  /**
   * Handle a partial-message `stream_event` (emitted only when the SDK runs with
   * `includePartialMessages`). Surfaces incremental assistant text: a
   * `content_block_delta` carrying a `text_delta` is emitted as an ordered
   * `onText(delta)` call, so consumers stream token-by-token. All other stream
   * events (message start/stop, tool input-json deltas, thinking deltas, …) are
   * ignored here — the terminal whole `assistant` message still drives tool
   * tracking and boundaries.
   *
   * Boundary parity with the whole-message path: the FIRST text delta of a new
   * assistant message applies the same "new turn after prior text → boundary"
   * rule as {@link handleAssistant}; later deltas of the same message just
   * append. The terminal `assistant` message then suppresses its (already
   * streamed) text via {@link streamedTextInMessage}.
   */
  private async handleStreamEvent(message: SDKMessage): Promise<void> {
    const text = extractTextDelta(message.event);
    if (text === undefined) return;

    const attribution = getAgentAttribution(message);

    // First text delta of this assistant message: apply boundary semantics once,
    // exactly as the whole-message path does before its single onText.
    if (!this.streamedTextInMessage) {
      if (this.hasAssistantText) {
        this.hasAssistantText = false;
        await this.handlers.onBoundary?.(attribution);
      }
      this.streamedTextInMessage = true;
      this.hasAssistantText = true;
    }

    await this.handlers.onText?.(text, attribution);
  }

  private async handleAssistant(message: SDKMessage): Promise<void> {
    // The Claude Code CLI emits synthetic placeholder turns (model
    // "<synthetic>") — e.g. "No response requested." after a /compact
    // continuation. They are not real assistant output, so don't translate them
    // to text or turn boundaries, and don't let them disturb per-turn state.
    if (isSyntheticMessage(message)) return;

    // Agent attribution: null for the main agent, or the spawning Task tool_use
    // id for a subagent. Threaded onto every emitted event so consumers can
    // separate main vs. subagent lanes.
    const attribution = getAgentAttribution(message);

    // If this message's text already streamed as `text_delta` chunks (partials
    // enabled), consume that flag and suppress the whole-text re-emit — the
    // deltas already carried it, and `hasAssistantText`/boundary state was set as
    // they streamed. Tool tracking below still runs on the terminal message.
    const alreadyStreamed = this.streamedTextInMessage;
    this.streamedTextInMessage = false;

    const content = extractMessageContent(message);
    if (content && !alreadyStreamed) {
      // A new assistant turn after a previous one produced text → boundary.
      if (this.hasAssistantText) {
        this.hasAssistantText = false;
        await this.handlers.onBoundary?.(attribution);
      }
      this.hasAssistantText = true;
      await this.handlers.onText?.(content, attribution);
    }

    // Surface any inline image content blocks the agent emitted. These are
    // independent of text (an assistant message may carry both) and of the
    // partial-streaming path (image blocks only appear on the whole message).
    if (this.handlers.onImages) {
      const images = extractImageBlocks(message);
      if (images.length > 0) {
        await this.handlers.onImages(images, attribution);
      }
    }

    // Track tool_use blocks so we can pair them with results later. We track
    // even when toolResults is disabled so boundary handling stays correct.
    for (const block of extractToolUseBlocks(message)) {
      if (block.id) {
        this.pendingToolUses.set(block.id, {
          name: block.name,
          input: block.input,
          startTime: this.now(),
          parentToolUseId: attribution.parentToolUseId,
        });
        // Surface the tool_use immediately, before it runs, so consumers can
        // render a pending/"running…" row. The eventual tool_result drives
        // onToolCall (below) to reconcile it. Fires even when toolResults is
        // disabled — onToolStart is an independent, opt-in concern.
        await this.handlers.onToolStart?.({
          toolName: block.name,
          inputSummary: getToolInputSummary(block.name, block.input),
          toolUseId: block.id,
          parentToolUseId: attribution.parentToolUseId,
        });
      }
    }
  }

  private async handleUser(message: SDKMessage): Promise<void> {
    const results = extractToolResultsPreferringNested(
      message as { type: string; message?: { content?: unknown }; tool_use_result?: unknown },
    );
    if (results.length === 0) {
      return;
    }

    // Fallback attribution from the result-carrying user message, used when the
    // originating tool_use wasn't tracked (so we can't read the issuing agent).
    const messageAttribution = getAgentAttribution(message);

    // A tool result ends the current text run; the next assistant text is a new
    // bubble. Drop the text flag so we don't emit a spurious boundary, but the
    // transport already received the text via onText.
    this.hasAssistantText = false;

    if (!this.toolResults || !this.handlers.onToolCall) {
      // Still consume pending tool uses so the map doesn't leak.
      for (const result of results) {
        if (result.toolUseId) this.pendingToolUses.delete(result.toolUseId);
      }
      return;
    }

    for (const result of results) {
      const toolUse = result.toolUseId ? this.pendingToolUses.get(result.toolUseId) : undefined;
      if (result.toolUseId) {
        this.pendingToolUses.delete(result.toolUseId);
      }

      await this.handlers.onToolCall({
        toolName: toolUse?.name ?? "Tool",
        inputSummary: toolUse ? getToolInputSummary(toolUse.name, toolUse.input) : undefined,
        output: result.output,
        ...(result.images && result.images.length > 0 ? { images: result.images } : {}),
        isError: result.isError,
        durationMs: toolUse ? this.now() - toolUse.startTime : undefined,
        toolUseId: result.toolUseId,
        // Attribute to the agent that issued the tool_use. A tracked tool_use
        // keeps its own attribution (including a legitimate `null` for the main
        // agent); only a truly untracked result falls back to the result
        // message's own attribution.
        parentToolUseId: toolUse ? toolUse.parentToolUseId : messageAttribution.parentToolUseId,
      });
    }
  }
}

/**
 * Build an `onMessage` callback that drives a fresh {@link SDKMessageTranslator}.
 *
 * Convenience for the common case: pass the returned function straight to
 * `FleetManager.trigger({ onMessage })`. Creates one translator bound to the
 * given handlers, so this represents a single trigger/turn.
 *
 * @param handlers - Destination handlers for text/boundary/tool events
 * @param options - Translator options (toolResults toggle, injectable clock)
 * @returns An async `onMessage` handler suitable for `TriggerOptions.onMessage`
 *
 * @example
 * ```typescript
 * await fleet.trigger("agent", undefined, {
 *   prompt,
 *   onMessage: createSDKMessageHandler({
 *     onText: (t) => stream(t),
 *     onToolCall: (c) => renderTool(c),
 *   }),
 * });
 * ```
 */
export function createSDKMessageHandler(
  handlers: SDKMessageHandlers,
  options?: SDKMessageTranslatorOptions,
): (message: SDKMessage) => Promise<void> {
  const translator = new SDKMessageTranslator(handlers, options);
  return (message: SDKMessage) => translator.handle(message);
}
