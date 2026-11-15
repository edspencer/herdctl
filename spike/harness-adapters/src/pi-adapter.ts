/**
 * Pi adapter: `pi --mode rpc` over stdio.
 *
 * WHY RPC MODE AND NOT THE IN-PROCESS SDK
 *  - It matches the subprocess model herdctl's CLI runtime already uses.
 *  - `--session-id <id>` is idempotent resume-or-create against a
 *    CALLER-SUPPLIED id, so herdctl can use its own job id as the session id
 *    instead of storing a mapping. The SDK has no resume option at all; you
 *    must construct a SessionManager yourself.
 *  - Approvals only reach a host in RPC mode. Pi has no built-in approval
 *    prompts, but an extension `tool_call` handler can block a call, and in
 *    RPC mode `ctx.hasUI` is true, so `ctx.ui.confirm()` round-trips over the
 *    extension-UI subprotocol to us. That is the only way to get a
 *    Claude-style "ask the host before running this tool" out of Pi.
 *
 * Protocol facts that shaped this file (Pi 1.5.2):
 *  - Commands are `{type, id?}` -- `type`, not `method`.
 *  - Responses are `{id, type:"response", command, success, data?|error}`.
 *  - Events stream UNWRAPPED at the top level, structurally distinguishable
 *    from responses only by `type !== "response"`.
 *  - `success:true` means ACCEPTED, not complete. The turn boundary is the
 *    `agent_settled` event.
 *  - There is NO top-level `error` event; errors are spread across five
 *    channels (see BEND B6).
 *  - Pi executes tools itself; there is no client-side tool execution request.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

const PI_CLI =
  process.env.SPIKE_PI_CLI ??
  join(
    import.meta.dirname,
    "..",
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );

/**
 * The approval gate extension, written to disk and loaded with `-e`.
 *
 * This is the whole mechanism behind Pi's approval capability: Pi ships no
 * approval prompts, so the host has to supply the gate itself. `ctx.ui.confirm`
 * is what crosses back to us as an `extension_ui_request` record.
 */
const APPROVAL_GATE_SOURCE = `
export default function gate(pi) {
  pi.on("tool_call", async (event, ctx) => {
    // Pi's own docs note a bare toolName comparison does not narrow, but we
    // only need the name as a label here.
    const name = event.toolName ?? "unknown";
    const title = "herdctl-spike approval";
    const message = JSON.stringify({ tool: name, input: event.input });
    if (!ctx.hasUI) {
      return { block: true, reason: "no host UI available to approve " + name };
    }
    const allowed = await ctx.ui.confirm(title, message, { timeout: 60000 });
    if (!allowed) {
      // reason becomes the error tool-result text the MODEL sees, and the loop
      // continues so the model can react.
      return { block: true, reason: "Denied by herdctl host policy" };
    }
    return undefined;
  });
}
`;

// =============================================================================
// Event queue (same shape as the Codex adapter's)
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

class PiSession implements HarnessSession {
  private child: ChildProcessWithoutNullStreams;
  private queue = new EventQueue();
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private sid: string;
  readonly sessionId: Promise<string>;
  private closed = false;
  private onApproval?: (r: ApprovalRequest) => Promise<ApprovalDecision>;
  private bridges: { close: () => Promise<void> }[] = [];
  /** Stop reason from the last message_end, needed because agent_settled lacks one. */
  private lastStopReason?: string;
  private lastErrorMessage?: string;

  constructor(child: ChildProcessWithoutNullStreams, sid: string, opts: StartSessionOptions) {
    this.child = child;
    this.sid = sid;
    this.onApproval = opts.onApproval;
    // BEND B0 note: Pi, unlike Claude, lets the CALLER choose the session id
    // (--session-id), so the id is known before the process even starts.
    // Three harnesses, three different answers to "when does an id exist".
    this.sessionId = Promise.resolve(sid);

    readJsonLines(
      child.stdout,
      (value) => this.handle(value as Record<string, unknown>),
      () => {
        /* non-protocol noise */
      },
    );

    child.on("exit", (code, signal) => {
      if (!this.closed) {
        this.queue.push({
          type: "error",
          timestamp: new Date().toISOString(),
          raw: { code, signal },
          message: `pi exited unexpectedly (code=${code} signal=${signal})`,
        });
      }
      this.queue.end();
    });
  }

