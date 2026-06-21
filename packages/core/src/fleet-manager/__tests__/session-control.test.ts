/**
 * Tests for first-class session control on FleetManager:
 *   - deleteSession(name, sessionId): removes a session transcript from disk
 *   - setSessionName(name, sessionId, customName): sets/clears a custom name
 *
 * These exercise the REAL SessionDiscoveryService + SessionMetadataStore (no
 * mocks) so we verify the transcript file is actually removed, the custom name
 * is persisted, and a subsequent getAgentSessions reflects the new name.
 *
 * `os.homedir()` is mocked to a temp directory so CLI transcripts
 * (~/.claude/projects/<encoded>/<id>.jsonl) land in a controlled location.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock os.homedir so CLI session paths resolve under our temp dir. We keep the
// real module for everything else (tmpdir, etc.).
let mockHome: string;
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    default: { ...actual, homedir: () => mockHome },
    homedir: () => mockHome,
  };
});

import {
  createJob,
  encodePathForCli,
  getCliSessionFile,
  SessionMetadataStore,
  updateJob,
} from "../../index.js";
import { AgentNotFoundError, InvalidStateError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("FleetManager session control (deleteSession / setSessionName)", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;
  let workDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-session-ctl-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    workDir = join(tempDir, "workspace");
    mockHome = join(tempDir, "home");
    await mkdir(configDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(mockHome, { recursive: true });
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function createConfig(config: object) {
    const configPath = join(configDir, "herdctl.yaml");
    const yaml = await import("yaml");
    await writeFile(configPath, yaml.stringify(config));
    return configPath;
  }

  async function createAgentConfig(name: string, config: object) {
    const agentDir = join(configDir, "agents");
    await mkdir(agentDir, { recursive: true });
    const agentPath = join(agentDir, `${name}.yaml`);
    const yaml = await import("yaml");
    await writeFile(agentPath, yaml.stringify(config));
    return agentPath;
  }

  function createTestManager(configPath: string) {
    return new FleetManager({
      configPath,
      stateDir,
      checkInterval: 10000,
      logger: silentLogger(),
    });
  }

  /** Create a CLI transcript file for a session under the mocked ~/.claude. */
  async function writeTranscript(wd: string, sessionId: string, content = "{}\n") {
    const projDir = join(mockHome, ".claude", "projects", encodePathForCli(wd));
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, `${sessionId}.jsonl`), content);
  }

  async function buildManagerWithAgent(extraAgentConfig: object = {}) {
    await createAgentConfig("keeper", {
      name: "keeper",
      working_directory: workDir,
      ...extraAgentConfig,
    });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/keeper.yaml" }],
    });
    const manager = createTestManager(configPath);
    await manager.initialize();
    return manager;
  }

  // ===========================================================================
  // deleteSession
  // ===========================================================================

  describe("deleteSession()", () => {
    const sessionId = "11111111-2222-3333-4444-555555555555";

    it("deletes the correct transcript file and returns true", async () => {
      const manager = await buildManagerWithAgent();
      await writeTranscript(workDir, sessionId);

      const sessionFile = getCliSessionFile(workDir, sessionId);
      expect(await readFile(sessionFile, "utf-8")).toBe("{}\n");

      const removed = await manager.deleteSession("keeper", sessionId);
      expect(removed).toBe(true);

      // File should be gone now.
      await expect(readFile(sessionFile, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("returns false when no transcript exists", async () => {
      const manager = await buildManagerWithAgent();
      // No transcript written.
      const removed = await manager.deleteSession("keeper", sessionId);
      expect(removed).toBe(false);
    });

    it("rejects a path-traversal session id", async () => {
      const manager = await buildManagerWithAgent();
      await expect(manager.deleteSession("keeper", "../../etc/passwd")).rejects.toThrow(
        /Invalid session ID/,
      );
    });

    it("throws AgentNotFoundError for an unknown agent", async () => {
      const manager = await buildManagerWithAgent();
      await expect(manager.deleteSession("ghost", sessionId)).rejects.toThrow(AgentNotFoundError);
    });

    it("throws InvalidStateError before initialize()", async () => {
      await createAgentConfig("keeper", { name: "keeper", working_directory: workDir });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/keeper.yaml" }],
      });
      const manager = createTestManager(configPath);
      // not initialized
      await expect(manager.deleteSession("keeper", sessionId)).rejects.toThrow(InvalidStateError);
    });

    it("removes the deleted session from a subsequent getAgentSessions listing", async () => {
      const manager = await buildManagerWithAgent();
      await writeTranscript(workDir, sessionId, "{}\n");

      // Attribute the session to the agent via a job record so it surfaces in
      // getAgentSessions (which only returns sessions attributed to the agent).
      const jobsDir = join(stateDir, "jobs");
      const job = await createJob(jobsDir, {
        agent: "keeper",
        trigger_type: "manual",
        prompt: "x",
      });
      await updateJob(jobsDir, job.id, { session_id: sessionId });

      const before = await manager.getAgentSessions("keeper");
      expect(before.map((s) => s.sessionId)).toContain(sessionId);

      const removed = await manager.deleteSession("keeper", sessionId);
      expect(removed).toBe(true);

      const after = await manager.getAgentSessions("keeper");
      expect(after.map((s) => s.sessionId)).not.toContain(sessionId);
    });

    it("uses the docker-sessions location for docker agents", async () => {
      const manager = await buildManagerWithAgent({ docker: { enabled: true } });

      // Docker transcripts live flat in .herdctl/docker-sessions/<id>.jsonl
      const dockerDir = join(stateDir, "docker-sessions");
      await mkdir(dockerDir, { recursive: true });
      await writeFile(join(dockerDir, `${sessionId}.jsonl`), "{}\n");

      const removed = await manager.deleteSession("keeper", sessionId);
      expect(removed).toBe(true);
      await expect(readFile(join(dockerDir, `${sessionId}.jsonl`), "utf-8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  // ===========================================================================
  // setSessionName
  // ===========================================================================

  describe("setSessionName()", () => {
    const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    it("persists a custom name via the metadata store", async () => {
      const manager = await buildManagerWithAgent();

      await manager.setSessionName("keeper", sessionId, "Feature Work");

      // Verify directly via a fresh store reading the same state dir.
      const store = new SessionMetadataStore(stateDir);
      expect(await store.getCustomName("keeper", sessionId)).toBe("Feature Work");
    });

    it("trims whitespace from the custom name", async () => {
      const manager = await buildManagerWithAgent();
      await manager.setSessionName("keeper", sessionId, "  Padded  ");

      const store = new SessionMetadataStore(stateDir);
      expect(await store.getCustomName("keeper", sessionId)).toBe("Padded");
    });

    it("clears the custom name when passed null", async () => {
      const manager = await buildManagerWithAgent();
      await manager.setSessionName("keeper", sessionId, "Temp");
      await manager.setSessionName("keeper", sessionId, null);

      const store = new SessionMetadataStore(stateDir);
      expect(await store.getCustomName("keeper", sessionId)).toBeUndefined();
    });

    it("clears the custom name when passed an empty/whitespace string", async () => {
      const manager = await buildManagerWithAgent();
      await manager.setSessionName("keeper", sessionId, "Temp");
      await manager.setSessionName("keeper", sessionId, "   ");

      const store = new SessionMetadataStore(stateDir);
      expect(await store.getCustomName("keeper", sessionId)).toBeUndefined();
    });

    it("is reflected in a subsequent getAgentSessions listing", async () => {
      const manager = await buildManagerWithAgent();
      await writeTranscript(workDir, sessionId, "{}\n");

      // Attribute the session to the agent.
      const jobsDir = join(stateDir, "jobs");
      const job = await createJob(jobsDir, {
        agent: "keeper",
        trigger_type: "manual",
        prompt: "x",
      });
      await updateJob(jobsDir, job.id, { session_id: sessionId });

      // Prime the discovery cache first so we prove the rename invalidates it.
      const before = await manager.getAgentSessions("keeper");
      const beforeEntry = before.find((s) => s.sessionId === sessionId);
      expect(beforeEntry?.customName).toBeUndefined();

      await manager.setSessionName("keeper", sessionId, "Renamed Session");

      const after = await manager.getAgentSessions("keeper");
      const afterEntry = after.find((s) => s.sessionId === sessionId);
      expect(afterEntry?.customName).toBe("Renamed Session");
    });

    it("throws AgentNotFoundError for an unknown agent", async () => {
      const manager = await buildManagerWithAgent();
      await expect(manager.setSessionName("ghost", sessionId, "x")).rejects.toThrow(
        AgentNotFoundError,
      );
    });

    it("throws InvalidStateError before initialize()", async () => {
      await createAgentConfig("keeper", { name: "keeper", working_directory: workDir });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/keeper.yaml" }],
      });
      const manager = createTestManager(configPath);
      await expect(manager.setSessionName("keeper", sessionId, "x")).rejects.toThrow(
        InvalidStateError,
      );
    });
  });

  // ===========================================================================
  // invalidateSessions
  // ===========================================================================

  describe("invalidateSessions()", () => {
    const sessionA = "11111111-1111-1111-1111-111111111111";
    const sessionB = "22222222-2222-2222-2222-222222222222";

    /** Attribute a session to an agent via a job record so it surfaces. */
    async function attribute(sessionId: string, agent = "keeper") {
      const jobsDir = join(stateDir, "jobs");
      const job = await createJob(jobsDir, { agent, trigger_type: "manual", prompt: "x" });
      await updateJob(jobsDir, job.id, { session_id: sessionId });
    }

    it("forces a rebuild so a new session appears on the next getAgentSessions", async () => {
      const manager = await buildManagerWithAgent();

      await writeTranscript(workDir, sessionA);
      await attribute(sessionA);

      // Prime the discovery cache.
      const before = await manager.getAgentSessions("keeper");
      expect(before.map((s) => s.sessionId)).toEqual([sessionA]);

      // A NEW session transcript appears (plus its attribution).
      await writeTranscript(workDir, sessionB);
      await attribute(sessionB);

      // Force a refresh — the new session must now be listed.
      manager.invalidateSessions("keeper");
      const after = await manager.getAgentSessions("keeper");
      expect(after.map((s) => s.sessionId).sort()).toEqual([sessionA, sessionB]);
    });

    it("returns void (no Promise) and is a no-op when the agent has no working dir", async () => {
      // No working_directory configured for this agent.
      await createAgentConfig("rootless", { name: "rootless" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/rootless.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      expect(manager.invalidateSessions("rootless")).toBeUndefined();
    });

    it("throws AgentNotFoundError for an unknown agent", async () => {
      const manager = await buildManagerWithAgent();
      expect(() => manager.invalidateSessions("ghost")).toThrow(AgentNotFoundError);
    });

    it("throws InvalidStateError before initialize()", async () => {
      await createAgentConfig("keeper", { name: "keeper", working_directory: workDir });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/keeper.yaml" }],
      });
      const manager = createTestManager(configPath);
      expect(() => manager.invalidateSessions("keeper")).toThrow(InvalidStateError);
    });
  });
});
