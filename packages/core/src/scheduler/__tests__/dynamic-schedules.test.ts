import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import {
  createDynamicSchedule,
  type DynamicScheduleFile,
  type DynamicScheduleOptions,
  deleteDynamicSchedule,
  getDynamicScheduleFilePath,
  getDynamicSchedulesDir,
  listDynamicSchedules,
  loadAllDynamicSchedules,
  MinIntervalViolationError,
  readDynamicSchedules,
  ScheduleLimitExceededError,
  ScheduleNameConflictError,
  updateDynamicSchedule,
} from "../dynamic-schedules.js";

async function createTempDir(): Promise<string> {
  const baseDir = join(
    tmpdir(),
    `herdctl-dynamic-schedules-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(baseDir, { recursive: true });
  return await realpath(baseDir);
}

const defaultOptions: DynamicScheduleOptions = {
  maxSchedules: 10,
  minInterval: "5m",
  staticScheduleNames: [],
};

describe("dynamic-schedules", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(stateDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  describe("getDynamicSchedulesDir", () => {
    it("returns dynamic-schedules subdir of stateDir", () => {
      expect(getDynamicSchedulesDir("/foo/.herdctl")).toBe("/foo/.herdctl/dynamic-schedules");
    });
  });

  describe("getDynamicScheduleFilePath", () => {
    it("returns yaml file for valid agent name", () => {
      expect(getDynamicScheduleFilePath("/foo/.herdctl", "vector")).toBe(
        "/foo/.herdctl/dynamic-schedules/vector.yaml",
      );
    });

    it("rejects agent names with path traversal", () => {
      expect(() => getDynamicScheduleFilePath("/foo/.herdctl", "../evil")).toThrow(
        "Invalid agent name",
      );
    });

    it("allows dotted qualified names (e.g., fleet.agent)", () => {
      const result = getDynamicScheduleFilePath("/foo/.herdctl", "fleet.agent");
      expect(result).toContain("fleet.agent.yaml");
    });

    it("rejects double-dot sequences to prevent path traversal", () => {
      expect(() => getDynamicScheduleFilePath("/foo/.herdctl", "agent..name")).toThrow(
        "Invalid agent name",
      );
      expect(() => getDynamicScheduleFilePath("/foo/.herdctl", "..agent")).toThrow(
        "Invalid agent name",
      );
    });
  });

  // ===========================================================================
  // Read / Write
  // ===========================================================================

  describe("readDynamicSchedules", () => {
    it("returns empty schedules when file does not exist", async () => {
      const result = await readDynamicSchedules(stateDir, "vector");
      expect(result).toEqual({ version: 1, schedules: {} });
    });

    it("reads existing schedule file", async () => {
      const dir = getDynamicSchedulesDir(stateDir);
      await mkdir(dir, { recursive: true });
      const data: DynamicScheduleFile = {
        version: 1,
        schedules: {
          "test-schedule": {
            type: "cron",
            cron: "0 9 * * *",
            prompt: "Do something",
            enabled: true,
            created_at: "2026-03-01T00:00:00.000Z",
          },
        },
      };
      await writeFile(join(dir, "vector.yaml"), stringifyYaml(data));

      const result = await readDynamicSchedules(stateDir, "vector");
      expect(result.schedules["test-schedule"].cron).toBe("0 9 * * *");
    });

    it("performs lazy TTL expiration on read", async () => {
      const dir = getDynamicSchedulesDir(stateDir);
      await mkdir(dir, { recursive: true });
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const data: DynamicScheduleFile = {
        version: 1,
        schedules: {
          expired: {
            type: "interval",
            interval: "1h",
            prompt: "Expired task",
            enabled: true,
            created_at: "2026-01-01T00:00:00.000Z",
            ttl_hours: 1,
            expires_at: pastDate,
          },
          active: {
            type: "interval",
            interval: "1h",
            prompt: "Active task",
            enabled: true,
            created_at: "2026-03-01T00:00:00.000Z",
            ttl_hours: 168,
            expires_at: futureDate,
          },
        },
      };
      await writeFile(join(dir, "vector.yaml"), stringifyYaml(data));

      const result = await readDynamicSchedules(stateDir, "vector");
      expect(Object.keys(result.schedules)).toEqual(["active"]);

      // Verify the file was cleaned up on disk
      const ondisk = stringifyYaml(
        JSON.parse(JSON.stringify(await readDynamicSchedules(stateDir, "vector"))),
      );
      expect(ondisk).not.toContain("expired");
    });
  });

  // ===========================================================================
  // CRUD: Create
  // ===========================================================================

  describe("createDynamicSchedule", () => {
    it("creates a cron schedule", async () => {
      const schedule = await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "daily-check",
          type: "cron",
          cron: "0 9 * * *",
          prompt: "Check for updates",
        },
        defaultOptions,
      );

      expect(schedule.type).toBe("cron");
      expect(schedule.cron).toBe("0 9 * * *");
      expect(schedule.enabled).toBe(true);
      expect(schedule.created_at).toBeDefined();
    });

    it("creates an interval schedule", async () => {
      const schedule = await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "hourly-check",
          type: "interval",
          interval: "1h",
          prompt: "Check hourly",
        },
        defaultOptions,
      );

      expect(schedule.type).toBe("interval");
      expect(schedule.interval).toBe("1h");
    });

    it("creates a schedule with TTL", async () => {
      const schedule = await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "temp-check",
          type: "interval",
          interval: "30m",
          prompt: "Temporary check",
          ttl_hours: 24,
        },
        defaultOptions,
      );

      expect(schedule.ttl_hours).toBe(24);
      expect(schedule.expires_at).toBeDefined();
      const expiresAt = new Date(schedule.expires_at!);
      const createdAt = new Date(schedule.created_at);
      const diffHours = (expiresAt.getTime() - createdAt.getTime()) / 3600000;
      expect(Math.abs(diffHours - 24)).toBeLessThan(1);
    });

    it("persists to disk", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "persisted",
          type: "interval",
          interval: "1h",
          prompt: "Test persistence",
        },
        defaultOptions,
      );

      const filePath = getDynamicScheduleFilePath(stateDir, "vector");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("persisted");
    });

    it("rejects invalid schedule names", async () => {
      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "../evil",
            type: "interval",
            interval: "1h",
            prompt: "Bad name",
          },
          defaultOptions,
        ),
      ).rejects.toThrow("Invalid schedule name");
    });

    it("rejects invalid cron expressions", async () => {
      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "bad-cron",
            type: "cron",
            cron: "not a cron",
            prompt: "Bad cron",
          },
          defaultOptions,
        ),
      ).rejects.toThrow("Invalid cron expression");
    });

    it("rejects cron schedule missing cron field", async () => {
      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "missing-cron",
            type: "cron",
            prompt: "No cron",
          },
          defaultOptions,
        ),
      ).rejects.toThrow("requires a cron expression");
    });

    it("rejects interval schedule missing interval field", async () => {
      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "missing-interval",
            type: "interval",
            prompt: "No interval",
          },
          defaultOptions,
        ),
      ).rejects.toThrow("requires an interval value");
    });

    it("rejects duplicate schedule names", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "unique",
          type: "interval",
          interval: "1h",
          prompt: "First",
        },
        defaultOptions,
      );

      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "unique",
            type: "interval",
            interval: "2h",
            prompt: "Duplicate",
          },
          defaultOptions,
        ),
      ).rejects.toThrow(ScheduleNameConflictError);
    });

    it("rejects when static schedule name collision exists", async () => {
      const options = { ...defaultOptions, staticScheduleNames: ["daily-report"] };

      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "daily-report",
            type: "interval",
            interval: "1h",
            prompt: "Collision",
          },
          options,
        ),
      ).rejects.toThrow(ScheduleNameConflictError);
    });

    it("enforces max schedule count", async () => {
      const options = { ...defaultOptions, maxSchedules: 2 };

      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "one",
          type: "interval",
          interval: "1h",
          prompt: "First",
        },
        options,
      );

      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "two",
          type: "interval",
          interval: "2h",
          prompt: "Second",
        },
        options,
      );

      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "three",
            type: "interval",
            interval: "3h",
            prompt: "Third",
          },
          options,
        ),
      ).rejects.toThrow(ScheduleLimitExceededError);
    });

    it("enforces minimum interval", async () => {
      const options = { ...defaultOptions, minInterval: "10m" };

      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "too-fast",
            type: "interval",
            interval: "1m",
            prompt: "Too fast",
          },
          options,
        ),
      ).rejects.toThrow(MinIntervalViolationError);
    });

    it("enforces minimum interval for cron schedules", async () => {
      const options = { ...defaultOptions, minInterval: "10m" };

      await expect(
        createDynamicSchedule(
          stateDir,
          "vector",
          {
            name: "too-fast-cron",
            type: "cron",
            cron: "* * * * *", // every minute
            prompt: "Too fast cron",
          },
          options,
        ),
      ).rejects.toThrow(MinIntervalViolationError);
    });
  });

  // ===========================================================================
  // CRUD: Update
  // ===========================================================================

  describe("updateDynamicSchedule", () => {
    it("updates prompt", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "updatable",
          type: "interval",
          interval: "1h",
          prompt: "Original prompt",
        },
        defaultOptions,
      );

      const updated = await updateDynamicSchedule(
        stateDir,
        "vector",
        "updatable",
        {
          prompt: "New prompt",
        },
        defaultOptions,
      );

      expect(updated.prompt).toBe("New prompt");
      expect(updated.interval).toBe("1h");
    });

    it("updates enabled status", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "toggleable",
          type: "interval",
          interval: "1h",
          prompt: "Toggle test",
        },
        defaultOptions,
      );

      const updated = await updateDynamicSchedule(
        stateDir,
        "vector",
        "toggleable",
        {
          enabled: false,
        },
        defaultOptions,
      );

      expect(updated.enabled).toBe(false);
    });

    it("removes TTL when set to null", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "ttl-remove",
          type: "interval",
          interval: "1h",
          prompt: "TTL test",
          ttl_hours: 24,
        },
        defaultOptions,
      );

      const updated = await updateDynamicSchedule(
        stateDir,
        "vector",
        "ttl-remove",
        {
          ttl_hours: null,
        },
        defaultOptions,
      );

      expect(updated.ttl_hours).toBeUndefined();
      expect(updated.expires_at).toBeNull();
    });

    it("throws for nonexistent schedule", async () => {
      await expect(
        updateDynamicSchedule(
          stateDir,
          "vector",
          "nonexistent",
          {
            prompt: "Test",
          },
          defaultOptions,
        ),
      ).rejects.toThrow('Schedule "nonexistent" not found');
    });
  });

  // ===========================================================================
  // CRUD: Delete
  // ===========================================================================

  describe("deleteDynamicSchedule", () => {
    it("deletes a schedule", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "deletable",
          type: "interval",
          interval: "1h",
          prompt: "Delete me",
        },
        defaultOptions,
      );

      await deleteDynamicSchedule(stateDir, "vector", "deletable");

      const schedules = await listDynamicSchedules(stateDir, "vector");
      expect(Object.keys(schedules)).toHaveLength(0);
    });

    it("removes file when last schedule is deleted", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "last-one",
          type: "interval",
          interval: "1h",
          prompt: "Last",
        },
        defaultOptions,
      );

      await deleteDynamicSchedule(stateDir, "vector", "last-one");

      // File should be gone
      const result = await readDynamicSchedules(stateDir, "vector");
      expect(result.schedules).toEqual({});
    });

    it("throws for nonexistent schedule", async () => {
      await expect(deleteDynamicSchedule(stateDir, "vector", "nonexistent")).rejects.toThrow(
        'Schedule "nonexistent" not found',
      );
    });
  });

  // ===========================================================================
  // CRUD: List
  // ===========================================================================

  describe("listDynamicSchedules", () => {
    it("returns empty map when no schedules exist", async () => {
      const result = await listDynamicSchedules(stateDir, "vector");
      expect(result).toEqual({});
    });

    it("returns all schedules", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "one",
          type: "interval",
          interval: "1h",
          prompt: "First",
        },
        defaultOptions,
      );

      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "two",
          type: "cron",
          cron: "0 9 * * *",
          prompt: "Second",
        },
        defaultOptions,
      );

      const result = await listDynamicSchedules(stateDir, "vector");
      expect(Object.keys(result)).toEqual(["one", "two"]);
    });
  });

  // ===========================================================================
  // Loader (loadAllDynamicSchedules)
  // ===========================================================================

  describe("loadAllDynamicSchedules", () => {
    it("returns empty map when no dynamic-schedules dir exists", async () => {
      const result = await loadAllDynamicSchedules(stateDir);
      expect(result.size).toBe(0);
    });

    it("loads schedules from multiple agents", async () => {
      await createDynamicSchedule(
        stateDir,
        "vector",
        {
          name: "v-schedule",
          type: "interval",
          interval: "1h",
          prompt: "Vector",
        },
        defaultOptions,
      );

      await createDynamicSchedule(
        stateDir,
        "briefing",
        {
          name: "b-schedule",
          type: "cron",
          cron: "0 6 * * *",
          prompt: "Briefing",
        },
        defaultOptions,
      );

      const result = await loadAllDynamicSchedules(stateDir);
      expect(result.size).toBe(2);
      expect(result.has("vector")).toBe(true);
      expect(result.has("briefing")).toBe(true);
      expect(result.get("vector")!["v-schedule"].type).toBe("interval");
      expect(result.get("briefing")!["b-schedule"].type).toBe("cron");
    });

    it("skips non-yaml files", async () => {
      const dir = getDynamicSchedulesDir(stateDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "readme.txt"), "not a schedule file");

      const result = await loadAllDynamicSchedules(stateDir);
      expect(result.size).toBe(0);
    });
  });
});
