/**
 * THE LIVE harness-adapter interface, as it ended up.
 *
 * Started as a byte-copy of `harness.draft0.ts` (the blind draft, frozen
 * before reading any Pi or Codex protocol surface) and was bent by each
 * harness in turn. `git diff` draft0 against this file is the spike's primary
 * deliverable. FINDINGS.md discusses the implications.
 *
 * =============================== BEND LOG ===============================
 * Each entry: what draft0 said, which harness broke it, and what it became.
 * "Found live" means running it caught the problem, not reading docs.
 *
 * B0. sessionId timing  [broken by CLAUDE -- the harness it was modelled on]
 *     draft0: `readonly sessionId: string`, available at startSession().
 *     No harness honours that, and the first counterexample was Claude, which
 *     only emits its id on system/subtype:"init" AFTER the turn starts. All
 *     three disagree: Claude async-after-start, Codex synchronous in the
 *     thread/start result, Pi caller-SUPPLIED before the process exists.
 *     Now: `Promise<string>` + non-blocking `currentSessionId()`.
 *
 * B1. one tool_call/tool_result pair is too coarse  [Codex, confirmed Pi]
 *     draft0 had exactly one tool shape. Codex has 18 ThreadItem variants, of
 *     which five are tool-ish and materially different: commandExecution,
 *     fileChange (a patch), mcpToolCall, dynamicToolCall, functionCallOutput.
 *     Squashing a patch application and a shell command into one event loses
 *     the distinction a UI needs. Now: `toolKind` on both events.
 *
 * B2. approvals are not allow/deny  [Codex; prediction P5 confirmed hard]
 *     draft0: `{allow: boolean}`. Codex's command decision enum is
 *     accept | acceptForSession | {acceptWithExecpolicyAmendment} |
 *     {applyNetworkPolicyAmendment} | decline | cancel -- and the server sends
 *     `availableDecisions` saying which subset this prompt accepts, with a
 *     SEPARATE vocabulary for fileChange, for permissions (which returns
 *     {permissions, scope}, not a decision at all), and another for legacy v1.
 *     Routing key is `approvalId`, NOT the item id. Now: a scope-bearing
 *     decision plus `availableDecisions` passthrough, and `raw` on the request.
 *
 * B3. non-terminal errors  [Codex AND Pi; prediction P6, the case I missed]
 *     draft0 implied an error ends a turn. Both harnesses have errors that do
 *     not: Codex's `error` notification carries `willRetry`, and Pi emits
 *     auto_retry_start/auto_retry_end around a retried failure. A consumer
 *     that tears down on `error` would kill a turn that was about to recover.
 *     Now: `error.terminal` and `error.willRetry`.
 *
 * B4. usage is three different things  [Pi vs Codex vs Claude]
 *     draft0 had one optional `costUsd`. Observed: Claude reports
 *     total_cost_usd; Pi reports usage.cost.total AND says via
 *     cost.totalFromProvider whether it is provider-billed or a catalog
 *     ESTIMATE; Codex reports no cost on the turn stream at all (dollars exist
 *     only at account level behind OpenAI auth, so a custom-provider
 *     deployment can never have them). Also Codex's token usage is CUMULATIVE
 *     (total/last) while Claude's is per-message. Now: `costBasis` and
 *     `cumulative` so a consumer cannot silently add estimates to real spend
 *     or double-count cumulative counters.
 *
 * B5. interrupt() has no target  [Codex]
 *     draft0: `interrupt()`, no args -- "stop the current turn". Codex's
 *     turn/interrupt addresses a SPECIFIC {threadId, turnId}, so the adapter
 *     must track the live turn id. Kept argument-free (it is the right
 *     consumer-facing shape) but documented as adapter-owned state, and
 *     `turn_end` now carries an optional `turnId` so a consumer can correlate.
 *
 * B6. not every harness has every event  [Pi]
 *     Pi has NO top-level error event (errors are spread across five channels,
 *     chiefly stopReason === "error" on a message) and NO session-started
 *     event in RPC mode at all. The adapter SYNTHESISES both. So a normalised
 *     event is not always a translation of a native one, and `raw` cannot
 *     always be a real native event. Now: `raw` is explicitly nullable with a
 *     `synthetic` flag, so a consumer can tell a reported fact from an
 *     inferred one.
 *
 * B7. incremental tool output has nowhere to go  [Codex and Pi]
 *     Codex streams item/commandExecution/outputDelta; Pi streams
 *     bash_execution_update. draft0 had no event for "a running tool produced
 *     more output", so both are currently dropped. Added `tool_output_delta`.
 *     Same gap applies to Claude's thinking_delta, which collapses lossily
 *     onto `thinking`; added `partial` to mark incremental thinking.
 *
 * B8. MCP injection is not always per-session  [Codex]
 *     draft0 took `injectedMcpServers` as a per-session option, which is how
 *     Claude and Pi work. Codex has NO app-server method to add an MCP server:
 *     it is process-level config.toml read at startup, so servers cannot vary
 *     per session within one Codex process. This is the one bend the interface
 *     CANNOT absorb -- it is a lifecycle constraint, not a shape mismatch.
 *     Now: a `mcpInjection` capability describing when servers can be bound.
 *
 * B9. approval POLICY is not approval HANDLING  [Codex]
 *     draft0 let a caller pass `onApproval` but never say WHAT to be asked
 *     about. Codex has a five-value approval_policy plus a `granular` object
 *     with five independent category flags, and an `approvals_reviewer` that
 *     can make the SERVER answer its own approvals so the client never sees a
 *     request. Inferring policy from "is there a callback" is lossy. Now an
 *     explicit `approvalPolicy`.
 *
 * B10. capabilities belong to (adapter + harness), not to the harness  [Pi]
 *     The sharpest conceptual finding. Pi has no approval mechanism at all,
 *     yet this spike's Pi adapter reports approvals:true -- because the
 *     ADAPTER ships a Pi extension whose tool_call handler calls
 *     ctx.ui.confirm. The capability is manufactured by adapter code. So a
 *     capability set is not a fact about a harness, and two adapters for the
 *     same harness can honestly disagree. Now documented on the type, with
 *     `via` provenance so "native" and "emulated by the adapter" are
 *     distinguishable -- a consumer may well care.
 *
 * B11. message events can be role-polymorphic  [Pi, found live]
 *     Pi's message_start/update/end fire for the USER's turn and for toolResult
 *     messages too, because `message` is a role union. Translating blindly
 *     echoed the user's own prompt back as assistant_text. Claude splits roles
 *     into distinct top-level types, so a Claude-modelled interface has no
 *     reason to expect this. No interface change -- an adapter-correctness
 *     lesson, recorded because the next adapter author will hit it.
 *
 * B12. capabilities need to be tri-state  [Codex; prediction P4 confirmed]
 *     draft0 used flat booleans. Codex's thread/items/list and thread/turns/list
 *     are in the STABLE, fully-typed surface and return -32601 "not supported
 *     yet". "Declared but unimplemented" is neither true nor false. Now a
 *     `CapabilityState` of yes | no | declared-unimplemented | emulated.
 * ========================================================================
 */