  get events(): AsyncIterable<HarnessEvent> {
    return this.queue.iterable();
  }

  currentSessionId(): string | undefined {
    return this.sid;
  }

  registerBridge(b: { close: () => Promise<void> }): void {
    this.bridges.push(b);
  }

  // --- transport ------------------------------------------------------------

  private command(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    const id = `c${++this.seq}`;
    writeJsonLine(this.child.stdin, { id, type, ...extra });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private handle(msg: Record<string, unknown>): void {
    const type = String(msg.type ?? "");

    // Responses carry type:"response"; events are unwrapped, so anything else
    // is an event. Discriminating on `type` is the documented approach.
    if (type === "response") {
      const id = String(msg.id ?? "");
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (msg.success === true) p.resolve(msg.data);
        else p.reject(new Error(String(msg.error ?? "pi command failed")));
      }
      return;
    }

    if (type === "extension_ui_request") {
      void this.handleUiRequest(msg);
      return;
    }

    this.translate(type, msg);
  }

  /**
   * The approval round-trip. Pi's extension asked `ctx.ui.confirm`, which
   * surfaced here; we answer on stdin with the SAME id.
   */
  private async handleUiRequest(msg: Record<string, unknown>): Promise<void> {
    const id = msg.id;
    const method = String(msg.method ?? "");

    if (method !== "confirm" && method !== "select") {
      // Fire-and-forget methods (notify/setStatus/...) expect no reply.
      return;
    }

    let input: unknown = msg.message;
    let toolName = "unknown";
    try {
      const parsed = JSON.parse(String(msg.message ?? "{}"));
      toolName = String(parsed.tool ?? "unknown");
      input = parsed.input;
    } catch {
      /* keep raw message */
    }

    let decision: ApprovalDecision = { allow: true };
    if (this.onApproval) {
      try {
        decision = await this.onApproval({ callId: String(id), toolName, input });
      } catch {
        decision = { allow: false, reason: "approval handler threw" };
      }
    }

    if (method === "confirm") {
      writeJsonLine(this.child.stdin, {
        type: "extension_ui_response",
        id,
        confirmed: decision.allow,
      });
    } else {
      writeJsonLine(this.child.stdin, {
        type: "extension_ui_response",
        id,
        value: decision.allow ? "Allow" : "Block",
      });
    }
  }

  // --- event translation ----------------------------------------------------

