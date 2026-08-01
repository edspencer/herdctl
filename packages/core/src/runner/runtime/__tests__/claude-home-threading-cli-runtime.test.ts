/**
 * Regression tests for herdctl#423 in the CLI runtime.
 *
 * `CLIRuntime.execute()` resolved BOTH of its transcript paths — the session
 * *directory* it snapshots/polls for a new session file, and the session *file*
 * it watches on resume — with the un-threaded `getCliSessionDir(cwd)` /
 * `getCliSessionFile(cwd, resume)`. Those hardcode `~/.claude`, so a
 * non-default Claude home made the runtime write/watch a different tree than
 * the one session discovery lists. There was an escape hatch
 * (`sessionDirOverride`, used by the Docker container runner) but no notion of
 * a Claude home.
 *
 * `claudeHomePath` now supplies that. `sessionDirOverride` keeps STRICT
 * precedence: it names an explicit host-side directory that is not derived from
 * a Claude home at all, and Docker must keep using it.
 *
 * Following `src/state/__tests__/claude-home-threading.test.ts`: real
 * directories, NO `vi.mock("node:os")` and — unlike the sibling
 * `cli-runtime.test.ts` — NO mock of `cli-session-path.js` or the session
 * watcher, since mocking either would make the path resolution under test
 * disappear. Only the `claude` subprocess is faked, and it writes the transcript
 * bytes a real CLI would.
 */

import { EventEmitter } from "node:events";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "../../types.js";
import { CLIRuntime } from "../cli-runtime.js";
import { defaultClaudeHome, encodePathForCli } from "../cli-session-path.js";

const RESUME_ID = "dddddddd-eeee-ffff-0000-111111111111";
const NEW_ID = "eeeeeeee-ffff-0000-1111-222222222222";

/** How long the fake `claude` "runs" before writing its output and exiting. */
const PROCESS_MS = 120;

type FakeSubprocess = Promise<{ exitCode: number }> & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
};

/**
 * A fake `claude` subprocess that runs `work()` (writing transcript bytes,
 * exactly as the real CLI would) and then exits 0.
 *
 * The delay matters: `execute()` spawns FIRST and only then constructs the
 * watcher and calls `initialize()`. Writing immediately would let
 * `initialize()` count the new lines as pre-existing and skip them.
 */
function fakeSubprocess(work: () => Promise<void>): FakeSubprocess {
  const promise = (async () => {
    await new Promise((r) => setTimeout(r, PROCESS_MS));
    await work();
    return { exitCode: 0 };
  })() as FakeSubprocess;
  promise.pid = 4242;
  promise.stdout = new EventEmitter();
  promise.stderr = new EventEmitter();
  promise.kill = vi.fn();
  return promise;
}

function assistantLine(text: string): string {
  return `${JSON.stringify({
    type: "assistant",
    message: {
      id: `msg_${text.replace(/\W/g, "_")}`,
      role: "assistant",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text }],
    },
  })}\n`;
}

function assistantTexts(messages: SDKMessage[]): string[] {
  return messages
    .filter((m) => m.type === "assistant")
    .flatMap((m) => {
      const content = (m as { message?: { content?: Array<{ type: string; text?: string }> } })
        .message?.content;
      return Array.isArray(content)
        ? content.filter((b) => b.type === "text" && b.text).map((b) => b.text as string)
        : [];
    });
}

