/**
 * A fake, local, OpenAI-compatible model provider.
 *
 * WHY THIS EXISTS
 * ---------------
 * The spike has no model credentials. But almost nothing the spike wants to
 * learn is about model intelligence -- it is about protocol: does a session
 * start, does a session id come back, does resume actually replay history, does
 * a tool call round-trip, does an interrupt land, does an MCP tool get invoked.
 * All of that is observable against a scripted provider, and observing it
 * against a REAL harness process driving a REAL protocol is far stronger
 * evidence than hand-built fixtures.
 *
 * It serves two API shapes so it can sit behind either harness:
 *   POST /v1/chat/completions  (OpenAI chat completions -- Pi)
 *   POST /v1/responses         (OpenAI Responses API    -- Codex)
 *
 * THE RESUME ORACLE
 * -----------------
 * The cleverest part. `[[SPIKE:recall]]` makes the provider scan the message
 * history it was handed for a `spike-*.txt` filename and answer with it, or
 * with the literal token NO_MEMORY if it cannot find one. Because the provider
 * is stateless, the ONLY way it can see that filename is if the harness
 * replayed the earlier conversation into the request. So "did resume work?"
 * stops being an assumption and becomes a string match on the reply. A harness
 * that silently starts a fresh session on a bad resume id is caught red-handed.
 *
 * Every request body is logged verbatim to the transcript file, which doubles
 * as a record of exactly what each harness sends -- itself a spike finding.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";

// =============================================================================
// Directives
// =============================================================================

/**
 * Behaviours the scenario script can request by embedding `[[SPIKE:<name>]]`
 * in the user prompt. Parsed from the LAST user message in the history.
 */
export type Directive =
  | "tool_file" // call a file-writing tool, then summarise its result
  | "recall" // answer from replayed history (the resume oracle)
  | "slow" // stream for a long time, so an interrupt has something to hit
  | "mcp" // call a tool whose name looks like an injected MCP tool
  | "plain"; // just answer, no tools

const FILENAME_RE = /spike-[A-Za-z0-9._-]*\.txt/;

function parseDirective(text: string): Directive {
  const m = /\[\[SPIKE:([a-z_]+)\]\]/.exec(text);
  const d = m?.[1];
  if (
    d === "tool_file" ||
    d === "recall" ||
    d === "slow" ||
    d === "mcp" ||
    d === "plain"
  ) {
    return d;
  }
  return "plain";
}

// =============================================================================
// Tool selection
// =============================================================================

/**
 * Pick a tool from whatever the harness advertised.
 *
 * Deliberately pattern-based rather than hard-coded: Pi and Codex expose
 * completely different tool vocabularies (and Codex may offer a single `shell`),
 * so the provider matches on intent. This is also why the provider works
 * unchanged across both harnesses.
 */
interface ToolSpec {
  name: string;
  /** JSON-schema-ish parameter object, if the harness supplied one. */
  params?: Record<string, unknown>;
  /** Set when the tool came from inside a namespace-typed entry (Codex MCP). */
  namespace?: string;
}

