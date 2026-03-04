/**
 * Dynamic schedule store for agent self-scheduling
 *
 * Manages per-agent YAML files in .herdctl/dynamic-schedules/ that hold
 * schedules created by agents at runtime via the scheduler MCP server.
 *
 * Design:
 * - One file per agent: eliminates cross-agent write contention
 * - Atomic writes: uses the same atomicWriteYaml pattern as state.yaml
 * - TTL expiration: lazy cleanup on read (no background timer needed)
 * - Namespace isolation: qualified name validated against QUALIFIED_NAME_PATTERN
 */

import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { atomicWriteYaml } from "../state/utils/atomic.js";
import { createLogger } from "../utils/logger.js";
import { calculateNextCronTrigger, isValidCronExpression } from "./cron.js";
import { parseInterval } from "./interval.js";

const logger = createLogger("dynamic-schedules");

// =============================================================================
// Schema
// =============================================================================

/**
 * Schema for a single dynamic schedule entry
 */
export const DynamicScheduleSchema = z.object({
  type: z.enum(["cron", "interval"]),
  cron: z.string().optional(),
  interval: z.string().optional(),
  prompt: z.string().max(10000),
  enabled: z.boolean().default(true),
  created_at: z.string(),
  ttl_hours: z.number().positive().optional(),
  expires_at: z.string().nullable().optional(),
});

export type DynamicSchedule = z.infer<typeof DynamicScheduleSchema>;

/**
 * Schema for the per-agent dynamic schedules YAML file
 */
export const DynamicScheduleFileSchema = z.object({
  version: z.number().int().positive().default(1),
  schedules: z.record(z.string(), DynamicScheduleSchema).default({}),
});

export type DynamicScheduleFile = z.infer<typeof DynamicScheduleFileSchema>;

/**
 * Qualified agent name pattern for file path construction.
 * Allows dots (for qualified names like "fleet.agent") but rejects ".."
 * sequences to prevent path traversal.
 */
const QUALIFIED_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * Schedule name pattern — same rules as agent names
 */
const SCHEDULE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

// =============================================================================
// Error Classes
// =============================================================================

export class DynamicScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DynamicScheduleError";
  }
}

export class ScheduleLimitExceededError extends DynamicScheduleError {
  constructor(agentName: string, max: number) {
    super(`Agent "${agentName}" has reached the maximum of ${max} dynamic schedules`);
    this.name = "ScheduleLimitExceededError";
  }
}

export class MinIntervalViolationError extends DynamicScheduleError {
  constructor(scheduleName: string, actual: string, minimum: string) {
    super(`Schedule "${scheduleName}" interval "${actual}" is below the minimum "${minimum}"`);
    this.name = "MinIntervalViolationError";
  }
}

export class ScheduleNameConflictError extends DynamicScheduleError {
  constructor(scheduleName: string, reason: string) {
    super(`Cannot create schedule "${scheduleName}": ${reason}`);
    this.name = "ScheduleNameConflictError";
  }
}

// =============================================================================
// Path Helpers
// =============================================================================

/**
 * Get the directory for dynamic schedule files
 */
export function getDynamicSchedulesDir(stateDir: string): string {
  return join(stateDir, "dynamic-schedules");
}

/**
 * Get the file path for a specific agent's dynamic schedules
 */
export function getDynamicScheduleFilePath(stateDir: string, agentName: string): string {
  // Validate agent name to prevent path traversal.
  // Qualified names like "fleet.agent" contain dots, so we allow single dots
  // but reject ".." sequences which would escape the directory.
  if (!QUALIFIED_NAME_PATTERN.test(agentName) || agentName.includes("..")) {
    throw new DynamicScheduleError(
      `Invalid agent name "${agentName}": must match ${QUALIFIED_NAME_PATTERN.source} (no ".." sequences)`,
    );
  }
  return join(getDynamicSchedulesDir(stateDir), `${agentName}.yaml`);
}

