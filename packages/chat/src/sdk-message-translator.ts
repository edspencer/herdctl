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

import { extractMessageContent, type SDKMessage } from "./message-extraction.js";
import { extractToolResults, extractToolUseBlocks, getToolInputSummary } from "./tool-parsing.js";

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
  /** Whether the tool reported an error */
  isError: boolean;
  /** Wall-clock duration between the tool_use and its result, in milliseconds */
  durationMs?: number;
  /** The originating tool_use id, when present */
  toolUseId?: string;
}

/**
 * Handlers invoked as SDK messages are translated. All are optional and may be
 * async; the translator awaits them in order so transports can apply
 * backpressure (e.g. a slow WebSocket send).
 */
export interface SDKMessageHandlers {
  /** Called with each assistant text delta as it streams in. */
  onText?: (text: string) => void | Promise<void>;
  /**
   * Called when a new assistant turn begins after a previous one produced text
   * (or after a tool call interrupts the text), so transports can split bubbles.
   */
  onBoundary?: () => void | Promise<void>;
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
    if (message.type === "assistant") {
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
  }

  // ---------------------------------------------------------------------------

  private async handleAssistant(message: SDKMessage): Promise<void> {
    const content = extractMessageContent(message);
    if (content) {
      // A new assistant turn after a previous one produced text → boundary.
      if (this.hasAssistantText) {
        this.hasAssistantText = false;
        await this.handlers.onBoundary?.();
      }
      this.hasAssistantText = true;
      await this.handlers.onText?.(content);
    }

    // Track tool_use blocks so we can pair them with results later. We track
    // even when toolResults is disabled so boundary handling stays correct.
    for (const block of extractToolUseBlocks(message)) {
      if (block.id) {
        this.pendingToolUses.set(block.id, {
          name: block.name,
          input: block.input,
          startTime: this.now(),
        });
      }
    }
  }

  private async handleUser(message: SDKMessage): Promise<void> {
    const results = extractToolResults(
      message as { type: string; message?: { content?: unknown }; tool_use_result?: unknown },
    );
    if (results.length === 0) {
      return;
    }

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
        isError: result.isError,
        durationMs: toolUse ? this.now() - toolUse.startTime : undefined,
        toolUseId: result.toolUseId,
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