function pickTool(tools: ToolSpec[], want: "write" | "read" | "mcp"): ToolSpec | undefined {
  const byName = (re: RegExp) => tools.find((t) => re.test(t.name));
  if (want === "mcp") {
    // Prefer a tool that arrived from inside an mcp__ namespace (Codex), then
    // an mcp__-prefixed flat name (Pi), then a bare spike/ping name.
    return (
      tools.find((t) => /^mcp__/i.test(t.namespace ?? "")) ??
      byName(/^mcp__.+__/i) ??
      byName(/spike[_-]?(ping|echo)/i) ??
      byName(/ping/i)
    );
  }
  if (want === "write") {
    // Priority order matters. Tried in strict preference, because several
    // harnesses offer BOTH a simple whole-file write and a structured
    // edit/patch tool whose schema is much fussier (Pi's `edit` demands an
    // `edits` array and rejects {path,content}; Codex's apply_patch wants a
    // diff). Always prefer the simple one, then a shell, and only then an
    // edit-shaped tool.
    return (
      byName(/^(write|write_file|create_file|create)$/i) ??
      // Codex 0.169.0's real shell tool is `exec_command`, and it also offers
      // `write_stdin` -- which writes to a running process's stdin, NOT a file.
      // A naive /write/ match picks write_stdin and the turn silently does
      // nothing useful, so shells are matched before any write-ish regex and
      // write_stdin is excluded explicitly.
      byName(/^(exec_command|bash|shell|exec|run_command|local_shell|powershell)$/i) ??
      byName(/^write(?!_stdin)/i) ??
      byName(/^(?!write_stdin)(?=.*(bash|shell|exec)).*/i) ??
      byName(/^(edit|str_replace_editor|apply_patch)$/i)
    );
  }
  return (
    byName(/^(read|read_file|cat|view)$/i) ??
    byName(/read/i) ??
    byName(/^(bash|shell|exec|run_command|local_shell)$/i)
  );
}

/** Build arguments appropriate to whichever tool we matched. */
function argsFor(tool: ToolSpec, filename: string, body: string): Record<string, unknown> {
  const n = tool.name.toLowerCase();
  const isShell = /bash|shell|exec|run_command/.test(n);
  if (isShell) {
    const cmd = `printf '%s' ${JSON.stringify(body)} > ${filename} && cat ${filename}`;
    // Different harnesses name the shell parameter differently; supply the
    // common aliases and let the harness pick the one it validates against.
    return { command: cmd, cmd, script: cmd, shell: cmd };
  }
  const keys = Object.keys(
    (tool.params?.properties as Record<string, unknown> | undefined) ?? {},
  );
  const pathKey = keys.find((k) => /path|file|filename/i.test(k)) ?? "path";
  const textKey = keys.find((k) => /content|text|body|data/i.test(k)) ?? "content";
  return { [pathKey]: filename, [textKey]: body };
}

// =============================================================================
// Decision core (shared by both API shapes)
// =============================================================================

export interface Decision {
  kind: "text" | "tool";
  text?: string;
  tool?: { name: string; args: Record<string, unknown> };
  /** For "slow": how many deltas and how far apart. */
  slow?: { chunks: number; delayMs: number };
}

export interface HistoryView {
  /** Flattened text of every message, oldest first, for history scanning. */
  allText: string;
  /** Text of the most recent user message. */
  lastUserText: string;
  /** True if a tool result appears AFTER the last user message. */
  toolResultPending: boolean;
  tools: ToolSpec[];
}

export function decide(h: HistoryView): Decision {
  const directive = parseDirective(h.lastUserText);

  if (directive === "recall") {
    // THE ORACLE. Only answerable if the harness replayed prior history.
    const found = FILENAME_RE.exec(h.allText);
    return {
      kind: "text",
      text: found
        ? `RECALLED ${found[0]}`
        : "NO_MEMORY (no spike filename present in the context I was given)",
    };
  }

  if (directive === "slow") {
    return {
      kind: "text",
      text: "counting: ",
      slow: { chunks: 240, delayMs: 250 }, // ~60s of streaming
    };
  }

  // Tool-using directives: first pass asks for the tool, second pass (once the
  // tool result is in history) summarises. This stateless shape works for any
  // agent loop.
  if (directive === "tool_file" || directive === "mcp") {
    if (!h.toolResultPending) {
      const want = directive === "mcp" ? "mcp" : "write";
      const tool = pickTool(h.tools, want);
      if (!tool) {
        return {
          kind: "text",
          text: `NO_SUITABLE_TOOL for ${want}; harness advertised: ${
            h.tools.map((t) => t.name).join(", ") || "(none)"
          }`,
        };
      }
      if (directive === "mcp") {
        // Codex nests MCP tools in a namespace entry and REJECTS the bare
        // nested name ("unsupported call: spike_ping"), so the wire name has
        // to be a joined form. Which join is not documented anywhere we
        // found, hence the env-selectable probe.
        const fmt = process.env.SPIKE_MCP_NAME_FORMAT ?? "bare";
        const ns = tool.namespace;
        const name =
          !ns || fmt === "bare"
            ? tool.name
            : fmt === "dunder"
              ? `${ns}__${tool.name}`
              : fmt === "dot"
                ? `${ns}.${tool.name}`
                : fmt === "slash"
                  ? `${ns}/${tool.name}`
                  : tool.name;
        return { kind: "tool", tool: { name, args: { message: "spike" } } };
      }
      // Stable-ish filename so the recall oracle has something to find.
      const fn = `spike-${process.env.SPIKE_FILE_TAG ?? "alpha"}.txt`;
      return {
        kind: "tool",
        tool: { name: tool.name, args: argsFor(tool, fn, "hello-from-spike") },
      };
    }
    const found = FILENAME_RE.exec(h.allText);
    return {
      kind: "text",
      text: `DONE tool round-trip complete${found ? ` for ${found[0]}` : ""}`,
    };
  }

  return { kind: "text", text: "OK plain reply from the fake provider." };
}

