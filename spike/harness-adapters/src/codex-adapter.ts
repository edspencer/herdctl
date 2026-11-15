/**
 * Codex adapter: `codex app-server` over stdio.
 *
 * Protocol facts established against the real binary (0.169.0) -- see
 * FINDINGS.md. The ones that shape this file:
 *
 *  - It is JSON-RPC *shaped* but NOT JSON-RPC 2.0. There is no `jsonrpc`
 *    field; the server never emits one. A strict 2.0 client that validates
 *    inbound messages rejects every single one.
 *  - Framing is newline-delimited JSON. Notifications carry `emittedAtMs`.
 *  - `initialize` returns NO capabilities and NO protocol version, only
 *    {userAgent, codexHome, platformFamily, platformOs}. Negotiation is
 *    client->server only, so an adapter must version-gate off `userAgent`.
 *  - The client must then send the `initialized` notification.
 *  - `thread/start` returns the thread id synchronously (unlike Claude).
 *  - Approvals arrive as real server->client *requests* carrying an id, and
 *    the decision vocabulary is far richer than allow/deny.
 *  - The auth wall is at `turn/start`, not at session setup: thread
 *    start/fork/resume all work with zero credentials.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonLines, writeJsonLine } from "./jsonl.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  HarnessAdapter,
  HarnessCapabilities,
  HarnessEvent,
  HarnessSession,
  StartSessionOptions,
} from "./harness.ts";
import { startMcpHttpBridge } from "../../../packages/core/src/runner/runtime/mcp-http-bridge.ts";

const SPIKE_ROOT = process.env.SPIKE_ROOT ?? "/data/paddock-servers/harness-spike";

const CODEX_BIN =
  process.env.SPIKE_CODEX_BIN ??
  join(
    import.meta.dirname,
    "..",
    "node_modules",
    "@openai/codex-linux-x64",
    "vendor",
    "x86_64-unknown-linux-musl",
    "bin",
    "codex",
  );

// =============================================================================
// Event queue
// =============================================================================

class EventQueue {
  private queue: HarnessEvent[] = [];
  private waiters: ((v: IteratorResult<HarnessEvent>) => void)[] = [];
  private done = false;

  push(e: HarnessEvent): void {
    const w = this.waiters.shift();
    if (w) w({ value: e, done: false });
    else this.queue.push(e);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  iterable(): AsyncIterable<HarnessEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<HarnessEvent>> {
            const v = self.queue.shift();
            if (v) return Promise.resolve({ value: v, done: false });
            if (self.done) return Promise.resolve({ value: undefined as never, done: true });
            return new Promise((r) => self.waiters.push(r));
          },
        };
      },
    };
  }
}

// =============================================================================
// Session
// =============================================================================

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

class CodexSession implements HarnessSession {
  private child: ChildProcessWithoutNullStreams;
  private queue = new EventQueue();
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private threadId?: string;
  private currentTurnId?: string;
  private sessionIdResolve!: (v: string) => void;
  readonly sessionId: Promise<string>;
  private closed = false;
  private onApproval?: (r: ApprovalRequest) => Promise<ApprovalDecision>;
  private bridges: { close: () => Promise<void> }[] = [];

  constructor(child: ChildProcessWithoutNullStreams, opts: StartSessionOptions) {
    this.child = child;
    this.onApproval = opts.onApproval;
    this.sessionId = new Promise<string>((r) => {
      this.sessionIdResolve = r;
    });

    // Newline-delimited JSON via the strict LF splitter rather than readline
    // -- see jsonl.ts for why (explicit framing contract; non-protocol noise
    // surfaced rather than swallowed).
    readJsonLines(
      child.stdout,
      (value) => this.handle(value as Record<string, unknown>),
      () => {
        /* non-JSON log noise on stdout; ignore */
      },
    );

    child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.queue.push({
          type: "error",
          timestamp: new Date().toISOString(),
          raw: { code, signal },
          message: `codex app-server exited unexpectedly (code=${code} signal=${signal})`,
        });
      }
      this.queue.end();
    });
  }

  get events(): AsyncIterable<HarnessEvent> {
    return this.queue.iterable();
  }

  currentSessionId(): string | undefined {
    return this.threadId;
  }

  registerBridge(b: { close: () => Promise<void> }): void {
    this.bridges.push(b);
  }

  // --- transport ------------------------------------------------------------

  /** Send a request. NOTE: deliberately omits `jsonrpc` -- see file header. */
  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method };
    if (params !== undefined) payload.params = params;
    writeJsonLine(this.child.stdin, payload);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method: string, params?: unknown): void {
    const payload: Record<string, unknown> = { method };
    if (params !== undefined) payload.params = params;
    writeJsonLine(this.child.stdin, payload);
  }

  private respond(id: number | string, result: unknown): void {
    writeJsonLine(this.child.stdin, { id, result });
  }

  // --- inbound dispatch -----------------------------------------------------

  private handle(msg: Record<string, unknown>): void {
    const id = msg.id as number | string | undefined;
    const method = msg.method as string | undefined;

    // Response to one of our requests
    if (id !== undefined && method === undefined) {
      const p = this.pending.get(id as number);
      if (!p) return;
      this.pending.delete(id as number);
      if (msg.error) {
        const e = msg.error as { code?: number; message?: string };
        p.reject(new Error(`codex error ${e.code}: ${e.message}`));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // Server -> client REQUEST (approval and friends): has both id and method
    if (id !== undefined && method !== undefined) {
      void this.handleServerRequest(id, method, msg.params as Record<string, unknown>);
      return;
    }

    // Notification
    if (method) this.handleNotification(method, (msg.params ?? {}) as Record<string, unknown>, msg);
  }

  private async handleServerRequest(
    id: number | string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const ts = new Date().toISOString();

    // Codex routes on approvalId when present: several callbacks can share one
    // itemId, so itemId is NOT a safe correlation key.
    const callId = String(params?.approvalId ?? params?.itemId ?? id);

    if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
      const toolName = String(params?.command ?? "command");
      const decision = await this.ask({ callId, toolName, input: params });
      // BEND B2: the normalised ApprovalDecision is a boolean, but Codex's
      // vocabulary is accept | acceptForSession | {acceptWithExecpolicyAmendment}
      // | {applyNetworkPolicyAmendment} | decline | cancel -- and the server
      // tells us which subset is offerable via availableDecisions. Collapsing
      // to allow/deny throws that away; we read availableDecisions so we at
      // least send a value this prompt accepts.
      const available = Array.isArray(params?.availableDecisions)
        ? (params.availableDecisions as unknown[])
        : undefined;
      const pick = (want: string, fallback: string) =>
        !available || available.includes(want) ? want : fallback;
      this.respond(id, {
        decision: decision.allow ? pick("accept", "acceptForSession") : pick("decline", "cancel"),
      });
      return;
    }

    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
      const decision = await this.ask({ callId, toolName: "fileChange", input: params });
      this.respond(id, { decision: decision.allow ? "accept" : "decline" });
      return;
    }

    if (method === "item/permissions/requestApproval") {
      const decision = await this.ask({ callId, toolName: "permissions", input: params });
      // Shape is {permissions, scope} -- not a decision enum at all.
      this.respond(id, {
        permissions: decision.allow ? (params?.permissions ?? []) : [],
        scope: "turn",
      });
      return;
    }

    // Anything else the server asks for (attestation, token refresh, user
    // input, elicitation). Answer minimally so the turn is not left hanging.
    this.queue.push({
      type: "error",
      timestamp: ts,
      raw: { method, params },
      message: `unhandled codex server request: ${method}`,
    });
    this.respond(id, {});
  }

  private async ask(req: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.onApproval) return { allow: true };
    try {
      return await this.onApproval(req);
    } catch {
      return { allow: false, reason: "approval handler threw" };
    }
  }

  private handleNotification(
    method: string,
    params: Record<string, unknown>,
    raw: unknown,
  ): void {
    const ts = new Date().toISOString();
    const push = (e: Omit<HarnessEvent, "timestamp" | "raw">) =>
      this.queue.push({ ...(e as HarnessEvent), timestamp: ts, raw });

    switch (method) {
      case "thread/started": {
        const thread = params.thread as Record<string, unknown> | undefined;
        const tid = String(thread?.id ?? "");
        if (tid && !this.threadId) {
          this.threadId = tid;
          this.sessionIdResolve(tid);
        }
        push({
          type: "session_started",
          sessionId: tid,
          ...(thread?.model ? { model: String(thread.model) } : {}),
        } as never);
        return;
      }

      case "turn/started": {
        const turn = params.turn as Record<string, unknown> | undefined;
        this.currentTurnId = turn?.id ? String(turn.id) : undefined;
        return;
      }

      case "item/agentMessage/delta":
        push({ type: "assistant_delta", text: String(params.delta ?? "") } as never);
        return;

      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        push({ type: "thinking", text: String(params.delta ?? "") } as never);
        return;

      case "item/commandExecution/outputDelta":
        // No normalised home: this is incremental output of an in-flight tool.
        // See BEND B1 -- the union has no tool_progress/tool_output_delta.
        return;

      case "item/started": {
        const item = params.item as Record<string, unknown> | undefined;
        const ev = this.itemToEvent(item, "started");
        if (ev) push(ev as never);
        return;
      }

      case "item/completed": {
        const item = params.item as Record<string, unknown> | undefined;
        const ev = this.itemToEvent(item, "completed");
        if (ev) push(ev as never);
        return;
      }

      case "thread/tokenUsage/updated": {
        const u = params.tokenUsage as Record<string, unknown> | undefined;
        const last = (u?.last ?? {}) as Record<string, number>;
        push({
          type: "usage",
          inputTokens: last.inputTokens ?? 0,
          outputTokens: last.outputTokens ?? 0,
          // BEND B4: no costUsd. Codex exposes dollars only at account level
          // (account/usage/read), behind OpenAI auth -- so a custom-provider
          // deployment can never report cost.
        } as never);
        return;
      }

      case "turn/completed": {
        const turn = params.turn as Record<string, unknown> | undefined;
        const status = String(turn?.status ?? "completed");
        push({
          type: "turn_end",
          status:
            status === "interrupted"
              ? "interrupted"
              : status === "failed"
                ? "error"
                : "ok",
        } as never);
        return;
      }

      case "error": {
        const err = params.error as Record<string, unknown> | undefined;
        push({
          type: "error",
          message: String(err?.message ?? "codex turn error"),
          ...(err?.codexErrorInfo ? { code: JSON.stringify(err.codexErrorInfo) } : {}),
        } as never);
        // An error notification does not imply the turn ended; Codex may retry
        // (`willRetry`). Only turn/completed ends a turn.
        return;
      }

      case "configWarning":
      case "remoteControl/status/changed":
      case "thread/status/changed":
      case "turn/diff/updated":
        return; // no normalised equivalent; consumers read raw

      default:
        return;
    }
  }

  /**
   * BEND B1: Codex has 18 distinct ThreadItem variants. The normalised union
   * has exactly one tool_call/tool_result pair, so five materially different
   * things (a shell command, a patch application, an MCP tool call, a dynamic
   * tool call, a web search) all have to squeeze through it, losing the
   * distinction. Recorded rather than papered over.
   */
  private itemToEvent(
    item: Record<string, unknown> | undefined,
    phase: "started" | "completed",
  ): Omit<HarnessEvent, "timestamp" | "raw"> | undefined {
    if (!item) return undefined;
    const type = String(item.type ?? "");
    const id = String(item.id ?? "");

    if (type === "agentMessage") {
      return phase === "completed"
        ? ({ type: "assistant_text", text: String(item.text ?? "") } as never)
        : undefined;
    }

    if (type === "reasoning") {
      if (phase !== "completed") return undefined;
      const parts = [
        ...((item.summary as string[] | undefined) ?? []),
        ...((item.content as string[] | undefined) ?? []),
      ];
      return parts.length ? ({ type: "thinking", text: parts.join("\n") } as never) : undefined;
    }

    const toolish: Record<string, { name: string; input: unknown; output: unknown; ok: boolean }> = {
      commandExecution: {
        name: "shell",
        input: { command: item.command, cwd: item.cwd },
        output: item.aggregatedOutput,
        ok: item.status === "completed" && (item.exitCode ?? 0) === 0,
      },
      fileChange: {
        name: "apply_patch",
        input: { changes: item.changes },
        output: item.changes,
        ok: item.status === "completed",
      },
      mcpToolCall: {
        name: `mcp__${String(item.server ?? "")}__${String(item.tool ?? "")}`,
        input: item.arguments,
        output: item.result ?? item.error,
        ok: item.status === "completed",
      },
      dynamicToolCall: {
        name: `${String(item.namespace ?? "")}/${String(item.tool ?? "")}`,
        input: item.arguments,
        output: item.contentItems,
        ok: item.success === true,
      },
      functionCallOutput: {
        name: String(item.name ?? "function"),
        input: undefined,
        output: item.output,
        ok: true,
      },
    };

    const t = toolish[type];
    if (!t) return undefined;

    if (phase === "started") {
      return { type: "tool_call", callId: id, name: t.name, input: t.input } as never;
    }
    return { type: "tool_result", callId: id, ok: t.ok, output: t.output } as never;
  }

  // --- control --------------------------------------------------------------

  async start(opts: StartSessionOptions): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "herdctl-spike", title: "herdctl harness spike", version: "0.0.1" },
      // Note: clientInfo.name is echoed into the upstream User-Agent and
      // thread.originator, so it is not purely cosmetic.
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify("initialized");

    const common = {
      cwd: opts.cwd,
      model: opts.model ?? "spike-fake-1",
      modelProvider: "spikefake",
      // BEND B9: the interface can express "I have an approval callback" but
      // not an approval POLICY. Codex has five policy values plus a granular
      // per-category object. Inferring the policy from the presence of a
      // callback is the best this interface allows, and it is lossy.
      approvalPolicy: opts.onApproval ? "untrusted" : "never",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
    };

    if (opts.resumeSessionId) {
      const res = (await this.request("thread/resume", {
        threadId: opts.resumeSessionId,
        ...common,
      })) as Record<string, unknown>;
      const thread = res?.thread as Record<string, unknown> | undefined;
      this.threadId = String(thread?.id ?? opts.resumeSessionId);
    } else {
      const res = (await this.request("thread/start", common)) as Record<string, unknown>;
      const thread = res?.thread as Record<string, unknown> | undefined;
      this.threadId = String(thread?.id ?? "");
    }
    if (this.threadId) this.sessionIdResolve(this.threadId);
  }

  async prompt(text: string): Promise<void> {
    if (!this.threadId) throw new Error("no thread");
    const res = (await this.request("turn/start", {
      threadId: this.threadId,
      // text_elements is NOT optional in the generated bindings.
      input: [{ type: "text", text, text_elements: [] }],
    })) as Record<string, unknown>;
    const turn = res?.turn as Record<string, unknown> | undefined;
    if (turn?.id) this.currentTurnId = String(turn.id);
  }

  async interrupt(): Promise<void> {
    if (!this.threadId) return;
    // BEND B5: the normalised interrupt() takes no arguments ("stop the
    // current turn"), but Codex addresses a specific turn by id. The adapter
    // has to track the live turn id itself. Workable, but it means "the
    // current turn" is adapter state rather than something the harness owns.
    if (!this.currentTurnId) throw new Error("no in-flight turn id to interrupt");
    await this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.currentTurnId,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const b of this.bridges) await b.close().catch(() => {});
    try {
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    // Kill only the PID we started.
    if (this.child.pid && !this.child.killed) this.child.kill("SIGTERM");
    this.queue.end();
  }
}

