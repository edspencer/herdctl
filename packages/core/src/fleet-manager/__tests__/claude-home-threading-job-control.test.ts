/**
 * Regression tests for herdctl#423: `JobControl.openChatSession()` resolved the
 * resumed session's transcript with `getCliSessionFile(workspacePath, sessionId)`
 * — no Claude home — so under a configured (non-default) home it read
 * `~/.claude/...`, found nothing, and the #406 pending-async-queue telemetry
 * silently reported a residue of 0 for every resume.
 *
 * The telemetry is deliberately non-fatal and log-only, so the log line IS the
 * observable: a resume that carries a prompt logs
 * `[pending-async-queue residue: N]`, and N is non-zero only if the transcript
 * was actually found. These tests write a transcript carrying a real queue
 * backlog into an alternate home and assert the number comes back.
 *
 * Following `src/state/__tests__/claude-home-threading.test.ts`: NO
 * `vi.mock("node:os")` and NO path-helper mock — the alternate home is a real
 * directory asserted to differ from `~/.claude`, or the test proves nothing.
 * Only the Claude SDK's `query` is mocked, so no `claude` subprocess is spawned.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  defaultClaudeHome,
  encodePathForCli,
  getCliSessionFile,
} from "../../runner/runtime/cli-session-path.js";
import { FleetManager } from "../fleet-manager.js";

const SESSION_ID = "cccccccc-dddd-eeee-ffff-000000000000";

/** Three enqueues, one dequeue → a pending async-queue depth of exactly 2. */
function transcriptWithQueueBacklog(): string {
  return `${[
    { type: "queue-operation", operation: "enqueue", uuid: "q-1" },
    { type: "queue-operation", operation: "enqueue", uuid: "q-2" },
    { type: "queue-operation", operation: "enqueue", uuid: "q-3" },
    { type: "queue-operation", operation: "dequeue", uuid: "q-4" },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
}

/** A fake SDK Query — only the members openSession()/close() touch. */
function fakeChatQuery() {
  return {
    [Symbol.asyncIterator]: async function* () {},
    supportedCommands: vi.fn().mockResolvedValue([]),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    return: vi.fn().mockResolvedValue(undefined),
  };
}

describe("openChatSession resolves transcripts against the configured Claude home (#423)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let stateDir: string;
  let configDir: string;
  let workDir: string;
  /** Captures the #406 resume log line; typed to match `FleetManagerLogger`. */
  let logger: Record<"debug" | "info" | "warn" | "error", Mock<(message: string) => void>>;

  beforeEach(async () => {
    vi.mocked(query).mockReset();
    vi.mocked(query).mockReturnValue(fakeChatQuery() as never);

    tempRoot = await mkdtemp(path.join(os.tmpdir(), "job-control-claude-home-"));
    claudeHome = path.join(tempRoot, "alt-claude-home");
    stateDir = path.join(tempRoot, ".herdctl");
    configDir = path.join(tempRoot, "config");
    workDir = path.join(tempRoot, "workspace");
    await mkdir(stateDir, { recursive: true });
    await mkdir(workDir, { recursive: true });

    // The transcript lives ONLY in the alternate home. Nothing is written to the
    // real `~/.claude`, so an un-threaded resolution can only report 0.
    const sessionDir = path.join(claudeHome, "projects", encodePathForCli(workDir));
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, `${SESSION_ID}.jsonl`), transcriptWithQueueBacklog());

    logger = {
      debug: vi.fn<(message: string) => void>(),
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    };
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function buildManager(claudeHomePath?: string) {
    const yaml = await import("yaml");
    const agentDir = path.join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "keeper.yaml"),
      yaml.stringify({ name: "keeper", working_directory: workDir }),
    );
    const configPath = path.join(configDir, "herdctl.yaml");
    await writeFile(
      configPath,
      yaml.stringify({ version: 1, agents: [{ path: "./agents/keeper.yaml" }] }),
    );

    const manager = new FleetManager({
      configPath,
      stateDir,
      claudeHomePath,
      checkInterval: 10_000,
      logger,
    });
    await manager.initialize();
    return manager;
  }

  /** The `[pending-async-queue residue: N]` value from the #406 resume log line. */
  function loggedResidue(): string | null {
    for (const [message] of logger.info.mock.calls) {
      const match = /\[pending-async-queue residue: ([^\]]+)\]/.exec(String(message));
      if (match) return match[1];
    }
    return null;
  }

  it("the fixture really uses a non-default home (guards the test itself)", () => {
    // If this ever fails the rest of the suite proves nothing: the bug is masked
    // precisely when the configured home equals ~/.claude.
    expect(claudeHome).not.toBe(defaultClaudeHome());
    expect(claudeHome.startsWith(os.homedir())).toBe(false);
    expect(getCliSessionFile(workDir, SESSION_ID, claudeHome).startsWith(claudeHome)).toBe(true);
  });

  it("reads the resumed transcript from the configured home", async () => {
    const manager = await buildManager(claudeHome);

    const session = await manager.openChatSession("keeper", {
      resume: SESSION_ID,
      prompt: "carry on",
    });

    // 3 enqueues - 1 dequeue. Before the fix this resolved to ~/.claude/... ,
    // read nothing, and reported "0" — the failure was invisible because the
    // telemetry is best-effort.
    expect(loggedResidue()).toBe("2");

    await session.close();
    await manager.stop();
  });

  it("still falls back to ~/.claude when no home is configured", async () => {
    const manager = await buildManager(undefined);

    const session = await manager.openChatSession("keeper", {
      resume: SESSION_ID,
      prompt: "carry on",
    });

    // The default home has no such transcript, so the count is 0 (never
    // `undefined`: a missing file is not an error for this counter). This is the
    // control proving the "2" above came from the alternate home, not from a
    // stray transcript somewhere on this machine.
    expect(loggedResidue()).toBe("0");

    await session.close();
    await manager.stop();
  });
});