// =============================================================================
// Request logging
// =============================================================================

function log(kind: string, payload: unknown): void {
  // Read lazily, NOT at module scope: ESM imports are evaluated before the
  // importing module's body, so a module-scope capture would always see the
  // value as unset when the runner assigns it after importing.
  const LOG = process.env.SPIKE_PROVIDER_LOG;
  if (!LOG) return;
  try {
    appendFileSync(
      LOG,
      `${JSON.stringify({ at: new Date().toISOString(), kind, payload })}\n`,
    );
  } catch {
    /* logging must never break the server */
  }
}

// =============================================================================
// Shape adapters: chat/completions
// =============================================================================

function historyFromChatCompletions(body: any): HistoryView {
  const msgs: any[] = Array.isArray(body?.messages) ? body.messages : [];
  const textOf = (m: any): string => {
    if (typeof m?.content === "string") return m.content;
    if (Array.isArray(m?.content)) {
      return m.content
        .map((c: any) => (typeof c === "string" ? c : (c?.text ?? c?.content ?? "")))
        .join(" ");
    }
    return "";
  };
  const lastUserIdx = msgs.map((m) => m?.role).lastIndexOf("user");
  const after = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : [];
  return {
    allText: msgs.map((m) => `${m?.role}: ${textOf(m)}`).join("\n"),
    lastUserText: lastUserIdx >= 0 ? textOf(msgs[lastUserIdx]) : "",
    toolResultPending: after.some((m) => m?.role === "tool" || m?.tool_call_id),
    tools: (Array.isArray(body?.tools) ? body.tools : []).map((t: any) => ({
      name: t?.function?.name ?? t?.name ?? "",
      params: t?.function?.parameters ?? t?.parameters,
    })),
  };
}

// =============================================================================
// Shape adapters: Responses API
// =============================================================================

function historyFromResponses(body: any): HistoryView {
  const input = Array.isArray(body?.input) ? body.input : [];
  const textOf = (item: any): string => {
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content
        .map((c: any) => c?.text ?? c?.output ?? (typeof c === "string" ? c : ""))
        .join(" ");
    }
    return item?.text ?? item?.output ?? "";
  };
  const isUser = (i: any) => i?.role === "user" || i?.type === "message";
  const userIdxs = input.map((i: any) => isUser(i) && i?.role === "user");
  const lastUserIdx = userIdxs.lastIndexOf(true);
  const after = lastUserIdx >= 0 ? input.slice(lastUserIdx + 1) : [];
  const instructions =
    typeof body?.instructions === "string" ? body.instructions : "";

  /**
   * History scanning MUST include function_call.arguments.
   *
   * This was a bug in the oracle, not in a harness, and it nearly produced a
   * false finding. In the Responses shape the filename the oracle looks for
   * lives in a `function_call` item's `arguments` JSON -- not in any
   * content/text/output field. Scanning only message content made Codex look
   * like it had replayed no history on resume, when the real cause was that
   * the oracle could not see the one field the filename was in. Pi's
   * chat/completions shape hid the same bug because its tool RESULT text
   * happens to contain the filename too.
   */
  const scanText = (i: any): string =>
    [
      textOf(i),
      typeof i?.arguments === "string" ? i.arguments : "",
      typeof i?.output === "string" ? i.output : "",
      i?.name ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  return {
    allText: [instructions, ...input.map((i: any) => `${i?.role ?? i?.type}: ${scanText(i)}`)].join(
      "\n",
    ),
    lastUserText: lastUserIdx >= 0 ? textOf(input[lastUserIdx]) : "",
    toolResultPending: after.some(
      (i: any) =>
        i?.type === "function_call_output" ||
        i?.type === "local_shell_call_output" ||
        i?.type === "custom_tool_call_output",
    ),
    tools: flattenResponsesTools(Array.isArray(body?.tools) ? body.tools : []),
  };
}