describe("CLIRuntime honours the configured Claude home (herdctl#423)", () => {
  let tempRoot: string;
  /** The alternate Claude home — deliberately NOT `os.homedir()/.claude`. */
  let claudeHome: string;
  let workDir: string;
  /** `<claudeHome>/projects/<encoded workDir>` — where a real CLI would write. */
  let homeSessionDir: string;
  /** A Docker-style host-side session dir, unrelated to any Claude home. */
  let overrideDir: string;

  const agent = { name: "keeper", configPath: "/tmp/agent.yaml" } as never;

  async function collect(runtime: CLIRuntime, resume?: string): Promise<SDKMessage[]> {
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

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cli-runtime-claude-home-"));
    claudeHome = path.join(tempRoot, "alt-claude-home");
    workDir = path.join(tempRoot, "workspace");
    overrideDir = path.join(tempRoot, "docker-sessions");
    homeSessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(workDir, { recursive: true });
    await mkdir(homeSessionDir, { recursive: true });
    await mkdir(overrideDir, { recursive: true });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it("the fixture really uses a non-default home (guards the test itself)", () => {
    // If this ever fails the rest of the suite proves nothing: the bug is masked
    // precisely when the configured home equals ~/.claude.
    expect(claudeHome).not.toBe(defaultClaudeHome());
    expect(claudeHome.startsWith(os.homedir())).toBe(false);
  });

  it("defaults to ~/.claude when no home is supplied", () => {
    expect(new CLIRuntime().getClaudeHomePath()).toBe(defaultClaudeHome());
    expect(new CLIRuntime({ claudeHomePath: claudeHome }).getClaudeHomePath()).toBe(claudeHome);
  });

  it("watches the resumed transcript under the configured home", async () => {
    const sessionFile = path.join(homeSessionDir, `${RESUME_ID}.jsonl`);
    await writeFile(sessionFile, assistantLine("older turn, must be skipped"));

    const runtime = new CLIRuntime({
      claudeHomePath: claudeHome,
      processSpawner: (() =>
        fakeSubprocess(() =>
          appendFile(sessionFile, assistantLine("appended in the alternate home")),
        ) as never) as never,
    });

    const messages = await collect(runtime, RESUME_ID);

    // The resumed session id is echoed on the synthetic init message, and the
    // newly-appended turn comes back — both only possible if the runtime
    // resolved into `claudeHome`. Before the fix this watched
    // `~/.claude/projects/<encoded>/...`, which does not exist.
    const init = messages.find((m) => m.type === "system") as { session_id?: string } | undefined;
    expect(init?.session_id).toBe(RESUME_ID);
    expect(assistantTexts(messages)).toEqual(["appended in the alternate home"]);
  });

  it("does NOT find the transcript when the home is left at its default (control)", async () => {
    const sessionFile = path.join(homeSessionDir, `${RESUME_ID}.jsonl`);
    await writeFile(sessionFile, assistantLine("older turn, must be skipped"));

    // Same fixture, no `claudeHomePath`: resolution falls back to ~/.claude,
    // where nothing was written. This is the pre-fix behaviour, kept as the
    // control that proves the test above is actually exercising the home.
    const runtime = new CLIRuntime({
      processSpawner: (() =>
        fakeSubprocess(() =>
          appendFile(sessionFile, assistantLine("appended in the alternate home")),
        ) as never) as never,
    });

    const messages = await collect(runtime, RESUME_ID);
    expect(assistantTexts(messages)).toEqual([]);
  });

  it("discovers a brand-new session file under the configured home", async () => {
    const runtime = new CLIRuntime({
      claudeHomePath: claudeHome,
      processSpawner: (() =>
        fakeSubprocess(() =>
          writeFile(
            path.join(homeSessionDir, `${NEW_ID}.jsonl`),
            assistantLine("fresh session in the alternate home"),
          ),
        ) as never) as never,
    });

    const messages = await collect(runtime);

    // The adopted session id comes from the file that appeared in the session
    // directory — so it can only be NEW_ID if `getCliSessionDir` resolved
    // against `claudeHome` for both the pre-spawn snapshot and the poll.
    const init = messages.find((m) => m.type === "system") as { session_id?: string } | undefined;
    expect(init?.session_id).toBe(NEW_ID);
    expect(assistantTexts(messages)).toEqual(["fresh session in the alternate home"]);
  });

  describe("sessionDirOverride keeps strict precedence over the home", () => {
    it("watches the override directory on resume, not the configured home", async () => {
      const overrideFile = path.join(overrideDir, `${RESUME_ID}.jsonl`);
      const homeFile = path.join(homeSessionDir, `${RESUME_ID}.jsonl`);
      await writeFile(overrideFile, assistantLine("older override turn, skipped"));
      await writeFile(homeFile, assistantLine("older home turn, skipped"));

      const runtime = new CLIRuntime({
        claudeHomePath: claudeHome,
        sessionDirOverride: overrideDir,
        // Write to BOTH, so only the path actually watched decides the result.
        processSpawner: (() =>
          fakeSubprocess(async () => {
            await appendFile(overrideFile, assistantLine("from the override dir"));
            await appendFile(homeFile, assistantLine("from the claude home"));
          }) as never) as never,
      });

      const messages = await collect(runtime, RESUME_ID);
      expect(assistantTexts(messages)).toEqual(["from the override dir"]);
    });

    it("polls the override directory for a new session file, not the configured home", async () => {
      const runtime = new CLIRuntime({
        claudeHomePath: claudeHome,
        sessionDirOverride: overrideDir,
        processSpawner: (() =>
          fakeSubprocess(async () => {
            await writeFile(
              path.join(overrideDir, `${NEW_ID}.jsonl`),
              assistantLine("from the override dir"),
            );
            await writeFile(
              path.join(homeSessionDir, `${RESUME_ID}.jsonl`),
              assistantLine("from the claude home"),
            );
          }) as never) as never,
      });

      const messages = await collect(runtime);

      const init = messages.find((m) => m.type === "system") as { session_id?: string } | undefined;
      expect(init?.session_id).toBe(NEW_ID);
      expect(assistantTexts(messages)).toEqual(["from the override dir"]);
    });
  });
});
