/**
 * Session attribution module
 *
 * Determines the origin of a Claude Code session (web, discord, slack, schedule, or native CLI)
 * by cross-referencing HerdCTL's job metadata and platform session YAML files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { z } from "zod";
import { createLogger } from "../utils/logger.js";
import { listJobs } from "./job-metadata.js";
import type { TriggerType } from "./schemas/job-metadata.js";

// =============================================================================
// Types
// =============================================================================

export type SessionOrigin = "web" | "discord" | "slack" | "schedule" | "native";

export interface SessionAttribution {
  origin: SessionOrigin;
  agentName: string | undefined;
  triggerType: string | undefined;
}

export interface AttributionIndex {
  /** Attribute a single session ID */
  getAttribute(sessionId: string): SessionAttribution;
  /** Batch attribute multiple session IDs */
  getAttributes(sessionIds: string[]): Map<string, SessionAttribution>;
  /** Number of entries in the index (for diagnostics) */
  readonly size: number;
}

// =============================================================================
// Internal Types
// =============================================================================

interface JobIndexEntry {
  agent: string;
  triggerType: string;
}

interface PlatformIndexEntry {
  platform: "discord" | "slack" | "web";
  agentName: string;
}

// =============================================================================
// Schemas
// =============================================================================

const PlatformSessionSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  agentName: z.string(),
  channels: z.record(
    z.string(),
    z.object({
      sessionId: z.string(),
      lastMessageAt: z.string(),
    }),
  ),
});

// =============================================================================
// Logger
// =============================================================================

const logger = createLogger("SessionAttribution");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a trigger type to a session origin
 */
function triggerTypeToOrigin(triggerType: TriggerType): SessionOrigin {
  switch (triggerType) {
    case "web":
      return "web";
    case "discord":
      return "discord";
    case "slack":
      return "slack";
    case "schedule":
      return "schedule";
    // manual, webhook, chat, fork — all treated as native CLI usage
    default:
      return "native";
  }
}

/**
 * Build the job index from job metadata files
 */
async function buildJobIndex(jobsDir: string): Promise<Map<string, JobIndexEntry>> {
  const index = new Map<string, JobIndexEntry>();

  const result = await listJobs(jobsDir, {}, { logger });

  for (const job of result.jobs) {
    if (job.session_id) {
      index.set(job.session_id, {
        agent: job.agent,
        triggerType: job.trigger_type,
      });
    }
  }

  return index;
}

/**
 * Build the platform index from platform session YAML files
 */
async function buildPlatformIndex(stateDir: string): Promise<Map<string, PlatformIndexEntry>> {
  const index = new Map<string, PlatformIndexEntry>();
  const platforms = ["discord", "slack", "web"] as const;

  for (const platform of platforms) {
    const sessionDir = path.join(stateDir, `${platform}-sessions`);

    let fileNames: string[];
    try {
      fileNames = await fs.readdir(sessionDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Session directory does not exist: ${sessionDir}`);
        continue;
      }
      throw error;
    }

    const yamlFiles = fileNames.filter((name) => name.endsWith(".yaml"));

    for (const fileName of yamlFiles) {
      const filePath = path.join(sessionDir, fileName);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = yaml.parse(content);
        const validated = PlatformSessionSchema.safeParse(parsed);

        if (!validated.success) {
          logger.warn(`Malformed platform session file: ${filePath}: ${validated.error.message}`);
          continue;
        }

        const session = validated.data;

        for (const channel of Object.values(session.channels)) {
          index.set(channel.sessionId, {
            platform,
            agentName: session.agentName,
          });
        }
      } catch (error) {
        if (error instanceof yaml.YAMLParseError) {
          logger.warn(`Failed to parse YAML file: ${filePath}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
  }

  return index;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Build an attribution index from job metadata and platform YAML files
 *
 * @param stateDir - Path to the .herdctl state directory
 * @returns An AttributionIndex for looking up session origins
 *
 * @example
 * ```typescript
 * const index = await buildAttributionIndex('/path/to/.herdctl');
 * const attribution = index.getAttribute('session-123');
 * console.log(attribution.origin); // 'discord'
 * ```
 */
export async function buildAttributionIndex(stateDir: string): Promise<AttributionIndex> {
  const jobsDir = path.join(stateDir, "jobs");

  const [jobIndex, platformIndex] = await Promise.all([
    buildJobIndex(jobsDir),
    buildPlatformIndex(stateDir),
  ]);

  const getAttribute = (sessionId: string): SessionAttribution => {
    // Check job index first
    const jobEntry = jobIndex.get(sessionId);
    if (jobEntry) {
      return {
        origin: triggerTypeToOrigin(jobEntry.triggerType as TriggerType),
        agentName: jobEntry.agent,
        triggerType: jobEntry.triggerType,
      };
    }

    // Check platform index
    const platformEntry = platformIndex.get(sessionId);
    if (platformEntry) {
      return {
        origin: platformEntry.platform,
        agentName: platformEntry.agentName,
        triggerType: undefined,
      };
    }

    // Default to native
    return {
      origin: "native",
      agentName: undefined,
      triggerType: undefined,
    };
  };

  const getAttributes = (sessionIds: string[]): Map<string, SessionAttribution> => {
    const result = new Map<string, SessionAttribution>();
    for (const sessionId of sessionIds) {
      result.set(sessionId, getAttribute(sessionId));
    }
    return result;
  };

  // Calculate unique session IDs across both indexes
  const allSessionIds = new Set([...jobIndex.keys(), ...platformIndex.keys()]);

  return {
    getAttribute,
    getAttributes,
    get size() {
      return allSessionIds.size;
    },
  };
}