/**
 * Codex nests tools inside `type: "namespace"` entries -- an injected MCP
 * server arrives as `{type:"namespace", name:"mcp__spike", tools:[{name:
 * "spike_ping", ...}]}`, and the callable function is the NESTED one. Calling
 * the namespace itself does nothing useful.
 *
 * So a harness's advertised tool list is not necessarily flat. Found by
 * logging what Codex actually sent, after the MCP scenario quietly failed to
 * invoke anything.
 */
function flattenResponsesTools(tools: any[]): ToolSpec[] {
  const out: ToolSpec[] = [];
  for (const t of tools) {
    if (t?.type === "namespace" && Array.isArray(t.tools)) {
      for (const sub of t.tools) {
        out.push({
          name: sub?.name ?? "",
          params: sub?.parameters ?? sub?.function?.parameters,
          namespace: t?.name ?? undefined,
        });
      }
      continue;
    }
    out.push({
      name: t?.name ?? t?.function?.name ?? t?.type ?? "",
      params: t?.parameters ?? t?.function?.parameters,
    });
  }
  return out;
}

// =============================================================================
// Emitters
// =============================================================================

const USAGE = { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 };

function sse(res: ServerResponse): (event: unknown, name?: string) => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  return (event: unknown, name?: string) => {
    if (name) res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function emitChatCompletions(
  res: ServerResponse,
  model: string,
  d: Decision,
  stream: boolean,
): Promise<void> {
  const id = `chatcmpl-spike-${Date.now()}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1e3), model };

  if (!stream) {
    const message =
      d.kind === "tool"
        ? {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: `call_spike_${Date.now()}`,
                type: "function",
                function: { name: d.tool!.name, arguments: JSON.stringify(d.tool!.args) },
              },
            ],
          }
        : { role: "assistant", content: d.text ?? "" };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id,
        object: "chat.completion",
        created: base.created,
        model,
        choices: [
          { index: 0, message, finish_reason: d.kind === "tool" ? "tool_calls" : "stop" },
        ],
        usage: USAGE,
      }),
    );
    return;
  }

  const send = sse(res);
  send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

  if (d.kind === "tool") {
    send({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_spike_${Date.now()}`,
                type: "function",
                function: { name: d.tool!.name, arguments: JSON.stringify(d.tool!.args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: USAGE });
  } else {
    send({ ...base, choices: [{ index: 0, delta: { content: d.text ?? "" }, finish_reason: null }] });
    if (d.slow) {
      for (let i = 0; i < d.slow.chunks; i++) {
        if (res.writableEnded || res.destroyed) return; // client hung up (interrupt)
        send({ ...base, choices: [{ index: 0, delta: { content: `${i} ` }, finish_reason: null }] });
        await sleep(d.slow.delayMs);
      }
    }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: USAGE });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function emitResponses(
  res: ServerResponse,
  model: string,
  d: Decision,
  stream: boolean,
): Promise<void> {
  const id = `resp-spike-${Date.now()}`;
  const usage = { input_tokens: 42, output_tokens: 7, total_tokens: 49 };

  const outputItem =
    d.kind === "tool"
      ? {
          type: "function_call",
          id: `fc_spike_${Date.now()}`,
          call_id: `call_spike_${Date.now()}`,
          name: d.tool!.name,
          arguments: JSON.stringify(d.tool!.args),
          status: "completed",
        }
      : {
          type: "message",
          id: `msg_spike_${Date.now()}`,
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: d.text ?? "", annotations: [] }],
        };

  const finalResponse = {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1e3),
    status: "completed",
    model,
    output: [outputItem],
    usage,
  };

  if (!stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(finalResponse));
    return;
  }

  const send = sse(res);
  let seq = 0;
  const ev = (type: string, extra: Record<string, unknown>) =>
    send({ type, sequence_number: seq++, ...extra }, type);

  ev("response.created", { response: { ...finalResponse, status: "in_progress", output: [] } });
  ev("response.in_progress", { response: { ...finalResponse, status: "in_progress", output: [] } });
  ev("response.output_item.added", { output_index: 0, item: { ...outputItem, status: "in_progress" } });

  if (d.kind === "tool") {
    ev("response.function_call_arguments.delta", {
      output_index: 0,
      item_id: (outputItem as any).id,
      delta: JSON.stringify(d.tool!.args),
    });
    ev("response.function_call_arguments.done", {
      output_index: 0,
      item_id: (outputItem as any).id,
      arguments: JSON.stringify(d.tool!.args),
    });
  } else {
    ev("response.content_part.added", {
      output_index: 0,
      item_id: (outputItem as any).id,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    const emitDelta = (t: string) =>
      ev("response.output_text.delta", {
        output_index: 0,
        item_id: (outputItem as any).id,
        content_index: 0,
        delta: t,
      });
    emitDelta(d.text ?? "");
    if (d.slow) {
      for (let i = 0; i < d.slow.chunks; i++) {
        if (res.writableEnded || res.destroyed) return;
        emitDelta(`${i} `);
        await sleep(d.slow.delayMs);
      }
    }
    ev("response.output_text.done", {
      output_index: 0,
      item_id: (outputItem as any).id,
      content_index: 0,
      text: d.text ?? "",
    });
    ev("response.content_part.done", {
      output_index: 0,
      item_id: (outputItem as any).id,
      content_index: 0,
      part: { type: "output_text", text: d.text ?? "", annotations: [] },
    });
  }

  ev("response.output_item.done", { output_index: 0, item: outputItem });
  ev("response.completed", { response: finalResponse });
  res.end();
}

// =============================================================================
// Server
// =============================================================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });
}

