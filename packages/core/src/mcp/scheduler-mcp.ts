#!/usr/bin/env node
/**
 * herdctl-scheduler MCP server
 *
 * Standalone stdio MCP server that allows agents to create, list, update,
 * and delete their own dynamic schedules at runtime.
 *
 * Scoped to a single agent via HERDCTL_AGENT_NAME env var.
 * All operations are namespace-isolated — an agent can only manage its own schedules.
 *
 * Environment variables (set by auto-injection in config loader):
 *   HERDCTL_AGENT_NAME   — agent this server is scoped to
 *   HERDCTL_STATE_DIR     — path to .herdctl/ directory
 *   HERDCTL_MAX_SCHEDULES — max dynamic schedules allowed (default: 10)
 *   HERDCTL_MIN_INTERVAL  — minimum interval between triggers (default: "5m")
 *   HERDCTL_STATIC_SCHEDULES — comma-separated list of static schedule names
 *
 * Usage:
 *   node dist/mcp/scheduler-mcp.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createDynamicSchedule,
  DynamicScheduleError,
  deleteDynamicSchedule,
  listDynamicSchedules,
  MinIntervalViolationError,
  ScheduleLimitExceededError,
  ScheduleNameConflictError,
  updateDynamicSchedule,
} from "../scheduler/dynamic-schedules.js";

// =============================================================================
// Configuration from environment
// =============================================================================

const EnvSchema = z.object({
  HERDCTL_AGENT_NAME: z.string().min(1, "HERDCTL_AGENT_NAME is required"),
  HERDCTL_STATE_DIR: z.string().min(1, "HERDCTL_STATE_DIR is required"),
  HERDCTL_MAX_SCHEDULES: z.coerce.number().int().positive().default(10),
  HERDCTL_MIN_INTERVAL: z.string().default("5m"),
  HERDCTL_STATIC_SCHEDULES: z.string().optional().default(""),
});

const envResult = EnvSchema.safeParse(process.env);
if (!envResult.success) {
  console.error(`Invalid environment: ${envResult.error.issues.map((i) => i.message).join(", ")}`);
  process.exit(1);
}

const AGENT_NAME = envResult.data.HERDCTL_AGENT_NAME;
const STATE_DIR = envResult.data.HERDCTL_STATE_DIR;
const MAX_SCHEDULES = envResult.data.HERDCTL_MAX_SCHEDULES;
const MIN_INTERVAL = envResult.data.HERDCTL_MIN_INTERVAL;
const STATIC_SCHEDULES = envResult.data.HERDCTL_STATIC_SCHEDULES.split(",").filter(Boolean);

const scheduleOptions = {
  maxSchedules: MAX_SCHEDULES,
  minInterval: MIN_INTERVAL,
  staticScheduleNames: STATIC_SCHEDULES,
};

// =============================================================================
// MCP Server
// =============================================================================

const server = new McpServer(
  {
    name: "herdctl-scheduler",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// --- herdctl_create_schedule ---

server.tool(
  "herdctl_create_schedule",
  "Create a new dynamic schedule for this agent. The schedule will persist across restarts and be evaluated by the herdctl scheduler.",
  {
    name: z
      .string()
      .describe("Schedule name (alphanumeric, hyphens, underscores). Must be unique."),
    type: z
      .enum(["cron", "interval"])
      .describe("Schedule type: 'cron' for cron expressions, 'interval' for fixed intervals"),
    cron: z
      .string()
      .optional()
      .describe("Cron expression (required when type is 'cron'). Example: '0 8,12,16,20 * * *'"),
    interval: z
      .string()
      .optional()
      .describe(
        "Interval duration (required when type is 'interval'). Format: {number}{unit} where unit is s/m/h/d. Example: '30m', '6h'",
      ),
    prompt: z
      .string()
      .max(10000)
      .describe(
        "The prompt to execute when this schedule triggers. This is what the agent will be asked to do. Max 10,000 characters.",
      ),
    ttl_hours: z
      .number()
      .optional()
      .describe(
        "Optional time-to-live in hours. The schedule auto-expires after this duration. Example: 168 for 7 days.",
      ),
    enabled: z.boolean().optional().describe("Whether the schedule is enabled (default: true)"),
  },
  async (args) => {
    try {
      const schedule = await createDynamicSchedule(
        STATE_DIR,
        AGENT_NAME,
        {
          name: args.name,
          type: args.type,
          cron: args.cron,
          interval: args.interval,
          prompt: args.prompt,
          ttl_hours: args.ttl_hours,
          enabled: args.enabled,
        },
        scheduleOptions,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                message: `Schedule "${args.name}" created successfully`,
                schedule: { name: args.name, ...schedule },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return formatError(error);
    }
  },
);

// --- herdctl_list_schedules ---

server.tool(
  "herdctl_list_schedules",
  "List all dynamic schedules for this agent.",
  {},
  async () => {
    try {
      const schedules = await listDynamicSchedules(STATE_DIR, AGENT_NAME);
      const count = Object.keys(schedules).length;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                agent: AGENT_NAME,
                count,
                max_schedules: MAX_SCHEDULES,
                schedules,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return formatError(error);
    }
  },
);

// --- herdctl_update_schedule ---

server.tool(
  "herdctl_update_schedule",
  "Update an existing dynamic schedule. Only specified fields are changed.",
  {
    name: z.string().describe("Name of the schedule to update"),
    cron: z.string().optional().describe("New cron expression"),
    interval: z.string().optional().describe("New interval duration"),
    prompt: z.string().optional().describe("New prompt text"),
    ttl_hours: z
      .number()
      .nullable()
      .optional()
      .describe("New TTL in hours. Set to null to remove TTL."),
    enabled: z.boolean().optional().describe("Enable or disable the schedule"),
  },
  async (args) => {
    try {
      const { name, ...updates } = args;
      const schedule = await updateDynamicSchedule(
        STATE_DIR,
        AGENT_NAME,
        name,
        updates,
        scheduleOptions,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                message: `Schedule "${name}" updated successfully`,
                schedule: { name, ...schedule },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return formatError(error);
    }
  },
);

// --- herdctl_delete_schedule ---

server.tool(
  "herdctl_delete_schedule",
  "Delete a dynamic schedule.",
  {
    name: z.string().describe("Name of the schedule to delete"),
  },
  async (args) => {
    try {
      await deleteDynamicSchedule(STATE_DIR, AGENT_NAME, args.name);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                message: `Schedule "${args.name}" deleted successfully`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return formatError(error);
    }
  },
);

// =============================================================================
// Error Formatting
// =============================================================================

function formatError(error: unknown) {
  let message: string;
  let errorType = "unknown_error";

  if (error instanceof ScheduleLimitExceededError) {
    errorType = "limit_exceeded";
    message = error.message;
  } else if (error instanceof MinIntervalViolationError) {
    errorType = "min_interval_violation";
    message = error.message;
  } else if (error instanceof ScheduleNameConflictError) {
    errorType = "name_conflict";
    message = error.message;
  } else if (error instanceof DynamicScheduleError) {
    errorType = "validation_error";
    message = error.message;
  } else {
    message = error instanceof Error ? error.message : String(error);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error: errorType, message }, null, 2),
      },
    ],
    isError: true,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start herdctl-scheduler MCP server:", error);
  process.exit(1);
});
