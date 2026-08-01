/**
 * Regression tests for herdctl#423, second half: telling **Claude Code itself**
 * where its home is.
 *
 * The first half threaded `claudeHomePath` through every transcript path
 * *herdctl* resolves. But the process that actually reads and appends those
 * transcripts — the Claude Agent SDK's Claude Code subprocess, and the `claude`
 * binary the CLI runtime spawns — resolves its home from the
 * `CLAUDE_CONFIG_DIR` environment variable and has never heard of
 * `claudeHomePath`. Nothing set that variable, so with a non-default home:
 *
 *   - herdctl adopted/listed `<claudeHomePath>/projects/<enc-cwd>/<sid>.jsonl`
 *   - the SDK read and wrote `~/.claude/projects/<enc-cwd>/<sid>.jsonl`
 *
 * A new chat silently landed in the wrong tree; resuming an *adopted* chat died
 * with `error_during_execution`, because the session id it was asked to resume
 * has no transcript in the home it can see.
 *
 * Following `src/state/__tests__/claude-home-threading.test.ts` and its CLI
 * sibling: real directories, NO `vi.mock("node:os")`. The only thing mocked is
 * the boundary herdctl hands the environment across (SDK `query()` / `execa`) —
 * which is exactly the assertion: what does herdctl pass out?
 */

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- boundary mocks -------------------------------------------------------

/** Options every SDK `query()` received. */
const queryCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((args: { options?: Record<string, unknown> }) => {
    queryCalls.push(args.options ?? {});
    return (async function* () {})();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn(() => ({})),
}));

/** Options every `execa()` spawn received. */
const execaCalls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];

type FakeSubprocess = Promise<{ exitCode: number }> & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
};

/** A `claude` that writes a transcript line into `sessionFile`, then exits 0. */
let cliWork: () => Promise<void> = async () => {};

vi.mock("execa", () => ({
  execa: vi.fn((file: string, args: string[], options: Record<string, unknown>) => {
    execaCalls.push({ file, args, options });
    const promise = (async () => {
      // The runtime spawns FIRST and only then builds the watcher, so writing
      // immediately would let initialize() count the line as pre-existing.
      await new Promise((r) => setTimeout(r, 120));
      await cliWork();
      return { exitCode: 0 };
    })() as FakeSubprocess;
    promise.pid = 4242;
    promise.stdout = new EventEmitter();
    promise.stderr = new EventEmitter();
    promise.kill = vi.fn();
    return promise;
  }),
}));

import type { ResolvedAgent } from "../../../config/index.js";
import type { SDKMessage } from "../../types.js";
import {
  CLAUDE_CONFIG_DIR_VAR,
  resolveClaudeConfigDir,
  withClaudeConfigDir,
} from "../claude-config-dir.js";
import { CLIRuntime } from "../cli-runtime.js";
import { defaultClaudeHome, encodePathForCli } from "../cli-session-path.js";
import { RuntimeFactory } from "../factory.js";
import type { RuntimeExecuteOptions } from "../interface.js";
import { SDKRuntime } from "../sdk-runtime.js";

const NEW_ID = "abcdabcd-1111-2222-3333-444444444444";
const RESUME_ID = "99999999-8888-7777-6666-555555555555";

const agent = { name: "keeper", qualifiedName: "keeper" } as unknown as ResolvedAgent;

function baseOptions(overrides: Partial<RuntimeExecuteOptions> = {}): RuntimeExecuteOptions {
  return { prompt: "hi", agent, ...overrides };
}

function envOf(call: Record<string, unknown>): Record<string, string | undefined> | undefined {
  return call.env as Record<string, string | undefined> | undefined;
}