// =============================================================================
// Adapter
// =============================================================================

export class CodexAdapter implements HarnessAdapter {
  readonly name = "codex";

  readonly capabilities: HarnessCapabilities = {
    resume: true,
    fork: true,
    interrupt: true,
    approvals: true,
    streamingDeltas: true,
    thinking: true,
    mcpStdio: true,
    mcpHttp: true,
    costUsd: false, // account-level only, behind OpenAI auth
    tokenUsage: true,
    setModelMidSession: true, // per-turn model override on turn/start
    listCommands: false, // no slash-command enumeration in app-server
    sandbox: true, // read-only / workspace-write / danger-full-access
  };

  async startSession(opts: StartSessionOptions): Promise<HarnessSession> {
    if (!existsSync(CODEX_BIN)) {
      throw new Error(`codex binary not found at ${CODEX_BIN}`);
    }

    const codexHome = process.env.CODEX_HOME ?? join(SPIKE_ROOT, "codex-home");
    mkdirSync(codexHome, { recursive: true });

    // --- MCP: stand up herdctl's bridge, then write it into config.toml ----
    // BEND B8: Codex has NO app-server method to add an MCP server. MCP is
    // process-level config read at startup, so "inject these MCP servers for
    // this session" is not expressible: the adapter must write config.toml
    // before spawn. For herdctl that means injected MCP servers cannot vary
    // per-session within one harness process.
    const bridges: { close: () => Promise<void> }[] = [];
    const mcpToml: string[] = [];
    const mcpEnv: Record<string, string> = {};
    let i = 0;
    for (const [key, def] of Object.entries(opts.injectedMcpServers ?? {})) {
      const bridge = await startMcpHttpBridge(def as never, { host: "127.0.0.1" });
      bridges.push(bridge);
      const envVar = `SPIKE_MCP_TOKEN_${i++}`;
      mcpEnv[envVar] = bridge.token;
      mcpToml.push(
        `[mcp_servers.${key}]`,
        `url = "http://127.0.0.1:${bridge.port}/mcp"`,
        // Header value is read from a named env var -- the token never appears
        // in the config file or on a command line.
        `bearer_token_env_var = "${envVar}"`,
        `startup_timeout_sec = 20`,
        ``,
      );
    }

    const providerUrl = opts.env?.SPIKE_PROVIDER_URL ?? "http://127.0.0.1:8099/v1";
    const config = [
      `model = "${opts.model ?? "spike-fake-1"}"`,
      `model_provider = "spikefake"`,
      `approval_policy = "${opts.onApproval ? "untrusted" : "never"}"`,
      `sandbox_mode = "workspace-write"`,
      ``,
      `[model_providers.spikefake]`,
      `name = "Spike Fake"`,
      `base_url = "${providerUrl}"`,
      // wire_api accepts ONLY "responses" in 0.169.0; "chat" was removed.
      // This is why an OpenRouter-style chat/completions endpoint cannot back
      // Codex without a translation layer.
      `wire_api = "responses"`,
      `env_key = "SPIKE_FAKE_KEY"`,
      `requires_openai_auth = false`,
      ``,
      `[sandbox_workspace_write]`,
      `writable_roots = ["${join(SPIKE_ROOT, "work")}"]`,
      `network_access = true`,
      ``,
      ...mcpToml,
    ].join("\n");
    writeFileSync(join(codexHome, "config.toml"), config);

    const child = spawn(CODEX_BIN, ["app-server", "--stdio"], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        HOME: process.env.HOME ?? join(SPIKE_ROOT, "home"),
        // A non-empty placeholder so Codex does not refuse for lack of a key.
        // The fake provider ignores it. requires_openai_auth=false above means
        // no real OpenAI credential is consulted.
        SPIKE_FAKE_KEY: "spike-placeholder-not-a-real-key",
        ...mcpEnv,
        ...(opts.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    child.stderr.on("data", (d) => {
      const s = String(d);
      if (process.env.SPIKE_VERBOSE) process.stderr.write(`[codex stderr] ${s}`);
    });

    const session = new CodexSession(child, opts);
    for (const b of bridges) session.registerBridge(b);
    await session.start(opts);
    return session;
  }
}
