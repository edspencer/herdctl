/**
 * THE LIVE harness-adapter interface.
 *
 * Starts as a byte-copy of `harness.draft0.ts` (the blind draft, frozen) and
 * evolves as each harness forces a change. `git diff` between the two files is
 * the spike's primary deliverable: the list of ways an interface designed from
 * Claude alone failed to fit a second and third harness.
 *
 * BEND LOG -- every change from draft0, with the harness that forced it.
 * (Appended as they are discovered; see FINDINGS.md for the discussion.)
 *
 *   B0. [Claude, before any other harness] `HarnessSession.sessionId` as a
 *       synchronous readonly property was wrong even for Claude. Claude only
 *       reveals its session id asynchronously, on the `system`/`subtype:"init"`
 *       message after the turn has started. So prediction P1 was right, but the
 *       first counterexample came from the harness the draft was modelled on,
 *       which is itself a finding: the draft was Claude-shaped and still did not
 *       fit Claude. Resolution: sessionId becomes a promise plus a late-filled
 *       accessor, and `session_started` stays on the event stream.
 *
 * (further bends appended below as discovered)
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
  /**
   * The id needed to resume this session later.
   *
   * BEND B0: draft0 had this as a synchronous `readonly sessionId: string`.
   * No harness can honour that. Claude only emits its session id on the
   * `system`/`subtype:"init"` message once the turn is already running, so the
   * id does not exist at the moment `startSession()` returns. Exposed as a
   * promise that resolves when the id is known; also mirrored by the
   * `session_started` event for consumers reading the stream.
   */
  readonly sessionId: Promise<string>;

  /**
   * The session id if it has arrived yet, else undefined. For callers that must
   * not block (e.g. a log-line decorator) and can tolerate a gap.
   */
  currentSessionId(): string | undefined;
  /** The normalised event stream for the whole session, across turns. */
  readonly events: AsyncIterable<HarnessEvent>;
  /** Send a user turn. Resolves when accepted, NOT when the turn completes. */
  prompt(text: string): Promise<void>;
  /** Stop the in-flight turn; session stays usable. */
  interrupt(): Promise<void>;
  /** Shut the session down and release the process. */
  close(): Promise<void>;
}
