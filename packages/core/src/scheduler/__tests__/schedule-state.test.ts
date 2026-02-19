import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getScheduleState,
  updateScheduleState,
  getAgentScheduleStates,
  type ScheduleStateLogger,
} from "../schedule-state.js";
import {
  createDefaultScheduleState,
  type ScheduleState,
  type FleetState,
} from "../../state/schemas/fleet-state.js";
import { writeFleetState, readFleetState } from "../../state/fleet-state.js";

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-schedule-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  // Resolve to real path to handle macOS /var -> /private/var symlink
  return await realpath(baseDir);
}

// Helper to create a mock logger
function createMockLogger(): ScheduleStateLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    warnings,
    warn: (message: string) => warnings.push(message),
  };
}

describe("getScheduleState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("existing schedule state", () => {
    it("returns schedule state for existing agent and schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: "2024-01-15T10:00:00Z",
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "my-agent", "hourly");

      expect(state.last_run_at).toBe("2024-01-15T10:00:00Z");
      expect(state.next_run_at).toBe("2024-01-15T11:00:00Z");
      expect(state.status).toBe("idle");
      expect(state.last_error).toBeNull();
    });

    it("returns schedule state with running status", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "running",
            schedules: {
              daily: {
                last_run_at: "2024-01-14T00:00:00Z",
                next_run_at: null,
                status: "running",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "my-agent", "daily");

      expect(state.status).toBe("running");
      expect(state.next_run_at).toBeNull();
    });

    it("returns schedule state with disabled status", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              weekly: {
                last_run_at: "2024-01-08T00:00:00Z",
                next_run_at: null,
                status: "disabled",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "my-agent", "weekly");

      expect(state.status).toBe("disabled");
    });

    it("returns schedule state with error information", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "error",
            schedules: {
              hourly: {
                last_run_at: "2024-01-15T10:00:00Z",
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: "Container exited with code 1",
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "my-agent", "hourly");

      expect(state.last_error).toBe("Container exited with code 1");
    });
  });

  describe("missing state handling", () => {
    it("returns default state when agent does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {},
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "non-existent", "hourly");

      expect(state).toEqual(createDefaultScheduleState());
    });

    it("returns default state when schedule does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: null,
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const state = await getScheduleState(tempDir, "my-agent", "non-existent");

      expect(state).toEqual(createDefaultScheduleState());
    });

    it("returns default state when agent has no schedules map", async () => {
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

      const state = await getScheduleState(tempDir, "my-agent", "hourly");

      expect(state).toEqual(createDefaultScheduleState());
    });

    it("returns default state when state file does not exist", async () => {
      const state = await getScheduleState(tempDir, "my-agent", "hourly");

      expect(state).toEqual(createDefaultScheduleState());
    });
  });
});