// =============================================================================
// Read / Write
// =============================================================================

/**
 * Read dynamic schedules for an agent from disk.
 *
 * This is a pure read — it does NOT write back expired schedules.
 * TTL filtering is applied in-memory: callers see only non-expired schedules,
 * but the file is not modified. This avoids write contention when multiple
 * readers (scheduler tick, MCP server, CLI) access the same file concurrently.
 *
 * Expired entries are cleaned up during mutations (create/update/delete)
 * which already perform a read-modify-write cycle.
 */
export async function readDynamicSchedules(
  stateDir: string,
  agentName: string,
): Promise<DynamicScheduleFile> {
  const parsed = await readRawDynamicSchedules(stateDir, agentName);

  // Filter expired schedules in-memory (no write-back)
  const now = new Date();
  const activeSchedules: Record<string, DynamicSchedule> = {};

  for (const [name, schedule] of Object.entries(parsed.schedules)) {
    if (schedule.expires_at && new Date(schedule.expires_at) <= now) {
      continue; // Skip expired schedule
    }
    activeSchedules[name] = schedule;
  }

  return { version: parsed.version, schedules: activeSchedules };
}

/**
 * Read the raw file content including expired entries.
 * Used internally by mutations that will write back anyway.
 */
async function readRawDynamicSchedules(
  stateDir: string,
  agentName: string,
): Promise<DynamicScheduleFile> {
  const filePath = getDynamicScheduleFilePath(stateDir, agentName);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, schedules: {} };
    }
    throw error;
  }

  const raw = parseYaml(content);
  if (!raw || typeof raw !== "object") {
    return { version: 1, schedules: {} };
  }

  return DynamicScheduleFileSchema.parse(raw);
}

/**
 * Strip expired entries from a schedule file in-place.
 * Called during mutations to piggyback cleanup on writes.
 */
function stripExpired(file: DynamicScheduleFile): void {
  const now = new Date();
  for (const [name, schedule] of Object.entries(file.schedules)) {
    if (schedule.expires_at && new Date(schedule.expires_at) <= now) {
      delete file.schedules[name];
    }
  }
}

/**
 * Write dynamic schedules for an agent atomically
 */
async function writeDynamicSchedules(
  stateDir: string,
  agentName: string,
  data: DynamicScheduleFile,
): Promise<void> {
  const dir = getDynamicSchedulesDir(stateDir);
  await mkdir(dir, { recursive: true });
  const filePath = getDynamicScheduleFilePath(stateDir, agentName);
  await atomicWriteYaml(filePath, data);
}

// =============================================================================
// CRUD Operations
// =============================================================================

export interface CreateScheduleInput {
  name: string;
  type: "cron" | "interval";
  cron?: string;
  interval?: string;
  prompt: string;
  ttl_hours?: number;
  enabled?: boolean;
}

export interface UpdateScheduleInput {
  cron?: string;
  interval?: string;
  prompt?: string;
  ttl_hours?: number | null;
  enabled?: boolean;
}

export interface DynamicScheduleOptions {
  maxSchedules: number;
  minInterval: string;
  /** Static schedule names for this agent — used to prevent name collisions */
  staticScheduleNames?: string[];
}

/**
 * Create a new dynamic schedule for an agent
 */
