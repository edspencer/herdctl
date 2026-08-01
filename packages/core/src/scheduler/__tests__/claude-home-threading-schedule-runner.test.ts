/**
 * Regression tests for herdctl#423, resume-fallback half: a scheduled run that
 * opts into `resume_session` must resolve the agent's stored CLI session against
 * the CONFIGURED Claude home, not `~/.claude`.
 *
 * `runSchedule` looks the session up with
 * `getSessionInfo(..., { runtime: agent.runtime, timeout })`, which for the `cli`
 * runtime delegates to `validateSessionWithFileCheck` — a transcript existence
 * check. That check accepts a `claudeHomePath`, but nothing threaded one in, so
 * under a non-default home it probed `~/.claude`, found nothing, and declared the
 * session `file_not_found`. `JobExecutor`'s own resume validation then repeated
 * the same un-threaded check.
 *
 * The damage is worse than a skipped resume: `getSessionInfo` DELETES a session
 * it judges stale, so a valid session is destroyed and the run silently starts
 * fresh.
 *
 * The observable is the `resume` the runtime is finally asked to execute with:
 * the session id when the home is threaded, `undefined` when it is not.
 *
 * Following `src/state/__tests__/claude-home-threading.test.ts`: real
 * directories, NO `vi.mock("node:os")`. The alternate home is asserted to differ
 * from `~/.claude`, or the test proves nothing — the bug is invisible precisely
 * when the two coincide. Only `RuntimeFactory.create` is mocked, so no `claude`
 * subprocess is spawned.
 */

import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgent, Schedule } from "../../config/index.js";
import type { SDKMessage } from "../../runner/index.js";
import { RuntimeFactory } from "../../runner/index.js";
import { defaultClaudeHome, encodePathForCli } from "../../runner/runtime/cli-session-path.js";
import type { ScheduleState } from "../../state/schemas/fleet-state.js";
import { runSchedule, type ScheduleRunnerLogger } from "../schedule-runner.js";

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const AGENT = "keeper";

/** A minimal but real CLI transcript — only its existence is under test. */
function transcript(workingDirectory: string): string {
  return `${[
    { type: "summary", summary: "A scheduled CLI session" },
    {
      type: "user",
      uuid: "u-1",
      sessionId: SESSION_ID,
      cwd: workingDirectory,
      timestamp: "2026-08-01T10:00:00.000Z",
      message: { role: "user", content: "previous turn" },
    },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
}

function silentLogger(): ScheduleRunnerLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

describe("runSchedule resolves the resumed CLI session against the configured home (#423)", () => {
  let tempRoot: string;
  /** The alternate Claude home — deliberately NOT `os.homedir()/.claude`. */
  let claudeHome: string;
  let stateDir: string;
  let sessionsDir: string;
  let workDir: string;
  let pointerFile: string;
  /** `resume` values the runtime was actually asked to execute with. */
  let resumes: Array<string | undefined>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sched-claude-home-"));
    claudeHome = path.join(tempRoot, "alt-claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    sessionsDir = path.join(stateDir, "sessions");
    workDir = path.join(tempRoot, "workspace");
    pointerFile = path.join(sessionsDir, `${AGENT}.json`);

    await mkdir(path.join(stateDir, "jobs"), { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    // The transcript exists ONLY in the alternate home. Nothing is written to the
    // real `~/.claude`, so an un-threaded check can only conclude "missing".
    const sessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, `${SESSION_ID}.jsonl`), transcript(workDir));

    const now = new Date().toISOString();
    await writeFile(
      pointerFile,
      JSON.stringify({
        agent_name: AGENT,
        session_id: SESSION_ID,
        created_at: now,
        last_used_at: now,
        job_count: 1,
        mode: "autonomous",
        working_directory: workDir,
        runtime_type: "cli",
        docker_enabled: false,
      }),
    );

    resumes = [];
    // Mirror the real factory: the runtime reports back exactly the home it was
    // handed (defaulting to `~/.claude`), because the executor validates resumes
    // against the home its runtime will actually read and write.
    vi.spyOn(RuntimeFactory, "create").mockImplementation(
      (_agent, options) =>
        ({
          getClaudeHomePath: () => options?.claudeHomePath ?? defaultClaudeHome(),
          execute: (executeOptions: { resume?: string }): AsyncIterable<SDKMessage> => {
            resumes.push(executeOptions.resume);
            return (async function* () {
              yield {
                type: "system" as const,
                subtype: "init",
                session_id: SESSION_ID,
              } as unknown as SDKMessage;
            })();
          },
        }) as never,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function agent(): ResolvedAgent {
    return {
      name: AGENT,
      qualifiedName: AGENT,
      fleetPath: [],
      configPath: `/fake/${AGENT}.yaml`,
      runtime: "cli",
      working_directory: workDir,
    } as unknown as ResolvedAgent;
  }

  function schedule(): Schedule {
    return {
      type: "interval",
      interval: "1h",
      prompt: "carry on",
      resume_session: true,
    } as unknown as Schedule;
  }

  const scheduleState: ScheduleState = {
    status: "idle",
    last_run_at: null,
    next_run_at: null,
    last_error: null,
  };

  it("the fixture really uses a non-default home (guards the test itself)", () => {
    // If this ever fails the rest of the suite proves nothing.
    expect(claudeHome).not.toBe(defaultClaudeHome());
    expect(claudeHome.startsWith(os.homedir())).toBe(false);
  });

  it("resumes the stored session when the home is threaded through", async () => {
    const result = await runSchedule({
      agent: agent(),
      scheduleName: "hourly",
      schedule: schedule(),
      scheduleState,
      stateDir,
      claudeHomePath: claudeHome,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    // THE regression: before the fix the existence check probed `~/.claude`,
    // reported `file_not_found`, and the run started fresh.
    expect(resumes).toEqual([SESSION_ID]);
    // ...and the session pointer was not destroyed as collateral.
    await expect(access(pointerFile)).resolves.toBeUndefined();
  });

  it("without a configured home the same session looks missing and is cleared", async () => {
    // The control proving the assertion above came from the alternate home:
    // nothing was ever written to the real `~/.claude`.
    const result = await runSchedule({
      agent: agent(),
      scheduleName: "hourly",
      schedule: schedule(),
      scheduleState,
      stateDir,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(resumes).toEqual([undefined]);
  });
});
