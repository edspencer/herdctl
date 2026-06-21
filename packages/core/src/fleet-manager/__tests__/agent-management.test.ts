/**
 * Tests for programmatic agent management and convenience session access.
 *
 * Covers FleetManager.addAgent / removeAgent (in-memory agent registration
 * without yaml + reload) and getAgentSessions / getAgentSessionMessages
 * (cwd derived from the loaded agent config).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls during tests
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock the SessionDiscoveryService so we can assert the FleetManager derives
// the right (agentName, workingDirectory, dockerEnabled) inputs from config,
// without touching the real ~/.claude filesystem.
const mockGetAgentSessions = vi.fn();
const mockGetSessionMessages = vi.fn();
vi.mock("../../state/session-discovery.js", () => ({
  SessionDiscoveryService: class MockSessionDiscoveryService {
    getAgentSessions = mockGetAgentSessions;
    getSessionMessages = mockGetSessionMessages;
  },
}));

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentNotFoundError, ConfigurationError, InvalidStateError } from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("FleetManager programmatic agent management", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fleet-agent-mgmt-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    await mkdir(configDir, { recursive: true });
    mockGetAgentSessions.mockReset();
    mockGetSessionMessages.mockReset();
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

  function createTestManager(configPath: string, checkInterval = 10000) {
    return new FleetManager({
      configPath,
      stateDir,
      checkInterval,
      logger: silentLogger(),
    });
  }

  // ===========================================================================
  // addAgent
  // ===========================================================================

  describe("addAgent()", () => {
    it("registers an agent in memory and exposes it in fleet status", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      const info = await manager.addAgent({
        name: "keeper-foo",
        description: "Foo keeper",
        working_directory: "/abs/projects/foo",
        runtime: "cli",
      });

      expect(info.name).toBe("keeper-foo");
      expect(info.qualifiedName).toBe("keeper-foo");

      // Visible via the various status queries
      expect(manager.getAgents().map((a) => a.name)).toContain("keeper-foo");

      const status = await manager.getFleetStatus();
      expect(status.counts.totalAgents).toBe(1);

      const byName = await manager.getAgentInfoByName("keeper-foo");
      expect(byName.working_directory).toBe("/abs/projects/foo");
    });

    it("makes the agent immediately triggerable", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({
        name: "triggerable",
        working_directory: tempDir,
        max_turns: 3,
      });

      // trigger() resolves agent by name; it should not throw AgentNotFound.
      const result = await manager.trigger("triggerable");
      expect(result.agentName).toBe("triggerable");
    });

    it("emits config:reloaded with an added change", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      const handler = vi.fn();
      manager.on("config:reloaded", handler);

      await manager.addAgent({ name: "evented", working_directory: tempDir });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          agentCount: 1,
          agentNames: ["evented"],
          changes: [expect.objectContaining({ type: "added", category: "agent", name: "evented" })],
        }),
      );
    });

    it("merges fleet defaults into the added agent", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
        defaults: {
          model: "claude-default-model",
          permission_mode: "acceptEdits",
          allowed_tools: ["Read", "Write"],
        },
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({ name: "defaulted", working_directory: tempDir });

      const agent = manager.getAgents().find((a) => a.name === "defaulted");
      expect(agent?.model).toBe("claude-default-model");
      expect(agent?.permission_mode).toBe("acceptEdits");
      expect(agent?.allowed_tools).toEqual(["Read", "Write"]);
    });

    it("can skip defaults merge when mergeDefaults is false", async () => {
      const configPath = await createConfig({
        version: 1,
        agents: [],
        defaults: { model: "claude-default-model" },
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent(
        { name: "no-defaults", working_directory: tempDir },
        { mergeDefaults: false },
      );

      const agent = manager.getAgents().find((a) => a.name === "no-defaults");
      expect(agent?.model).toBeUndefined();
    });

    it("resolves a relative working_directory against the config dir", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({ name: "rel", working_directory: "projects/rel" });

      const info = await manager.getAgentInfoByName("rel");
      expect(info.working_directory).toBe(join(configDir, "projects/rel"));
    });

    it("resolves a relative working_directory against an explicit baseDir", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent(
        { name: "rel-base", working_directory: "child" },
        { baseDir: "/custom/base" },
      );

      const info = await manager.getAgentInfoByName("rel-base");
      expect(info.working_directory).toBe("/custom/base/child");
    });

    it("throws ConfigurationError on duplicate agent name", async () => {
      await createAgentConfig("existing", { name: "existing" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/existing.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(
        manager.addAgent({ name: "existing", working_directory: tempDir }),
      ).rejects.toThrow(ConfigurationError);
    });

    it("replaces an existing agent when replace is true", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({ name: "dup", description: "v1", working_directory: tempDir });
      const info = await manager.addAgent(
        { name: "dup", description: "v2", working_directory: tempDir },
        { replace: true },
      );

      expect(info.description).toBe("v2");
      expect(manager.getAgents().filter((a) => a.name === "dup")).toHaveLength(1);
    });

    it("throws ConfigurationError on invalid agent config", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(
        // Invalid: name contains a dot (violates AGENT_NAME_PATTERN)
        manager.addAgent({ name: "bad.name" } as { name: string }),
      ).rejects.toThrow(ConfigurationError);
    });

    it("throws InvalidStateError before initialize()", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);

      await expect(manager.addAgent({ name: "early", working_directory: tempDir })).rejects.toThrow(
        InvalidStateError,
      );
    });
  });

  // ===========================================================================
  // removeAgent
  // ===========================================================================

  describe("removeAgent()", () => {
    it("removes an agent and updates fleet status", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({ name: "temp-agent", working_directory: tempDir });
      expect((await manager.getFleetStatus()).counts.totalAgents).toBe(1);

      const removed = await manager.removeAgent("temp-agent");
      expect(removed).toBe(true);
      expect(manager.getAgents()).toHaveLength(0);
      expect((await manager.getFleetStatus()).counts.totalAgents).toBe(0);
    });

    it("emits config:reloaded with a removed change", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();
      await manager.addAgent({ name: "to-remove", working_directory: tempDir });

      const handler = vi.fn();
      manager.on("config:reloaded", handler);

      await manager.removeAgent("to-remove");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          agentCount: 0,
          changes: [
            expect.objectContaining({ type: "removed", category: "agent", name: "to-remove" }),
          ],
        }),
      );
    });

    it("returns false when the agent does not exist", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      expect(await manager.removeAgent("nope")).toBe(false);
    });

    it("removes a file-loaded agent by name", async () => {
      await createAgentConfig("from-file", { name: "from-file" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/from-file.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      expect(await manager.removeAgent("from-file")).toBe(true);
      expect(manager.getAgents()).toHaveLength(0);
    });

    it("throws InvalidStateError before initialize()", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);

      await expect(manager.removeAgent("x")).rejects.toThrow(InvalidStateError);
    });
  });

  // ===========================================================================
  // getAgentSessions / getAgentSessionMessages
  // ===========================================================================

  describe("getAgentSessions() / getAgentSessionMessages()", () => {
    it("derives working directory and docker mode from config", async () => {
      mockGetAgentSessions.mockResolvedValue([{ sessionId: "s1" }]);

      await createAgentConfig("sessioned", {
        name: "sessioned",
        working_directory: "/abs/projects/sessioned",
      });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/sessioned.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      const sessions = await manager.getAgentSessions("sessioned", { limit: 10 });

      expect(sessions).toEqual([{ sessionId: "s1" }]);
      expect(mockGetAgentSessions).toHaveBeenCalledWith(
        "sessioned",
        "/abs/projects/sessioned",
        false, // dockerEnabled
        { limit: 10 },
      );
    });

    it("passes dockerEnabled=true for docker agents", async () => {
      mockGetAgentSessions.mockResolvedValue([]);

      await createAgentConfig("dockerized", {
        name: "dockerized",
        working_directory: "/abs/projects/dockerized",
        docker: { enabled: true },
      });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/dockerized.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.getAgentSessions("dockerized");

      expect(mockGetAgentSessions).toHaveBeenCalledWith(
        "dockerized",
        "/abs/projects/dockerized",
        true,
        undefined,
      );
    });

    it("returns [] when the agent has no working directory", async () => {
      await createAgentConfig("no-wd", { name: "no-wd" });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/no-wd.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      // working_directory defaults to the agent config dir during file load, so
      // override to undefined to exercise the empty-dir branch.
      const agent = manager.getAgents().find((a) => a.name === "no-wd");
      if (agent) agent.working_directory = undefined;

      expect(await manager.getAgentSessions("no-wd")).toEqual([]);
      expect(mockGetAgentSessions).not.toHaveBeenCalled();
    });

    it("reads session messages for an agent", async () => {
      const messages = [{ role: "user", content: "hi", timestamp: "t" }];
      mockGetSessionMessages.mockResolvedValue(messages);

      await createAgentConfig("msg-agent", {
        name: "msg-agent",
        working_directory: "/abs/projects/msg",
      });
      const configPath = await createConfig({
        version: 1,
        agents: [{ path: "./agents/msg-agent.yaml" }],
      });
      const manager = createTestManager(configPath);
      await manager.initialize();

      const result = await manager.getAgentSessionMessages("msg-agent", "sess-123");

      expect(result).toEqual(messages);
      expect(mockGetSessionMessages).toHaveBeenCalledWith("/abs/projects/msg", "sess-123", {
        dockerEnabled: false,
      });
    });

    it("throws AgentNotFoundError for an unknown agent", async () => {
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await expect(manager.getAgentSessions("ghost")).rejects.toThrow(AgentNotFoundError);
      await expect(manager.getAgentSessionMessages("ghost", "x")).rejects.toThrow(
        AgentNotFoundError,
      );
    });

    it("throws InvalidStateError (not AgentNotFoundError) before initialize()", async () => {
      // Regression for CodeRabbit fix: a pre-init call must surface the real
      // cause (uninitialized) rather than masquerading as a missing agent.
      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);

      await expect(manager.getAgentSessions("anything")).rejects.toThrow(InvalidStateError);
      await expect(manager.getAgentSessions("anything")).rejects.not.toThrow(AgentNotFoundError);
      await expect(manager.getAgentSessionMessages("anything", "x")).rejects.toThrow(
        InvalidStateError,
      );
    });

    it("works for a programmatically added agent", async () => {
      mockGetAgentSessions.mockResolvedValue([{ sessionId: "prog" }]);

      const configPath = await createConfig({ version: 1, agents: [] });
      const manager = createTestManager(configPath);
      await manager.initialize();

      await manager.addAgent({
        name: "prog-agent",
        working_directory: "/abs/projects/prog",
      });

      const sessions = await manager.getAgentSessions("prog-agent");
      expect(sessions).toEqual([{ sessionId: "prog" }]);
      expect(mockGetAgentSessions).toHaveBeenCalledWith(
        "prog-agent",
        "/abs/projects/prog",
        false,
        undefined,
      );
    });
  });
});
