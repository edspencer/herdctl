import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InjectedMcpServerDef, SDKMessage } from "../../types.js";

const watchMessages: SDKMessage[] = [];
const flushMessages: SDKMessage[] = [];

vi.mock("../cli-session-path.js", () => ({
  // The runtime resolves its Claude home at construction time; these tests stub
  // the path helpers wholesale, so the home fallback must be stubbed too. The
  // real threading is covered (unmocked) in
  // claude-home-threading-cli-runtime.test.ts.
  defaultClaudeHome: vi.fn(() => "/tmp/default-claude-home"),
  getCliSessionDir: vi.fn(() => "/tmp/sessions"),
  getCliSessionFile: vi.fn(() => "/tmp/sessions/session-1.jsonl"),
  snapshotSessionFiles: vi.fn(async () => new Set<string>()),
  waitForNewSessionFile: vi.fn(async () => "/tmp/sessions/session-1.jsonl"),
}));

vi.mock("../cli-session-watcher.js", () => ({
  CLISessionWatcher: class {
    constructor(_path: string) {}

    async initialize(): Promise<void> {}

    async *watch(): AsyncIterable<SDKMessage> {
      for (const message of watchMessages) {
        yield message;
      }
    }

    async flushRemainingMessages(): Promise<SDKMessage[]> {
      return [...flushMessages];
    }

    stop(): void {}
  },
}));

import { CLIRuntime } from "../cli-runtime.js";
import {
  getCliSessionDir,
  getCliSessionFile,
  snapshotSessionFiles,
  waitForNewSessionFile,
} from "../cli-session-path.js";

function makeSubprocess(exitCode = 0): Promise<{ exitCode: number }> & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
} {
  const promise = Promise.resolve({ exitCode }) as Promise<{ exitCode: number }> & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  promise.pid = 1234;
  promise.stdout = new EventEmitter();
  promise.stderr = new EventEmitter();
  promise.kill = vi.fn();
  return promise;
}

describe("CLIRuntime synthetic result aggregation", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
  });

  it("deduplicates assistant snapshots when aggregating turns and usage", async () => {
    watchMessages.push(
      {
        type: "assistant",
        message: {
          id: "msg-1",
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 25 },
          content: [{ type: "text", text: "partial" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-1",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 25 },
          content: [{ type: "text", text: "final one" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-2",
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: "final two" }],
        },
      } as SDKMessage,
    );

    const runtime = new CLIRuntime({
      processSpawner: (() => makeSubprocess() as never) as never,
    });

    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "Hello",
      agent: { name: "test-agent", configPath: "/tmp/agent.yaml" } as never,
    })) {
      messages.push(message);
    }

    const result = messages.find((m) => m.type === "result") as
      | (SDKMessage & {
          type: "result";
          num_turns?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        })
      | undefined;
    expect(result).toBeDefined();
    expect(result?.num_turns).toBe(2);
    expect(result?.usage?.input_tokens).toBe(110);
    expect(result?.usage?.output_tokens).toBe(30);
  });

  it("aggregates per-model token usage (incl. cache classes) across models", async () => {
    watchMessages.push(
      {
        type: "assistant",
        message: {
          id: "msg-1",
          model: "claude-opus-4-8",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 100,
            output_tokens: 25,
            cache_creation_input_tokens: 40,
            cache_read_input_tokens: 900,
          },
          content: [{ type: "text", text: "opus turn one" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-2",
          model: "claude-opus-4-8",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 50,
            output_tokens: 15,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 100,
          },
          content: [{ type: "text", text: "opus turn two" }],
        },
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "msg-3",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          usage: {
            input_tokens: 20,
            output_tokens: 8,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          content: [{ type: "text", text: "haiku subagent" }],
        },
      } as SDKMessage,
    );

    const runtime = new CLIRuntime({
      processSpawner: (() => makeSubprocess() as never) as never,
    });

    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "Hello",
      agent: { name: "test-agent", configPath: "/tmp/agent.yaml" } as never,
    })) {
      messages.push(message);
    }

    const result = messages.find((m) => m.type === "result") as
      | (SDKMessage & {
          type: "result";
          modelUsage?: Record<
            string,
            {
              inputTokens: number;
              outputTokens: number;
              cacheCreationInputTokens: number;
              cacheReadInputTokens: number;
            }
          >;
        })
      | undefined;

    expect(result?.modelUsage).toBeDefined();
    // Opus turns are summed across both messages; Haiku is its own bucket.
    expect(result?.modelUsage?.["claude-opus-4-8"]).toEqual({
      inputTokens: 150,
      outputTokens: 40,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 1000,
    });
    expect(result?.modelUsage?.["claude-haiku-4-5"]).toEqual({
      inputTokens: 20,
      outputTokens: 8,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("buckets usage under 'unknown' when an assistant message has no model", async () => {
    watchMessages.push({
      type: "assistant",
      message: {
        id: "msg-1",
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 4 },
        content: [{ type: "text", text: "no model field" }],
      },
    } as SDKMessage);

    const runtime = new CLIRuntime({
      processSpawner: (() => makeSubprocess() as never) as never,
    });

    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "Hello",
      agent: { name: "test-agent", configPath: "/tmp/agent.yaml" } as never,
    })) {
      messages.push(message);
    }

    const result = messages.find((m) => m.type === "result") as
      | (SDKMessage & { type: "result"; modelUsage?: Record<string, { inputTokens: number }> })
      | undefined;
    expect(result?.modelUsage?.unknown?.inputTokens).toBe(12);
  });
});