describe("CLAUDE_CONFIG_DIR reaches Claude Code (herdctl#423)", () => {
  let tempRoot: string;
  /** The alternate Claude home — deliberately NOT `os.homedir()/.claude`. */
  let claudeHome: string;
  let workDir: string;
  /** `<claudeHome>/projects/<encoded workDir>` — where a real CLI would write. */
  let homeSessionDir: string;
  /** Whatever `CLAUDE_CONFIG_DIR` was before a test touched it. */
  let savedConfigDir: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "claude-config-dir-"));
    claudeHome = path.join(tempRoot, "alt-claude-home");
    workDir = path.join(tempRoot, "workspace");
    homeSessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(workDir, { recursive: true });
    await mkdir(homeSessionDir, { recursive: true });

    savedConfigDir = process.env[CLAUDE_CONFIG_DIR_VAR];
    delete process.env[CLAUDE_CONFIG_DIR_VAR];

    queryCalls.length = 0;
    execaCalls.length = 0;
    cliWork = async () => {};
  });

  afterEach(async () => {
    if (savedConfigDir === undefined) delete process.env[CLAUDE_CONFIG_DIR_VAR];
    else process.env[CLAUDE_CONFIG_DIR_VAR] = savedConfigDir;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("the fixture really uses a non-default home (guards the test itself)", () => {
    // If this ever fails the rest of the suite proves nothing: the bug is masked
    // precisely when the configured home equals ~/.claude.
    expect(claudeHome).not.toBe(defaultClaudeHome());
    expect(claudeHome.startsWith(os.homedir())).toBe(false);
  });

  // -----------------------------------------------------------------------
  // The decision function
  // -----------------------------------------------------------------------

  describe("resolveClaudeConfigDir()", () => {
    it("returns the configured home when it differs from ~/.claude", () => {
      expect(resolveClaudeConfigDir(claudeHome, {})).toBe(claudeHome);
    });

    it("returns undefined for the default home", () => {
      // Setting the variable to a value equal to the default is NOT inert:
      // Claude Code branches on whether it is set at all when deriving its
      // secure-storage service name. Stay quiet when we have nothing to add.
      expect(resolveClaudeConfigDir(defaultClaudeHome(), {})).toBeUndefined();
      expect(resolveClaudeConfigDir(undefined, {})).toBeUndefined();
    });

    it("does not clobber an operator-set value, even a conflicting one", () => {
      const operator = path.join(tempRoot, "operator-home");
      expect(
        resolveClaudeConfigDir(claudeHome, { [CLAUDE_CONFIG_DIR_VAR]: operator }),
      ).toBeUndefined();
      expect(
        resolveClaudeConfigDir(claudeHome, { [CLAUDE_CONFIG_DIR_VAR]: claudeHome }),
      ).toBeUndefined();
    });

    it("treats an empty operator value as unset", () => {
      expect(resolveClaudeConfigDir(claudeHome, { [CLAUDE_CONFIG_DIR_VAR]: "" })).toBe(claudeHome);
    });

    it("compares paths after resolution, not as strings", () => {
      expect(resolveClaudeConfigDir(`${defaultClaudeHome()}/`, {})).toBeUndefined();
      expect(
        resolveClaudeConfigDir(path.join(defaultClaudeHome(), "..", ".claude"), {}),
      ).toBeUndefined();
    });
  });

  describe("withClaudeConfigDir()", () => {
    it("copies the inherited environment rather than replacing it", () => {
      // The SDK's `env` REPLACES the subprocess environment wholesale, so
      // dropping the inherited vars would strip PATH/HOME/credentials.
      const base = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-test" };
      const merged = withClaudeConfigDir(claudeHome, base);
      expect(merged).toEqual({ ...base, [CLAUDE_CONFIG_DIR_VAR]: claudeHome });
      // …and it is a copy: the caller's object is untouched.
      expect(base).not.toHaveProperty(CLAUDE_CONFIG_DIR_VAR);
    });

    it("returns undefined when nothing needs injecting", () => {
      expect(withClaudeConfigDir(defaultClaudeHome(), {})).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // SDK runtime
  // -----------------------------------------------------------------------

  describe("SDKRuntime", () => {
    it("defaults to ~/.claude and reports the configured home", () => {
      expect(new SDKRuntime().getClaudeHomePath()).toBe(defaultClaudeHome());
      expect(new SDKRuntime({ claudeHomePath: claudeHome }).getClaudeHomePath()).toBe(claudeHome);
    });

    it("passes CLAUDE_CONFIG_DIR to query() from execute()", async () => {
      const runtime = new SDKRuntime({ claudeHomePath: claudeHome });
      for await (const _ of runtime.execute(baseOptions())) {
        // no messages yielded
      }

      expect(queryCalls).toHaveLength(1);
      expect(envOf(queryCalls[0])?.[CLAUDE_CONFIG_DIR_VAR]).toBe(claudeHome);
    });

    it("passes CLAUDE_CONFIG_DIR to query() from openSession() (the resume path)", () => {
      // This is the call that failed live: resuming an ADOPTED chat whose
      // transcript only exists under the configured home.
      const runtime = new SDKRuntime({ claudeHomePath: claudeHome });
      runtime.openSession(baseOptions({ resume: NEW_ID }));

      expect(queryCalls).toHaveLength(1);
      expect(queryCalls[0].resume).toBe(NEW_ID);
      expect(envOf(queryCalls[0])?.[CLAUDE_CONFIG_DIR_VAR]).toBe(claudeHome);
    });

    it("carries the inherited environment across, since SDK env replaces it", async () => {
      process.env.HERDCTL_CLAUDE_CONFIG_DIR_TEST_MARKER = "carried";
      try {
        const runtime = new SDKRuntime({ claudeHomePath: claudeHome });
        for await (const _ of runtime.execute(baseOptions())) {
          // no messages yielded
        }
        const env = envOf(queryCalls[0]);
        expect(env?.HERDCTL_CLAUDE_CONFIG_DIR_TEST_MARKER).toBe("carried");
        expect(env?.PATH).toBe(process.env.PATH);
      } finally {
        delete process.env.HERDCTL_CLAUDE_CONFIG_DIR_TEST_MARKER;
      }
    });

    it("never mutates process.env", async () => {
      const runtime = new SDKRuntime({ claudeHomePath: claudeHome });
      for await (const _ of runtime.execute(baseOptions())) {
        // no messages yielded
      }
      // A global mutation would leak this agent's home into every other agent
      // sharing the host process.
      expect(process.env[CLAUDE_CONFIG_DIR_VAR]).toBeUndefined();
    });

    it("leaves env unset for the default home", async () => {
      const runtime = new SDKRuntime();
      for await (const _ of runtime.execute(baseOptions())) {
        // no messages yielded
      }
      expect(queryCalls).toHaveLength(1);
      expect(envOf(queryCalls[0])).toBeUndefined();
    });

    it("does not clobber an operator-set CLAUDE_CONFIG_DIR", async () => {
      const operator = path.join(tempRoot, "operator-home");
      process.env[CLAUDE_CONFIG_DIR_VAR] = operator;

      const runtime = new SDKRuntime({ claudeHomePath: claudeHome });
      for await (const _ of runtime.execute(baseOptions())) {
        // no messages yielded
      }

      // Left unset entirely, so the subprocess plainly inherits the operator's
      // value — the escape hatch keeps working.
      expect(envOf(queryCalls[0])).toBeUndefined();
      expect(process.env[CLAUDE_CONFIG_DIR_VAR]).toBe(operator);
    });
  });

  // -----------------------------------------------------------------------
  // CLI runtime — the spawned `claude` reads the same variable
  // -----------------------------------------------------------------------

  describe("CLIRuntime", () => {
    /**
     * Drive a full `execute()`.
     *
     * Pass `resume` for the cases that only care about the spawn: resuming
     * watches a known file path instead of polling the session directory for a
     * newly-created one, so the run finishes promptly (yielding nothing) rather
     * than blocking on a file the test never means to create.
     */
    async function run(runtime: CLIRuntime, resume?: string): Promise<SDKMessage[]> {
      const messages: SDKMessage[] = [];
      for await (const message of runtime.execute({
        prompt: "hello",
        agent: { ...(agent as object), working_directory: workDir } as never,
        resume,
      })) {
        messages.push(message);
      }
      return messages;
    }

    it("passes CLAUDE_CONFIG_DIR to the spawned claude binary", async () => {
      cliWork = () =>
        writeFile(
          path.join(homeSessionDir, `${NEW_ID}.jsonl`),
          `${JSON.stringify({ type: "system", subtype: "init" })}\n`,
        );

      await run(new CLIRuntime({ claudeHomePath: claudeHome }));

      expect(execaCalls).toHaveLength(1);
      expect(execaCalls[0].file).toBe("claude");
      // execa merges `env` over the inherited environment (extendEnv defaults
      // to true), so a bare single-key object is the whole per-spawn addition.
      expect(execaCalls[0].options.env).toEqual({ [CLAUDE_CONFIG_DIR_VAR]: claudeHome });
      expect(process.env[CLAUDE_CONFIG_DIR_VAR]).toBeUndefined();
    });

    it("leaves env alone for the default home", async () => {
      await run(new CLIRuntime(), RESUME_ID);
      expect(execaCalls).toHaveLength(1);
      expect(execaCalls[0].options.env).toBeUndefined();
    });

    it("does not clobber an operator-set CLAUDE_CONFIG_DIR", async () => {
      const operator = path.join(tempRoot, "operator-home");
      process.env[CLAUDE_CONFIG_DIR_VAR] = operator;

      await run(new CLIRuntime({ claudeHomePath: claudeHome }), RESUME_ID);

      // Nothing passed, so the spawn plainly inherits the operator's value.
      expect(execaCalls).toHaveLength(1);
      expect(execaCalls[0].options.env).toBeUndefined();
    });

    it("leaves a caller-supplied spawner (the Docker path) entirely alone", async () => {
      const spawned: Array<unknown[]> = [];
      const runtime = new CLIRuntime({
        claudeHomePath: claudeHome,
        processSpawner: ((...spawnArgs: unknown[]) => {
          spawned.push(spawnArgs);
          const promise = (async () => {
            await new Promise((r) => setTimeout(r, 20));
            return { exitCode: 0 };
          })() as FakeSubprocess;
          promise.pid = 1;
          promise.stdout = new EventEmitter();
          promise.stderr = new EventEmitter();
          promise.kill = vi.fn();
          return promise;
        }) as never,
      });

      await run(runtime, RESUME_ID);

      // The container has its own Claude home; herdctl must not push a host
      // path into it. The spawner signature carries no env at all.
      expect(spawned).toHaveLength(1);
      expect(execaCalls).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Wiring
  // -----------------------------------------------------------------------

  describe("RuntimeFactory", () => {
    it("threads claudeHomePath into the SDK runtime, not just the CLI one", () => {
      const sdk = RuntimeFactory.create({ ...(agent as object) } as ResolvedAgent, {
        claudeHomePath: claudeHome,
      }) as SDKRuntime;
      expect(sdk).toBeInstanceOf(SDKRuntime);
      expect(sdk.getClaudeHomePath()).toBe(claudeHome);

      const cli = RuntimeFactory.create({ ...(agent as object), runtime: "cli" } as ResolvedAgent, {
        claudeHomePath: claudeHome,
      }) as CLIRuntime;
      expect(cli).toBeInstanceOf(CLIRuntime);
      expect(cli.getClaudeHomePath()).toBe(claudeHome);
    });

    it("still defaults both runtimes to ~/.claude", () => {
      const sdk = RuntimeFactory.create({ ...(agent as object) } as ResolvedAgent) as SDKRuntime;
      expect(sdk).toBeInstanceOf(SDKRuntime);
      expect(sdk.getClaudeHomePath()).toBe(defaultClaudeHome());

      // "both runtimes" — the CLI half does its own path arithmetic against this
      // home, so its default is the one that actually has to hold.
      const cli = RuntimeFactory.create({
        ...(agent as object),
        runtime: "cli",
      } as ResolvedAgent) as CLIRuntime;
      expect(cli).toBeInstanceOf(CLIRuntime);
      expect(cli.getClaudeHomePath()).toBe(defaultClaudeHome());
    });
  });
});
