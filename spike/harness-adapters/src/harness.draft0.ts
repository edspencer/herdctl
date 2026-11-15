/**
 * DRAFT 0 — FROZEN. DO NOT EDIT.
 *
 * The blind draft of the harness-adapter interface, written BEFORE reading any
 * of Pi's or Codex's event vocabulary or protocol surface. Its only inputs were:
 *   - herdctl's existing `RuntimeInterface` / `RuntimeSession` seam
 *   - `JobOutputMessage` (herdctl's existing small normalised path)
 *   - general reasoning about what a coding harness does
 *
 * The point of freezing this is that the spike's product is "what had to bend".
 * A bend list reconstructed from memory after the fact is worthless, so this
 * file is committed untouched and the live interface evolves in `harness.ts`.
 * Diff the two to get the real answer.
 *
 * PREDICTIONS (recorded now so they can be scored later):
 *   P1. `sessionId` as a synchronous readonly property will bend. I expect at
 *       least one harness to only reveal its session id asynchronously, after
 *       the first turn has started.
 *   P2. `prompt()` returning `Promise<void>` that resolves on *accept* (not on
 *       turn completion) will hold. Turn completion belongs on the event stream.
 *   P3. A single flat `tool_result` with `ok: boolean` will bend — harnesses
 *       that run tools in-process vs. delegating to the client will disagree
 *       about who reports the result.
 *   P4. `capabilities` as a flat bag of booleans will be too coarse; at least
 *       one capability will need to be tri-state (yes / degraded / no).
 *   P5. Approvals modelled as one callback returning one decision will bend on
 *       any harness whose approval has more than allow/deny (e.g. "allow for
 *       the rest of the session").
 *   P6. `turn_end.status` will need a case I have not thought of.
 */

// =============================================================================
// Capabilities
// =============================================================================

/**
 * What a harness can do. Declared statically per adapter so herdctl can refuse
 * or degrade an operation before attempting it, rather than discovering the
 * hard way mid-turn.
 */
export interface HarnessCapabilities {
  /** Can resume a prior session by id in a fresh process. */
  resume: boolean;
  /** Can branch a session, leaving the original intact. */
  fork: boolean;
  /** Can stop an in-flight turn without ending the session. */
  interrupt: boolean;
  /** Asks the client to approve tool calls before running them. */
  approvals: boolean;
  /** Emits incremental assistant text (token-ish deltas), not just whole messages. */
  streamingDeltas: boolean;
  /** Surfaces model reasoning/thinking separately from assistant text. */
  thinking: boolean;
  /** Can attach MCP servers over stdio. */
  mcpStdio: boolean;
  /** Can attach MCP servers over streamable HTTP (herdctl's bridge needs this). */
  mcpHttp: boolean;
  /** Reports a dollar cost figure. */
  costUsd: boolean;
  /** Reports token counts. */
  tokenUsage: boolean;
  /** Can change model mid-session. */
  setModelMidSession: boolean;
  /** Can enumerate slash commands / prompts. */
  listCommands: boolean;
  /** Confines tool side effects (filesystem/network) by its own mechanism. */
  sandbox: boolean;
}

// =============================================================================
// Normalised event union
// =============================================================================

/** Fields every normalised event carries. */
export interface HarnessEventBase {
  /** ISO timestamp the adapter observed this event. */
  timestamp: string;
  /**
   * The untranslated native event, verbatim. Always present. Consumers that
   * need harness-specific detail reach through here rather than forcing the
   * normalised union to grow a field for every harness's quirk.
   */
  raw: unknown;
}

export type HarnessEvent =
  | (HarnessEventBase & {
      type: "session_started";
      sessionId: string;
      model?: string;
    })
  | (HarnessEventBase & { type: "assistant_text"; text: string })
  | (HarnessEventBase & { type: "assistant_delta"; text: string })
  | (HarnessEventBase & { type: "thinking"; text: string })
  | (HarnessEventBase & {
      type: "tool_call";
      callId: string;
      name: string;
      input: unknown;
    })
  | (HarnessEventBase & {
      type: "tool_result";
      callId: string;
      ok: boolean;
      output: unknown;
    })
  | (HarnessEventBase & {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    })
  | (HarnessEventBase & {
      type: "turn_end";
      status: "ok" | "interrupted" | "error" | "max_turns";
    })
  | (HarnessEventBase & { type: "error"; message: string; code?: string });

export type HarnessEventType = HarnessEvent["type"];

// =============================================================================
// Approvals
// =============================================================================

export interface ApprovalRequest {
  /** Correlates with the `tool_call` event's callId where the harness gives one. */
  callId: string;
  toolName: string;
  input: unknown;
}

export type ApprovalDecision = { allow: boolean; reason?: string };

// =============================================================================
// MCP injection (reuses herdctl's existing transport-agnostic shape)
// =============================================================================

export interface InjectedMcpServerDef {
  /** Tool definitions are owned by herdctl; transport chosen per adapter. */
  name: string;
  /** For adapters that can only take HTTP: the bridge URL. */
  httpUrl?: string;
  /** Bearer token the bridge requires. */
  bearerToken?: string;
  /** For adapters that can take stdio. */
  command?: string;
  args?: string[];
}

// =============================================================================
// Adapter + session
// =============================================================================

export interface StartSessionOptions {
  /** Working directory the harness operates in. */
  cwd: string;
  model?: string;
  /** Appended to whatever system prompt the harness already has. */
  systemPromptAppend?: string;
  /** Resume this session id instead of starting fresh. */
  resumeSessionId?: string;
  injectedMcpServers?: Record<string, InjectedMcpServerDef>;
  /** Called when the harness requests approval. Absent => adapter auto-allows. */
  onApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Extra env for the harness process. */
  env?: Record<string, string>;
  abortController?: AbortController;
}

export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;
  startSession(opts: StartSessionOptions): Promise<HarnessSession>;
}

export interface HarnessSession {
  /** The id needed to resume this session later. */
  readonly sessionId: string;
  /** The normalised event stream for the whole session, across turns. */
  readonly events: AsyncIterable<HarnessEvent>;
  /** Send a user turn. Resolves when accepted, NOT when the turn completes. */
  prompt(text: string): Promise<void>;
  /** Stop the in-flight turn; session stays usable. */
  interrupt(): Promise<void>;
  /** Shut the session down and release the process. */
  close(): Promise<void>;
}