// =============================================================================
// Capabilities
// =============================================================================

/**
 * BEND B12: booleans were not enough.
 *
 * - "yes"                     -- observed working
 * - "no"                      -- the harness has no such concept
 * - "declared-unimplemented"  -- the harness's own API advertises it and it
 *                                fails at runtime (Codex transcript reads)
 * - "emulated"                -- the ADAPTER provides it, not the harness
 *                                (Pi approvals via a shipped extension)
 */
export type CapabilityState = "yes" | "no" | "declared-unimplemented" | "emulated";

/**
 * BEND B8: when can injected MCP servers be bound?
 * - "per-session"     -- fresh set per session (Claude, Pi)
 * - "per-process"     -- process-level config read at startup; cannot vary
 *                        per session within one process (Codex)
 * - "none"
 */
export type McpInjectionBinding = "per-session" | "per-process" | "none";

/**
 * What a harness can do, declared per adapter so herdctl can refuse or degrade
 * before attempting an operation.
 *
 * BEND B10: read this as a property of (adapter + harness), NOT of the harness.
 * Two adapters for the same harness can legitimately report different values,
 * because an adapter can manufacture a capability the harness lacks.
 */
export interface HarnessCapabilities {
  resume: CapabilityState;
  fork: CapabilityState;
  interrupt: CapabilityState;
  approvals: CapabilityState;
  streamingDeltas: CapabilityState;
  thinking: CapabilityState;
  /** Incremental output from a still-running tool (BEND B7). */
  toolOutputDeltas: CapabilityState;
  mcpStdio: CapabilityState;
  mcpHttp: CapabilityState;
  /** Reading back a stored transcript by session id. */
  transcriptRead: CapabilityState;
  tokenUsage: CapabilityState;
  /** BEND B4: cost is not a boolean -- see `costBasis` on the usage event. */
  costUsd: CapabilityState;
  setModelMidSession: CapabilityState;
  listCommands: CapabilityState;
  /** The harness confines tool side effects by its own mechanism. */
  sandbox: CapabilityState;
  /** BEND B8. */
  mcpInjection: McpInjectionBinding;
  /**
   * Free-text provenance for any capability whose state is "emulated" or
   * "declared-unimplemented", so the reason survives into a UI or a log.
   * e.g. { approvals: "adapter ships a Pi extension calling ctx.ui.confirm" }
   */
  via?: Partial<Record<keyof Omit<HarnessCapabilities, "via" | "mcpInjection">, string>>;
}

