import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readFleetState,
  writeFleetState,
  updateAgentState,
  initializeFleetState,
  removeAgentState,
  type StateLogger,
} from "../fleet-state.js";
import {
  createInitialFleetState,
  type FleetState,
  type AgentState,
} from "../schemas/fleet-state.js";
import { StateFileError } from "../errors.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-fleet-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): StateLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (message: string) => warnings.push(message),
  };
}

describe("readFleetState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("valid state files", () => {
    it("reads and validates state.yaml with full fleet state", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const stateContent = `
fleet:
  started_at: "2024-01-15T10:30:00Z"
agents:
  my-agent:
    status: running
    current_job: job-123
    last_job: job-122
    next_schedule: hourly
    next_trigger_at: "2024-01-15T11:00:00Z"
    container_id: abc123
  other-agent:
    status: idle
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.fleet.started_at).toBe("2024-01-15T10:30:00Z");
      expect(state.agents["my-agent"]).toEqual({
        status: "running",
        current_job: "job-123",
        last_job: "job-122",
        next_schedule: "hourly",
        next_trigger_at: "2024-01-15T11:00:00Z",
        container_id: "abc123",
      });
      expect(state.agents["other-agent"]).toEqual({
        status: "idle",
      });
    });

    it("reads state with agent error status", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const stateContent = `
fleet:
  started_at: "2024-01-15T10:30:00Z"
agents:
  failed-agent:
    status: error
    last_job: job-100
    error_message: "Container exited with code 1"
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.agents["failed-agent"]).toEqual({
        status: "error",
        last_job: "job-100",
        error_message: "Container exited with code 1",
      });
    });

    it("applies default values for missing optional fields", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const stateContent = `
agents:
  minimal-agent:
    status: idle
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.fleet).toEqual({});
      expect(state.agents["minimal-agent"]).toEqual({
        status: "idle",
      });
    });

    it("handles empty agents map", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const stateContent = `
fleet:
  started_at: "2024-01-15T10:30:00Z"
agents: {}
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.fleet.started_at).toBe("2024-01-15T10:30:00Z");
      expect(state.agents).toEqual({});
    });
  });

  describe("missing file handling", () => {
    it("returns default empty state when file does not exist", async () => {
      const stateFile = join(tempDir, "nonexistent.yaml");

      const state = await readFleetState(stateFile);

      expect(state).toEqual(createInitialFleetState());
      expect(state.fleet).toEqual({});
      expect(state.agents).toEqual({});
    });

    it("does not log warning for missing file", async () => {
      const stateFile = join(tempDir, "nonexistent.yaml");
      const logger = createMockLogger();

      await readFleetState(stateFile, { logger });

      expect(logger.warnings).toHaveLength(0);
    });
  });

  describe("empty file handling", () => {
    it("returns default state for empty file", async () => {
      const stateFile = join(tempDir, "empty.yaml");
      await writeFile(stateFile, "", "utf-8");

      const state = await readFleetState(stateFile);

      expect(state).toEqual(createInitialFleetState());
    });

    it("returns default state for file with only whitespace", async () => {
      const stateFile = join(tempDir, "whitespace.yaml");
      await writeFile(stateFile, "   \n  \n   ", "utf-8");

      const state = await readFleetState(stateFile);

      expect(state).toEqual(createInitialFleetState());
    });

    it("returns default state for file with only comments", async () => {
      const stateFile = join(tempDir, "comments.yaml");
      await writeFile(stateFile, "# This is a comment\n", "utf-8");

      const state = await readFleetState(stateFile);

      expect(state).toEqual(createInitialFleetState());
    });
  });

  describe("corrupted file handling", () => {
    it("returns default state and logs warning for invalid YAML syntax", async () => {
      const stateFile = join(tempDir, "invalid-syntax.yaml");
      await writeFile(stateFile, "fleet: [unclosed", "utf-8");
      const logger = createMockLogger();

      const state = await readFleetState(stateFile, { logger });

      expect(state).toEqual(createInitialFleetState());
      expect(logger.warnings).toHaveLength(1);
      // YAML parse errors come through as read errors
      expect(logger.warnings[0]).toContain("Using default state");
    });

    it("returns default state and logs warning for invalid status enum", async () => {
      const stateFile = join(tempDir, "invalid-status.yaml");
      const stateContent = `
agents:
  bad-agent:
    status: invalid_status
`;
      await writeFile(stateFile, stateContent, "utf-8");
      const logger = createMockLogger();

      const state = await readFleetState(stateFile, { logger });

      expect(state).toEqual(createInitialFleetState());
      expect(logger.warnings).toHaveLength(1);
      expect(logger.warnings[0]).toContain("Corrupted state file");
    });

    it("returns default state and logs warning for wrong type structure", async () => {
      const stateFile = join(tempDir, "wrong-type.yaml");
      const stateContent = `
agents: "not an object"
`;
      await writeFile(stateFile, stateContent, "utf-8");
      const logger = createMockLogger();

      const state = await readFleetState(stateFile, { logger });

      expect(state).toEqual(createInitialFleetState());
      expect(logger.warnings).toHaveLength(1);
    });

    it("uses default console.warn when no logger provided", async () => {
      const stateFile = join(tempDir, "invalid.yaml");
      await writeFile(stateFile, "fleet: [unclosed", "utf-8");
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const state = await readFleetState(stateFile);

      expect(state).toEqual(createInitialFleetState());
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("FleetState type validation", () => {
    it("validates all AgentStatus enum values", async () => {
      const stateFile = join(tempDir, "all-statuses.yaml");
      const stateContent = `
agents:
  idle-agent:
    status: idle
  running-agent:
    status: running
  error-agent:
    status: error
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.agents["idle-agent"].status).toBe("idle");
      expect(state.agents["running-agent"].status).toBe("running");
      expect(state.agents["error-agent"].status).toBe("error");
    });

    it("allows nullable fields to be null", async () => {
      const stateFile = join(tempDir, "nullable.yaml");
      const stateContent = `
agents:
  agent-with-nulls:
    status: idle
    current_job: null
    last_job: null
    next_schedule: null
    next_trigger_at: null
    container_id: null
    error_message: null
`;
      await writeFile(stateFile, stateContent, "utf-8");

      const state = await readFleetState(stateFile);

      expect(state.agents["agent-with-nulls"].current_job).toBeNull();
      expect(state.agents["agent-with-nulls"].last_job).toBeNull();
      expect(state.agents["agent-with-nulls"].error_message).toBeNull();
    });
  });
});

describe("writeFleetState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("successful writes", () => {
    it("writes valid fleet state to file", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const state: FleetState = {
        fleet: {
          started_at: "2024-01-15T10:30:00Z",
        },
        agents: {
          "my-agent": {
            status: "running",
            current_job: "job-123",
          },
        },
      };

      await writeFleetState(stateFile, state);

      const content = await readFile(stateFile, "utf-8");
      expect(content).toContain("started_at:");
      expect(content).toContain("my-agent:");
      expect(content).toContain("status: running");
      expect(content).toContain("current_job: job-123");
    });

    it("writes empty state correctly", async () => {
      const stateFile = join(tempDir, "empty-state.yaml");
      const state = createInitialFleetState();

      await writeFleetState(stateFile, state);

      const readState = await readFleetState(stateFile);
      expect(readState).toEqual(state);
    });

    it("overwrites existing file", async () => {
      const stateFile = join(tempDir, "overwrite.yaml");
      await writeFile(stateFile, "old: content\n", "utf-8");
      const state: FleetState = {
        fleet: { started_at: "2024-01-15T10:30:00Z" },
        agents: {},
      };

      await writeFleetState(stateFile, state);

      const content = await readFile(stateFile, "utf-8");
      expect(content).not.toContain("old:");
      expect(content).toContain("started_at:");
    });

    it("preserves custom indent option", async () => {
      const stateFile = join(tempDir, "custom-indent.yaml");
      const state: FleetState = {
        fleet: {},
        agents: {
          agent: { status: "idle" },
        },
      };

      await writeFleetState(stateFile, state, { indent: 4 });

      const content = await readFile(stateFile, "utf-8");
      // Check for 4-space indentation
      expect(content).toMatch(/^\s{4}agent:/m);
    });

    it("round-trips complex state correctly", async () => {
      const stateFile = join(tempDir, "roundtrip.yaml");
      const originalState: FleetState = {
        fleet: {
          started_at: "2024-01-15T10:30:00Z",
        },
        agents: {
          "agent-1": {
            status: "running",
            current_job: "job-123",
            last_job: "job-122",
            next_schedule: "hourly",
            next_trigger_at: "2024-01-15T11:00:00Z",
            container_id: "container-abc",
          },
          "agent-2": {
            status: "error",
            last_job: "job-456",
            error_message: "Out of memory",
          },
          "agent-3": {
            status: "idle",
          },
        },
      };

      await writeFleetState(stateFile, originalState);
      const readState = await readFleetState(stateFile);

      expect(readState.fleet.started_at).toBe(originalState.fleet.started_at);
      expect(readState.agents["agent-1"]).toEqual(originalState.agents["agent-1"]);
      expect(readState.agents["agent-2"]).toEqual(originalState.agents["agent-2"]);
      expect(readState.agents["agent-3"]).toEqual(originalState.agents["agent-3"]);
    });
  });

  describe("atomic write behavior", () => {
    it("writes atomically (no partial writes)", async () => {
      const stateFile = join(tempDir, "atomic.yaml");
      const state: FleetState = {
        fleet: { started_at: "2024-01-15T10:30:00Z" },
        agents: {
          agent: {
            status: "running",
            current_job: "job-1",
          },
        },
      };

      await writeFleetState(stateFile, state);

      // File should be complete and valid
      const readState = await readFleetState(stateFile);
      expect(readState.fleet.started_at).toBe("2024-01-15T10:30:00Z");
    });

    it("does not leave temp files on success", async () => {
      const stateFile = join(tempDir, "no-temp.yaml");
      const state = createInitialFleetState();

      await writeFleetState(stateFile, state);

      // Check no temp files exist
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(tempDir);
      const tempFiles = files.filter((f) => f.includes(".tmp."));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("throws StateFileError when write fails", async () => {
      // Try to write to a non-existent directory
      const stateFile = join(tempDir, "nonexistent-dir", "state.yaml");
      const state = createInitialFleetState();

      await expect(writeFleetState(stateFile, state)).rejects.toThrow(StateFileError);
    });

    it("validates state before writing", async () => {
      const stateFile = join(tempDir, "validate.yaml");
      const invalidState = {
        fleet: {},
        agents: {
          agent: {
            status: "invalid_status", // Invalid status
          },
        },
      } as unknown as FleetState;

      await expect(writeFleetState(stateFile, invalidState)).rejects.toThrow();
    });
  });
});

describe("updateAgentState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("updating existing agents", () => {
    it("updates single field of existing agent", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: { started_at: "2024-01-15T10:30:00Z" },
        agents: {
          "my-agent": {
            status: "idle",
            last_job: "job-100",
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "my-agent", {
        status: "running",
      });

      expect(updatedState.agents["my-agent"].status).toBe("running");
      expect(updatedState.agents["my-agent"].last_job).toBe("job-100");
    });

    it("updates multiple fields of existing agent", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "my-agent", {
        status: "running",
        current_job: "job-200",
        container_id: "container-xyz",
      });

      expect(updatedState.agents["my-agent"]).toEqual({
        status: "running",
        current_job: "job-200",
        container_id: "container-xyz",
      });
    });

    it("can set fields to null", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "error",
            error_message: "Some error",
            current_job: "job-100",
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "my-agent", {
        status: "idle",
        error_message: null,
        current_job: null,
      });

      expect(updatedState.agents["my-agent"].status).toBe("idle");
      expect(updatedState.agents["my-agent"].error_message).toBeNull();
      expect(updatedState.agents["my-agent"].current_job).toBeNull();
    });

    it("preserves other agents when updating one", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "agent-1": { status: "idle" },
          "agent-2": { status: "running", current_job: "job-100" },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "agent-1", {
        status: "running",
      });

      expect(updatedState.agents["agent-1"].status).toBe("running");
      expect(updatedState.agents["agent-2"]).toEqual({
        status: "running",
        current_job: "job-100",
      });
    });

    it("preserves fleet metadata when updating agent", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: { started_at: "2024-01-15T10:30:00Z" },
        agents: {
          "my-agent": { status: "idle" },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "my-agent", {
        status: "running",
      });

      expect(updatedState.fleet.started_at).toBe("2024-01-15T10:30:00Z");
    });
  });

  describe("creating new agents", () => {
    it("creates new agent if it does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {},
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "new-agent", {
        status: "running",
        current_job: "job-1",
      });

      expect(updatedState.agents["new-agent"]).toEqual({
        status: "running",
        current_job: "job-1",
      });
    });

    it("creates new agent with default status if not provided", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {},
      };
      await writeFleetState(stateFile, initialState);

      const updatedState = await updateAgentState(stateFile, "new-agent", {
        last_job: "job-1",
      });

      expect(updatedState.agents["new-agent"].status).toBe("idle");
      expect(updatedState.agents["new-agent"].last_job).toBe("job-1");
    });

    it("creates agent in file that does not exist", async () => {
      const stateFile = join(tempDir, "new-state.yaml");

      const updatedState = await updateAgentState(stateFile, "new-agent", {
        status: "running",
      });

      expect(updatedState.agents["new-agent"].status).toBe("running");

      // Verify it was persisted
      const readState = await readFleetState(stateFile);
      expect(readState.agents["new-agent"].status).toBe("running");
    });
  });

  describe("file operations", () => {
    it("writes changes back to file", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": { status: "idle" },
        },
      };
      await writeFleetState(stateFile, initialState);

      await updateAgentState(stateFile, "my-agent", { status: "running" });

      // Read from file directly to verify persistence
      const persistedState = await readFleetState(stateFile);
      expect(persistedState.agents["my-agent"].status).toBe("running");
    });

    it("handles corrupted file by starting fresh", async () => {
      const stateFile = join(tempDir, "corrupted.yaml");
      await writeFile(stateFile, "invalid: [yaml", "utf-8");
      const logger = createMockLogger();

      const updatedState = await updateAgentState(
        stateFile,
        "new-agent",
        { status: "running" },
        { logger },
      );

      expect(updatedState.agents["new-agent"].status).toBe("running");
      expect(logger.warnings).toHaveLength(1);
    });
  });
});

describe("initializeFleetState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sets started_at if not already set", async () => {
    const stateFile = join(tempDir, "state.yaml");

    const state = await initializeFleetState(stateFile);

    expect(state.fleet.started_at).toBeDefined();
    expect(new Date(state.fleet.started_at!).getTime()).toBeGreaterThan(0);
  });

  it("does not overwrite existing started_at", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const originalTimestamp = "2024-01-01T00:00:00Z";
    const initialState: FleetState = {
      fleet: { started_at: originalTimestamp },
      agents: {},
    };
    await writeFleetState(stateFile, initialState);

    const state = await initializeFleetState(stateFile);

    expect(state.fleet.started_at).toBe(originalTimestamp);
  });

  it("creates file if it does not exist", async () => {
    const stateFile = join(tempDir, "new-state.yaml");

    const state = await initializeFleetState(stateFile);

    expect(state.fleet.started_at).toBeDefined();

    // Verify file was created
    const persistedState = await readFleetState(stateFile);
    expect(persistedState.fleet.started_at).toBe(state.fleet.started_at);
  });

  it("preserves existing agents", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const initialState: FleetState = {
      fleet: {},
      agents: {
        "existing-agent": { status: "idle" },
      },
    };
    await writeFleetState(stateFile, initialState);

    const state = await initializeFleetState(stateFile);

    expect(state.agents["existing-agent"]).toEqual({ status: "idle" });
    expect(state.fleet.started_at).toBeDefined();
  });
});

describe("removeAgentState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes specified agent from state", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const initialState: FleetState = {
      fleet: {},
      agents: {
        "agent-1": { status: "idle" },
        "agent-2": { status: "running" },
      },
    };
    await writeFleetState(stateFile, initialState);

    const updatedState = await removeAgentState(stateFile, "agent-1");

    expect(updatedState.agents["agent-1"]).toBeUndefined();
    expect(updatedState.agents["agent-2"]).toEqual({ status: "running" });
  });

  it("persists removal to file", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const initialState: FleetState = {
      fleet: {},
      agents: {
        "agent-to-remove": { status: "idle" },
      },
    };
    await writeFleetState(stateFile, initialState);

    await removeAgentState(stateFile, "agent-to-remove");

    const persistedState = await readFleetState(stateFile);
    expect(persistedState.agents["agent-to-remove"]).toBeUndefined();
  });

  it("handles removal of non-existent agent gracefully", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const initialState: FleetState = {
      fleet: {},
      agents: {
        "existing-agent": { status: "idle" },
      },
    };
    await writeFleetState(stateFile, initialState);

    const updatedState = await removeAgentState(stateFile, "non-existent");

    expect(updatedState.agents["existing-agent"]).toEqual({ status: "idle" });
    expect(Object.keys(updatedState.agents)).toHaveLength(1);
  });

  it("preserves fleet metadata when removing agent", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const initialState: FleetState = {
      fleet: { started_at: "2024-01-15T10:30:00Z" },
      agents: {
        "agent-to-remove": { status: "idle" },
      },
    };
    await writeFleetState(stateFile, initialState);

    const updatedState = await removeAgentState(stateFile, "agent-to-remove");

    expect(updatedState.fleet.started_at).toBe("2024-01-15T10:30:00Z");
  });
});

describe("concurrent operations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles multiple concurrent reads", async () => {
    const stateFile = join(tempDir, "state.yaml");
    const state: FleetState = {
      fleet: { started_at: "2024-01-15T10:30:00Z" },
      agents: {
        agent: { status: "running" },
      },
    };
    await writeFleetState(stateFile, state);

    const reads = [];
    for (let i = 0; i < 50; i++) {
      reads.push(readFleetState(stateFile));
    }

    const results = await Promise.all(reads);

    for (const result of results) {
      expect(result.fleet.started_at).toBe("2024-01-15T10:30:00Z");
      expect(result.agents.agent.status).toBe("running");
    }
  });

  it("handles sequential updates correctly", async () => {
    const stateFile = join(tempDir, "state.yaml");
    await writeFleetState(stateFile, createInitialFleetState());

    // Sequential updates (not concurrent to avoid race conditions)
    for (let i = 0; i < 10; i++) {
      await updateAgentState(stateFile, `agent-${i}`, {
        status: "running",
        current_job: `job-${i}`,
      });
    }

    const finalState = await readFleetState(stateFile);

    expect(Object.keys(finalState.agents)).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(finalState.agents[`agent-${i}`].status).toBe("running");
      expect(finalState.agents[`agent-${i}`].current_job).toBe(`job-${i}`);
    }
  });
});
