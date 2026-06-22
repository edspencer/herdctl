import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../types.js";

const watchMessages: SDKMessage[] = [];
const flushMessages: SDKMessage[] = [];

vi.mock("../cli-session-path.js", () => ({
  getCliSessionDir: vi.fn(() => "/tmp/sessions"),
  getCliSessionFile: vi.fn(() => "/tmp/sessions/session-1.jsonl"),
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
import { getCliSessionDir } from "../cli-session-path.js";

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