describe("CLIRuntime working directory / session resolution", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
    vi.mocked(getCliSessionDir).mockClear();
  });

  it("spawns in the agent's working_directory and resolves the session dir from it", async () => {
    // FleetManager.trigger applies a per-trigger override by swapping the
    // resolved agent's working_directory, so the CLI runtime sees the effective
    // directory here. We assert both the spawn cwd and the session-dir lookup
    // use it — proving session/transcript resolution follows the effective cwd.
    let spawnedCwd: string | undefined;

    const runtime = new CLIRuntime({
      processSpawner: ((_args: string[], cwd: string) => {
        spawnedCwd = cwd;
        return makeSubprocess() as never;
      }) as never,
    });

    const effectiveDir = "/override/project-x";
    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "Hello",
      agent: {
        name: "sweeper",
        configPath: "/tmp/agent.yaml",
        working_directory: effectiveDir,
      } as never,
    })) {
      messages.push(message);
    }

    expect(spawnedCwd).toBe(effectiveDir);
    // Second argument is the resolved Claude home (herdctl#423) — defaulted here
    // since this runtime was constructed without one.
    expect(vi.mocked(getCliSessionDir)).toHaveBeenCalledWith(
      effectiveDir,
      "/tmp/default-claude-home",
    );
  });
});