  private translate(type: string, msg: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const push = (e: Omit<HarnessEvent, "timestamp" | "raw">) =>
      this.queue.push({ ...(e as HarnessEvent), timestamp: ts, raw: msg });

    switch (type) {
      case "agent_start":
        // Pi has no session_started event at all: in RPC mode no header is
        // emitted. We synthesise one from the caller-supplied id so consumers
        // see a uniform stream. (BEND B7.)
        push({ type: "session_started", sessionId: this.sid } as never);
        return;

      case "message_update": {
        const ame = msg.assistantMessageEvent as Record<string, unknown> | undefined;
        const k = String(ame?.type ?? "");
        if (k === "text_delta") {
          push({ type: "assistant_delta", text: String(ame?.delta ?? "") } as never);
        } else if (k === "thinking_delta") {
          push({ type: "thinking", text: String(ame?.delta ?? "") } as never);
        }
        // The WIRE shape lifts cumulative usage to the top level of
        // message_update (the SDK shape does not). Cumulative, so we only
        // report it at message_end to avoid emitting monotonically growing
        // duplicates.
        return;
      }

      case "message_end": {
        const m = msg.message as Record<string, unknown> | undefined;

        // BEND B11, found by running it: Pi's message_start/update/end are
        // ROLE-POLYMORPHIC. `message` is an AgentMessage union, so message_end
        // also fires for the user's own turn and for toolResult messages.
        // Translating it blindly emits the user's prompt and every tool result
        // back as assistant_text -- which is what the first run did. Claude by
        // contrast splits roles into distinct top-level message types, so an
        // interface modelled on Claude has no reason to expect this.
        const role = String(m?.role ?? "");
        if (role !== "assistant") return;

        this.lastStopReason = m?.stopReason ? String(m.stopReason) : undefined;
        this.lastErrorMessage = m?.errorMessage ? String(m.errorMessage) : undefined;

        const content = Array.isArray(m?.content) ? (m.content as Record<string, unknown>[]) : [];
        for (const b of content) {
          if (b?.type === "text" && typeof b.text === "string" && b.text) {
            push({ type: "assistant_text", text: b.text } as never);
          } else if (b?.type === "thinking" && typeof b.thinking === "string") {
            push({ type: "thinking", text: b.thinking } as never);
          }
        }

        const u = m?.usage as Record<string, unknown> | undefined;
        if (u) {
          const cost = u.cost as Record<string, number> | undefined;
          push({
            type: "usage",
            inputTokens: Number(u.input ?? 0),
            outputTokens: Number(u.output ?? 0),
            // Pi DOES report a dollar figure. cost.total is provider-billed
            // when available, else a catalog estimate -- totalFromProvider
            // says which, a distinction the normalised union cannot express
            // (BEND B8).
            ...(cost && typeof cost.total === "number" ? { costUsd: cost.total } : {}),
          } as never);
        }

        // BEND B6: Pi has no top-level error event. An errored turn is only
        // visible as stopReason === "error" on the message, so the adapter has
        // to synthesise the normalised error event here.
        if (this.lastStopReason === "error") {
          push({
            type: "error",
            message: this.lastErrorMessage ?? "pi turn ended with stopReason=error",
          } as never);
        }
        return;
      }

      case "tool_execution_start":
        push({
          type: "tool_call",
          callId: String(msg.toolCallId ?? ""),
          name: String(msg.toolName ?? ""),
          input: msg.args,
        } as never);
        return;

      case "tool_execution_end":
        push({
          type: "tool_result",
          callId: String(msg.toolCallId ?? ""),
          ok: msg.isError !== true,
          output: msg.result,
        } as never);
        return;

      case "agent_settled": {
        // THE turn boundary. agent_end is not: it closes one low-level run and
        // can be followed by automatic retry, compaction or queued work.
        const aborted = msg.aborted === true;
        push({
          type: "turn_end",
          status: aborted
            ? "interrupted"
            : this.lastStopReason === "error"
              ? "error"
              : this.lastStopReason === "length"
                ? "max_turns"
                : "ok",
        } as never);
        return;
      }

      case "auto_retry_start":
        push({
          type: "error",
          message: `pi auto-retry: ${String(msg.errorMessage ?? "")}`,
          code: "auto_retry",
        } as never);
        return;

      case "extension_error":
        push({
          type: "error",
          message: `pi extension error (${String(msg.event ?? "")}): ${String(msg.error ?? "")}`,
          code: "extension_error",
        } as never);
        return;

      default:
        // agent_end, turn_start, queue_update, entry_appended, compaction_*,
        // bash_execution_update, ... no normalised equivalent; raw is available.
        return;
    }
  }

  // --- control --------------------------------------------------------------

  async prompt(text: string): Promise<void> {
    // Resolves on ACCEPTANCE, not completion -- matches the normalised
    // contract, and is also exactly what Pi's response means.
    await this.command("prompt", { message: text });
  }

  async interrupt(): Promise<void> {
    await this.command("abort");
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const b of this.bridges) await b.close().catch(() => {});
    try {
      // Closing stdin is Pi's documented orderly shutdown.
      this.child.stdin.end();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 200));
    if (this.child.pid && !this.child.killed) this.child.kill("SIGTERM");
    this.queue.end();
  }
}

// =============================================================================
// Adapter
// =============================================================================

export class PiAdapter implements HarnessAdapter {
  readonly name = "pi";