// =============================================================================
// Normalised event union
// =============================================================================

export interface HarnessEventBase {
  timestamp: string;
  /**
   * The untranslated native event, verbatim.
   *
   * BEND B6: nullable, because not every normalised event corresponds to a
   * native one. Pi emits no session-started event and no top-level error
   * event, so the adapter synthesises both.
   */
  raw: unknown | null;
  /** True when the adapter inferred this event rather than translating one. */
  synthetic?: boolean;
}

/** BEND B1: which kind of tool, since harnesses distinguish several. */
export type ToolKind =
  | "command" // shell / exec
  | "file_edit" // patch or structured edit
  | "file_read"
  | "mcp" // an MCP server's tool
  | "search" // web/file search
  | "builtin"
  | "other";

/** BEND B4: is a cost figure real money or a local estimate? */
export type CostBasis = "provider-billed" | "estimated" | "unavailable";

export type HarnessEvent =
  | (HarnessEventBase & {
      type: "session_started";
      sessionId: string;
      model?: string;
    })
  | (HarnessEventBase & { type: "assistant_text"; text: string })
  | (HarnessEventBase & { type: "assistant_delta"; text: string })
  | (HarnessEventBase & {
      type: "thinking";
      text: string;
      /** BEND B7: true for an incremental chunk, false/absent for a whole block. */
      partial?: boolean;
    })
  | (HarnessEventBase & {
      type: "tool_call";
      callId: string;
      name: string;
      input: unknown;
      kind?: ToolKind;
    })
  | (HarnessEventBase & {
      type: "tool_output_delta";
      callId: string;
      text: string;
    })
  | (HarnessEventBase & {
      type: "tool_result";
      callId: string;
      ok: boolean;
      output: unknown;
      kind?: ToolKind;
    })
  | (HarnessEventBase & {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      /** BEND B4: never add an "estimated" figure to real spend. */
      costBasis?: CostBasis;
      /**
       * BEND B4: true when the counters are session totals rather than a
       * delta for this message. Codex reports cumulative; Claude per-message.
       * Summing cumulative events double-counts.
       */
      cumulative?: boolean;
    })
  | (HarnessEventBase & {
      type: "turn_end";
      status: TurnEndStatus;
      /** BEND B5: lets a consumer correlate with a specific turn. */
      turnId?: string;
      /** The harness's own stop reason, unmapped, for diagnostics. */
      nativeStatus?: string;
    })
  | (HarnessEventBase & {
      type: "error";
      message: string;
      code?: string;
      /** BEND B3: false when the harness intends to continue the turn. */
      terminal?: boolean;
      /** BEND B3: the harness will retry on its own. Do NOT tear down. */
      willRetry?: boolean;
    });

/**
 * BEND B3/P6: draft0 had ok | interrupted | error | max_turns. Observed across
 * three harnesses: Claude adds error_during_execution; Pi's stopReason adds
 * "length", "deferred", "toolUse", "pending"; Codex has
 * completed|interrupted|failed|inProgress. `nativeStatus` carries the
 * unmapped original because this list will keep growing.
 */