describe("CLIRuntime --mcp-config serialization (issue #182)", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
  });

  /**
   * Runs the CLI runtime with the given agent config and returns the value of
   * the `--mcp-config` argument that was passed to the spawned `claude` process
   * (or undefined if the flag was not emitted).
   */
  async function captureMcpConfigArg(agent: Record<string, unknown>): Promise<string | undefined> {
    let spawnedArgs: string[] = [];

    const runtime = new CLIRuntime({
      processSpawner: ((args: string[]) => {
        spawnedArgs = args;
        return makeSubprocess() as never;
      }) as never,
    });

    for await (const _message of runtime.execute({
      prompt: "Hello",
      agent: { name: "mcp-agent", configPath: "/tmp/agent.yaml", ...agent } as never,
    })) {
      // drain
    }

    const idx = spawnedArgs.indexOf("--mcp-config");
    return idx === -1 ? undefined : spawnedArgs[idx + 1];
  }

  it("wraps mcp_servers in a top-level `mcpServers` key (not flat)", async () => {
    // The Claude CLI validates --mcp-config against a schema that requires a
    // top-level `mcpServers` record (same shape as .mcp.json). The pre-#182
    // flat form `{"coolify":{...}}` fails validation with
    // "mcpServers: Invalid input: expected record, received undefined" and the
    // headless process hangs until the job times out.
    const mcpConfigArg = await captureMcpConfigArg({
      mcp_servers: {
        coolify: { command: "npx", args: ["-y", "@masonator/coolify-mcp"] },
      },
    });

    expect(mcpConfigArg).toBeDefined();
    const parsed = JSON.parse(mcpConfigArg as string);

    // The wrapping key is the whole point of the fix.
    expect(parsed).toHaveProperty("mcpServers");
    expect(parsed).toEqual({
      mcpServers: {
        coolify: { command: "npx", args: ["-y", "@masonator/coolify-mcp"] },
      },
    });

    // Guard against regression to the flat shape, where the server name would
    // sit at the top level instead of under `mcpServers`.
    expect(parsed).not.toHaveProperty("coolify");
  });

  it("serializes multiple stdio + http servers under `mcpServers` with env passthrough", async () => {
    const mcpConfigArg = await captureMcpConfigArg({
      mcp_servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "tok-123" },
        },
        posthog: { url: "https://mcp.example.com" },
      },
    });

    expect(mcpConfigArg).toBeDefined();
    expect(JSON.parse(mcpConfigArg as string)).toEqual({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "tok-123" },
        },
        posthog: { type: "http", url: "https://mcp.example.com" },
      },
    });
  });

  it("omits --mcp-config entirely when no mcp_servers are configured", async () => {
    expect(await captureMcpConfigArg({})).toBeUndefined();
    expect(await captureMcpConfigArg({ mcp_servers: {} })).toBeUndefined();
  });

  // edspencer/herdctl#445 — headers and an explicit `sse` transport must reach
  // the CLI's --mcp-config too, not just the SDK runtime.
  it("carries headers and type: sse into --mcp-config", async () => {
    const mcpConfigArg = await captureMcpConfigArg({
      mcp_servers: {
        linear: {
          type: "sse",
          url: "https://mcp.linear.app/sse",
          headers: { Authorization: "Bearer sk-test-123" },
        },
      },
    });

    expect(JSON.parse(mcpConfigArg as string)).toEqual({
      mcpServers: {
        linear: {
          type: "sse",
          url: "https://mcp.linear.app/sse",
          headers: { Authorization: "Bearer sk-test-123" },
        },
      },
    });
  });
});

// =============================================================================
// Plugins (#444)
// =============================================================================

describe("CLIRuntime plugins (--plugin-dir)", () => {
  /** Runs the CLI runtime and returns the full argv handed to `claude`. */
  async function captureArgs(agent: Record<string, unknown>): Promise<string[]> {
    let spawnedArgs: string[] = [];

    const runtime = new CLIRuntime({
      processSpawner: ((args: string[]) => {
        spawnedArgs = args;
        return makeSubprocess() as never;
      }) as never,
    });

    for await (const _message of runtime.execute({
      prompt: "Hello",
      agent: { name: "plugin-agent", configPath: "/tmp/agent.yaml", ...agent } as never,
    })) {
      // drain
    }

    return spawnedArgs;
  }

  it("emits one --plugin-dir per plugin, in order", async () => {
    const args = await captureArgs({
      plugins: [
        { type: "local", path: "/opt/plugins/slack" },
        { type: "local", path: "/opt/plugins/jira" },
      ],
    });

    expect(args.filter((a) => a === "--plugin-dir")).toHaveLength(2);
    expect(args[args.indexOf("--plugin-dir") + 1]).toBe("/opt/plugins/slack");
    expect(args).toContain("/opt/plugins/jira");
  });

  it("uses --plugin-dir-no-mcp when skipMcpDiscovery is set", async () => {
    const args = await captureArgs({
      plugins: [{ type: "local", path: "/opt/plugins/slack", skipMcpDiscovery: true }],
    });

    expect(args[args.indexOf("--plugin-dir-no-mcp") + 1]).toBe("/opt/plugins/slack");
    expect(args).not.toContain("--plugin-dir");
  });

  it("emits no plugin flag when the agent lists none", async () => {
    const args = await captureArgs({});
    expect(args).not.toContain("--plugin-dir");
    expect(args).not.toContain("--plugin-dir-no-mcp");
  });
});

