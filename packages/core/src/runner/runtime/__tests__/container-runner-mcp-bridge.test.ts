/**
 * The Docker SDK path's MCP HTTP bridge must require the per-bridge bearer
 * token. This path binds all interfaces (the agent container is in another
 * network namespace), so the token is the only thing keeping other hosts and
 * containers from calling the injected tools.
 *
 * Uses a mock Docker client (no daemon required). The mock `exec` reads the SDK
 * options herdctl hands the container, then calls the live bridge the way the
 * agent would (with the configured headers) and the way an attacker would
 * (without them), before letting the turn end.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgent } from "../../../config/index.js";
import type { InjectedMcpServerDef } from "../../types.js";
import { ContainerRunner } from "../container-runner.js";
import { resolveDockerConfig } from "../docker-config.js";
import { SDKRuntime } from "../sdk-runtime.js";

interface BridgeEntry {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

interface Observed {
  entry?: BridgeEntry;
  statusNoToken?: number;
  statusWithToken?: number;
  toolCalls: number;
}

function lanIPv4(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

/** Pull the JSON out of `export HERDCTL_SDK_OPTIONS='…' && node …`. */
function parseSdkOptions(cmd: string[]): {
  sdkOptions: { mcpServers: Record<string, BridgeEntry> };
} {
  const script = cmd[cmd.length - 1];
  const start = script.indexOf("HERDCTL_SDK_OPTIONS='") + "HERDCTL_SDK_OPTIONS='".length;
  const end = script.lastIndexOf("' && node");
  return JSON.parse(script.slice(start, end).replace(/'\\''/g, "'"));
}

async function callTool(host: string, port: string, headers: Record<string, string>) {
  const res = await fetch(`http://${host}:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "write_fact", arguments: { fact: "x" } },
    }),
  });
  await res.text();
  return res.status;
}

function makeMockDocker(observed: Observed, probeHost: string) {
  const container = {
    inspect: vi.fn().mockResolvedValue({ Id: "cid-mcp", State: { Running: true } }),
    start: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn(async (opts: { Cmd: string[] }) => {
      const entry = parseSdkOptions(opts.Cmd).sdkOptions.mcpServers.probe;
      observed.entry = entry;
      const port = new URL(entry.url).port;
      observed.statusNoToken = await callTool(probeHost, port, {});
      observed.statusWithToken = await callTool(probeHost, port, entry.headers ?? {});
      return {
        // End the turn right after the probe; the real stream needs a daemon.
        start: vi.fn().mockRejectedValue(new Error("test-terminate-after-capture")),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return {
    createContainer: vi.fn(async () => container),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn(),
  };
}

describe("ContainerRunner SDK path: MCP HTTP bridge authentication", () => {
  let tmpRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "herdctl-bridge-"));
    fs.mkdirSync(path.join(tmpRoot, "home"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "state"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "workspace"), { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tmpRoot, "home");
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function runTurn(probeHost: string): Promise<Observed> {
    const observed: Observed = { toolCalls: 0 };
    const def: InjectedMcpServerDef = {
      name: "probe",
      tools: [
        {
          name: "write_fact",
          description: "records a fact",
          inputSchema: { type: "object" },
          handler: async () => {
            observed.toolCalls++;
            return { content: [{ type: "text" as const, text: "ok" }] };
          },
        },
      ],
    };
    const runner = new ContainerRunner(
      new SDKRuntime(),
      resolveDockerConfig({ enabled: true, ephemeral: false }),
      path.join(tmpRoot, "state"),
      makeMockDocker(observed, probeHost) as unknown as import("dockerode"),
    );
    const agent = {
      name: "docker-agent",
      configPath: "/path/to/agent.yaml",
      working_directory: path.join(tmpRoot, "workspace"),
    } as ResolvedAgent;

    for await (const _msg of runner.execute({
      prompt: "hi",
      agent,
      injectedMcpServers: { probe: def },
    })) {
      // discard
    }
    return observed;
  }

  it("hands the container a bearer header alongside the bridge URL", async () => {
    const o = await runTurn("127.0.0.1");

    expect(o.entry?.url).toMatch(/^http:\/\/herdctl:\d+\/mcp$/);
    expect(o.entry?.headers?.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
  });

  it("rejects calls without the token and accepts calls with it", async () => {
    const o = await runTurn("127.0.0.1");

    expect(o.statusNoToken).toBe(401);
    expect(o.statusWithToken).toBe(200);
    expect(o.toolCalls).toBe(1);
  });

  it.skipIf(!lanIPv4())(
    "stays reachable from another network namespace, but only with the token",
    async () => {
      const o = await runTurn(lanIPv4() as string);

      expect(o.statusNoToken).toBe(401);
      expect(o.statusWithToken).toBe(200);
    },
  );
});