  readonly capabilities: HarnessCapabilities = {
    resume: true, // --session-id, idempotent, caller-supplied
    fork: true, // fork {entryId} / --fork
    interrupt: true, // abort
    // True only because we ship an extension to provide it. Pi itself has no
    // approval concept -- see BEND B10 on capabilities being a property of
    // "adapter + harness", not of the harness alone.
    approvals: true,
    streamingDeltas: true,
    thinking: true,
    mcpStdio: true,
    mcpHttp: true, // streamable HTTP; legacy SSE explicitly unsupported
    costUsd: true, // usage.cost.total
    tokenUsage: true,
    setModelMidSession: true, // set_model {provider, modelId}
    listCommands: true, // get_commands
    sandbox: false, // none by design
  };

  async startSession(opts: StartSessionOptions): Promise<HarnessSession> {
    if (!existsSync(PI_CLI)) throw new Error(`pi CLI not found at ${PI_CLI}`);

    // One isolated agent dir relocates settings, models.json, auth.json AND
    // sessions in a single move, keeping the real ~/.pi entirely out of play.
    const agentDir = join(SPIKE_ROOT, "pi-home");
    mkdirSync(agentDir, { recursive: true });

    const providerUrl = opts.env?.SPIKE_PROVIDER_URL ?? "http://127.0.0.1:8099/v1";
    const modelId = opts.model ?? "spike-fake-1";

    // models.json: point Pi at the fake provider.
    // api:"openai-completions" => POST <baseUrl>/chat/completions, so baseUrl
    // MUST already include /v1; Pi does not append it.
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            spikefake: {
              baseUrl: providerUrl,
              api: "openai-completions",
              apiKey: "spike-placeholder-not-a-real-key",
              models: [
                {
                  id: modelId,
                  name: "Spike Fake",
                  // The fake provider does honour usage on the final chunk, but
                  // be explicit: this compat flag defaults true and yields zero
                  // usage/cost against an endpoint that ignores
                  // stream_options.include_usage.
                  compat: { supportsUsageInStreaming: true },
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    // --- MCP: herdctl's bridge, declared in the USER-level mcp.json --------
    // User-level deliberately: a project-level .pi/mcp.json is trust-gated and
    // is SILENTLY SKIPPED in rpc mode under the default "ask" trust setting,
    // which would look like the bridge simply not working.
    const bridges: { close: () => Promise<void> }[] = [];
    const servers: Record<string, unknown> = {};
    for (const [key, def] of Object.entries(opts.injectedMcpServers ?? {})) {
      const bridge = await startMcpHttpBridge(def as never, { host: "127.0.0.1" });
      bridges.push(bridge);
      servers[key] = {
        url: `http://127.0.0.1:${bridge.port}/mcp`,
        headers: { Authorization: `Bearer ${bridge.token}` },
        // Default exposure is "codemode", which does NOT declare the tools to
        // the model. "direct" is required for the model to see them at all.
        exposure: "direct",
        timeout: 30,
      };
    }
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: servers }, null, 2));

    // --- approval gate extension -------------------------------------------
    const extPath = join(agentDir, "spike-approval-gate.js");
    if (opts.onApproval) writeFileSync(extPath, APPROVAL_GATE_SOURCE);

    const sessionId = opts.resumeSessionId ?? randomUUID();

    const args = [
      PI_CLI,
      "--mode",
      "rpc",
      // Idempotent resume-or-create on a caller-chosen id. Note: on a miss it
      // CREATES rather than failing, and warns on stderr -- so a bad id looks
      // like success. The recall oracle in the scenario is what distinguishes
      // those two outcomes.
      "--session-id",
      sessionId,
      "--provider",
      "spikefake",
      "--model",
      `spikefake/${modelId}`,
      // Required for project-scoped resources to load in non-interactive modes.
      "--approve",
    ];
    if (opts.onApproval) args.push("-e", extPath);

    const child = spawn(process.execPath, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        HOME: process.env.HOME ?? join(SPIKE_ROOT, "home"),
        PI_SKIP_VERSION_CHECK: "1",
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
        ...(opts.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    child.stderr.on("data", (d) => {
      if (process.env.SPIKE_VERBOSE) process.stderr.write(`[pi stderr] ${String(d)}`);
    });

    const session = new PiSession(child, sessionId, opts);
    for (const b of bridges) session.registerBridge(b);

    // Give the process a moment to come up and be ready for commands.
    await new Promise((r) => setTimeout(r, 1200));
    return session;
  }
}
