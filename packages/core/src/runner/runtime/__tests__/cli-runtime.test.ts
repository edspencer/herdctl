import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../types.js";

const watchMessages: SDKMessage[] = [];
const flushMessages: SDKMessage[] = [];

vi.mock("../cli-session-path.js", () => ({
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
    expect(vi.mocked(getCliSessionDir)).toHaveBeenCalledWith(effectiveDir);
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