export type TurnEndStatus =
  | "ok"
  | "interrupted"
  | "error"
  | "max_turns"
  | "context_exceeded"
  | "refused"
  | "unknown";

export type HarnessEventType = HarnessEvent["type"];

// =============================================================================
// Approvals  (BEND B2)
// =============================================================================

export interface ApprovalRequest {
  /**
   * The key to answer on. BEND B2: Codex routes approvals on `approvalId`,
   * which is NOT the tool item's id -- several callbacks can share one item.
   */
  callId: string;
  toolName: string;
  input: unknown;
  /** What kind of thing is being approved, where the harness distinguishes. */
  kind?: "command" | "file_change" | "permissions" | "tool" | "other";
  /**
   * BEND B2: the subset of decisions THIS prompt accepts, in the harness's own
   * vocabulary, when it tells us. A correct client offers these rather than
   * assuming allow/deny.
   */
  availableDecisions?: unknown[];
  /** The native request, so an adapter-specific UI can do better than this shape. */
  raw?: unknown;
}

/**
 * BEND B2: draft0 was `{allow: boolean}`.
 *
 * `scope` exists because "allow once" and "allow for the rest of the session"
 * are both first-class in Codex (accept vs acceptForSession) and a boolean
 * cannot say which. `native` is the escape hatch for decisions the normalised
 * shape cannot express at all -- amendments carrying an exec-policy or
 * network-policy patch.
 */
export interface ApprovalDecision {
  allow: boolean;
  scope?: "once" | "session";
  reason?: string;
  /** Verbatim harness-native decision; when set, takes precedence. */
  native?: unknown;
}

// =============================================================================
// MCP injection
// =============================================================================

/**
 * Reuses herdctl's existing transport-agnostic shape: herdctl owns the TOOLS,
 * each adapter chooses the transport (in-process SDK server, stdio child, or
 * the localhost HTTP bridge).
 *
 * Corrects draft0, which invented url/bearerToken/command fields. The real
 * herdctl type is tool definitions with handlers and no transport at all,
 * which is the better design and already fits all three harnesses.
 */
export interface InjectedMcpToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (args: Record<string, unknown>) => Promise<{
    content: { type: "text"; text: string }[];
  }>;
}

export interface InjectedMcpServerDef {
  name: string;
  version?: string;
  tools: InjectedMcpToolDef[];
}

// =============================================================================
// Adapter + session
// =============================================================================

/** BEND B9: policy is distinct from handling. */
export type ApprovalPolicy =
  | "never" // never ask; auto-allow
  | "on-request" // ask when the harness thinks it needs to
  | "untrusted" // ask for anything not known-safe
  | "always"; // ask for every tool call

export interface StartSessionOptions {
  cwd: string;
  model?: string;
  systemPromptAppend?: string;
  resumeSessionId?: string;
  injectedMcpServers?: Record<string, InjectedMcpServerDef>;
  /** BEND B9: what to be asked about, independent of who answers. */
  approvalPolicy?: ApprovalPolicy;
  /** Who answers. Absent => adapter auto-allows. */
  onApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  env?: Record<string, string>;
  abortController?: AbortController;
}

export interface HarnessAdapter {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;
  startSession(opts: StartSessionOptions): Promise<HarnessSession>;
}

export interface HarnessSession {
  /** BEND B0: a promise, because the id's availability differs per harness. */
  readonly sessionId: Promise<string>;
  /** BEND B0: non-blocking peek for callers that can tolerate a gap. */
  currentSessionId(): string | undefined;
  /** The normalised event stream for the whole session, across turns. */
  readonly events: AsyncIterable<HarnessEvent>;
  /** Send a user turn. Resolves when ACCEPTED, not when the turn completes. */
  prompt(text: string): Promise<void>;
  /**
   * Stop the in-flight turn; the session stays usable.
   *
   * BEND B5: argument-free is the right consumer-facing shape, but note the
   * adapter must track which turn is live (Codex addresses a specific turnId).
   */
  interrupt(): Promise<void>;
  /** Shut the session down and release the process. */
  close(): Promise<void>;
}