export async function createDynamicSchedule(
  stateDir: string,
  agentName: string,
  input: CreateScheduleInput,
  options: DynamicScheduleOptions,
): Promise<DynamicSchedule> {
  // Validate schedule name
  if (!SCHEDULE_NAME_PATTERN.test(input.name)) {
    throw new DynamicScheduleError(
      `Invalid schedule name "${input.name}": must match ${SCHEDULE_NAME_PATTERN.source}`,
    );
  }

  // Validate schedule type matches provided fields
  if (input.type === "cron") {
    if (!input.cron) {
      throw new DynamicScheduleError("Cron schedule requires a cron expression");
    }
    if (!isValidCronExpression(input.cron)) {
      throw new DynamicScheduleError(`Invalid cron expression: "${input.cron}"`);
    }
  } else if (input.type === "interval") {
    if (!input.interval) {
      throw new DynamicScheduleError("Interval schedule requires an interval value");
    }
    // parseInterval throws on invalid format
    parseInterval(input.interval);
  }

  // Validate minimum interval
  validateMinInterval(input.name, input, options.minInterval);

  // Check for static schedule name collision
  if (options.staticScheduleNames?.includes(input.name)) {
    throw new ScheduleNameConflictError(
      input.name,
      "a static schedule with this name already exists",
    );
  }

  // Read current schedules (raw — includes expired entries for cleanup)
  const file = await readRawDynamicSchedules(stateDir, agentName);
  stripExpired(file);

  // Check for duplicate name
  if (input.name in file.schedules) {
    throw new ScheduleNameConflictError(
      input.name,
      "a dynamic schedule with this name already exists",
    );
  }

  // Check schedule count limit (against non-expired count)
  if (Object.keys(file.schedules).length >= options.maxSchedules) {
    throw new ScheduleLimitExceededError(agentName, options.maxSchedules);
  }

  // Build and validate the schedule before persisting
  const now = new Date().toISOString();
  const schedule = DynamicScheduleSchema.parse({
    type: input.type,
    ...(input.cron && { cron: input.cron }),
    ...(input.interval && { interval: input.interval }),
    prompt: input.prompt,
    enabled: input.enabled ?? true,
    created_at: now,
    ...(input.ttl_hours != null && {
      ttl_hours: input.ttl_hours,
      expires_at: new Date(Date.now() + input.ttl_hours * 3600000).toISOString(),
    }),
  });

  file.schedules[input.name] = schedule;
  await writeDynamicSchedules(stateDir, agentName, file);

  return schedule;
}

/**
 * Update an existing dynamic schedule
 */
export async function updateDynamicSchedule(
  stateDir: string,
  agentName: string,
  scheduleName: string,
  updates: UpdateScheduleInput,
  options: DynamicScheduleOptions,
): Promise<DynamicSchedule> {
  const file = await readRawDynamicSchedules(stateDir, agentName);
  stripExpired(file);

  if (!(scheduleName in file.schedules)) {
    throw new DynamicScheduleError(`Schedule "${scheduleName}" not found`);
  }

  const existing = file.schedules[scheduleName];

  // If updating cron, validate it
  if (updates.cron !== undefined) {
    if (!isValidCronExpression(updates.cron)) {
      throw new DynamicScheduleError(`Invalid cron expression: "${updates.cron}"`);
    }
  }

  // If updating interval, validate it
  if (updates.interval !== undefined) {
    parseInterval(updates.interval);
  }

  // Validate minimum interval with the updated values
  const effectiveSchedule = {
    type: existing.type,
    cron: updates.cron ?? existing.cron,
    interval: updates.interval ?? existing.interval,
  };
  validateMinInterval(scheduleName, effectiveSchedule, options.minInterval);

  // Apply updates
  const updated: DynamicSchedule = { ...existing };
  if (updates.cron !== undefined) updated.cron = updates.cron;
  if (updates.interval !== undefined) updated.interval = updates.interval;
  if (updates.prompt !== undefined) updated.prompt = updates.prompt;
  if (updates.enabled !== undefined) updated.enabled = updates.enabled;

  // Handle TTL updates — always relative to now, not created_at.
  // If the user sets ttl_hours: 24 during an update, they expect it to
  // expire 24 hours from now, not 24 hours from the original creation time.
  if (updates.ttl_hours !== undefined) {
    if (updates.ttl_hours === null) {
      // Remove TTL
      updated.ttl_hours = undefined;
      updated.expires_at = null;
    } else {
      updated.ttl_hours = updates.ttl_hours;
      updated.expires_at = new Date(Date.now() + updates.ttl_hours * 3600000).toISOString();
    }
  }

  const validated = DynamicScheduleSchema.parse(updated);
  file.schedules[scheduleName] = validated;
  await writeDynamicSchedules(stateDir, agentName, file);

  return validated;
}

