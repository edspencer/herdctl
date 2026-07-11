/**
 * Regression tests for edspencer/herdctl#327
 *
 * A refreshed OAuth token must reach REUSED persistent containers. Container
 * env is fixed at creation time, so for ephemeral:false agents (where
 * getOrCreateContainer returns a still-running container) the current
 * credentials have to be re-injected into every `docker exec`. These tests use
 * a mock Docker client (no daemon required) to prove that the SECOND execution
 * against a reused container carries the NEW CLAUDE_CODE_OAUTH_TOKEN.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgent } from "../../../config/index.js";
import { extractCredentialEnv } from "../container-manager.js";
import { ContainerRunner } from "../container-runner.js";
import { resolveDockerConfig } from "../docker-config.js";
import { SDKRuntime } from "../sdk-runtime.js";

// ---------------------------------------------------------------------------
// extractCredentialEnv (pure)
// ---------------------------------------------------------------------------

describe("extractCredentialEnv", () => {
  it("keeps only auth-credential keys and drops everything else", () => {
    const env = [
      "HOME=/home/claude",
      "TERM=xterm-256color",
      "CLAUDE_CODE_OAUTH_TOKEN=tok-abc",
      "CLAUDE_REFRESH_TOKEN=ref-abc",
      "CLAUDE_EXPIRES_AT=123456",
      "ANTHROPIC_API_KEY=sk-xyz",
      "GITHUB_TOKEN=ghp_should_not_leak",
    ];

    const creds = extractCredentialEnv(env);

    expect(creds).toContain("CLAUDE_CODE_OAUTH_TOKEN=tok-abc");
    expect(creds).toContain("CLAUDE_REFRESH_TOKEN=ref-abc");
    expect(creds).toContain("CLAUDE_EXPIRES_AT=123456");
    expect(creds).toContain("ANTHROPIC_API_KEY=sk-xyz");
    // Non-credential vars must not be forwarded to per-exec env.
    expect(creds).not.toContain("HOME=/home/claude");
    expect(creds).not.toContain("TERM=xterm-256color");
    expect(creds.some((e) => e.startsWith("GITHUB_TOKEN="))).toBe(false);
  });

  it("returns an empty array when no credential keys are present", () => {
    expect(extractCredentialEnv(["HOME=/x", "TERM=y"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ContainerRunner: refreshed token reaches a reused persistent container
// ---------------------------------------------------------------------------

/** Captured `container.exec()` options per exec call. */
interface MockDocker {
  docker: unknown;
  execCalls: Array<{ Env?: string[]; Cmd?: string[] }>;
  createContainerCalls: () => number;
}

function makeMockDocker(): MockDocker {
  const execCalls: Array<{ Env?: string[]; Cmd?: string[] }> = [];
  let createContainerCallCount = 0;

  const container = {
    // Used both by getOrCreateContainer (State.Running) and execute (Id).
    inspect: vi.fn().mockResolvedValue({ Id: "cid-persistent", State: { Running: true } }),
    start: vi.fn().mockResolvedValue(undefined),
    exec: vi.fn(async (opts: { Env?: string[]; Cmd?: string[] }) => {
      execCalls.push(opts);
      return {
        // Reject start() so the generator terminates deterministically right
        // after the exec options (incl. Env) have been captured — avoids the
        // real JSONL/demux stream plumbing which needs a live socket.
        start: vi.fn().mockRejectedValue(new Error("test-terminate-after-capture")),
        inspect: vi.fn().mockResolvedValue({ ExitCode: 0 }),
      };
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const docker = {
    createContainer: vi.fn(async () => {
      createContainerCallCount++;
      return container;
    }),
    listContainers: vi.fn().mockResolvedValue([]),
    getContainer: vi.fn(),
  };

  return {
    docker,
    execCalls,
    createContainerCalls: () => createContainerCallCount,
  };
}

async function drain(gen: AsyncIterable<unknown>): Promise<void> {
  // The mock forces exec.start() to reject, so execute() yields a single
  // "Docker execution failed" error message and then completes.
  for await (const _msg of gen) {
    // discard
  }
}

function writeCredentials(homeDir: string, accessToken: string): void {
  const claudeDir = path.join(homeDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken,
        refreshToken: "refresh-token-static",
        // Well beyond the 5-minute refresh buffer, so buildContainerEnv reads
        // the file verbatim and makes no network refresh call.
        expiresAt: Date.now() + 60 * 60 * 1000,
      },
    }),
  );
}

describe("ContainerRunner OAuth injection into reused persistent container (#327)", () => {
  let tmpRoot: string;
  let homeDir: string;
  let stateDir: string;
  let workspaceDir: string;
  let originalHome: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "herdctl-327-"));
    homeDir = path.join(tmpRoot, "home");
    stateDir = path.join(tmpRoot, "state");
    workspaceDir = path.join(tmpRoot, "workspace");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    // buildContainerEnv reads ~/.claude/.credentials.json via os.homedir(),
    // which honors $HOME on POSIX.
    originalHome = process.env.HOME;
    process.env.HOME = homeDir;

    // Keep the credential env deterministic (no ambient API key).
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("SDK exec carries the NEW token after a host-side refresh, with the container reused", async () => {
    const mock = makeMockDocker();
    const config = resolveDockerConfig({ enabled: true, ephemeral: false });
    const agent = {
      name: "persistent-agent",
      configPath: "/path/to/agent.yaml",
      working_directory: workspaceDir,
    } as ResolvedAgent;

    const runner = new ContainerRunner(
      new SDKRuntime(),
      config,
      stateDir,
      mock.docker as import("dockerode"),
    );

    // ---- First execution: token1, container is created ---------------------
    writeCredentials(homeDir, "token-ONE");
    await drain(runner.execute({ prompt: "hi", agent }));

    expect(mock.createContainerCalls()).toBe(1);
    expect(mock.execCalls).toHaveLength(1);
    expect(mock.execCalls[0].Env).toContain("CLAUDE_CODE_OAUTH_TOKEN=token-ONE");

    // ---- Host refreshes the token on disk (new access token) ---------------
    writeCredentials(homeDir, "token-TWO");

    // ---- Second execution: same persistent container is reused -------------
    await drain(runner.execute({ prompt: "hi again", agent }));

    // Container was NOT recreated — the persistent one was reused...
    expect(mock.createContainerCalls()).toBe(1);
    expect(mock.execCalls).toHaveLength(2);

    // ...yet the reused container's exec receives the NEW token (the bug fix).
    const secondEnv = mock.execCalls[1].Env ?? [];
    expect(secondEnv).toContain("CLAUDE_CODE_OAUTH_TOKEN=token-TWO");
    expect(secondEnv).not.toContain("CLAUDE_CODE_OAUTH_TOKEN=token-ONE");

    // The injected exec env is credential-only (no HOME/TERM leakage).
    expect(secondEnv.some((e) => e.startsWith("HOME="))).toBe(false);
    expect(secondEnv.some((e) => e.startsWith("TERM="))).toBe(false);
  });
});