describe("CLIRuntime flag settings (--settings)", () => {
  async function captureArgs(agent: Record<string, unknown>): Promise<string[]> {
    let spawnedArgs: string[] = [];

    const runtime = new CLIRuntime({
      processSpawner: ((args: string[]) => {
        spawnedArgs = args;
        return makeSubprocess() as never;
      }) as never,
    });

    for await (const _message of runtime.execute({
      prompt: "Hello",
      agent: { name: "settings-agent", configPath: "/tmp/agent.yaml", ...agent } as never,
    })) {
      // drain
    }

    return spawnedArgs;
  }

  it("serialises the agent's settings into one --settings argument", async () => {
    const args = await captureArgs({
      settings: { autoMemoryDirectory: "/data/memory", effortLevel: "high" },
    });

    expect(args.filter((a) => a === "--settings")).toHaveLength(1);
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({
      autoMemoryDirectory: "/data/memory",
      effortLevel: "high",
    });
  });

  it("emits no --settings when the agent sets none, or an empty object", async () => {
    expect(await captureArgs({})).not.toContain("--settings");
    expect(await captureArgs({ settings: {} })).not.toContain("--settings");
  });
});

describe("CLIRuntime session fork (--fork-session)", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
    vi.mocked(getCliSessionFile).mockClear();
    vi.mocked(waitForNewSessionFile).mockClear();
    vi.mocked(snapshotSessionFiles).mockClear();
    vi.mocked(snapshotSessionFiles).mockResolvedValue(new Set(["pre-existing.jsonl"]));
    // Distinct paths so we can tell which resolver drove the watched file: a
    // plain resume watches the source file in place; a fork must wait for a new
    // one (Claude Code writes a new session file for `--fork-session`).
    vi.mocked(getCliSessionFile).mockReturnValue("/tmp/sessions/source.jsonl");
    vi.mocked(waitForNewSessionFile).mockResolvedValue("/tmp/sessions/forked-child.jsonl");
  });

  async function run(opts: { resume?: string; fork?: boolean }): Promise<{
    spawnedArgs: string[];
    messages: SDKMessage[];
  }> {
    let spawnedArgs: string[] = [];
    const runtime = new CLIRuntime({
      processSpawner: ((args: string[]) => {
        spawnedArgs = args;
        return makeSubprocess() as never;
      }) as never,
    });
    const messages: SDKMessage[] = [];
    for await (const message of runtime.execute({
      prompt: "branch off here",
      agent: { name: "keeper", configPath: "/tmp/agent.yaml" } as never,
      ...opts,
    })) {
      messages.push(message);
    }
    return { spawnedArgs, messages };
  }

  const initId = (messages: SDKMessage[]): string | undefined =>
    (
      messages.find((m) => m.type === "system") as
        | (SDKMessage & { session_id?: string })
        | undefined
    )?.session_id;

  it("passes --resume <source> and --fork-session to the CLI", async () => {
    const { spawnedArgs } = await run({ resume: "source", fork: true });
    const rIdx = spawnedArgs.indexOf("--resume");
    expect(rIdx).toBeGreaterThan(-1);
    expect(spawnedArgs[rIdx + 1]).toBe("source");
    expect(spawnedArgs).toContain("--fork-session");
  });

  it("watches the NEW forked file and reports its id, not the source's", async () => {
    const { messages } = await run({ resume: "source", fork: true });
    // A fork must resolve via waitForNewSessionFile (the new file), never the
    // resumed source path — otherwise it would report the parent's id and miss
    // the child's turns entirely.
    expect(vi.mocked(waitForNewSessionFile)).toHaveBeenCalled();
    expect(vi.mocked(getCliSessionFile)).not.toHaveBeenCalled();
    expect(initId(messages)).toBe("forked-child");
  });

  it("a plain resume (no fork) still watches the source file in place", async () => {
    const { messages } = await run({ resume: "source" });
    expect(vi.mocked(getCliSessionFile)).toHaveBeenCalled();
    expect(vi.mocked(waitForNewSessionFile)).not.toHaveBeenCalled();
    expect(initId(messages)).toBe("source");
  });

  it("snapshots the session dir pre-spawn and forwards it as knownFiles (issue #357)", async () => {
    await run({ resume: "source", fork: true });
    // The snapshot must be taken (before spawn) and threaded into the resolver
    // so the new file is found by set difference, not mtime.
    expect(vi.mocked(snapshotSessionFiles)).toHaveBeenCalled();
    expect(vi.mocked(waitForNewSessionFile)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ knownFiles: new Set(["pre-existing.jsonl"]) }),
    );
  });

  it("does NOT snapshot on a plain resume (no new file is expected)", async () => {
    await run({ resume: "source" });
    expect(vi.mocked(snapshotSessionFiles)).not.toHaveBeenCalled();
  });
});