export function startFakeProvider(port: number): Promise<{ url: string; close: () => void }> {
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && url.startsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "spike-fake-1", object: "model", owned_by: "spike" }],
        }),
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(404).end("not found");
      return;
    }

    const rawBody = await readBody(req);
    let body: any = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      /* leave empty */
    }
    const isResponses = url.includes("/responses");
    log(isResponses ? "responses_request" : "chat_request", body);

    const h = isResponses ? historyFromResponses(body) : historyFromChatCompletions(body);
    const d = decide(h);
    log("decision", { directive: parseDirective(h.lastUserText), decision: d, toolsSeen: h.tools.map((t) => t.name) });

    const model = body?.model ?? "spike-fake-1";
    const stream = body?.stream === true;
    try {
      if (isResponses) await emitResponses(res, model, d, stream);
      else await emitChatCompletions(res, model, d, stream);
    } catch (err) {
      log("emit_error", String(err));
      if (!res.headersSent) res.writeHead(500).end("spike provider error");
      else res.end();
    }
  });

  return new Promise((resolve) => {
    // Loopback only. Never expose a fake model endpoint to the LAN.
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => server.close(),
      });
    });
  });
}

// Run standalone: `tsx src/fake-provider.ts <port>`
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  const port = Number(process.argv[2] ?? 8099);
  startFakeProvider(port).then(({ url }) => {
    console.error(`[fake-provider] listening on ${url}`);
  });
}
