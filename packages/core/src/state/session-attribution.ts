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
import { JobMetadataSchema, type TriggerType } from "./schemas/job-metadata.js";
import { safeReadYaml } from "./utils/reads.js";

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

  return createAttributionIndex(jobIndex, platformIndex);
}

/**
 * Assemble the {@link AttributionIndex} lookup object from a job index and a
 * platform index. Shared by the full {@link buildAttributionIndex} and the
 * incremental {@link AttributionIndexBuilder}.
 */
function createAttributionIndex(
  jobIndex: Map<string, JobIndexEntry>,
  platformIndex: Map<string, PlatformIndexEntry>,
): AttributionIndex {
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

/** One job file's contribution to the index, memoized by the builder. */
interface CachedJobFile {
  /** File mtime (epoch ms) when last parsed — the cache-invalidation key. */
  mtimeMs: number;
  /**
   * The session→attribution entry this job contributes, or `null` when the job
   * has no `session_id` yet (e.g. still running) or failed to parse. Cached
   * either way so we don't re-read an unchanged file.
   */
  entry: { sessionId: string; agent: string; triggerType: string } | null;
}

/**
 * Incremental builder for the attribution index.
 *
 * The full {@link buildAttributionIndex} reads and YAML-parses *every* job record
 * on each build. For a long-running fleet that accumulates thousands of jobs,
 * that's the dominant cost of listing sessions once the per-listing cache
 * expires. Job records are effectively immutable except for a small tail (a job
 * gains its `session_id` and a terminal status when it finishes), so this builder
 * keeps a per-file cache keyed on mtime and re-parses only files that are new or
 * whose mtime changed — turning each rebuild from O(jobs) reads into O(jobs)
 * cheap stats + O(changed) parses.
 *
 * Platform session files are few and mutable, so they're still read in full each
 * build.
 *
 * A single builder instance must be reused across builds to get the benefit.
 */
export class AttributionIndexBuilder {
  private readonly jobFileCache = new Map<string, CachedJobFile>();

  /** Build (or incrementally refresh) the attribution index for a state dir. */
  async build(stateDir: string): Promise<AttributionIndex> {
    const jobsDir = path.join(stateDir, "jobs");
    const [jobIndex, platformIndex] = await Promise.all([
      this.buildJobIndexIncremental(jobsDir),
      buildPlatformIndex(stateDir),
    ]);
    return createAttributionIndex(jobIndex, platformIndex);
  }

  private async buildJobIndexIncremental(jobsDir: string): Promise<Map<string, JobIndexEntry>> {
    let files: string[];
    try {
      files = await fs.readdir(jobsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.jobFileCache.clear();
        return new Map();
      }
      throw error;
    }

    const jobFiles = files.filter((f) => f.startsWith("job-") && f.endsWith(".yaml"));
    const present = new Set(jobFiles);

    // Drop cache entries for job files that have been deleted/pruned.
    for (const cachedFile of this.jobFileCache.keys()) {
      if (!present.has(cachedFile)) {
        this.jobFileCache.delete(cachedFile);
      }
    }

    // Stat every file (cheap); re-parse only new or changed ones.
    await Promise.all(
      jobFiles.map(async (file) => {
        const filePath = path.join(jobsDir, file);

        let mtimeMs: number;
        try {
          mtimeMs = (await fs.stat(filePath)).mtimeMs;
        } catch {
          // Vanished between readdir and stat — forget it.
          this.jobFileCache.delete(file);
          return;
        }

        const cached = this.jobFileCache.get(file);
        if (cached && cached.mtimeMs === mtimeMs) {
          return; // unchanged — reuse the cached contribution
        }

        const result = await safeReadYaml<unknown>(filePath);
        if (!result.success) {
          logger.warn(`Failed to read job file ${filePath}: ${result.error.message}`);
          this.jobFileCache.set(file, { mtimeMs, entry: null });
          return;
        }

        const parsed = JobMetadataSchema.safeParse(result.data);
        if (!parsed.success) {
          logger.warn(`Corrupted job file ${filePath}: ${parsed.error.message}`);
          this.jobFileCache.set(file, { mtimeMs, entry: null });
          return;
        }

        const job = parsed.data;
        this.jobFileCache.set(file, {
          mtimeMs,
          entry: job.session_id
            ? { sessionId: job.session_id, agent: job.agent, triggerType: job.trigger_type }
            : null,
        });
      }),
    );

    // Assemble the session→attribution map from the cached per-file contributions.
    const index = new Map<string, JobIndexEntry>();
    for (const { entry } of this.jobFileCache.values()) {
      if (entry) {
        index.set(entry.sessionId, { agent: entry.agent, triggerType: entry.triggerType });
      }
    }
    return index;
  }
}