describe("CLIRuntime injected MCP servers (HTTP bridge)", () => {
  beforeEach(() => {
    watchMessages.length = 0;
    flushMessages.length = 0;
  });

  interface ConfiguredServer {
    type: string;
    url: string;
    headers?: Record<string, string>;
  }

  interface Observed {
    args: string[];
    configArg: string;
    config: { mcpServers: Record<string, ConfiguredServer & Record<string, unknown>> };
    fileMode?: number;
    dirMode?: number;
    unauthenticatedStatus?: number;
    authenticatedToolText?: string;
    lanError?: boolean;
  }

  function injectedDef(onCall?: (args: Record<string, unknown>) => void): InjectedMcpServerDef {
    return {
      name: "probe",
      tools: [
        {
          name: "write_fact",
          description: "records a fact",
          inputSchema: { type: "object", properties: { fact: { type: "string" } } },
          handler: async (args) => {
            onCall?.(args);
            return { content: [{ type: "text" as const, text: `stored ${String(args.fact)}` }] };
          },
        },
      ],
    };
  }

  function nonLoopbackIPv4(): string | undefined {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
      }
    }
    return undefined;
  }

  async function postToolsCall(url: string, headers: Record<string, string>): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "write_fact", arguments: { fact: "from-test" } },
      }),
    });
  }

  /**
   * Run one turn. The fake `claude` reads the MCP config it was given and,
   * while the turn is live, calls the bridge the way the real CLI would (with
   * the configured headers) and the way an attacker would (without them).
   */
  async function runTurn(
    runtimeOptions: ConstructorParameters<typeof CLIRuntime>[0],
    agent: Record<string, unknown> = {},
    injected: Record<string, InjectedMcpServerDef> = { probe: injectedDef() },
  ): Promise<Observed> {
    let observed: Observed | undefined;

    const runtime = new CLIRuntime({
      ...runtimeOptions,
      processSpawner: ((args: string[]) => {
        const configArg = args[args.indexOf("--mcp-config") + 1];
        const isFile = !configArg.trimStart().startsWith("{");
        observed = {
          args: [...args],
          configArg,
          config: JSON.parse(isFile ? readFileSync(configArg, "utf8") : configArg),
          fileMode: isFile ? statSync(configArg).mode & 0o777 : undefined,
          dirMode: isFile ? statSync(dirname(configArg)).mode & 0o777 : undefined,
        };
        const probe = observed.config.mcpServers.probe;
        const lanIp = nonLoopbackIPv4();

        const done = (async () => {
          if (probe) {
            const unauth = await postToolsCall(probe.url, {});
            observed!.unauthenticatedStatus = unauth.status;
            const auth = await postToolsCall(probe.url, probe.headers ?? {});
            const body = (await auth.json()) as { result: { content: { text: string }[] } };
            observed!.authenticatedToolText = body.result.content[0].text;
            if (lanIp) {
              const port = new URL(probe.url).port;
              observed!.lanError = await postToolsCall(
                `http://${lanIp}:${port}/mcp`,
                probe.headers ?? {},
              ).then(
                () => false,
                () => true,
              );
            }
          }
          return { exitCode: 0 };
        })();

        return Object.assign(done, {
          pid: 4321,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          kill: vi.fn(),
        }) as never;
      }) as never,
    });

    for await (const _message of runtime.execute({
      prompt: "Hello",
      agent: { name: "mcp-agent", configPath: "/tmp/agent.yaml", ...agent } as never,
      injectedMcpServers: injected,
    })) {
      // drain
    }

    if (!observed) throw new Error("claude was never spawned");
    return observed;
  }

  it("gives claude a loopback URL plus a bearer header, and the bridge enforces it", async () => {
    const o = await runTurn({ mcpConfigTransport: "file" });
    const probe = o.config.mcpServers.probe;

    expect(probe.type).toBe("http");
    expect(probe.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(probe.headers?.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);

    expect(o.unauthenticatedStatus).toBe(401);
    expect(o.authenticatedToolText).toBe("stored from-test");
  });

  it.skipIf(!nonLoopbackIPv4())("does not expose the bridge on the LAN interface", async () => {
    const o = await runTurn({ mcpConfigTransport: "file" });

    expect(o.lanError).toBe(true);
  });

  it("passes the config as an owner-only file and keeps the token out of argv", async () => {
    const o = await runTurn({ mcpConfigTransport: "file" });
    const token = o.config.mcpServers.probe.headers?.Authorization.slice("Bearer ".length);

    expect(o.configArg.endsWith("mcp-config.json")).toBe(true);
    expect(o.fileMode).toBe(0o600);
    expect(o.dirMode).toBe(0o700);
    expect(token).toBeTruthy();
    expect(o.args.some((a) => a.includes(token as string))).toBe(false);
  });

  it("removes the config file and closes the bridge when the turn ends", async () => {
    const o = await runTurn({ mcpConfigTransport: "file" });

    expect(o.fileMode).toBe(0o600); // it existed while claude ran
    expect(existsSync(o.configArg)).toBe(false);
    expect(existsSync(dirname(o.configArg))).toBe(false);
    await expect(postToolsCall(o.config.mcpServers.probe.url, {})).rejects.toThrow();
  });

  it("merges declared servers into the same config (and keeps their secrets out of argv)", async () => {
    const o = await runTurn(
      { mcpConfigTransport: "file" },
      {
        mcp_servers: {
          github: { command: "npx", args: ["-y", "gh-mcp"], env: { GITHUB_TOKEN: "tok-secret" } },
        },
      },
    );

    expect(Object.keys(o.config.mcpServers).sort()).toEqual(["github", "probe"]);
    expect(o.config.mcpServers.github).toMatchObject({ env: { GITHUB_TOKEN: "tok-secret" } });
    expect(o.args.filter((a) => a === "--mcp-config")).toHaveLength(1);
    expect(o.args.some((a) => a.includes("tok-secret"))).toBe(false);
  });

  it("gives every injected server its own bridge and token", async () => {
    const o = await runTurn(
      { mcpConfigTransport: "file" },
      {},
      {
        probe: injectedDef(),
        other: { ...injectedDef(), name: "other" },
      },
    );
    const { probe, other } = o.config.mcpServers;

    expect(probe.url).not.toBe(other.url);
    expect(probe.headers?.Authorization).not.toBe(other.headers?.Authorization);
  });

  it("inlines the config (headers included) when mcpConfigTransport is inline", async () => {
    const o = await runTurn({ mcpConfigTransport: "inline" });

    expect(o.configArg.trimStart().startsWith("{")).toBe(true);
    expect(o.config.mcpServers.probe.headers?.Authorization).toMatch(/^Bearer /);
    expect(o.unauthenticatedStatus).toBe(401);
    expect(o.authenticatedToolText).toBe("stored from-test");
  });

  it("defaults to inline for a caller-supplied spawner, which may not share the host filesystem", async () => {
    const o = await runTurn({});

    expect(o.configArg.trimStart().startsWith("{")).toBe(true);
  });

  it("removes the config file even when spawning claude throws", async () => {
    let configPath = "";
    const runtime = new CLIRuntime({
      mcpConfigTransport: "file",
      processSpawner: ((args: string[]) => {
        configPath = args[args.indexOf("--mcp-config") + 1];
        throw new Error("spawn failed");
      }) as never,
    });

    for await (const _message of runtime.execute({
      prompt: "Hello",
      agent: { name: "mcp-agent", configPath: "/tmp/agent.yaml" } as never,
      injectedMcpServers: { probe: injectedDef() },
    })) {
      // drain
    }

    expect(configPath.endsWith("mcp-config.json")).toBe(true);
    expect(existsSync(dirname(configPath))).toBe(false);
  });
});
