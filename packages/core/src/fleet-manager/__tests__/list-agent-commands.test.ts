/**
 * Tests for FleetManager.listAgentCommands(agentName, opts?):
 *   - opens a streaming session, reads its slash-command list, and ALWAYS
 *     closes the session (even when listCommands() throws).
 *
 * The Claude SDK's `query` is mocked to return a fake Query whose
 * `supportedCommands()` and `return()` we control, so no real `claude`
 * subprocess is spawned. `openChatSession` (which `listAgentCommands` delegates
 * to) builds its own `SDKRuntime` and calls `query()` internally; asserting that
 * the fake Query's `return()` was invoked proves the session was torn down.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Claude SDK to prevent real API calls / subprocess spawns.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AgentNotFoundError,
  InvalidStateError,
  StreamingSessionUnsupportedError,
} from "../errors.js";
import { FleetManager } from "../fleet-manager.js";

const silentLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const SAMPLE_COMMANDS = [
  { name: "compact", description: "Compact the conversation", argumentHint: "" },
  { name: "review", description: "Review a pull request", argumentHint: "<pr>" },
];

/**
 * Build a fake SDK Query. `supportedCommands` resolves to the given commands
 * (or rejects if `commandsError` is supplied); `return` records that the
 * session was closed. Only the members `openSession()` touches are provided.
 */
function fakeQuery(opts: { commands?: typeof SAMPLE_COMMANDS; commandsError?: Error }) {
  const returnSpy = vi.fn().mockResolvedValue(undefined);
  const supportedCommands = opts.commandsError
    ? vi.fn().mockRejectedValue(opts.commandsError)
    : vi.fn().mockResolvedValue(opts.commands ?? SAMPLE_COMMANDS);
  const q = {
    // Iterating is never triggered by listAgentCommands, but the shape needs an
    // async-iterator to satisfy the structural cast in openSession().
    [Symbol.asyncIterator]: async function* () {},
    supportedCommands,
    interrupt: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    return: returnSpy,
  };
  return { q, returnSpy, supportedCommands };
}

describe("FleetManager.listAgentCommands()", () => {
  let tempDir: string;
  let configDir: string;
  let stateDir: string;
  let workDir: string;

  beforeEach(async () => {
    vi.mocked(query).mockReset();
    tempDir = await mkdtemp(join(tmpdir(), "fleet-list-cmds-test-"));
    configDir = join(tempDir, "config");
    stateDir = join(tempDir, ".herdctl");
    workDir = join(tempDir, "workspace");
    await mkdir(configDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
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

  it("returns the full SlashCommand[] reported by the session", async () => {
    const manager = await buildManagerWithAgent();
    const { q, returnSpy } = fakeQuery({ commands: SAMPLE_COMMANDS });
    vi.mocked(query).mockReturnValue(q as never);

    const commands = await manager.listAgentCommands("keeper");

    expect(commands).toEqual(SAMPLE_COMMANDS);
    // Session must be closed after a successful listing.
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it("closes the session even when listCommands() throws", async () => {
    const manager = await buildManagerWithAgent();
    const boom = new Error("supportedCommands failed");
    const { q, returnSpy } = fakeQuery({ commandsError: boom });
    vi.mocked(query).mockReturnValue(q as never);

    await expect(manager.listAgentCommands("keeper")).rejects.toThrow("supportedCommands failed");
    // finally{} must have torn down the subprocess despite the throw.
    expect(returnSpy).toHaveBeenCalledTimes(1);
  });

  it("throws AgentNotFoundError for an unknown agent (no session opened)", async () => {
    const manager = await buildManagerWithAgent();

    await expect(manager.listAgentCommands("ghost")).rejects.toThrow(AgentNotFoundError);
    // We never got as far as opening a session.
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  it("throws InvalidStateError before initialize()", async () => {
    await createAgentConfig("keeper", { name: "keeper", working_directory: workDir });
    const configPath = await createConfig({
      version: 1,
      agents: [{ path: "./agents/keeper.yaml" }],
    });
    const manager = createTestManager(configPath);
    // not initialized
    await expect(manager.listAgentCommands("keeper")).rejects.toThrow(InvalidStateError);
  });

  it("surfaces StreamingSessionUnsupportedError for Docker-wrapped agents", async () => {
    const manager = await buildManagerWithAgent({ docker: { enabled: true } });

    await expect(manager.listAgentCommands("keeper")).rejects.toThrow(
      StreamingSessionUnsupportedError,
    );
    // Docker path throws before any subprocess is spawned.
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });
});