/**
 * Delete a dynamic schedule
 */
export async function deleteDynamicSchedule(
  stateDir: string,
  agentName: string,
  scheduleName: string,
): Promise<void> {
  const file = await readRawDynamicSchedules(stateDir, agentName);
  stripExpired(file);

  if (!(scheduleName in file.schedules)) {
    throw new DynamicScheduleError(`Schedule "${scheduleName}" not found`);
  }

  delete file.schedules[scheduleName];

  // If no schedules remain, delete the file
  if (Object.keys(file.schedules).length === 0) {
    const filePath = getDynamicScheduleFilePath(stateDir, agentName);
    try {
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }

  await writeDynamicSchedules(stateDir, agentName, file);
}

/**
 * List all dynamic schedules for an agent
 */
export async function listDynamicSchedules(
  stateDir: string,
  agentName: string,
): Promise<Record<string, DynamicSchedule>> {
  const file = await readDynamicSchedules(stateDir, agentName);
  return file.schedules;
}

// =============================================================================
// Loader for Scheduler Integration
// =============================================================================

/**
 * Load all dynamic schedules across all agents.
 *
 * Returns a map of agentName -> { scheduleName -> schedule }.
 * Used by the scheduler to merge dynamic schedules with static ones.
 */
export async function loadAllDynamicSchedules(
  stateDir: string,
): Promise<Map<string, Record<string, DynamicSchedule>>> {
  const { readdir } = await import("node:fs/promises");
  const dir = getDynamicSchedulesDir(stateDir);
  const result = new Map<string, Record<string, DynamicSchedule>>();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return result;
    }
    throw error;
  }

  for (const file of files) {
    if (!file.endsWith(".yaml")) continue;
    const agentName = file.replace(/\.yaml$/, "");

    try {
      const schedules = await listDynamicSchedules(stateDir, agentName);
      if (Object.keys(schedules).length > 0) {
        result.set(agentName, schedules);
      }
    } catch (parseError) {
      // Skip files that fail to parse — don't crash the scheduler.
      // Log a warning so operators can diagnose corrupt files.
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.warn(`Failed to load schedules for "${agentName}": ${msg}`);
    }
  }

  return result;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that a schedule respects the minimum interval constraint.
 *
 * For interval schedules, the interval must be >= min_interval.
 * For cron schedules, we estimate the gap between consecutive triggers
 * and reject if it's below the minimum.
 */
function validateMinInterval(
  scheduleName: string,
  schedule: { type: string; cron?: string; interval?: string },
  minInterval: string,
): void {
  const minMs = parseInterval(minInterval);

  if (schedule.type === "interval" && schedule.interval) {
    const scheduleMs = parseInterval(schedule.interval);
    if (scheduleMs < minMs) {
      throw new MinIntervalViolationError(scheduleName, schedule.interval, minInterval);
    }
  }

  if (schedule.type === "cron" && schedule.cron) {
    // Estimate the gap between consecutive cron triggers
    try {
      const now = new Date();
      const first = calculateNextCronTrigger(schedule.cron, now);
      const second = calculateNextCronTrigger(schedule.cron, first);
      const gapMs = second.getTime() - first.getTime();
      if (gapMs < minMs) {
        throw new MinIntervalViolationError(
          scheduleName,
          `~${Math.round(gapMs / 1000)}s`,
          minInterval,
        );
      }
    } catch (error) {
      // Re-throw our own errors, ignore cron parsing failures
      if (error instanceof MinIntervalViolationError) throw error;
      logger.debug(`Unexpected error estimating cron gap for "${schedule.cron}": ${error}`);
    }
  }
}
