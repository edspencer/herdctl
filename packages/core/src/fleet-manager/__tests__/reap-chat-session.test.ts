/**
 * Tests for FleetManager.reapChatSession — the escape hatch for a managed
 * session the reap policy will never release on its own.
 *
 * These drive the REAL SessionLifecycleManager + SessionReaper the fleet builds
 * in initialize(), so what's covered is the actual wiring (a private
 * `sessionLifecycle` reached through a public method), not a stub of it. The
 * policy behaviour itself is covered in session/__tests__/session-reaper.test.ts.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import type { RuntimeSession } from "../../runner/runtime/interface.js";
import type { SessionLifecycleSignal } from "../../session/types.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

/** A background task, so the policy holds the session open and never reaps it. */
const TASK = { id: "t1", type: "shell", status: "running", description: "server" };

function fakeSession(): RuntimeSession & { close: ReturnType<typeof vi.fn> } {
  async function* empty(): AsyncGenerator<never> {}
  return {
    messages: empty(),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    listCommands: vi.fn().mockResolvedValue([]),
    setModel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function keepAliveSignal(sessionId: string): SessionLifecycleSignal {
  return { kind: "turn_end", sessionId, sessionCrons: [], backgroundTasks: [TASK] };
}

describe("FleetManager.reapChatSession()", () => {
  let tempDir: string;
  let configPath: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-reap-chat-session-"));
    const configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(join(configDir, "agents"), { recursive: true });
    await mkdir(join(tempDir, "workspace"), { recursive: true });

    const yaml = await import("yaml");
    await writeFile(
      join(configDir, "agents", "keeper.yaml"),
      yaml.stringify({ name: "keeper", working_directory: join(tempDir, "workspace") }),
    );
    configPath = join(configDir, "herdctl.yaml");
    await writeFile(
      configPath,
      yaml.stringify({ version: 1, agents: [{ path: "./agents/keeper.yaml" }] }),
    );
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function createManager() {
    return new FleetManager({ configPath, stateDir, checkInterval: 10000, logger: silentLogger() });
  }

  it("returns false before initialize(), when there is no lifecycle manager yet", () => {
    expect(createManager().reapChatSession("sess-1")).toBe(false);
  });

  it("closes a session the policy is holding open for background work", async () => {
    const manager = createManager();
    await manager.initialize();
    const lifecycle = manager.getSessionLifecycle();
    if (!lifecycle) throw new Error("expected a session lifecycle manager after initialize()");

    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");
    await managed.handleSignal(keepAliveSignal("sess-1"));
    expect(managed.isLive()).toBe(true); // kept alive: nothing will reap this

    expect(manager.reapChatSession("sess-1")).toBe(true);
    expect(managed.isLive()).toBe(false);
    await new Promise((r) => setTimeout(r, 5)); // close() is deferred a tick
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("returns false for an unknown session id, and for one already reaped", async () => {
    const manager = createManager();
    await manager.initialize();
    const lifecycle = manager.getSessionLifecycle();
    if (!lifecycle) throw new Error("expected a session lifecycle manager after initialize()");

    const session = fakeSession();
    const managed = lifecycle.manage(session, "keeper");
    await managed.handleSignal(keepAliveSignal("sess-1"));

    expect(manager.reapChatSession("who-dis")).toBe(false);
    expect(manager.reapChatSession("sess-1")).toBe(true);
    expect(manager.reapChatSession("sess-1")).toBe(false);
    await new Promise((r) => setTimeout(r, 5));
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