describe("updateScheduleState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("updating existing schedules", () => {
    it("updates single field of existing schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: "2024-01-15T10:00:00Z",
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
      });

      expect(updated.status).toBe("running");
      expect(updated.last_run_at).toBe("2024-01-15T10:00:00Z");
      expect(updated.next_run_at).toBe("2024-01-15T11:00:00Z");
    });

    it("updates multiple fields of existing schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
        last_run_at: "2024-01-15T11:00:00Z",
        next_run_at: null,
      });

      expect(updated.status).toBe("running");
      expect(updated.last_run_at).toBe("2024-01-15T11:00:00Z");
      expect(updated.next_run_at).toBeNull();
    });

    it("can set fields to null", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: "2024-01-15T10:00:00Z",
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: "Previous error",
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        last_error: null,
      });

      expect(updated.last_error).toBeNull();
      expect(updated.last_run_at).toBe("2024-01-15T10:00:00Z");
    });

    it("preserves other schedules when updating one", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
              daily: {
                last_run_at: "2024-01-14T00:00:00Z",
                next_run_at: "2024-01-15T00:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
      });

      const fleetState = await readFleetState(stateFile);
      expect(fleetState.agents["my-agent"].schedules?.daily).toEqual({
        last_run_at: "2024-01-14T00:00:00Z",
        next_run_at: "2024-01-15T00:00:00Z",
        status: "idle",
        last_error: null,
      });
    });

    it("preserves other agents when updating one agent's schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "agent-1": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: null,
                status: "idle",
                last_error: null,
              },
            },
          },
          "agent-2": {
            status: "running",
            current_job: "job-100",
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      await updateScheduleState(tempDir, "agent-1", "hourly", {
        status: "running",
      });

      const fleetState = await readFleetState(stateFile);
      expect(fleetState.agents["agent-2"]).toEqual({
        status: "running",
        current_job: "job-100",
      });
    });

    it("preserves fleet metadata when updating schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: { started_at: "2024-01-15T00:00:00Z" },
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: null,
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
      });

      const fleetState = await readFleetState(stateFile);
      expect(fleetState.fleet.started_at).toBe("2024-01-15T00:00:00Z");
    });
  });

  describe("creating new schedules", () => {
    it("creates new schedule if it does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {},
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
        last_run_at: "2024-01-15T10:00:00Z",
      });

      expect(updated.status).toBe("running");
      expect(updated.last_run_at).toBe("2024-01-15T10:00:00Z");
      expect(updated.next_run_at).toBeNull();
      expect(updated.last_error).toBeNull();
    });

    it("creates schedules map if agent has none", async () => {
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

      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
      });

      expect(updated.status).toBe("running");

      const fleetState = await readFleetState(stateFile);
      expect(fleetState.agents["my-agent"].schedules).toBeDefined();
      expect(fleetState.agents["my-agent"].schedules?.hourly).toBeDefined();
    });

    it("creates agent if it does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {},
      };
      await writeFleetState(stateFile, initialState);

      const updated = await updateScheduleState(tempDir, "new-agent", "hourly", {
        status: "running",
      });

      expect(updated.status).toBe("running");

      const fleetState = await readFleetState(stateFile);
      expect(fleetState.agents["new-agent"]).toBeDefined();
      expect(fleetState.agents["new-agent"].status).toBe("idle");
      expect(fleetState.agents["new-agent"].schedules?.hourly).toBeDefined();
    });

    it("creates state file if it does not exist", async () => {
      const updated = await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
        next_run_at: "2024-01-15T11:00:00Z",
      });

      expect(updated.status).toBe("running");
      expect(updated.next_run_at).toBe("2024-01-15T11:00:00Z");

      const fleetState = await readFleetState(join(tempDir, "state.yaml"));
      expect(fleetState.agents["my-agent"].schedules?.hourly).toBeDefined();
    });
  });

  describe("persistence", () => {
    it("persists updates to file", async () => {
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

      await updateScheduleState(tempDir, "my-agent", "hourly", {
        status: "running",
        last_run_at: "2024-01-15T10:00:00Z",
      });

      // Read from file directly to verify persistence
      const content = await readFile(stateFile, "utf-8");
      expect(content).toContain("hourly:");
      expect(content).toContain("status: running");
      expect(content).toContain("last_run_at:");
    });
  });
});

describe("getAgentScheduleStates", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("existing schedules", () => {
    it("returns all schedules for an agent", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: "2024-01-15T10:00:00Z",
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
              daily: {
                last_run_at: "2024-01-14T00:00:00Z",
                next_run_at: "2024-01-15T00:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const schedules = await getAgentScheduleStates(tempDir, "my-agent");

      expect(Object.keys(schedules)).toHaveLength(2);
      expect(schedules.hourly).toBeDefined();
      expect(schedules.daily).toBeDefined();
      expect(schedules.hourly.last_run_at).toBe("2024-01-15T10:00:00Z");
      expect(schedules.daily.last_run_at).toBe("2024-01-14T00:00:00Z");
    });

    it("returns single schedule for agent with one schedule", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {
              hourly: {
                last_run_at: null,
                next_run_at: "2024-01-15T11:00:00Z",
                status: "idle",
                last_error: null,
              },
            },
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const schedules = await getAgentScheduleStates(tempDir, "my-agent");

      expect(Object.keys(schedules)).toHaveLength(1);
      expect(schedules.hourly).toBeDefined();
    });
  });

  describe("missing state handling", () => {
    it("returns empty object when agent does not exist", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {},
      };
      await writeFleetState(stateFile, initialState);

      const schedules = await getAgentScheduleStates(tempDir, "non-existent");

      expect(schedules).toEqual({});
    });

    it("returns empty object when agent has no schedules map", async () => {
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

      const schedules = await getAgentScheduleStates(tempDir, "my-agent");

      expect(schedules).toEqual({});
    });

    it("returns empty object when state file does not exist", async () => {
      const schedules = await getAgentScheduleStates(tempDir, "my-agent");

      expect(schedules).toEqual({});
    });

    it("returns empty object when schedules map is empty", async () => {
      const stateFile = join(tempDir, "state.yaml");
      const initialState: FleetState = {
        fleet: {},
        agents: {
          "my-agent": {
            status: "idle",
            schedules: {},
          },
        },
      };
      await writeFleetState(stateFile, initialState);

      const schedules = await getAgentScheduleStates(tempDir, "my-agent");

      expect(schedules).toEqual({});
    });
  });
});

describe("createDefaultScheduleState", () => {
  it("returns correct default values", () => {
    const state = createDefaultScheduleState();

    expect(state.last_run_at).toBeNull();
    expect(state.next_run_at).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.last_error).toBeNull();
  });
});
